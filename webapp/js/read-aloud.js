/* OpenFolk web app: reading a bot's answer aloud, and the bar below everything while it is read. */
import { i18n, locale, t } from './i18n.js';
import { el, node, state, storage } from './core.js';
import { paneFor } from './panes.js';
import { bot, botIdOf, responsibleMachine, send, senderName } from './e2e.js';
import { jumpToEntry } from './list.js';
import { openChat } from './chat.js';
import { showEvent } from './queue.js';
import { alertDialog } from './dialogs.js';

// Two voices: a cloud voice (the backend asks OpenAI or Gemini with the key of the shared settings, local/src/speech.ts)
// or the browser's speech output (on the iPhone the iOS voices). Either way the text is read in parts: some browsers
// stop long utterances after a few seconds, and the cloud voice starts sooner on a short first part. Code and links
// are only announced.
// parts: the text in chunks, starts: the character each begins at, index: the part being read (or next, paused),
// gen: counts every cancel of the browser's voice, see deviceFrom(). The cloud voice keeps one <audio> (unlocked by the
// tap that starts reading, which iOS wants) and asks for each part once per message (session); clips[i] is the answer.
const speech = {
    active: null, chatId: null, botId: null, silentHintShown: false,
    parts: [], starts: [], total: 0, index: 0, partStart: 0, boundary: 0, playing: false, dragging: false, timer: 0, gen: 0,
    utterances: [], silentTicks: 0,
    cloud: false, provider: '', machine: '', session: 0, clips: [], waiting: -1, loaded: -1, from: 0, audio: /** @type {HTMLAudioElement | null} */ (null),
};

/** Whether this message is being read. */
export function isReading(id) {
    return speech.active === id;
}

export function speakButton(e, chatId) {
    const k = node('button', 'speak' + (speech.active === e.id ? ' speaking' : ''));
    k.type = 'button';
    k.dataset.speak = e.id;
    k.title = t('message.readAloud');
    k.setAttribute('aria-label', t('message.readAloud'));
    k.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="wave" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
    k.addEventListener('click', (ev) => { ev.stopPropagation(); readAloud(e, chatId); });
    return k;
}

function speechText(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ` (${t('speak.codeBlock')}) `)
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+?([.,;:!?)]*)(?=\s|$)/g, `${t('speak.link')}$1`)
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*#+\s*/gm, '')
        .replace(/[*_~>|#]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Sentences bundled into chunks: the first up to `first` characters, the others up to `rest`. */
function chunks(text, first, rest) {
    const parts = [];
    for (const s of text.match(/[^.!?…]+[.!?…]*\s*/g) || []) {
        const max = parts.length > 1 ? rest : first;
        if (parts.length && (parts[parts.length - 1] + s).length < max) parts[parts.length - 1] += s;
        else parts.push(s);
    }
    return parts;
}

// First names that the ending rule below gets wrong: male ones ending in a vowel, female ones ending in a consonant.
const MALE_NAMES = new Set(('mike luke joe steve dave pete george lee jesse jake blake kyle andy tony harry gary jerry larry terry billy bobby '
    + 'danny johnny ricky timmy jimmy rudi willi toni luca andrea joshua noah elia jona mattia nikita sascha mischa hauke eike ole malte '
    + 'arne uwe rene kai nico timo ingo udo otto hugo bruno leo theo ali ravi yuki hiroshi').split(' '));
const FEMALE_NAMES = new Set(('astrid ingrid sigrid karin kerstin kirsten doris iris ruth margret dagmar gudrun heidrun elisabeth beth ann jen '
    + 'meg kim jess rachel miriam sarah hannah leah deborah megan susan carmen ellen helen gretchen maren jasmin yasmin marion ingeborg '
    + 'gretel liesl isabel mabel annabel muriel nell pearl bridget janet margot rosalind sharon evelyn carolyn robin kathrin katrin '
    + 'christin franziska mercedes ines agnes dolores lourdes inez').split(' '));

/** The voice a name calls for, when the bot has none chosen: a known name, else by the ending (a vowel: female). */
export function guessVoice(name) {
    const first = String(name || '').trim().toLowerCase().split(/[\s-]+/)[0] || '';
    if (MALE_NAMES.has(first)) return 'male';
    if (FEMALE_NAMES.has(first)) return 'female';
    return /[aeiy]$/.test(first) ? 'female' : 'male';
}

/** The voice of the bot being read: chosen in the editor, otherwise guessed from its name. */
function botVoice() {
    const b = bot(speech.botId);
    return (b && b.voice) || guessVoice(b ? b.name : '');
}

// Names of the systems' own voices (Apple, Microsoft) the name rule above gets wrong or cannot know; Apple's
// "Grandpa" and "Eddy" end in a vowel, "Google Deutsch" has no name at all and counts as neither.
const MALE_VOICES = new Set('martin markus yannick viktor stefan conrad killian jonas reed rocko eddy flo grandpa daniel aaron fred ralph albert junior thomas arthur rishi gordon oliver'.split(' '));
const FEMALE_VOICES = new Set('anna helena petra sandy shelley grandma katja amala hedda vicki samantha karen moira tessa kathy seraphina'.split(' '));

/** Male, female or '' (unknown) for a voice of the device, by its name. */
export function voiceSex(name) {
    const first = String(name || '').replace(/^(microsoft|google|apple)\s+/i, '').trim().toLowerCase().split(/[\s(-]+/)[0] || '';
    if (MALE_VOICES.has(first)) return 'male';
    if (FEMALE_VOICES.has(first)) return 'female';
    if (!first || /^(deutsch|english|german|us|uk)$/.test(first)) return '';
    return guessVoice(first);
}

/** Best voice for the UI language and the bot: premium/enhanced/natural voices first (German systems call them
 *  "erweitert"), then local ones; among them one whose name fits the bot's voice. `fits`: false when the device has
 *  no voice of the bot's kind in this language (an iPhone has mostly female German voices until others are loaded). */
function speechVoice() {
    const lang = new RegExp(`^${i18n.language}(-|_|$)`, 'i');
    const all = (window.speechSynthesis.getVoices() || []).filter((v) => lang.test(v.lang));
    const who = botVoice();
    const fitting = all.filter((v) => voiceSex(v.name) === who);
    const pick = (voices) => voices.find((v) => /premium|enhanced|erweitert|natural|neural/i.test(v.name)) || voices.find((v) => v.localService) || voices[0] || null;
    const voice = pick(fitting);
    return voice ? { voice, fits: true, who } : { voice: pick(all), fits: false, who };
}

/** A hint once per device and kind when no voice of that kind exists. */
const MISSING_VOICE_KEY = 'openfolk-missing-voice-hint';

function missingVoiceHint(who) {
    const shown = storage.get(MISSING_VOICE_KEY).split(',');
    if (shown.includes(who)) return;
    storage.set(MISSING_VOICE_KEY, [...shown.filter(Boolean), who].join(','));
    showEvent(t(IOS ? 'speak.noVoiceIos' : 'speak.noVoice', { kind: t(who === 'male' ? 'speak.kindMale' : 'speak.kindFemale') }));
}

/** The machine that makes the cloud voice: the bot's own, otherwise any awake one (the keys are synced). */
function speechMachine(b = bot(speech.botId)) {
    return (b && responsibleMachine(b)) || state.online[0] || null;
}

/** Whether a machine can read aloud itself (Piper; known from its machine settings, which only the main account gets). */
function speaksItself(machine) {
    const v = machine && state.machineSettings[machine] && state.machineSettings[machine].voice;
    return Boolean(v && v.state === 'ready' && v.speech);
}

/** The machine for the voice on the bot's machine: its own if it speaks, else any awake one that does, else its own. */
function localMachine(b) {
    const own = speechMachine(b);
    if (speaksItself(own)) return own;
    return state.online.find(speaksItself) || own;
}

/**
 * Same rule as speechProvider() in local/src/speech.ts: a voice of the backend when the chosen provider has a key or
 * the bot's machine speaks itself; "auto" takes a key first, then a machine that speaks. Null: the device reads.
 * `b`: the bot read (or edited), a new one in the editor has none yet.
 * @returns {{ provider: 'openai' | 'gemini' | 'local', machine: string } | null}
 */
export function backendVoice(b = bot(speech.botId)) {
    const s = state.settings || {};
    const keys = s.apiKeys || {};
    const choice = s.readAloud || 'auto';
    if (choice === 'device') return null;
    const machine = speechMachine(b);
    if (!machine) return null;
    if (choice === 'local') return { provider: 'local', machine: localMachine(b) };
    const cloud = choice === 'auto' ? (keys.openai ? 'openai' : keys.gemini ? 'gemini' : '') : keys[choice] ? choice : '';
    if (cloud) return { provider: cloud, machine };
    // "auto" without a key: a machine that speaks itself, if any is known
    const local = state.online.find(speaksItself);
    return choice === 'auto' && local ? { provider: 'local', machine: local } : null;
}

/** Marks the message being read and shows the bar below everything; without a message both go away. */
function showSpeaking(e, chatId) {
    speech.active = e ? e.id : null;
    speech.chatId = e ? chatId : null;
    speech.botId = e ? e.botId || botIdOf(chatId) : null;
    for (const k of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.speak'))) k.classList.toggle('speaking', k.dataset.speak === speech.active);
    el.speechBar.hidden = !e;
    el.app.classList.toggle('speaking', !!e);
    if (!e) return;
    el.speechBarWho.textContent = senderName(speech.botId);
    el.speechBarText.textContent = speechText(e.text);
}

// The timeline counts characters, for both voices: the browser tells neither the duration nor the position of an
// utterance (onboundary is missing on many voices), and the cloud voice knows the length of a part only once it is there.
const SPEECH_CHARS_PER_SECOND = 14;

function clockOf(chars) {
    const s = Math.round(chars / SPEECH_CHARS_PER_SECOND);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Characters read so far: the finished parts plus the place inside the current one. */
function speechPosition() {
    const len = (speech.parts[speech.index] || '').length;
    let inside = speech.from * len;
    const a = speech.audio;
    if (speech.cloud && speech.loaded === speech.index && a && a.duration > 0 && Number.isFinite(a.duration)) inside = a.currentTime / a.duration * len;
    else if (!speech.cloud && speech.playing && speech.partStart) inside = speech.boundary || (Date.now() - speech.partStart) / 1000 * SPEECH_CHARS_PER_SECOND;
    return (speech.starts[speech.index] || 0) + Math.min(len, inside);
}

function renderSpeechBar() {
    const seek = /** @type {HTMLInputElement} */ (el.speechBarSeek);
    seek.max = String(speech.total);
    if (!speech.dragging) seek.value = String(Math.round(speechPosition()));
    el.speechBarElapsed.textContent = speech.waiting >= 0 ? '…' : clockOf(Number(seek.value));
    el.speechBarTotal.textContent = clockOf(speech.total);
    el.speechBar.classList.toggle('paused', !speech.playing);
    const label = t(speech.playing ? 'speak.pause' : 'speak.play');
    el.speechBarPlay.title = label;
    el.speechBarPlay.setAttribute('aria-label', label);
}

/** The timeline moves only while something is read. */
function speechTicking(on) {
    clearInterval(speech.timer);
    speech.silentTicks = 0;
    speech.timer = on ? setInterval(tick, 250) : 0;
}

/** The browser's voice does not always report its end (iOS at times): once it has started and stays silent for
 *  three ticks, reading is over and the bar goes away. */
function tick() {
    const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (!speech.cloud && speech.partStart && synth && typeof synth.speaking === 'boolean') {
        speech.silentTicks = synth.speaking || synth.pending ? 0 : speech.silentTicks + 1;
        if (speech.silentTicks >= 3) { finishReading(); return; }
    }
    renderSpeechBar();
}

function stopReading() {
    speech.gen++;
    speech.playing = false;
    speech.waiting = -1;
    speechTicking(false);
    if (speech.audio) speech.audio.pause();
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        // Safari sometimes stays paused after cancel(); new utterances then stay silent
        if (typeof window.speechSynthesis.resume === 'function') window.speechSynthesis.resume();
    }
}

/** The voice conversation (talk.js) goes on when reading is over, by its end or a stop; one listener, null = none. */
let endListener = null;

export function onReadingEnd(fn) {
    endListener = fn;
}

function finishReading() {
    const was = speech.active;
    stopReading();
    speech.utterances = [];
    showSpeaking(null);
    if (was && endListener) endListener();
}

/** Stops whatever is being read; the bar goes away. */
export function stopReadAloud() {
    finishReading();
}

/** The cloud voice pauses its audio (its handlers stay valid); the browser's voice cancels and remembers the part
 *  (pause() loses its place on Android). */
function pauseReading() {
    if (speech.cloud) {
        speech.from = (speechPosition() - speech.starts[speech.index]) / Math.max(1, speech.parts[speech.index].length);
        speech.playing = false;
        speech.waiting = -1;
        speechTicking(false);
        if (speech.audio) speech.audio.pause();
        renderSpeechBar();
        return;
    }
    const index = speech.index;
    const from = speech.from;
    stopReading();
    speech.index = index;
    speech.from = from;
    renderSpeechBar();
}

function playFrom(index, from = 0) {
    if (speech.cloud) cloudFrom(index, from);
    else deviceFrom(index);
}

/** Goes to a character of the text: the cloud voice to that place, the browser's voice to the start of its part. */
function seekReading(chars) {
    let i = 0;
    while (i + 1 < speech.parts.length && speech.starts[i + 1] <= chars) i++;
    const from = speech.cloud ? Math.max(0, Math.min(1, (chars - speech.starts[i]) / Math.max(1, speech.parts[i].length))) : 0;
    const a = speech.audio;
    if (speech.cloud && speech.loaded === i && a && a.duration > 0 && Number.isFinite(a.duration)) {
        a.currentTime = from * a.duration;
        speech.index = i;
        renderSpeechBar();
    } else if (speech.playing) playFrom(i, from);
    else { speech.index = i; speech.from = from; speech.partStart = 0; renderSpeechBar(); }
}

/** The bar's buttons: pause and go on, stop from anywhere, move on the timeline, go to the message being read. */
export function setupSpeechBar() {
    el.speechBarStop.addEventListener('click', finishReading);
    el.speechBarPlay.addEventListener('click', () => {
        if (speech.playing) { pauseReading(); return; }
        const a = speech.audio;
        if (speech.cloud && a && speech.loaded === speech.index && a.src && !a.ended) {
            speech.playing = true;
            a.play().catch(() => undefined);
            speechTicking(true);
            renderSpeechBar();
        } else playFrom(speech.index, speech.from);
    });
    const seek = /** @type {HTMLInputElement} */ (el.speechBarSeek);
    seek.addEventListener('input', () => {
        speech.dragging = true;
        el.speechBarElapsed.textContent = clockOf(Number(seek.value));
    });
    seek.addEventListener('change', () => {
        speech.dragging = false;
        seekReading(Number(seek.value));
    });
    el.speechBarOpen.addEventListener('click', () => {
        const { active, chatId } = speech;
        if (!active || !chatId) return;
        const p = paneFor(chatId);
        if (!p) { openChat(chatId, active); return; }
        openChat(chatId);
        p.jumpTo = active;
        jumpToEntry(p);
    });
}

// In silent mode the speech output on the iPhone stays mute but still reports "running"; a web page can neither
// query nor bypass the switch (audioSession "playback" with a silent <audio> did not help). The cloud voice plays as
// media and is not affected. iPadOS pretends to be a Mac, but gives itself away by touch.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** If the output does not start (iOS hangs at times, e.g. after a voice recording), try once more. */
const SPEAK_START_MS = 1500;
/** The backend waits 60 s for the provider; without an answer by then the browser's voice takes over. */
const CLOUD_WAIT_MS = 65_000;

/** A second tap on the message being read stops it. */
export function readAloud(e, chatId) {
    if (expected.chatId) dropExpected(expected.chatId);
    const wasActive = speech.active;
    finishReading();
    if (wasActive === e.id) return;
    const text = speechText(e.text);
    speech.botId = e.botId || botIdOf(chatId);
    const backend = backendVoice();
    speech.cloud = Boolean(backend);
    speech.provider = backend ? backend.provider : '';
    speech.machine = backend ? backend.machine : '';
    if (!speech.cloud && !('speechSynthesis' in window)) {
        void alertDialog(t('speak.unsupported'));
        return;
    }
    // Piper on a machine's processor needs about a third of the audio's length: shorter parts, so the first comes soon
    // and each next one is ready before the one playing ends
    const parts = speech.provider === 'local' ? chunks(text, 160, 400) : speech.cloud ? chunks(text, 220, 700) : chunks(text, 220, 220);
    if (!parts.length) return;
    if (!speech.cloud && IOS && !speech.silentHintShown) {
        speech.silentHintShown = true;
        showEvent(t('speak.silentMode'));
    }
    speech.parts = parts;
    speech.starts = [];
    speech.total = 0;
    for (const part of parts) { speech.starts.push(speech.total); speech.total += part.length; }
    for (const c of speech.clips) if (c && c.url) URL.revokeObjectURL(c.url);
    speech.clips = [];
    speech.session++;
    speech.loaded = -1;
    if (speech.cloud) unlockAudio();
    showSpeaking(e, chatId);
    playFrom(0);
}

// ---------------------------------------------------------- Cloud voice

/** A moment of silence, played in the tap that starts reading: afterwards iOS lets the same <audio> play on its own. */
function unlockAudio() {
    if (!speech.audio) speech.audio = new Audio();
    speech.audio.src = silence || (silence = silentWav());
    speech.audio.play().catch(() => undefined);
}

let silence = '';

/** A tenth of a second of silence as a WAV (8 kHz, 16 bit, mono). */
function silentWav() {
    const samples = 800;
    const v = new DataView(new ArrayBuffer(44 + samples * 2));
    const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    text(36, 'data'); v.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
}

/** Asks the backend for part i once per message. */
function fetchClip(i) {
    if (i >= speech.parts.length || speech.clips[i]) return;
    const clip = { state: 'loading', url: '', error: '' };
    speech.clips[i] = clip;
    const session = speech.session;
    const b = bot(speech.botId);
    const name = b && b.voices && b.voices[speech.provider];
    send({ type: 'speech_get', id: `${session}:${i}`, text: speech.parts[i].trim(), voice: botVoice(), ...(name ? { name } : {}) }, speech.machine || speechMachine());
    setTimeout(() => {
        if (session === speech.session && clip.state === 'loading') clipArrived(i, { error: 'timeout' });
    }, CLOUD_WAIT_MS);
}

/** The backend's answer to "speech_get" (connection.js). */
export function speechAudio(f) {
    if (String(f.id).startsWith('preview:')) { previewArrived(f); return; }
    const [session, i] = String(f.id).split(':').map(Number);
    if (session === speech.session) clipArrived(i, f);
}

function clipArrived(i, f) {
    const clip = speech.clips[i];
    if (!clip || clip.state !== 'loading') return;
    if (f.error || !f.data) {
        clip.state = 'failed';
        clip.error = f.error || '';
    } else {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        clip.url = URL.createObjectURL(new Blob([bytes], { type: f.mime || 'audio/mpeg' }));
        clip.state = 'ready';
    }
    if (speech.waiting === i) cloudFrom(i, speech.from);
}

/** Plays part i from a fraction of it on, once it is there; asks for the next one meanwhile. */
function cloudFrom(i, from = 0) {
    stopReading();
    speech.index = i;
    speech.from = from;
    speech.playing = true;
    speechTicking(true);
    fetchClip(i);
    const clip = speech.clips[i];
    if (clip.state === 'loading') {
        speech.waiting = i;
        renderSpeechBar();
        return;
    }
    if (clip.state === 'failed') { cloudFailed(i, clip.error); return; }
    const gen = speech.gen;
    const a = /** @type {HTMLAudioElement} */ (speech.audio);
    speech.loaded = i;
    a.onloadedmetadata = () => { if (gen === speech.gen && from && Number.isFinite(a.duration)) a.currentTime = from * a.duration; };
    a.onended = () => {
        if (gen !== speech.gen) return;
        if (i + 1 < speech.parts.length) cloudFrom(i + 1);
        else finishReading();
    };
    a.onerror = () => { if (gen === speech.gen) cloudFailed(i, t('speak.cloudUnplayable')); };
    a.src = clip.url;
    a.play().catch((e) => { if (gen === speech.gen && e.name !== 'AbortError') cloudFailed(i, e.message); });
    speech.from = 0;
    fetchClip(i + 1);
    renderSpeechBar();
}

/** Without the cloud voice the browser's voice reads on from this part. */
function cloudFailed(i, error) {
    showEvent(speech.provider === 'local' ? t('speak.localFailed', { machine: String(speech.machine || '').toUpperCase(), error: error || '?' }) : t('speak.cloudFailed', { error: error || '?' }), true);
    speech.cloud = false;
    speech.loaded = -1;
    if (!('speechSynthesis' in window)) { finishReading(); return; }
    deviceFrom(i);
}

// ---------------------------------------------------------- The browser's voice

/** Queues the parts from `index` on. Callbacks of an earlier queue (cancel() fires them late) carry an old `gen`. */
function deviceFrom(index, secondTry = false) {
    stopReading();
    const gen = speech.gen;
    const synth = window.speechSynthesis;
    const parts = speech.parts;
    speech.index = index;
    speech.from = 0;
    speech.partStart = 0;
    speech.playing = true;
    const { voice, fits, who } = speechVoice();
    // no voice of the bot's kind: the pitch says it at least, and the user learns how to load one
    const pitch = fits ? 1 : who === 'male' ? 0.7 : 1.25;
    if (!fits && voice) missingVoiceHint(who);
    let started = false;
    // Chrome drops utterances nothing refers to before they end, and with them their onend
    speech.utterances = [];
    for (let i = index; i < parts.length; i++) {
        const u = new SpeechSynthesisUtterance(parts[i].trim());
        speech.utterances.push(u);
        u.lang = locale();
        if (voice) u.voice = voice;
        u.rate = 1.05;
        u.pitch = pitch;
        u.onstart = () => {
            if (gen !== speech.gen) return;
            started = true;
            speech.index = i;
            speech.partStart = Date.now();
            speech.boundary = 0;
        };
        u.onboundary = (ev) => { if (gen === speech.gen) speech.boundary = ev.charIndex; };
        if (i === parts.length - 1) {
            const done = () => { if (gen === speech.gen) finishReading(); };
            u.onend = done;
            u.onerror = done;
        }
        synth.speak(u);
    }
    speechTicking(true);
    renderSpeechBar();
    setTimeout(() => {
        if (started || gen !== speech.gen) return;
        if (!secondTry) { deviceFrom(index, true); return; }
        finishReading();
        showEvent(t('speak.doesNotStart'), true);
    }, SPEAK_START_MS);
}

// ---------------------------------------------------------- Reading the answer to a voice message
// After a voice message the next answer with text in that chat is read as soon as it is done (a setting of this
// device, on by default). The tap that sends the recording unlocks the sound, which iOS wants; a page in the
// background may not start any, so an answer that arrives meanwhile is read when the app comes back, while it is fresh.
// Typing a message to that chat or reading something else drops the wish.
export const AUTO_READ_KEY = 'openfolk-read-voice-answers';
const AUTO_READ_FRESH_MS = 10 * 60_000;
const expected = { chatId: /** @type {string | null} */ (null), entry: null, doneAt: 0 };

export function autoReadOn() {
    return storage.get(AUTO_READ_KEY) !== 'off';
}

/** In the tap that sends a voice message: unlocks both voices unless something is being read right now. */
export function primeReadAloud() {
    if (!autoReadOn() || speech.active) return;
    unlockVoices();
}

/** Unlocks both voices inside a tap: iOS lets a sound start on its own only after one did in a tap. */
export function unlockVoices() {
    unlockAudio();
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
}

/** A voice message went to this chat. */
export function expectAnswer(chatId) {
    if (!autoReadOn()) return;
    Object.assign(expected, { chatId, entry: null, doneAt: 0 });
}

/** A typed message to this chat: its answer is not read by itself. */
export function dropExpected(chatId) {
    if (expected.chatId === chatId) Object.assign(expected, { chatId: null, entry: null, doneAt: 0 });
}

/** A finished entry of a chat (connection.js); in the background it waits for the app to come back. */
export function answerDone(chatId, e) {
    if (expected.chatId !== chatId || e.role !== 'assistant' || !e.text || !e.id) return;
    if (document.hidden) {
        Object.assign(expected, { entry: e, doneAt: Date.now() });
        return;
    }
    dropExpected(chatId);
    readAloud(e, chatId);
}

/** The app is visible again (start.js). */
export function readWaitingAnswer() {
    const { chatId, entry, doneAt } = expected;
    if (!chatId || !entry) return;
    dropExpected(chatId);
    if (Date.now() - doneAt < AUTO_READ_FRESH_MS) readAloud(entry, chatId);
}

// ---------------------------------------------------------- Hearing a voice in the editor

const PREVIEW_WAIT_MS = 30_000;
const preview = { id: '', audio: /** @type {HTMLAudioElement | null} */ (null), done: /** @type {((error: string) => void) | null} */ (null) };
let previewCount = 0;

/**
 * Plays a sample sentence in a voice of the provider reading for this bot (the editor's "Listen"). Called in the tap,
 * which unlocks the sound on iOS. `done` gets '' once it plays, or why it does not.
 * @param {{ provider: string, machine: string }} where @param {string} name @param {'female' | 'male'} kind
 * @param {(error: string) => void} done
 */
export function previewVoice(where, name, kind, done) {
    stopPreview();
    preview.audio = preview.audio || new Audio();
    preview.audio.src = silence || (silence = silentWav());
    preview.audio.play().catch(() => undefined);
    preview.id = `preview:${++previewCount}`;
    preview.done = done;
    const id = preview.id;
    send({ type: 'speech_get', id, text: t('editor.voiceSample'), voice: kind, name }, where.machine);
    setTimeout(() => { if (preview.id === id) previewArrived({ id, error: 'timeout' }); }, PREVIEW_WAIT_MS);
}

export function stopPreview() {
    preview.id = '';
    if (preview.audio) preview.audio.pause();
}

function previewArrived(f) {
    if (f.id !== preview.id) return;
    preview.id = '';
    const done = preview.done || (() => undefined);
    if (f.error || !f.data) { done(f.error || '?'); return; }
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const a = /** @type {HTMLAudioElement} */ (preview.audio);
    a.src = URL.createObjectURL(new Blob([bytes], { type: f.mime || 'audio/mpeg' }));
    a.play().then(() => done(''), (e) => done(e.message));
}
