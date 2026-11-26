/* OpenFolk web app: voice messages, files and images. */
import { t } from './i18n.js';
import { node, state, storage } from './core.js';
import { paneFor, panes } from './panes.js';
import { bot, isPerson, responsibleMachine, send, showImageLarge, upper } from './e2e.js';
import { scroll, setReply } from './chat-features.js';
import { approvalsToBottom, composerButtons, showEvent, textHeight } from './queue.js';
import { expectAnswer, readWaitingAnswer, renderAutoRead, stopReadAloud } from './read-aloud.js';
import { alertDialog } from './dialogs.js';
import { sendTracked } from './outbox.js';

/** @typedef {import('./panes.js').Pane} Pane */

// ---------------------------------------------------------------- Voice messages
// One microphone, one recording: it belongs to the pane and the chat it was started in (`pane`, `chatId`).

// talk: the recording is the voice conversation's (talk.js), which sends it as a voice message itself
export const rec = { pane: null, chatId: null, recorder: null, stream: null, ctx: null, analyser: null, chunks: [], mime: '', start: 0, pausedSince: 0, paused: 0, timer: null, levels: [], talk: false };
const MAX_RECORDING_MS = 15 * 60 * 1000;

export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && window.isSecureContext);

// The composer's microphone sends a voice message (the default) or, set on this device, dictates into the field (#59)
const DICTATION_KEY = 'openfolk-dictation';

export function dictationOn() {
    return storage.get(DICTATION_KEY) === 'on';
}

export function setDictation(on) {
    storage.set(DICTATION_KEY, on ? 'on' : 'off');
    for (const x of panes) composerButtons(x);
}

function durationText(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function recordingDuration() {
    if (!rec.start) return 0;
    return (rec.pausedSince || Date.now()) - rec.start - rec.paused;
}

/** @param {Pane} p @param {boolean} [talk] from the voice conversation */
export async function startRecording(p, talk = false) {
    if (rec.recorder || !p.chatId) return;
    const chatId = p.chatId;
    // whoever speaks now does not want to hear an answer meanwhile
    stopReadAloud();
    renderAutoRead();
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
        void alertDialog(t('voice.noMicrophone', { error: e.message }));
        return;
    }
    // the pane may have switched chats while the browser asked for the microphone
    if (p.chatId !== chatId || rec.recorder) {
        stream.getTracks().forEach((track) => track.stop());
        return;
    }
    // Chrome/Android: WebM/Opus, Safari/iOS: MP4/AAC – the backend decodes both
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    Object.assign(rec, { pane: p, chatId, recorder, stream, chunks: [], mime: recorder.mimeType || mime, start: Date.now(), pausedSince: 0, paused: 0, levels: [], talk });
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    recorder.start(1000);
    // load the speech model on the machine while speaking (saves the cold start afterwards)
    const b = bot(chatId);
    send({ type: 'voice_warmup' }, b ? responsibleMachine(b) : undefined);
    // live level for the bars
    try {
        rec.ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
        rec.analyser = rec.ctx.createAnalyser();
        rec.analyser.fftSize = 512;
        rec.ctx.createMediaStreamSource(stream).connect(rec.analyser);
    } catch { rec.analyser = null; }
    const data = new Uint8Array(512);
    rec.timer = setInterval(() => {
        if (!rec.pausedSince && rec.analyser) {
            rec.analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            rec.levels = [...rec.levels.slice(-39), Math.min(1, Math.sqrt(sum / data.length) * 4)];
            renderLevels(p);
        }
        p.el.recTime.textContent = durationText(recordingDuration());
        if (recordingDuration() > MAX_RECORDING_MS) void (dictationOn() && !rec.talk ? finishDictation() : stopRecording(true));
    }, 100);
    p.el.recDot.classList.remove('paused');
    p.el.recTime.textContent = '0:00';
    p.el.recLevel.innerHTML = '';
    for (const x of panes) composerButtons(x);
}

/** @param {Pane} p */
function renderLevels(p) {
    const z = p.el.recLevel;
    while (z.children.length < 40) z.appendChild(document.createElement('i'));
    const levels = rec.levels;
    [.../** @type {HTMLCollectionOf<HTMLElement>} */ (z.children)].forEach((bar, i) => {
        const value = levels[levels.length - 40 + i] || 0;
        bar.style.height = `${Math.max(8, Math.round(value * 100))}%`;
    });
}

export function pauseRecording() {
    const recorder = rec.recorder;
    if (!recorder) return;
    if (rec.pausedSince) {
        rec.paused += Date.now() - rec.pausedSince;
        rec.pausedSince = 0;
        recorder.resume();
    } else {
        rec.pausedSince = Date.now();
        recorder.pause();
    }
    rec.pane.el.recDot.classList.toggle('paused', !!rec.pausedSince);
    rec.pane.el.recPause.title = rec.pausedSince ? t('voice.resume') : t('voice.pause');
}

/** Stops the microphone; resolves to what was recorded, with the pane and chat it belongs to. */
async function endRecording() {
    const recorder = rec.recorder;
    const length = recordingDuration();
    clearInterval(rec.timer);
    const stopped = new Promise((r) => { recorder.onstop = r; });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    rec.stream.getTracks().forEach((track) => track.stop());
    if (rec.ctx) rec.ctx.close().catch(() => undefined);
    const ended = { p: rec.pane, chatId: rec.chatId, chunks: rec.chunks, mime: (rec.mime || 'audio/webm').split(';')[0], length };
    Object.assign(rec, { pane: null, chatId: null, recorder: null, stream: null, ctx: null, analyser: null, chunks: [], start: 0, pausedSince: 0, paused: 0, timer: null, talk: false });
    for (const x of panes) composerButtons(x);
    return ended;
}

/** The recording as an upload of the send and transcribe frames. */
async function recordingUpload(chunks, mime, length) {
    const ext = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return { name: `voice-message-${stamp}.${ext}`, type: mime, data: await readFile(new Blob(chunks, { type: mime })), durationMs: Math.round(length) };
}

/** Ends the recording; with `submit` it goes out as a voice message, otherwise it is discarded. `spoken`: from the
 *  voice conversation (talk.js), which reads the answer itself and asks the bot for a short one. Resolves to whether it
 *  went out. */
export async function stopRecording(submit, spoken = false) {
    if (!rec.recorder) return false;
    const { p, chatId, chunks, mime, length } = await endRecording();
    // discarded, or its pane has closed or switched chats meanwhile
    if (!submit || !panes.includes(p) || p.chatId !== chatId) {
        // discarded: an answer that arrived while recording is read now
        if (!submit) readWaitingAnswer();
        return false;
    }
    if (length < 600 || chunks.length === 0) {
        showEvent(t('voice.tooShort'), true, chatId);
        return false;
    }
    const audio = await recordingUpload(chunks, mime, length);
    const b = bot(chatId);
    // Pasted images and files go along; the backend only transcribes the recording
    const more = p.uploads.map((u) => ({ name: u.name, type: u.type, data: u.data, thumb: u.thumb }));
    (isPerson(chatId) ? send : sendTracked)({
        type: 'send', chatId, text: p.el.text.value.trim(),
        attachments: [audio, ...more],
        replyTo: p.replyTo || undefined,
        spoken: spoken || undefined,
        later: p.later || undefined,
    }, b ? responsibleMachine(b) : undefined);
    p.later = false;
    setReply(p, null);
    p.uploads = [];
    renderUploads(p);
    p.el.text.value = '';
    textHeight(p);
    showVoicePending(chatId, length);
    if (!spoken) expectAnswer(chatId);
    return true;
}

// ---------------------------------------------------------------- Dictation (#59)
// With dictation on, the checkmark ends the recording and asks the chat's machine for the text alone; it goes into the
// input field at the cursor, and the message leaves only with the send button, as text: no recording in the chat, no
// answer read aloud.

const DICTATION_TIMEOUT_MS = 3 * 60 * 1000;
/** id -> { p, chatId, timer } of a dictation whose text is awaited */
const dictations = new Map();

export async function finishDictation() {
    if (!rec.recorder) return;
    const { p, chatId, chunks, mime, length } = await endRecording();
    if (!panes.includes(p) || p.chatId !== chatId) return;
    if (length < 600 || chunks.length === 0) {
        showEvent(t('voice.tooShort'), true, chatId);
        return;
    }
    // randomUUID needs a secure context, getRandomValues does not
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    const timer = setTimeout(() => dictationDone(id, false, '', t('voice.dictationNoAnswer')), DICTATION_TIMEOUT_MS);
    dictations.set(id, { p, chatId, timer });
    p.dictating = id;
    composerButtons(p);
    const b = bot(chatId);
    send({ type: 'transcribe', id, chatId, audio: await recordingUpload(chunks, mime, length) }, b ? responsibleMachine(b) : undefined);
}

/** The machine's answer, or a failure with its `message`. */
export function dictationDone(id, ok, text, message = '') {
    const d = dictations.get(id);
    if (!d) return;
    dictations.delete(id);
    clearTimeout(d.timer);
    const p = d.p;
    if (p.dictating === id) p.dictating = null;
    if (panes.includes(p)) composerButtons(p);
    if (!panes.includes(p) || p.chatId !== d.chatId) return;
    if (!ok) { void alertDialog(message || t('voice.dictationFailed')); return; }
    if (!text) { showEvent(t('voice.nothingHeard'), true, d.chatId); return; }
    insertAtCaret(p, text);
}

/** An older backend answers the frame with an error for the request. */
export function dictationRefused(message) {
    for (const id of dictations.keys()) dictationDone(id, false, '', t('voice.dictationOld', { error: message }));
}

/** Puts dictated text where the cursor was (the end if the field changed since or never had the focus), with spaces. */
function insertAtCaret(p, text) {
    const field = p.el.text;
    const value = field.value;
    const focused = document.activeElement === field;
    const c = focused ? { start: field.selectionStart, end: field.selectionEnd } : p.caret && p.caret.value === value ? p.caret : { start: value.length, end: value.length };
    const before = value.slice(0, c.start);
    const after = value.slice(c.end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    field.value = before + lead + text + trail + after;
    const caret = (before + lead + text).length;
    field.focus();
    field.setSelectionRange(caret, caret);
    p.caret = null;
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Placeholder until the transcript comes back from the machine. */
function showVoicePending(chatId, length) {
    state.voicePending[chatId] = { length, since: Date.now() };
    const pane = paneFor(chatId);
    if (!pane) return;
    renderVoicePending(pane);
    approvalsToBottom(pane);
    scroll(pane, true);
}

/** Puts the placeholder back after the history was redrawn (it lives in the state, not only in the DOM). @param {Pane} pane */
export function renderVoicePending(pane) {
    const chatId = pane.chatId;
    const v = state.voicePending[chatId];
    if (!v) return;
    // the transcribed message came with the history instead of its own frame (a few seconds of clock difference allowed)
    if ((state.history[chatId] || []).some((e) => e.voice && e.from === 'me' && Date.parse(e.ts) > v.since - 5000)) {
        delete state.voicePending[chatId];
        return;
    }
    if (pane.el.messages.querySelector(`[data-voice-pending="${CSS.escape(chatId)}"]`)) return;
    const p = node('div', 'bubble me voice pending', '🎤 ' + t('voice.transcribing', { duration: durationText(v.length) }));
    p.dataset.voicePending = chatId;
    pane.el.messages.appendChild(p);
}

export function removeVoicePending(chatId) {
    delete state.voicePending[chatId];
    const pane = paneFor(chatId);
    const p = pane && pane.el.messages.querySelector(`[data-voice-pending="${CSS.escape(chatId)}"]`);
    if (p) p.remove();
}

// Playback: the recording is on the machine and is fetched on the first tap
export const playback = new Map();
/** Image attachments whose original is requested for the large view (instead of a download). */
export const imageRequested = new Set();

export function voicePlayer(a) {
    const w = node('div', 'voice-player');
    const button = node('button', 'voice-button', '▶');
    button.type = 'button';
    button.setAttribute('aria-label', t('voice.play'));
    const track = node('span', 'voice-track');
    const fill = node('span', 'voice-fill');
    track.appendChild(fill);
    const time = node('span', 'voice-time', a.durationMs ? durationText(a.durationMs) : '');
    w.append(button, track, time);
    button.addEventListener('click', () => {
        if (w.audio) {
            if (w.audio.paused) w.audio.play(); else w.audio.pause();
            return;
        }
        if (a.machine && !state.online.includes(a.machine)) {
            showEvent(t('voice.machineOff', { machine: upper(a.machine) }), true);
            return;
        }
        button.textContent = '…';
        playback.set(a.path, w);
        send({ type: 'file_get', path: a.path }, a.machine);
    });
    w.parts = { button, fill, time, length: a.durationMs };
    return w;
}

export function startPlayback(f) {
    const w = playback.get(f.path);
    playback.delete(f.path);
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: f.mime })));
    const { button, fill, time, length } = w.parts;
    w.audio = audio;
    audio.addEventListener('play', () => { button.textContent = '⏸'; });
    audio.addEventListener('pause', () => { button.textContent = '▶'; });
    audio.addEventListener('ended', () => { button.textContent = '▶'; fill.style.width = '0'; time.textContent = durationText(length); });
    audio.addEventListener('timeupdate', () => {
        const total = (isFinite(audio.duration) ? audio.duration * 1000 : length) || 1;
        fill.style.width = `${Math.min(100, (audio.currentTime * 1000 / total) * 100)}%`;
        time.textContent = durationText(audio.currentTime * 1000);
    });
    audio.play().catch(() => { button.textContent = '▶'; });
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error(t('file.unreadable')));
        r.readAsDataURL(file);
    });
}

/** Shrink an image to an edge length, as JPEG data URL. Cropped square if `square`. */
export function shrinkImage(file, edge, square) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            if (square) {
                c.width = c.height = edge;
                const s = Math.min(img.width, img.height);
                ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, edge, edge);
            } else {
                const f = Math.min(1, edge / Math.max(img.width, img.height));
                c.width = Math.round(img.width * f);
                c.height = Math.round(img.height * f);
                ctx.drawImage(img, 0, 0, c.width, c.height);
            }
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('file.imageUnreadable'))); };
        img.src = url;
    });
}

/** @param {Pane} p */
export async function addFiles(p, list) {
    for (const d of list) {
        if (d.size > 20 * 1024 * 1024) {
            showEvent(t('file.tooLarge', { name: d.name }), true, p.chatId);
            continue;
        }
        const u = { name: d.name, type: d.type || 'application/octet-stream', size: d.size, data: await readFile(d), thumb: '' };
        if (u.type.startsWith('image/')) {
            try { u.thumb = await shrinkImage(d, 240, false); } catch { /* without preview */ }
        }
        p.uploads.push(u);
    }
    renderUploads(p);
}

/** @param {Pane} p */
export function renderUploads(p) {
    composerButtons(p);
    const bar = p.el.attachments;
    bar.innerHTML = '';
    bar.hidden = p.uploads.length === 0;
    p.uploads.forEach((u, i) => {
        const chip = node('div', 'upload');
        if (u.thumb) {
            const img = document.createElement('img');
            img.src = u.thumb;
            img.alt = '';
            chip.appendChild(img);
            // tap on the preview: the pasted image in full size
            chip.classList.add('image');
            chip.title = t('file.showLarge');
            chip.addEventListener('click', () => {
                const bytes = Uint8Array.from(atob(u.data), (c) => c.charCodeAt(0));
                showImageLarge(URL.createObjectURL(new Blob([bytes], { type: u.type })), u.name);
            });
        } else chip.appendChild(node('span', 'symbol', '📄'));
        chip.appendChild(node('span', 'name', u.name));
        const remove = node('button', 'remove', '×');
        remove.type = 'button';
        remove.title = t('file.remove');
        remove.addEventListener('click', (ev) => { ev.stopPropagation(); p.uploads.splice(i, 1); renderUploads(p); });
        chip.appendChild(remove);
        bar.appendChild(chip);
    });
}
