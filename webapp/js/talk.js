/* OpenFolk web app: the voice conversation. A page over a bot's chat where listening, sending, the answer and reading
   it aloud follow each other by themselves until the user ends it (the button next to the microphone). Two ways: in the
   app (the recording goes to Whisper on the bot's machine, the answer is read aloud) or over OpenAI Realtime
   (talk-realtime.js), where OpenAI listens and speaks and this page is the bridge to the bot. */
import { t } from './i18n.js';
import { el, state } from './core.js';
import { panes } from './panes.js';
import { bot, fillAvatar, responsibleMachine, send } from './e2e.js';
import { chatStatus } from './list.js';
import { machineToWake } from './chat.js';
import { rec, startRecording, stopRecording } from './voice.js';
import { isReading, onReadingEnd, readAloud, stopReadAloud, unlockVoices } from './read-aloud.js';
import { connectRealtime, realtimeOn } from './talk-realtime.js';

/** @typedef {import('./panes.js').Pane} Pane */

// Phases: off → listening → sending → thinking → speaking → listening …; muted and paused hold the microphone, error
// shows what went wrong until the microphone button tries again, connecting waits for OpenAI. The pane behind the page
// records and sends as for a voice message (voice.js); this module only decides when. Nothing here is synced: the
// conversation belongs to this device.
// awaiting: a request is with the bot (from sending until its answer). queue: texts to read; readPrefix: what of the
// running answer was read already (talkInterim). rt: the OpenAI connection, call: its open ask_bot, said: what it says.
const talk = {
    chatId: /** @type {string | null} */ (null), pane: /** @type {Pane | null} */ (null), phase: /** @type {string} */ ('off'), since: 0, timer: 0,
    heard: false, quietSince: 0, sent: false, awaiting: false, micOff: false, starting: false, queue: [], readPrefix: '',
    heardText: '', answerText: '', error: '', level: -1, lock: /** @type {any} */ (null), shown: '',
    rt: /** @type {any} */ (null), call: '', said: '',
};

/** Level of the recorder's meter (0..1, voice.js) that counts as speech, in two of the last three samples (300 ms). */
const SPEECH_LEVEL = 0.15;
/** Silence after speech that ends the turn. */
const SILENCE_MS = 1500;
/** Listening without a word: the recording starts afresh, so a long wait does not become a long file for Whisper. */
const QUIET_RESTART_MS = 45_000;
/** Right after the transcript the bot's state may still say idle; after this, idle means nothing is coming. */
const IDLE_GRACE_MS = 5000;
/** Understanding takes a second or two with the model loaded; longer, the page says why. */
const SLOW_SENDING_MS = 6000;

/** Whether the conversation runs in this chat. */
export function talking(chatId) {
    return talk.phase !== 'off' && talk.chatId === chatId;
}

/** The button next to the microphone. @param {Pane} p */
export function startTalk(p) {
    if (talk.phase !== 'off' || !p.chatId) return;
    const b = bot(p.chatId);
    if (!b) return;
    Object.assign(talk, { chatId: p.chatId, pane: p, micOff: false, awaiting: false, queue: [], readPrefix: '', heardText: '', answerText: '', error: '', shown: '', call: '', said: '' });
    fillAvatar(el.talkAvatar, b, b.id);
    el.talkName.textContent = b.name;
    el.talk.hidden = false;
    onReadingEnd(readingEnded);
    // the tap that opens the page unlocks the sound, which iOS wants before anything plays on its own
    unlockVoices();
    // Whisper unloads after half an hour; loading it takes up to a minute, so start now and not at the first sentence
    if (!realtimeOn()) send({ type: 'voice_warmup' }, responsibleMachine(b) || undefined);
    holdScreen(true);
    talk.timer = setInterval(tick, 250);
    if (!state.agentOnline || machineToWake(p.chatId)) fail(t('talk.machineOff'));
    else if (realtimeOn()) openRealtime();
    else listen();
}

/** Back, the end button, Escape, the pane closing or switching chats. */
export function endTalk() {
    if (talk.phase === 'off') return;
    clearInterval(talk.timer);
    talk.phase = 'off';
    talk.queue = [];
    if (talk.rt) talk.rt.close();
    talk.rt = null;
    talk.call = '';
    onReadingEnd(null);
    if (rec.pane === talk.pane) stopRecording(false);
    stopReadAloud();
    holdScreen(false);
    el.talk.hidden = true;
    el.talk.dataset.phase = 'off';
    talk.chatId = null;
    talk.pane = null;
}

function setPhase(phase) {
    talk.phase = phase;
    talk.since = Date.now();
    render();
}

// ---------------------------------------------------------- In the app

/** Opens the microphone; refused, or taken by another pane, the page shows it off. */
async function listen() {
    const p = talk.pane;
    talk.heard = false;
    talk.quietSince = 0;
    talk.error = '';
    setPhase('listening');
    await startRecording(p);
    if (talk.phase !== 'listening' || talk.pane !== p) {
        // ended or moved on while the browser asked for the microphone
        if (rec.pane === p && talk.phase !== 'listening') stopRecording(false);
        return;
    }
    if (rec.pane !== p) {
        talk.micOff = true;
        setPhase('muted');
    }
}

/** The recording goes out as a voice message marked as spoken; too short, it is dropped and listening goes on.
 *  `sent` says the recording is on its way: before that, a missing placeholder means nothing yet. */
async function submit() {
    if (talk.phase !== 'listening' || rec.pane !== talk.pane) return;
    const chatId = talk.chatId;
    talk.queue = [];
    talk.readPrefix = '';
    talk.sent = false;
    talk.awaiting = true;
    setPhase('sending');
    const sent = await stopRecording(true, true);
    // the phase may have moved on while the recording was stopped (TypeScript keeps the narrowing from above)
    if (/** @type {string} */ (talk.phase) !== 'sending' || talk.chatId !== chatId) return;
    if (!sent) {
        talk.awaiting = false;
        listen();
        return;
    }
    talk.sent = true;
}

/** A long silence: the recording starts afresh. `since` moves first, so the tick does not ask again while it stops. */
async function restartListening() {
    const p = talk.pane;
    talk.since = Date.now();
    await stopRecording(false);
    if (talk.phase === 'listening' && talk.pane === p) listen();
}

/** Every 250 ms while the page is open: the meter decides the end of a turn, and the page follows the chat. */
function tick() {
    const p = talk.pane;
    if (!p || !panes.includes(p) || p.chatId !== talk.chatId) {
        endTalk();
        return;
    }
    // over OpenAI the turns are OpenAI's; the page only follows
    if (talk.rt || talk.phase === 'connecting') {
        render();
        return;
    }
    const now = Date.now();
    if (talk.phase === 'listening' && rec.pane === p) {
        const recent = rec.levels.slice(-3);
        const loud = recent.filter((v) => v > SPEECH_LEVEL).length >= 2;
        if (loud) {
            talk.heard = true;
            talk.quietSince = 0;
        } else if (talk.heard && !talk.quietSince) talk.quietSince = now;
        setLevel(recent[recent.length - 1] || 0);
        if (talk.heard && talk.quietSince && now - talk.quietSince >= SILENCE_MS) {
            submit();
            return;
        }
        if (!talk.heard && now - talk.since >= QUIET_RESTART_MS) {
            restartListening();
            return;
        }
    }
    // the transcript came within a history instead of its own frame (voice.js drops the placeholder then)
    if (talk.phase === 'sending' && talk.sent && !state.voicePending[talk.chatId]) setPhase('thinking');
    // the bot's answer came without text, or never: the chat is idle again, nothing waits, nobody speaks
    if (talk.phase === 'thinking' && now - talk.since >= IDLE_GRACE_MS && chatStatus(talk.chatId).state === 'idle' && !talk.queue.length) {
        talk.awaiting = false;
        afterSpeaking();
        return;
    }
    render();
}

/** The ring around the picture follows the microphone; set only when it changed, so a quiet room repaints nothing. */
function setLevel(level) {
    const v = Math.round(level * 20) / 20;
    if (v === talk.level) return;
    talk.level = v;
    el.talkAvatar.style.setProperty('--talk-level', String(v));
}

/** The transcript of the recording came back (connection.js, a `user` entry with `voice`). */
export function talkHeard(chatId, e) {
    if (!talking(chatId) || talk.rt || !e.voice || e.from !== 'me') return;
    talk.heardText = e.text || '';
    talk.answerText = '';
    if (talk.phase === 'sending') setPhase('thinking');
    else render();
}

let interimCount = 0;

/** Text the bot said before a tool runs (connection.js `tool`, the live text so far): read right away. The final
 *  answer begins with the same text; talkAnswer reads only what follows. */
export function talkInterim(chatId, botId, text) {
    if (!talking(chatId) || talk.rt || !talk.awaiting || !text.trim()) return;
    talk.readPrefix += text;
    enqueue({ id: `talk:${++interimCount}`, role: 'assistant', botId, text, ts: '' });
}

/** The bot's finished answer (connection.js `done`): read once whatever is being read is over; over OpenAI it is the
 *  result of the open call. Without text the page listens again. */
export function talkAnswer(chatId, e) {
    if (!talking(chatId) || e.role !== 'assistant') return;
    if (talk.rt) {
        if (talk.call) answerCall((e.text || '').trim() || t('talk.noAnswer', { name: botName() }));
        return;
    }
    talk.awaiting = false;
    const full = e.text || '';
    // what was read while the bot worked (talkInterim) is not read again; if it does not match, all of it is
    const rest = talk.readPrefix && full.startsWith(talk.readPrefix) ? full.slice(talk.readPrefix.length) : full;
    talk.readPrefix = '';
    if (rest.trim()) enqueue({ ...e, text: rest });
    else if (!talk.queue.length && talk.phase !== 'speaking') afterSpeaking();
}

function enqueue(e) {
    talk.queue.push(e);
    if (talk.phase !== 'speaking') next();
}

/** Reads the next queued text; in the background the page waits, nothing may start a sound there. */
function next() {
    const e = talk.queue.shift();
    if (!e) {
        afterSpeaking();
        return;
    }
    if (document.hidden) {
        talk.queue.unshift(e);
        setPhase('paused');
        return;
    }
    // an answer while listening (the user interrupted, the bot finished anyway): the microphone closes first
    if (rec.pane === talk.pane) stopRecording(false);
    talk.answerText = e.text;
    talk.starting = true;
    readAloud(e, talk.chatId);
    talk.starting = false;
    if (isReading(e.id)) setPhase('speaking');
    else next();
}

/** read-aloud.js: whatever was read is over, by its end or a stop. Not while this module itself starts or stops it. */
function readingEnded() {
    if (talk.starting || talk.phase !== 'speaking') return;
    next();
}

/** Nothing left to read: back to the bot's work if it is still on it, else listening. */
function afterSpeaking() {
    if (document.hidden) setPhase('paused');
    else if (talk.awaiting) setPhase('thinking');
    else if (talk.micOff) setPhase('muted');
    else listen();
}

function interrupt() {
    talk.queue = [];
    talk.starting = true;
    stopReadAloud();
    talk.starting = false;
    talk.awaiting = false;
    talk.readPrefix = '';
    afterSpeaking();
}

// ---------------------------------------------------------- Over OpenAI Realtime
// OpenAI listens, detects the end of a turn and speaks; the page shows the phase and is the bridge to the bot: a call
// of ask_bot becomes a message in the bot's chat, the bot's answer the call's result. Nothing is recorded here.

async function openRealtime() {
    const chatId = talk.chatId;
    talk.error = '';
    talk.call = '';
    setPhase('connecting');
    try {
        const rt = await connectRealtime(chatId, { onEvent: realtimeEvent, onClosed: realtimeClosed });
        if (talk.chatId !== chatId || talk.phase === 'off') { rt.close(); return; }
        talk.rt = rt;
        if (talk.micOff) rt.mute(true);
        setPhase(talk.micOff ? 'muted' : 'listening');
    } catch (e) {
        if (talk.chatId === chatId && talk.phase !== 'off') fail(/** @type {Error} */ (e).message);
    }
}

function realtimeClosed() {
    talk.rt = null;
    if (talk.phase !== 'off') fail(t('talk.dropped'));
}

/** One event of OpenAI's data channel. Its names stand in backticks: "conversation." in quotes would count as a
 *  dictionary key in tests/browser/i18n-keys.test.mjs. */
function realtimeEvent(e) {
    if (talk.phase === 'off' || !talk.rt) return;
    switch (e.type) {
        case 'input_audio_buffer.speech_started':
            if (talk.phase !== 'thinking' && talk.phase !== 'muted') setPhase('listening');
            break;
        case `conversation.item.input_audio_transcription.completed`:
            talk.heardText = e.transcript || '';
            render();
            break;
        case 'response.function_call_arguments.done':
            if (e.name === 'ask_bot') askBot(e.call_id, e.arguments);
            break;
        case 'output_audio_buffer.started':
            talk.said = '';
            setPhase('speaking');
            break;
        case 'response.output_audio_transcript.delta':
            talk.said += e.delta || '';
            talk.answerText = talk.said;
            render();
            break;
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared':
            if (talk.phase === 'speaking') setPhase(talk.call ? 'thinking' : talk.micOff ? 'muted' : 'listening');
            break;
        case 'error':
            talk.error = (e.error && e.error.message) || '?';
            render();
            break;
    }
}

/** The model passes a request on: into the bot's chat as a typed message, marked as spoken. One at a time. */
function askBot(callId, args) {
    if (talk.call) {
        talk.rt.toolResult(callId, t('talk.stillWorking', { name: botName() }));
        return;
    }
    let request = '';
    try { request = String(JSON.parse(args || '{}').request || '').trim(); } catch { /* empty */ }
    if (!request) request = talk.heardText;
    const b = bot(talk.chatId);
    talk.call = callId;
    talk.answerText = '';
    send({ type: 'send', chatId: talk.chatId, text: request, spoken: true }, (b && responsibleMachine(b)) || undefined);
    if (talk.phase !== 'speaking') setPhase('thinking');
}

/** The bot's answer, or its error, ends the open call. */
function answerCall(text) {
    const callId = talk.call;
    talk.call = '';
    if (talk.rt && callId) talk.rt.toolResult(callId, text);
    if (talk.phase === 'thinking') setPhase(talk.micOff ? 'muted' : 'listening');
}

// ---------------------------------------------------------- Both ways

/** A tap on the picture: while listening it sends at once, while the bot speaks it stops the voice and listens. */
export function tapTalk() {
    if (talk.rt) {
        if (talk.phase === 'speaking') {
            talk.rt.cancelSpeech();
            setPhase(talk.call ? 'thinking' : talk.micOff ? 'muted' : 'listening');
        }
        return;
    }
    if (talk.phase === 'listening' && talk.heard) submit();
    else if (talk.phase === 'speaking') interrupt();
}

/** The microphone button: off while listening, on again from muted or after an error; while the bot works or speaks
 *  it only decides what follows. */
export function toggleTalkMic() {
    if (talk.rt) {
        talk.micOff = !talk.micOff;
        talk.rt.mute(talk.micOff);
        if (talk.phase === 'listening' || talk.phase === 'muted') setPhase(talk.micOff ? 'muted' : 'listening');
        else render();
        return;
    }
    if (talk.phase === 'connecting') return;
    if (talk.phase === 'listening') {
        talk.micOff = true;
        if (rec.pane === talk.pane) stopRecording(false);
        setPhase('muted');
        return;
    }
    if (talk.phase === 'muted' || talk.phase === 'error') {
        talk.micOff = false;
        if (!state.agentOnline || machineToWake(talk.chatId)) fail(t('talk.machineOff'));
        else if (realtimeOn()) openRealtime();
        else listen();
        return;
    }
    talk.micOff = !talk.micOff;
    render();
}

/** The app hides or comes back (start.js): the microphone closes meanwhile, a waiting answer is read on return. */
export function talkVisibility(hidden) {
    if (talk.phase === 'off') return;
    if (!hidden) holdScreen(true);
    if (talk.rt) {
        // what OpenAI says meanwhile still plays where the system allows it; the microphone stays closed
        talk.rt.mute(hidden || talk.micOff);
        return;
    }
    if (hidden) {
        if (talk.phase === 'listening') {
            if (rec.pane === talk.pane) stopRecording(false);
            setPhase('paused');
        }
        return;
    }
    if (talk.phase !== 'paused') return;
    if (talk.queue.length) next();
    else afterSpeaking();
}

/** Something went wrong (the machine is off, a failed transcription, OpenAI): shown until the microphone button
 *  tries again. */
function fail(message) {
    talk.error = message;
    talk.awaiting = false;
    talk.call = '';
    if (talk.rt) { talk.rt.close(); talk.rt = null; }
    if (rec.pane === talk.pane) stopRecording(false);
    setPhase('error');
}

/** An error of the chat while the recording or the request is on its way (connection.js). */
export function talkError(chatId, message) {
    if (!talking(chatId)) return;
    if (talk.rt) {
        if (talk.call) answerCall(t('talk.botError', { name: botName(), error: message }));
        return;
    }
    if (talk.phase === 'sending' || talk.phase === 'thinking') fail(message);
}

/** Keeps the screen on while the page is open, where the browser allows it. The lock goes when the app hides, so it
 *  is asked for again on return. */
function holdScreen(on) {
    if (!on) {
        if (talk.lock) talk.lock.release().catch(() => undefined);
        talk.lock = null;
        return;
    }
    const wakeLock = /** @type {any} */ (navigator).wakeLock;
    if (!wakeLock || talk.lock) return;
    wakeLock.request('screen').then((lock) => {
        if (talk.phase === 'off') { lock.release().catch(() => undefined); return; }
        talk.lock = lock;
        lock.addEventListener('release', () => { if (talk.lock === lock) talk.lock = null; });
    }).catch(() => undefined);
}

function machineName() {
    const b = bot(talk.chatId);
    return String((b && responsibleMachine(b)) || '').toUpperCase();
}

function botName() {
    const b = bot(talk.chatId);
    return b ? b.name : '';
}

function phaseText() {
    const b = bot(talk.chatId);
    const name = b ? b.name : '';
    switch (talk.phase) {
        case 'connecting': return t('talk.connecting');
        case 'listening': return t('talk.listening');
        // a long wait is the speech model starting on the machine (cold start up to a minute)
        case 'sending': return Date.now() - talk.since > SLOW_SENDING_MS ? t('talk.sendingSlow', { machine: machineName() }) : t('talk.sending');
        case 'thinking': return (!talk.rt && b && state.activity[b.id]) || t('talk.thinking', { name });
        case 'speaking': return t('talk.speaking', { name });
        case 'muted': return t('talk.muted');
        case 'paused': return t('talk.paused');
        default: return '';
    }
}

/** The page from the state; written only when something changed, so an idle page repaints nothing. */
function render() {
    if (talk.phase === 'off') return;
    const key = JSON.stringify([talk.phase, talk.heardText, talk.answerText, talk.error, talk.micOff, phaseText()]);
    if (key === talk.shown) return;
    talk.shown = key;
    el.talk.dataset.phase = talk.phase;
    el.talkPhase.textContent = phaseText();
    el.talkHeard.textContent = talk.heardText ? t('talk.you', { text: talk.heardText }) : '';
    el.talkAnswer.textContent = talk.answerText;
    el.talkError.textContent = talk.error;
    el.talkError.hidden = !talk.error;
    const micOff = talk.micOff || talk.phase === 'muted' || talk.phase === 'error';
    el.talkMic.classList.toggle('off', micOff);
    const label = t(micOff ? 'talk.micOn' : 'talk.micOff');
    el.talkMic.title = label;
    el.talkMic.setAttribute('aria-label', label);
}
