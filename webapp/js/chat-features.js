/* OpenFolk web app: @ mentions, history rendering, unread, read aloud, pinned messages, replies (quote). */
import { i18n, locale, t } from './i18n.js';
import { SEEN_KEY, el, mdCached, node, state, storage, closest } from './core.js';
import { paneFor, paneOf, visibleChats } from './panes.js';
import { bot, botIdOf, clockTime, colorOf, fillAvatar, group, isGroup, plain, responsibleMachine, send, senderName, upper } from './e2e.js';
import { jumpToEntry, listTap, renderChatList } from './list.js';
import { openChat } from './chat.js';
import { attachmentBar, displayTime, getLive, isQueued, liveWrap, renderApprovals, renderLiveText, renderQueue, renderTools, showEvent, speaker, textHeight, titleFrom, toolRow } from './queue.js';
import { renderVoicePending, voicePlayer } from './voice.js';
import { menuButton } from './menus.js';

/** @typedef {import('./panes.js').Pane} Pane */

// ---------------------------------------------------------- @ mentions
// Typing "@" suggests bots: in groups the members, in a single chat all other bots
// (which the backend names to the bot as helpers for message_bot).

function mentionCandidates(chatId) {
    const g = group(chatId);
    if (g) return [...g.members.map(bot).filter(Boolean), { id: 'all', name: t('mention.everyone'), role: '' }];
    return state.bots.filter((b) => b.id !== botIdOf(chatId));
}

/** @param {Pane} p */
export function checkMention(p) {
    const text = p.el.text;
    const pos = text.selectionStart;
    const m = text.selectionEnd === pos ? /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.value.slice(0, pos)) : null;
    if (!m || !p.chatId) return closeMention(p);
    const query = m[1].toLowerCase();
    const hits = mentionCandidates(p.chatId)
        .filter((b) => !query || b.id.toLowerCase().includes(query) || (b.name || '').toLowerCase().includes(query))
        .sort((a, b) => Number(!a.id.toLowerCase().startsWith(query)) - Number(!b.id.toLowerCase().startsWith(query)));
    if (hits.length === 0) return closeMention(p);
    p.mention.start = pos - m[1].length - 1;
    p.mention.hits = hits;
    p.mention.active = Math.min(p.mention.active, hits.length - 1);
    renderMention(p);
}

/** @param {Pane} p */
function renderMention(p) {
    const list = p.el.mention;
    list.innerHTML = '';
    p.mention.hits.forEach((b, i) => {
        const row = node('div', 'match' + (i === p.mention.active ? ' active' : ''));
        row.setAttribute('role', 'option');
        const av = node('div', 'avatar');
        fillAvatar(av, b, b.id);
        const who = node('div', 'who');
        who.appendChild(node('span', '', `${b.name} · @${b.id}`));
        if (b.area || b.role) who.appendChild(node('span', 'role', b.area || b.role));
        row.append(av, who);
        // mousedown instead of click: the input keeps the focus, the keyboard on the phone stays open
        row.addEventListener('mousedown', (ev) => { ev.preventDefault(); chooseMention(p, i); });
        list.appendChild(row);
    });
    list.hidden = false;
    const active = list.children[p.mention.active];
    if (active) active.scrollIntoView({ block: 'nearest' });
}

/** @param {Pane} p */
function chooseMention(p, i) {
    const b = p.mention.hits[i];
    if (!b) return;
    const text = p.el.text;
    const v = text.value;
    const before = v.slice(0, p.mention.start) + '@' + b.id + ' ';
    text.value = before + v.slice(text.selectionStart).replace(/^\S*\s?/, '');
    text.setSelectionRange(before.length, before.length);
    closeMention(p);
    text.focus();
    textHeight(p);
}

/** @param {Pane} p */
export function closeMention(p) {
    p.mention.start = -1;
    p.mention.hits = [];
    p.mention.active = 0;
    p.el.mention.hidden = true;
    p.el.mention.innerHTML = '';
}

/** Arrow keys, Enter/Tab and Escape operate the list while it is open. @param {Pane} p */
export function mentionKey(p, ev) {
    if (p.el.mention.hidden) return false;
    const m = p.mention;
    const n = m.hits.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        m.active = (m.active + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
        renderMention(p);
    } else if ((ev.key === 'Enter' && !ev.shiftKey) || ev.key === 'Tab') {
        chooseMention(p, m.active);
    } else if (ev.key === 'Escape') {
        closeMention(p);
    } else {
        return false;
    }
    ev.preventDefault();
    return true;
}

// When opening, the chat first renders the remembered history, then the fresh one from the machine. Mostly both
// are the same; the second rendering froze the iPad briefly with long chats and is skipped then (`rendered` of
// the pane holds what was drawn last).

function historySnapshot(entries) {
    return JSON.stringify(entries, (k, v) => (k === 'result' || k === 'deferred' ? undefined : v));
}

/** @param {Pane} p */
export function historyUnchanged(p, chatId, entries, live) {
    return p.rendered.id === chatId && !live.length && !Object.keys(state.live[chatId] || {}).length
        && p.rendered.snapshot === historySnapshot(entries);
}

/** @param {Pane} p */
export function renderHistory(p, live) {
    const id = p.chatId;
    p.rendered = { id, snapshot: historySnapshot(state.history[id] || []) };
    const entries = (state.history[id] || []).map((e, i) => ({ e, i, ts: displayTime(e) }))
        .sort((a, b) => a.ts.localeCompare(b.ts) || a.i - b.i).map((x) => x.e);
    p.el.messages.innerHTML = '';
    for (const e of entries) if (!isQueued(e, id) && !e.deletedAt) renderEntry(p, e);
    // running answers (also those that started before opening)
    for (const lt of live || []) {
        const l = getLive(id, lt.botId);
        l.text = lt.text;
        l.tools = new Map(lt.tools.map((tool) => [tool.id, tool]));
    }
    for (const [botId, l] of Object.entries(state.live[id] || {})) {
        l.wrap = null;
        l.bubble = null;
        l.rows = new Map();
        for (const tool of l.tools.values()) {
            const row = toolRow(tool);
            l.rows.set(tool.id, row);
            liveWrap(id, botId).appendChild(row);
        }
        if (l.text) renderLiveText(id, botId, true);
        else liveWrap(id, botId);
    }
    renderVoicePending(p);
    renderApprovals(p);
    renderQueue(p);
    scroll(p, true);
}

// Follow: a pane follows every new content as long as the user has not scrolled up himself (`follow` of the pane).
// Whether it follows is decided by the last scroll movement, not by the distance after inserting – otherwise
// following stopped with large blocks (code, tables).

/** @param {Pane} p */
export function scroll(p, now = false) {
    if (!p) return;
    if (now) p.follow = true;
    if (p.follow) p.el.messages.scrollTop = p.el.messages.scrollHeight;
    p.el.toBottom.hidden = p.follow;
}

/** @param {Pane} p */
export function renderEntry(p, e) {
    const messages = p.el.messages;
    const chatId = p.chatId;
    if (e.role === 'event') {
        messages.appendChild(node('div', 'event', e.text));
        return;
    }
    if (e.role === 'user' && e.movedTo) {
        // moved from the queue into a conversation of its own: hint with link instead of a bubble
        const h = node('div', 'event moved', e.movedTo === 'pending'
            ? '↗ ' + t('queue.moving')
            : '↗ ' + t('queue.movedTo', { title: titleFrom(e.text) }));
        if (e.id) h.dataset.id = e.id;
        if (e.movedTo !== 'pending') h.addEventListener('click', () => openChat(e.movedTo, undefined, undefined, p));
        messages.appendChild(h);
        return;
    }
    if (e.role === 'user') {
        const fromMe = !e.from || e.from === 'me';
        const routine = e.from && e.from.startsWith('routine:');
        const b = node('div', 'bubble ' + (fromMe ? 'me' : routine ? 'me routine' : 'bot job'));
        if (!fromMe) {
            const head = node('div', 'sender', routine ? senderName(e.from) : t('chat.jobFrom', { name: senderName(e.from) }));
            if (!routine) head.style.color = colorOf(e.from);
            b.appendChild(head);
        }
        if (e.replyTo) b.appendChild(quoteNode(p, e.replyTo));
        let attachments = e.attachments || [];
        if (e.voice) {
            // voice message: player, below it the transcript
            b.classList.add('voice');
            for (const a of attachments.filter((x) => x.type.startsWith('audio/'))) b.appendChild(voicePlayer(a));
            attachments = attachments.filter((x) => !x.type.startsWith('audio/'));
            b.appendChild(node('div', 'transcript', e.text || t('voice.notTranscribed')));
        } else if (e.text) {
            b.appendChild(node('div', 'text', e.text));
        }
        if (attachments.length) b.appendChild(attachmentBar(attachments));
        const time = node('span', 'time', clockTime(e.ts));
        if (e.id) time.prepend(moreButton());
        if (fromMe) {
            b.dataset.id = e.id || '';
            time.appendChild(ticks(isRead(e)));
        }
        b.appendChild(time);
        if (e.id) b.dataset.eid = e.id;
        messages.appendChild(b);
        return;
    }
    // assistant
    const wrap = node('div', 'answer');
    if (isGroup(chatId) && e.botId) wrap.appendChild(speaker(e.botId));
    renderTools(wrap, e.tools || [], { chatId, entryId: e.id });
    if (e.text || (e.attachments && e.attachments.length)) {
        const b = node('div', 'bubble bot');
        if (e.text) {
            const content = node('div', 'content');
            content.innerHTML = mdCached(e.text);
            commandButtons(content, chatId, e.botId || (isGroup(chatId) ? null : botIdOf(chatId)));
            b.appendChild(content);
        }
        if (e.attachments && e.attachments.length) b.appendChild(attachmentBar(e.attachments));
        const time = node('span', 'time');
        if (e.id) time.appendChild(moreButton());
        if (e.text && e.id) time.appendChild(speakButton(e));
        time.appendChild(document.createTextNode(clockTime(e.ts)));
        b.appendChild(time);
        if (e.id) b.dataset.eid = e.id;
        wrap.appendChild(b);
    }
    messages.appendChild(wrap);
}

// ---------------------------------------------------------- Let commands run
// If a bot names a command as code (`npm run restart -w local -- reason`), ▶ follows it. A tap sends it, after asking,
// as a message to exactly this bot, which runs it in its folder and reports the result; its approval rules apply as
// usual. Only single-line commands of known tools.
const COMMAND = /^(npm|npx|pnpm|yarn|node|php|composer|git|python|py|pip|tsx)\s+\S/;

function commandButtons(content, chatId, botId) {
    if (!botId) return;
    for (const code of content.querySelectorAll('code')) {
        const command = code.textContent.trim();
        if (command.includes('\n') || command.length > 300 || !COMMAND.test(command)) continue;
        const k = node('button', 'command-run', '▶');
        k.type = 'button';
        k.title = t('command.run');
        k.setAttribute('aria-label', t('command.runLabel', { command }));
        k.addEventListener('click', (ev) => { ev.stopPropagation(); runCommand(chatId, botId, command); });
        // code block: button in the corner of the block; otherwise right behind the code in the text
        const block = code.parentElement && code.parentElement.tagName === 'PRE' ? code.parentElement : null;
        if (block) { block.classList.add('with-command'); block.appendChild(k); } else code.after(k);
    }
}

function runCommand(chatId, botId, command) {
    const b = bot(botId);
    if (!b || !chatId) return;
    const where = responsibleMachine(b);
    if (!where || !state.agentOnline) { alert(t('bot.sleepsNoMachine', { name: b.name }) + '.'); return; }
    if (!confirm(t('command.confirm', { name: b.name, command, machine: upper(where) }))) return;
    // in groups addressed to the bot that named the command
    const text = `${isGroup(chatId) ? `@${b.id} ` : ''}${t('command.request', { command: '`' + command + '`' })}`;
    send({ type: 'send', chatId, text }, isGroup(chatId) ? undefined : where);
}

// ---------------------------------------------------------- Unread
// Until when a chat was seen applies to all devices: every change goes to the machines, which pass it on to all
// devices ({ until, unread, updatedAt } per chat, the newer state wins). The browser storage holds the state as long
// as no machine is awake; on the next connection newer entries are sent. Newer incoming messages show an orange dot
// in the overview. On the very first start everything up to now counts as seen (`_since`).
const seen = (() => {
    let s = null;
    try { s = JSON.parse(storage.get(SEEN_KEY) || 'null'); } catch { /* create new */ }
    return s && typeof s === 'object' ? s : { _since: new Date().toISOString() };
})();
if (!seen._since) seen._since = new Date().toISOString();
storage.set(SEEN_KEY, JSON.stringify(seen));

function isIncoming(e) {
    return e.role === 'assistant' || (e.role === 'user' && e.from && e.from !== 'me' && !e.from.startsWith('routine:'));
}

export function noteIncoming(chatId, entries) {
    for (const e of entries) if (e && e.ts && isIncoming(e) && (!state.incoming[chatId] || e.ts > state.incoming[chatId])) state.incoming[chatId] = e.ts;
}

/** Collect changed chats and send them bundled to the machines (with the chat open every answer comes on its own). */
const seenPending = {};
let seenTimer = null;
function rememberSeen(chatId, entry) {
    seen[chatId] = entry;
    storage.set(SEEN_KEY, JSON.stringify(seen));
    seenPending[chatId] = entry;
    clearTimeout(seenTimer);
    seenTimer = setTimeout(sendSeen, 800);
}

function sendSeen() {
    const changed = Object.assign({}, seenPending);
    if (!Object.keys(changed).length || !state.signedIn || !state.agentOnline) return;
    for (const id of Object.keys(changed)) delete seenPending[id];
    send({ type: 'seen', state: changed });
}

export function markSeen(chatId) {
    if (!chatId) return;
    rememberSeen(chatId, { until: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

/** State from the machines: take over newer entries; on connecting (all) send what is newer here. */
export function receiveSeen(f) {
    let changed = false;
    for (const [id, e] of Object.entries(f.state || {})) {
        const here = seen[id];
        if (here && typeof here === 'object' && here.updatedAt >= e.updatedAt) continue;
        seen[id] = e;
        changed = true;
    }
    if (f.all) {
        for (const [id, e] of Object.entries(seen)) {
            if (id.startsWith('_') || !e || typeof e !== 'object') continue;
            const there = f.state && f.state[id];
            if (!there || there.updatedAt < e.updatedAt) seenPending[id] = e;
        }
        clearTimeout(seenTimer);
        seenTimer = setTimeout(sendSeen, 300);
    }
    if (!changed) return;
    storage.set(SEEN_KEY, JSON.stringify(seen));
    renderChatList();
}

export function isUnread(chatId) {
    if (!document.hidden && visibleChats().includes(chatId)) return false;
    const e = seen[chatId];
    if (e && e.unread) return true;
    const incoming = state.incoming[chatId];
    return !!incoming && incoming > ((e && e.until) || seen._since);
}

export function toggleUnread(chatId) {
    if (isUnread(chatId)) markSeen(chatId);
    else {
        const e = seen[chatId];
        rememberSeen(chatId, { until: e && e.until, unread: true, updatedAt: new Date().toISOString() });
    }
    listTap.active = false;
    renderChatList();
}

// ---------------------------------------------------------- Read aloud
// Speech output of the browser (on the iPhone the iOS voices). Long texts in sentences, because some
// browsers stop long utterances after a few seconds. Code and links are only announced.
const speech = { active: null };

function moreButton() {
    const k = node('button', 'more', '⋯');
    k.type = 'button';
    k.title = t('message.moreTitle');
    k.setAttribute('aria-label', t('message.moreLabel'));
    return k;
}

function speakButton(e) {
    const k = node('button', 'speak' + (speech.active === e.id ? ' speaking' : ''));
    k.type = 'button';
    k.dataset.speak = e.id;
    k.title = t('message.readAloud');
    k.setAttribute('aria-label', t('message.readAloud'));
    k.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="wave" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
    k.addEventListener('click', (ev) => { ev.stopPropagation(); readAloud(e); });
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

/** Best voice for the UI language: premium/enhanced/natural voices first (German systems call them "erweitert"),
 *  then local ones. */
function speechVoice() {
    const lang = new RegExp(`^${i18n.language}(-|_|$)`, 'i');
    const voices = (window.speechSynthesis.getVoices() || []).filter((v) => lang.test(v.lang));
    return voices.find((v) => /premium|enhanced|erweitert|natural|neural/i.test(v.name)) || voices.find((v) => v.localService) || voices[0] || null;
}

function showSpeaking(id) {
    speech.active = id;
    for (const k of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.speak'))) k.classList.toggle('speaking', k.dataset.speak === id);
}

// In silent mode the speech output on the iPhone stays mute but still reports "running"; a web page can neither
// query nor bypass the switch (audioSession "playback" with a silent <audio> did not help).
// iPadOS pretends to be a Mac, but gives itself away by touch.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** If the output does not start (iOS hangs at times, e.g. after a voice recording), try once more. */
const SPEAK_START_MS = 1500;

function readAloud(e, secondTry = false) {
    if (!('speechSynthesis' in window)) {
        alert(t('speak.unsupported'));
        return;
    }
    const synth = window.speechSynthesis;
    const wasActive = speech.active;
    synth.cancel();
    // Safari sometimes stays paused after cancel(); new utterances then stay silent
    if (typeof synth.resume === 'function') synth.resume();
    showSpeaking(null);
    if (wasActive === e.id && !secondTry) return;
    const sentences = speechText(e.text).match(/[^.!?…]+[.!?…]*\s*/g) || [];
    // bundle sentences into chunks up to about 220 characters
    const parts = [];
    for (const s of sentences) {
        if (parts.length && (parts[parts.length - 1] + s).length < 220) parts[parts.length - 1] += s;
        else parts.push(s);
    }
    if (!parts.length) return;
    if (IOS && !speech.silentHintShown) {
        speech.silentHintShown = true;
        showEvent(t('speak.silentMode'));
    }
    const voice = speechVoice();
    let started = false;
    parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part.trim());
        u.lang = locale();
        if (voice) u.voice = voice;
        u.rate = 1.05;
        if (i === 0) u.onstart = () => { started = true; };
        if (i === parts.length - 1) u.onend = () => { if (speech.active === e.id) showSpeaking(null); };
        u.onerror = () => { if (speech.active === e.id && i === parts.length - 1) showSpeaking(null); };
        synth.speak(u);
    });
    showSpeaking(e.id);
    setTimeout(() => {
        if (started || speech.active !== e.id) return;
        if (!secondTry) { readAloud(e, true); return; }
        synth.cancel();
        showSpeaking(null);
        showEvent(t('speak.doesNotStart'), true);
    }, SPEAK_START_MS);
}

// ---------------------------------------------------------- Pinned messages
// The "⋯" button on a message (or a right click) opens its menu: pin/unpin, read aloud, copy.
// The bar below the header shows a pinned message; a tap jumps there, with several in turn (fxIndex of the pane).
const fx = { openSince: 0 };

function entryById(chatId, eid) {
    return (state.history[chatId] || []).find((x) => x.id === eid);
}

function pinnedOf(chatId) {
    return (state.pinned && state.pinned[chatId]) || [];
}

/** @param {Pane} p */
export function renderPinned(p) {
    if (!p) return;
    const list = p.chatId ? pinnedOf(p.chatId) : [];
    p.el.pinnedBar.hidden = list.length === 0;
    p.el.pinnedBar.classList.remove('open');
    if (!list.length) return;
    if (p.fxIndex >= list.length) p.fxIndex = 0;
    const pin = list[p.fxIndex];
    p.el.fxText.innerHTML = '';
    const who = isGroup(p.chatId) || pin.from !== 'me' ? `${senderName(pin.from)}: ` : '';
    p.el.fxText.append(node('span', 'fx-content', '📌 ' + who + (plain(pin.text) || t('message.noText'))));
    if (list.length > 1) p.el.fxText.append(node('span', 'fx-count', `${p.fxIndex + 1}/${list.length}`));
}

/** @param {Pane} p */
export function tapPinned(p) {
    const list = pinnedOf(p.chatId);
    const pin = list[p.fxIndex];
    if (!pin) return;
    const bubble = /** @type {HTMLElement | null} */ (p.el.messages.querySelector(`.bubble[data-eid="${CSS.escape(pin.id)}"]`));
    if (bubble) {
        p.follow = false;
        bubble.scrollIntoView({ block: 'center', behavior: 'smooth' });
        bubble.classList.remove('highlighted');
        void bubble.offsetWidth;
        bubble.classList.add('highlighted');
        p.el.toBottom.hidden = false;
        // the next tap shows the next pinned message
        if (list.length > 1) { p.fxIndex = (p.fxIndex + 1) % list.length; renderPinned(p); }
    } else {
        // not in the loaded history: expand the text in the bar
        p.el.pinnedBar.classList.toggle('open');
    }
}

/** ✕ in the bar: unpin the message shown there. @param {Pane} p */
export function unpinShown(p) {
    const pin = pinnedOf(p.chatId)[p.fxIndex];
    if (pin) sendPin(p.chatId, pin, false);
}

function sendPin(chatId, entry, on) {
    const list = pinnedOf(chatId).filter((x) => x.id !== entry.id);
    state.pinned[chatId] = on ? [entry, ...list].slice(0, 3) : list;
    const p = paneFor(chatId);
    if (p && on) p.fxIndex = 0;
    renderPinned(p);
    send({ type: 'pin', chatId, entry, on });
}

// ---------------------------------------------------------- Replies (quote)
function quoteText(e) {
    return (plain(e.text) || (e.attachments || []).map((a) => a.name).join(', ') || t('message.noText')).slice(0, 300);
}

/** Set the quote above the input field of a pane (or remove it with null); it goes out with the next message. */
export function setReply(p, q) {
    p.replyTo = q;
    p.el.replyBar.hidden = !q;
    if (!q) return;
    p.el.rbWho.textContent = senderName(q.from);
    p.el.rbText.textContent = q.text;
    p.el.text.focus();
}

/** @param {Pane} p */
function quoteNode(p, q) {
    const k = node('div', 'quote');
    k.append(node('strong', '', senderName(q.from)), node('span', '', q.text));
    // jumps to the quoted message if it is in the loaded history
    k.addEventListener('click', (ev) => {
        ev.stopPropagation();
        p.jumpTo = q.id;
        jumpToEntry(p);
    });
    return k;
}

/** @param {Pane} p */
function openMessageMenu(p, bubble, x, y) {
    const chatId = p.chatId;
    const e = entryById(chatId, bubble.dataset.eid);
    if (!e) return;
    const pinned = pinnedOf(chatId).some((x) => x.id === e.id);
    const m = el.messageMenu;
    m.innerHTML = '';
    const item = (icon, text, action) => {
        const k = menuButton(icon, text);
        k.addEventListener('click', (ev) => { ev.stopPropagation(); m.hidden = true; action(); });
        m.appendChild(k);
    };
    const from = e.role === 'user' ? (e.from || 'me') : (e.botId || botIdOf(chatId));
    // The pane may show another chat by the time the entry is chosen
    item('reply', t('message.reply'), () => { if (p.chatId === chatId) setReply(p, { id: e.id, from, text: quoteText(e) }); });
    item(pinned ? 'unpin' : 'pin', pinned ? t('message.unpin') : t('message.pin'), () => sendPin(chatId, {
        id: e.id, text: e.text || (e.attachments || []).map((a) => a.name).join(', '), ts: e.ts, from,
    }, !pinned));
    if (e.text) item(speech.active === e.id ? 'stop' : 'speaker', speech.active === e.id ? t('message.stopReading') : t('message.readAloud'), () => readAloud(e));
    if (e.text) item('copy', t('message.copy'), () => { if (navigator.clipboard) navigator.clipboard.writeText(e.text).catch(() => undefined); });
    m.hidden = false;
    fx.openSince = Date.now();
    // at the finger or mouse pointer, but inside the window
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    bubble.classList.remove('highlighted');
    void bubble.offsetWidth;
    bubble.classList.add('highlighted');
}

/** Message menu for all panes, delegated on their container (panes come and go). */
export function setupMessageMenu() {
    const bubbleOf = (ev) => ev.target.closest && ev.target.closest('.messages .bubble[data-eid]');
    // A long press on the phone stays with text selection (select and copy sentences); the menu opens there via
    // the "⋯" button on the message. A right click with the mouse opens it directly.
    let pointer = 'mouse';
    el.panes.addEventListener('pointerdown', (ev) => { pointer = ev.pointerType; }, true);
    el.panes.addEventListener('contextmenu', (ev) => {
        const b = bubbleOf(ev);
        const p = paneOf(ev);
        if (!b || !p || pointer === 'touch' || window.getSelection().toString()) return;
        ev.preventDefault();
        openMessageMenu(p, b, ev.clientX, ev.clientY);
    });
    el.panes.addEventListener('click', (ev) => {
        const k = closest(ev, '.messages .more');
        const b = k && bubbleOf(ev);
        const p = paneOf(ev);
        if (!b || !p) return;
        ev.stopPropagation();
        const r = k.getBoundingClientRect();
        openMessageMenu(p, b, r.left - 150, r.bottom + 4);
    });
    // The click that opened the menu must not close it right away
    document.addEventListener('click', (ev) => {
        if (!el.messageMenu.contains(/** @type {Node} */ (ev.target)) && Date.now() - (fx.openSince || 0) > 600) el.messageMenu.hidden = true;
    });
}

// Ticks as in a messenger: one = stored on the machine, two blue = a bot started on it.
// Messages from before the ticks count as read.
const TICKS_SINCE = '2026-10-07T10:30:00Z';

export function isRead(e) {
    return Boolean(e.readAt) || e.ts < TICKS_SINCE;
}

function ticks(read) {
    const s = node('span', 'read-ticks' + (read ? ' read' : ''));
    s.title = read ? t('message.read') : t('message.sent');
    s.innerHTML = '<svg viewBox="0 0 18 11" aria-hidden="true"><path d="M1 6l3.5 3.5L11 2"/><path class="second" d="M7 9.5L14.5 2"/></svg>';
    return s;
}

export function setRead(chatId, id, ts) {
    const e = (state.history[chatId] || []).find((x) => x.id === id);
    if (e) e.readAt = ts;
    const p = paneFor(chatId);
    if (!p) return;
    const b = p.el.messages.querySelector(`.bubble[data-id="${CSS.escape(id)}"] .read-ticks`);
    if (b) b.replaceWith(ticks(true));
    renderQueue(p);
}
