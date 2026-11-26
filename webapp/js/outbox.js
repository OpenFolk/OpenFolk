/* OpenFolk web app: messages on their way to a bot's machine. A message stays here until the machine has stored it (the
   "user" frame naming its `cid`); without that answer it goes again, after a reconnect at once, and the machine drops a
   second copy by its `cid`. A relay restarting (a deploy) or a dropped connection lost such messages, photos included,
   without a word. Only in memory: a reload of the page ends the attempts. */
import { t } from './i18n.js';
import { node, state } from './core.js';
import { send } from './e2e.js';
import { paneFor } from './panes.js';

/** Sent again when no answer came this long. */
const RETRY_MS = 15_000;
/** Given up after this long: the chat says so, with "Send again". */
const GIVE_UP_MS = 3 * 60_000;
const CHECK_MS = 5_000;

/** @type {Map<string, { frame: any, machine: string | undefined, chatId: string, since: number, last: number, failed: boolean, voice: boolean }>} */
const pending = new Map();
let timer = null;

/** randomUUID needs a secure context, getRandomValues does not */
const newCid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Sends a message of the user to a bot or group and keeps it until its machine stored it. */
export function sendTracked(frame, machine) {
    const cid = newCid();
    const f = { ...frame, cid };
    const voice = (frame.attachments || []).some((a) => (a.type || '').startsWith('audio/'));
    pending.set(cid, { frame: f, machine, chatId: frame.chatId, since: Date.now(), last: Date.now(), failed: false, voice });
    send(f, machine);
    timer ??= setInterval(check, CHECK_MS);
    renderOutbox(frame.chatId);
    return cid;
}

/** connection.js: a "user" frame of this device's own message; with its cid, or as a backend from before cids sends it. */
export function stored(chatId, entry) {
    if (entry.from && entry.from !== 'me') return;
    let cid = entry.cid && pending.has(entry.cid) ? entry.cid : '';
    // An older backend knows no cid: the oldest message of the chat with that text (a voice message by its kind)
    if (!cid) {
        for (const [k, x] of pending) {
            if (x.chatId === chatId && (x.voice ? entry.voice : !entry.voice && x.frame.text.trim() === (entry.text || '').trim())) { cid = k; break; }
        }
    }
    if (!cid) return;
    pending.delete(cid);
    renderOutbox(chatId);
}

/** An error the machine sent for the chat: it answered, nothing to send again. */
export function refused(chatId) {
    for (const [k, x] of pending) if (x.chatId === chatId) pending.delete(k);
    renderOutbox(chatId);
}

/** connection.js: the machines awake changed (a reconnect): what waits goes again at once. */
export function resendWaiting() {
    for (const x of pending.values()) if (!x.failed) again(x);
}

function again(x) {
    if (!state.agentOnline) return;
    x.last = Date.now();
    send(x.frame, x.machine);
}

function check() {
    const now = Date.now();
    for (const x of pending.values()) {
        if (x.failed) continue;
        if (now - x.since > GIVE_UP_MS) {
            x.failed = true;
            renderOutbox(x.chatId);
        } else if (now - x.last > RETRY_MS) again(x);
    }
    if (!pending.size) {
        clearInterval(timer);
        timer = null;
    }
}

/** A text message of this chat on its way: "Sending …" in the chat; given up: "Not delivered" with "Send again". */
export function renderOutbox(chatId) {
    const p = paneFor(chatId);
    if (!p) return;
    for (const n of p.el.messages.querySelectorAll('.outbox')) n.remove();
    for (const [cid, x] of pending) {
        if (x.chatId !== chatId || (x.voice && !x.failed)) continue;
        const b = node('div', 'bubble me pending outbox' + (x.failed ? ' failed' : ''));
        const files = x.frame.attachments || [];
        // the photos on their way as their previews, the other files by name
        const thumbs = files.filter((f) => f.thumb);
        if (thumbs.length) {
            const row = node('div', 'outbox-thumbs');
            for (const f of thumbs) {
                const img = document.createElement('img');
                img.src = f.thumb;
                img.alt = f.name;
                row.appendChild(img);
            }
            b.appendChild(row);
        }
        const others = files.filter((f) => !f.thumb && !(f.type || '').startsWith('audio/'));
        if (x.frame.text || others.length) b.appendChild(node('div', 'text', [x.frame.text, ...others.map((f) => '📄 ' + f.name)].filter(Boolean).join('\n')));
        const line = node('div', 'outbox-line', x.failed ? t('outbox.failed') : t('outbox.sending'));
        if (x.failed) {
            const k = node('button', 'link', t('outbox.retry'));
            k.type = 'button';
            k.addEventListener('click', () => {
                Object.assign(x, { since: Date.now(), failed: false });
                timer ??= setInterval(check, CHECK_MS);
                again(x);
                renderOutbox(chatId);
            });
            line.append(' ', k);
        }
        b.appendChild(line);
        b.dataset.cid = cid;
        p.el.messages.appendChild(b);
    }
}
