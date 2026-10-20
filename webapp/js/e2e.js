/* OpenFolk web app: end-to-end encryption, chat helpers and sending. */
import { locale, t } from './i18n.js';
import { COLORS, el, node, startParams, state } from './core.js';
import { connect } from './connection.js';
import { secureStore } from './platform.js';
import { startApproval, takeApproval } from './qr-login.js';

// ================================================================ End-to-end encryption

/**
 * AES-256-GCM with the backends' key (E2E_KEY). It is taken over once via the pairing link
 * (#e2e=…, never sent to the server) or by entering it, and stored as a non-extractable key
 * in IndexedDB; the apps keep it in the Keychain/Keystore (platform.js). The relay then only sees routing information.
 */
export const e2e = { key: null, seenActive: false };
const RELAY_TYPES = new Set(['wake_status', 'wake', 'devices', 'device_logout', 'accounts', 'account_create', 'account_update', 'account_delete', 'account_invite', 'pair_request', 'pair_approve', 'totp_status', 'totp_begin', 'totp_confirm', 'totp_off', 'machine_tokens', 'machine_token_remove']);
const textEnc = new TextEncoder();
/**
 * Additional authenticated data that binds a frame to its direction (client to backend, backend to client). Browsers
 * and backends must use exactly these bytes, otherwise no frame can be decrypted.
 */
const AAD_TO_BACKEND = textEnc.encode('openfolk:c2b');
const AAD_FROM_BACKEND = textEnc.encode('openfolk:b2c');
const IDB_NAME = 'openfolk';

function b64(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s);
}

function unb64(text) {
    const s = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** Opens the database with the store 'kv'. */
function idb() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(IDB_NAME, 1);
        r.onupgradeneeded = () => {
            r.result.createObjectStore('kv');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

export async function idbSet(k, v) {
    const db = await idb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        if (v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGet(k, db) {
    db = db || await idb();
    return new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(k);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

export async function adoptKey(text) {
    const raw = unb64(text.includes('#e2e=') ? text.split('#e2e=')[1] : text);
    if (raw.length !== 32) throw new Error(t('e2e.keyLength'));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    if (secureStore) await secureStore.set('e2e', b64(raw));
    else {
        try { await idbSet('e2e', key); } catch { /* without IndexedDB only for this session */ }
    }
    e2e.key = key;
}

/** Delete the key on this device. */
export async function forgetKey() {
    if (secureStore) await secureStore.set('e2e', '').catch(() => undefined);
    try { await idbSet('e2e', undefined); } catch { /* ignore */ }
    e2e.key = null;
}

async function loadKey() {
    if (secureStore) {
        const raw = await secureStore.get('e2e');
        return raw ? crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']) : null;
    }
    return (await idbGet('e2e')) || null;
}

/**
 * Take over what a pairing link carries (`#pair=…` signs the device in once, `#e2e=…` is the key); true if there
 * was anything. `params`: the link's part behind '#'.
 * @param {URLSearchParams} params
 */
export async function adoptPairingLink(params) {
    const pair = params.get('pair');
    const key = params.get('e2e');
    if (pair) state.pairToken = pair;
    if (key) {
        try { await adoptKey(key); } catch (e) { alert(t('e2e.pairingFailed', { error: e.message })); }
    }
    return !!(pair || key);
}

export async function e2eStart() {
    if (!window.crypto || !crypto.subtle) return;
    try { e2e.key = await loadKey(); } catch { e2e.key = null; }
    await adoptPairingLink(startParams);
    // A new device's QR code, scanned with the camera app: approved once this device is signed in
    takeApproval(startParams);
    // Link pasted into a tab that is already open: the page does not reload, only the # part changes
    window.addEventListener('hashchange', async () => {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
        if (takeApproval(params)) {
            startApproval();
            return;
        }
        if (!(await adoptPairingLink(params))) return;
        el.keyDialog.hidden = true;
        // reconnect so the backends send everything again (encrypted)
        if (state.ws) state.ws.close(); else connect();
    });
}

/**
 * Replay protection (ReplayGuard in shared/protocol.ts): every encrypted frame carries this page's sender id, a
 * growing counter and the time; a frame the relay delivers a second time, or one older than ten minutes, is dropped.
 */
const REPLAY_WINDOW_MS = 10 * 60_000;
/**
 * Replay guard of one connection to the relay: its own sender id and counter, and the highest counter seen per
 * backend sender. Each connection needs its own (the shared chat list opens one per account, others.js): a backend
 * numbers all its frames in one sequence, and frames of two sockets may arrive interleaved, so one shared guard
 * would drop valid frames as repeated, here and in the backend.
 * @returns {{ sender: string, counter: number, seen: Map<string, number>, chain: Promise<void> }}
 */
export function newChannel() {
    return { sender: Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join(''), counter: 0, seen: new Map(), chain: Promise.resolve() };
}
const mainChannel = newChannel();

async function encrypt(frame, ch = mainChannel) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const guarded = Object.assign({}, frame, { _r: { t: Date.now(), s: ch.sender, n: ++ch.counter } });
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_TO_BACKEND }, e2e.key, textEnc.encode(JSON.stringify(guarded)));
    return { type: 'e2e', iv: b64(iv), data: b64(data) };
}

/** The frame, or null when it is a replay. Backends before protocol version 2 send no guard; their frames pass. */
export async function decrypt(f, ch = mainChannel) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv), additionalData: AAD_FROM_BACKEND }, e2e.key, unb64(f.data));
    const { _r: r, ...frame } = JSON.parse(new TextDecoder().decode(plain));
    if (r && typeof r.s === 'string' && typeof r.n === 'number') {
        if (Math.abs(Date.now() - r.t) > REPLAY_WINDOW_MS || r.n <= (ch.seen.get(r.s) || 0)) {
            console.warn('E2E: frame rejected (repeated or too old)');
            return null;
        }
        ch.seen.set(r.s, r.n);
    }
    return frame;
}

export function askForKey(hint) {
    if (!el.keyDialog.hidden) return;
    el.keyError.hidden = !hint;
    el.keyError.textContent = hint || '';
    el.keyInput.value = '';
    el.keyDialog.hidden = false;
    el.keyInput.focus();
}

export const isGroup = (chatId) => typeof chatId === 'string' && chatId.startsWith('g:');
// Conversations: chatId `<bot id>~<id>` next to the main chat `<bot id>`; bot() returns the bot for both
export const botIdOf = (chatId) => String(chatId || '').split('~')[0];
export const isConversation = (chatId) => !isGroup(chatId || '') && String(chatId || '').includes('~');
export const bot = (id) => state.bots.find((b) => b.id === botIdOf(id));
export const conversation = (chatId) => {
    const b = isConversation(chatId) ? bot(chatId) : null;
    return b && (b.conversations || []).find((c) => `${b.id}~${c.id}` === chatId);
};
export const conversationTitle = (chatId) => (conversation(chatId) || {}).title || t('conversation.new');
/** Model of a chat: the conversation's, otherwise the bot's ('default' = default of the CLI). */
export const modelOf = (chatId) => (conversation(chatId) || {}).model || (bot(chatId) || {}).model || 'default';
export const group = (chatId) => state.groups.find((g) => 'g:' + g.id === chatId);

export function clockTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const today = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    return today ? time : d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

export function duration(ms) {
    if (!ms && ms !== 0) return '';
    return ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`;
}

export function fileSize(b) {
    return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

function initials(name) {
    return (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function colorOf(id) {
    let h = 0;
    for (const c of id || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
}

// zoom: a click shows the picture large (only where the avatar has no other job)
export function fillAvatar(container, obj, id, zoom = false) {
    container.innerHTML = '';
    container.style.background = obj && obj.avatar ? '' : colorOf(id || (obj && obj.id) || '');
    container.classList.toggle('zoomable', Boolean(zoom && obj && obj.avatar));
    container.onclick = null;
    if (obj && obj.avatar) {
        const img = document.createElement('img');
        img.src = obj.avatar;
        img.alt = '';
        container.appendChild(img);
        if (zoom) container.onclick = (ev) => { ev.stopPropagation(); showImageLarge(obj.avatar, obj.name); };
    } else {
        container.textContent = initials(obj ? obj.name : '');
    }
}

// path: image attachment whose original still comes from the machine (then replaces the preview)
export function showImageLarge(src, name, path = '') {
    let o = document.getElementById('image-view');
    if (!o) {
        o = node('div', 'overlay image-view');
        o.id = 'image-view';
        o.appendChild(document.createElement('img'));
        o.addEventListener('click', () => { o.hidden = true; o.dataset.path = ''; });
        document.body.appendChild(o);
    }
    o.classList.toggle('photo', Boolean(path));
    o.dataset.path = path;
    const img = o.querySelector('img');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    if (src) img.src = src;
    else img.removeAttribute('src');
    img.alt = name || '';
    o.hidden = false;
}

/** Original of an image attachment arrived: only use it if the large view still shows exactly this picture. */
export function imageOriginal(f) {
    const o = document.getElementById('image-view');
    if (!o || o.hidden || o.dataset.path !== f.path) return;
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    showImageLarge(URL.createObjectURL(new Blob([bytes], { type: f.mime })), f.name, f.path);
}

export function shortFolder(folder) {
    return (folder || '').replace(/^[A-Za-z]:\/www\/?/, 'www/').replace(/^[A-Za-z]:\//, '');
}

export function plain(text) {
    return (text || '').replace(/```[\s\S]*?```/g, ` [${t('preview.code')}] `).replace(/[`*_#>|]+/g, '').replace(/\s+/g, ' ').trim();
}

export function senderName(from) {
    if (!from || from === 'me') return t('sender.me');
    if (from.startsWith('routine:')) return '⏰ ' + from.slice(8);
    return (bot(from) || {}).name || from;
}

/** Frames to the backends go out encrypted when there is a key (in order); relay requests in plain text. */
export function send(frame, machine) {
    sendOn(state.ws, mainChannel, frame, machine);
}

/** Like send(), over another connection with its own replay guard (others.js). */
export function sendOn(ws, ch, frame, machine) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (RELAY_TYPES.has(frame.type) || !e2e.key) {
        ws.send(JSON.stringify(machine ? Object.assign({}, frame, { machine }) : frame));
        return;
    }
    ch.chain = ch.chain.then(async () => {
        const v = await encrypt(frame, ch);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(machine ? Object.assign(v, { machine }) : v));
    }).catch((e) => console.warn('Encrypt:', e));
}

/**
 * Machine a bot runs on (same rule as in the backend, tests/browser/shared-rules.test.mjs): its own if it is awake,
 * otherwise none. One not placed yet (saved before 0.2) runs on the first machine awake, which claims it.
 */
export function responsibleMachine(b, online = state.online) {
    if (!b.machine) return [...online].sort()[0] || null;
    return online.includes(b.machine) ? b.machine : null;
}

export const upper = (r) => (r || '').toUpperCase();

/** Merge the states of all machines into one picture: a working bot wins over "idle". */
export function mergeStates() {
    state.states = {};
    state.activity = {};
    state.activeChats = {};
    for (const j of Object.values(state.perMachine)) {
        for (const [botId, st] of Object.entries(j.states || {})) {
            const before = state.states[botId];
            if (before && before !== 'idle') continue;
            state.states[botId] = st;
            if (j.activity && j.activity[botId]) state.activity[botId] = j.activity[botId];
            if (j.activeChats && j.activeChats[botId]) state.activeChats[botId] = j.activeChats[botId];
        }
    }
}

export function openApprovals(chatId) {
    return Object.values(state.approvals).filter((a) => a.chatId === chatId);
}
