/* OpenFolk web app: the voice conversation over OpenAI Realtime. A WebRTC connection between this device and OpenAI;
   the SDP offer goes to the bot's machine, which asks OpenAI with the stored key (local/src/realtime.ts), so the key
   stays there and this page needs no connection to OpenAI of its own (the relay's connect-src 'self'). The events of
   the data channel go to talk.js; this module only connects, sends and closes. */
import { t } from './i18n.js';
import { state } from './core.js';
import { bot, responsibleMachine, send } from './e2e.js';
import { guessVoice } from './read-aloud.js';

/** The backend waits 20 s for OpenAI; a little more for the way through the relay. */
const CONNECT_WAIT_MS = 30_000;
/** Offers waiting for the backend's "talk_answer", by id. */
const waiting = new Map();
let seq = 0;

/** Whether the conversation runs over OpenAI: chosen in the shared settings and an OpenAI key stored. */
export function realtimeOn() {
    const s = state.settings || {};
    return Boolean(s.talkMode && s.talkMode !== 'app' && s.apiKeys && s.apiKeys.openai && typeof RTCPeerConnection === 'function');
}

/**
 * Connects to OpenAI for a bot's chat. `onEvent` gets every event of the data channel, `onClosed` the end of the
 * connection. Resolves to the controls; rejects with a message for the page.
 * @param {string} chatId
 * @param {{ onEvent: (e: any) => void, onClosed: () => void }} h
 */
export async function connectRealtime(chatId, h) {
    const b = bot(chatId);
    const machine = b ? responsibleMachine(b) : null;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const track = stream.getAudioTracks()[0];
    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };
    pc.addTrack(track, stream);
    const dc = pc.createDataChannel('oai-events');
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        try { dc.close(); } catch { /* already closed */ }
        pc.close();
        track.stop();
        audio.srcObject = null;
    };
    dc.addEventListener('message', (ev) => {
        let e;
        try { e = JSON.parse(ev.data); } catch { return; }
        h.onEvent(e);
    });
    // "disconnected" may come back by itself; "failed" and "closed" do not (OpenAI ends a session after an hour)
    pc.addEventListener('connectionstatechange', () => {
        if (!closed && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) { close(); h.onClosed(); }
    });
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const id = String(++seq);
        const answer = await new Promise((resolve, reject) => {
            waiting.set(id, { resolve, reject });
            send({ type: 'talk_connect', id, chatId, sdp: offer.sdp, voice: (b && b.voice) || guessVoice(b ? b.name : '') }, machine || undefined);
            setTimeout(() => { if (waiting.delete(id)) reject(new Error(t('talk.connectTimeout'))); }, CONNECT_WAIT_MS);
        });
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (e) {
        close();
        throw e;
    }
    const out = (e) => { if (dc.readyState === 'open') dc.send(JSON.stringify(e)); };
    return {
        /** The bot's answer (or the page's own note) as the result of a call, then a spoken response. The event name
         *  stands in backticks: "conversation." in quotes would count as a dictionary key (i18n-keys.test.mjs). */
        toolResult(callId, text) {
            out({ type: `conversation.item.create`, item: { type: 'function_call_output', call_id: callId, output: text } });
            out({ type: 'response.create' });
        },
        /** Stops what the model says right now. */
        cancelSpeech() {
            out({ type: 'response.cancel' });
            out({ type: 'output_audio_buffer.clear' });
        },
        mute(off) { track.enabled = !off; },
        close,
    };
}

/** The backend's "talk_answer" (connection.js); an answer for an id nobody waits for any more is dropped. */
export function talkAnswerSdp(f) {
    const w = waiting.get(f.id);
    if (!w) return;
    waiting.delete(f.id);
    if (f.sdp) w.resolve(f.sdp);
    else w.reject(new Error(f.error || '?'));
}

/** An old backend does not know "talk_connect": every offer waiting gets its message. */
export function talkRefused(message) {
    for (const w of waiting.values()) w.reject(new Error(message));
    waiting.clear();
}
