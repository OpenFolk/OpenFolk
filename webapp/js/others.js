/* OpenFolk web app: the bots of the other accounts this device is signed in to, for the shared chat list. One
   lightweight connection per account fetches only what a row needs (bots, state, last message, unread); a tap opens
   the chat in that account, which loads the page again (accounts.js). The active account keeps its one full
   connection (connection.js), and nothing of another account goes beyond the list. */
import { deviceAccounts, loadedAccount, storage } from './core.js';
import { botIdOf, decrypt, e2e, isGroup, newChannel, sendOn } from './e2e.js';
import { socketUrl } from './platform.js';
import { preview } from './connection.js';
import { renderChatList } from './list.js';
import { forgetAccount } from './accounts.js';

/** '0': the list shows the active account only (settings). */
export const ALL_ACCOUNTS_KEY = 'openfolk-all-accounts';
const RETRY_MS = 15_000;

/**
 * @typedef {{ account: { id: string, name: string, device: string }, ws: WebSocket | null, channel: ReturnType<typeof newChannel>,
 *   bots: any[], groups: any[], perMachine: Record<string, { states: Record<string, string>, activity: Record<string, string>, activeChats: Record<string, string> }>,
 *   approvals: Record<string, { chatId: string, machine?: string }>, last: Record<string, string>, lastTs: Record<string, string>, incoming: Record<string, string>,
 *   seen: Record<string, any>, online: string[], retry: any }} Other
 */

/** @type {Map<string, Other>} */
export const others = new Map();

export function showAllAccounts() {
    return storage.get(ALL_ACCOUNTS_KEY) !== '0';
}

/** @param {boolean} on */
export function setShowAllAccounts(on) {
    storage.set(ALL_ACCOUNTS_KEY, on ? '1' : '0');
    if (on) connectOthers();
    else closeOthers();
    renderChatList();
}

/** After the active account signed in: one connection for each other account of this device. */
export function connectOthers() {
    if (!showAllAccounts()) return;
    for (const a of deviceAccounts()) {
        if (a.id === loadedAccount || others.has(a.id)) continue;
        /** @type {Other} */
        const o = {
            account: a, ws: null, channel: newChannel(), bots: [], groups: [], perMachine: {}, approvals: {}, last: {}, lastTs: {}, incoming: {},
            seen: storedSeen(a.id), online: [], retry: null,
        };
        others.set(a.id, o);
        open(o);
    }
}

export function closeOthers() {
    for (const o of others.values()) {
        clearTimeout(o.retry);
        const ws = o.ws;
        o.ws = null;
        if (ws) ws.close();
    }
    others.clear();
}

/** What this device last stored as seen for that account (core.js keeps it per account). */
function storedSeen(id) {
    try {
        const s = JSON.parse(storage.get(id === 'main' ? 'openfolk-seen' : `openfolk-seen:${id}`) || 'null');
        return s && typeof s === 'object' ? s : { _since: new Date().toISOString() };
    } catch {
        return { _since: new Date().toISOString() };
    }
}

/** @param {Other} o */
function open(o) {
    const ws = new WebSocket(socketUrl('/ws/client'));
    o.ws = ws;
    let inbox = Promise.resolve();
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', device: o.account.device }));
    ws.onmessage = (ev) => {
        if (o.ws !== ws) return;
        let f;
        try { f = JSON.parse(ev.data); } catch { return; }
        // in order, decrypting is asynchronous
        inbox = inbox.then(() => receive(o, f)).catch((e) => console.warn('Other account:', e));
    };
    ws.onclose = (ev) => {
        if (o.ws !== ws) return;
        o.ws = null;
        // 4004: logged out or deleted; that account is gone from this device
        if (ev.code === 4004) {
            drop(o);
            return;
        }
        if (others.get(o.account.id) === o) o.retry = setTimeout(() => open(o), RETRY_MS);
    };
}

/** @param {Other} o */
function drop(o) {
    clearTimeout(o.retry);
    others.delete(o.account.id);
    forgetAccount(o.account.id);
    renderChatList();
}

/** @param {Other} o */
function chatIds(o) {
    return [
        ...o.bots.flatMap((b) => [b.id, ...(b.conversations || []).filter((c) => !c.archived).map((c) => `${b.id}~${c.id}`)]),
        ...o.groups.map((g) => 'g:' + g.id),
    ];
}

/** @param {Other} o @param {any} raw */
async function receive(o, raw) {
    if (raw.type === 'auth') {
        if (!raw.ok && raw.loggedOut) drop(o);
        return;
    }
    if (raw.type === 'agents') {
        o.online = raw.online || [];
        renderChatList();
        return;
    }
    let f = raw;
    if (raw.type === 'e2e') {
        if (!e2e.key) return;
        f = await decrypt(raw, o.channel).catch(() => null);
        if (!f) return;
        if (raw.machine) f.machine = raw.machine;
    } else if (e2e.key) {
        // With a key only encrypted frames count, as on the main connection
        return;
    }
    const nameOf = (id) => (o.bots.find((b) => b.id === id) || {}).name || id;
    const note = (chatId, e) => {
        if (!e) return;
        o.last[chatId] = preview(chatId, e, nameOf);
        if (e.ts) o.lastTs[chatId] = e.ts;
        const incoming = e.role === 'assistant' || (e.role === 'user' && e.from && e.from !== 'me' && !e.from.startsWith('routine:'));
        if (incoming && e.ts && (!o.incoming[chatId] || e.ts > o.incoming[chatId])) o.incoming[chatId] = e.ts;
    };
    switch (f.type) {
        case 'bots':
            o.bots = f.bots || [];
            o.groups = f.groups || [];
            if (f.machine) {
                o.perMachine[f.machine] = { states: f.states || {}, activity: f.activity || {}, activeChats: f.activeChats || {} };
                for (const [id, a] of Object.entries(o.approvals)) if (a.machine === f.machine) delete o.approvals[id];
            }
            for (const a of f.approvals || []) o.approvals[a.id] = Object.assign({ machine: f.machine }, a);
            for (const id of chatIds(o)) if (!(id in o.last)) sendOn(o.ws, o.channel, { type: 'history', chatId: id, limit: 1 });
            break;
        case 'history': {
            const entries = f.entries || [];
            o.last[f.chatId] = o.last[f.chatId] || '';
            note(f.chatId, entries[entries.length - 1]);
            break;
        }
        case 'user':
            note(f.chatId, f.entry);
            break;
        case 'done':
            if (f.entry && (f.entry.text || (f.entry.attachments || []).length)) note(f.chatId, f.entry);
            break;
        case 'state': {
            const m = (o.perMachine[f.machine || '?'] = o.perMachine[f.machine || '?'] || { states: {}, activity: {}, activeChats: {} });
            m.states[f.botId] = f.state;
            if (f.chatId && f.state !== 'idle' && f.state !== 'error') m.activeChats[f.botId] = f.chatId;
            else delete m.activeChats[f.botId];
            if (f.activity) m.activity[f.botId] = f.activity;
            else delete m.activity[f.botId];
            break;
        }
        case 'approval':
            o.approvals[f.approval.id] = Object.assign({ machine: f.machine }, f.approval);
            break;
        case 'approval_done':
            delete o.approvals[f.id];
            break;
        case 'seen':
            for (const [id, e] of Object.entries(f.state || {})) {
                const here = o.seen[id];
                if (!here || typeof here !== 'object' || (e && e.updatedAt > here.updatedAt)) o.seen[id] = e;
            }
            break;
        default:
            return;
    }
    renderChatList();
}

// ---------------------------------------------------------------- What the list shows of them

/** @param {Other} o @param {string} chatId */
function status(o, chatId) {
    if (Object.values(o.approvals).some((a) => a.chatId === chatId)) return { state: 'waiting', activity: '' };
    const members = isGroup(chatId) ? ((o.groups.find((g) => 'g:' + g.id === chatId) || {}).members || []) : [botIdOf(chatId)];
    for (const m of Object.values(o.perMachine)) {
        for (const id of members) {
            const s = m.states[id];
            if ((s === 'thinking' || s === 'waiting') && m.activeChats[id] === chatId) return { state: 'thinking', activity: m.activity[id] || '' };
        }
    }
    return { state: 'idle', activity: '' };
}

/** @param {Other} o @param {string} chatId */
function unread(o, chatId) {
    const e = o.seen[chatId];
    if (e && e.unread) return true;
    const incoming = o.incoming[chatId];
    return !!incoming && incoming > ((e && e.until) || o.seen._since || '');
}

/**
 * The rows of the other accounts: a bot (with its conversations) or a group each, with what the list sorts by.
 * @returns {{ account: { id: string, name: string }, id: string, item: any, group: boolean, section: number, ts: string,
 *   state: string, activity: string, last: string, unread: boolean, approvals: number, sleeping: boolean, machine: string }[]}
 */
export function otherRows() {
    if (!showAllAccounts()) return [];
    const rows = [];
    for (const o of others.values()) {
        const items = [...o.bots.map((b) => ({ id: b.id, item: b, group: false })), ...o.groups.map((g) => ({ id: 'g:' + g.id, item: g, group: true }))];
        for (const { id, item, group } of items) {
            const chats = group ? [id] : [id, ...(item.conversations || []).filter((c) => !c.archived).map((c) => `${id}~${c.id}`)];
            const states = chats.map((c) => status(o, c));
            const busy = states.find((s) => s.state !== 'idle');
            const own = status(o, id);
            // A bot counts as running when one of its conversations runs, as in the own list
            const shown = own.state !== 'idle' ? own : busy || own;
            const ts = chats.reduce((x, c) => ((o.lastTs[c] || '') > x ? o.lastTs[c] : x), '');
            const sleeping = !group && !!item.machine && !o.online.includes(item.machine) && !busy;
            rows.push({
                account: o.account, id, item, group, ts,
                section: busy ? 0 : item.favorite ? 1 : 2,
                state: shown.state, activity: shown.activity,
                last: o.last[id] || '', unread: chats.some((c) => unread(o, c)),
                approvals: Object.values(o.approvals).filter((a) => chats.includes(a.chatId)).length,
                sleeping, machine: item.machine || '',
            });
        }
    }
    return rows;
}

/** Opens a chat of another account: the page loads again in that account (core.js picks it from ?account=). */
export function openOtherChat(account, chatId) {
    location.href = `${location.pathname}?chat=${encodeURIComponent(chatId)}&account=${encodeURIComponent(account)}`;
}

/** For the app badge. */
export function otherUnreadCount() {
    return otherRows().filter((r) => r.unread).length;
}
