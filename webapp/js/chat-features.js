/* OpenFolk web app: @ mentions, / commands, history rendering, unread, pinned messages, replies (quote). */
import { i18n, readSetting, t, writeSetting } from './i18n.js';
import { SEEN_KEY, SUPPORT_MAIL, el, mdCached, node, state, storage, closest, toast } from './core.js';
import { codeBlocks } from './code-blocks.js';
import { paneFor, paneOf, panes, visibleChats } from './panes.js';
import { bot, botIdOf, clockTime, colorOf, conversationTitle, fillAvatar, group, isConversation, isGroup, isPerson, modelOf, person, plain, responsibleMachine, send, senderName, upper } from './e2e.js';
import { jumpToEntry, listTap, renderChatList } from './list.js';
import { openChat } from './chat.js';
import { allChats, isBlocked } from './connection.js';
import { attachmentBar, composerButtons, displayTime, getLive, isQueued, liveWrap, renderApprovals, renderLiveText, renderQueue, renderTools, speaker, textHeight, titleFrom, toolRow } from './queue.js';
import { renderVoicePending, voicePlayer } from './voice.js';
import { menuButton } from './menus.js';
import { isReading, readAloud, speakButton } from './read-aloud.js';
import { alertDialog, confirmDialog } from './dialogs.js';
import { renderOutbox } from './outbox.js';
import { isNative } from './platform.js';

/** @typedef {import('./panes.js').Pane} Pane */

// ---------------------------------------------------------- @ mentions
// Typing "@" suggests bots: in groups the members, in a single chat all other bots
// (which the backend names to the bot as helpers for message_bot).

function mentionCandidates(chatId) {
    const g = group(chatId);
    if (g) return [...g.members.map(bot).filter(Boolean), { id: 'all', name: t('mention.everyone'), role: '' }];
    return state.bots.filter((b) => b.id !== botIdOf(chatId));
}

const startsWith = (b, query) => b.id.toLowerCase().startsWith(query) || (b.name || '').toLowerCase().startsWith(query);

/** What a chosen bot is inserted as: its first name when that is one word no other candidate shares (the backend
 *  matches name and id alike, mentioned() in agent.ts), else its id. @param {{ id: string, name?: string }} b */
function mentionWord(b, candidates) {
    const name = b.name || '';
    const norm = (x) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
    if (!/^[\p{L}\p{N}_-]+$/u.test(name) || b.id === 'all') return b.id;
    const n = norm(name);
    return candidates.some((c) => c.id !== b.id && (norm(c.name || '') === n || norm(c.id) === n)) ? b.id : name;
}

/** @param {Pane} p */
export function checkMention(p) {
    const text = p.el.text;
    const pos = text.selectionStart;
    const before = text.selectionEnd === pos ? text.value.slice(0, pos) : '';
    const c = /^\/([\p{L}\p{N}_:.-]*)$/u.exec(before);
    if (c && p.chatId) return checkCommand(p, c[1]);
    const m = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
    if (!m || !p.chatId) return closeMention(p);
    const query = m[1].toLowerCase();
    const hits = mentionCandidates(p.chatId)
        .filter((b) => !query || b.id.toLowerCase().includes(query) || (b.name || '').toLowerCase().includes(query))
        .sort((a, b) => Number(!startsWith(a, query)) - Number(!startsWith(b, query)));
    if (hits.length === 0) return closeMention(p);
    p.mention.kind = 'bot';
    p.mention.start = pos - m[1].length - 1;
    p.mention.hits = hits;
    p.mention.active = Math.min(p.mention.active, hits.length - 1);
    renderMention(p);
}

/** @param {Pane} p */
function renderMention(p) {
    const list = p.el.mention;
    list.innerHTML = '';
    const commands = p.mention.kind === 'command';
    list.setAttribute('aria-label', t(commands ? 'commands.label' : 'mention.label'));
    p.mention.hits.forEach((b, i) => {
        const row = node('div', 'match' + (i === p.mention.active ? ' active' : ''));
        row.setAttribute('role', 'option');
        // mousedown instead of click: the input keeps the focus, the keyboard on the phone stays open
        row.addEventListener('mousedown', (ev) => { ev.preventDefault(); chooseMention(p, i); });
        list.appendChild(row);
        if (commands) {
            const who = node('div', 'who');
            const name = node('span', '', '/' + b.name);
            if (b.argumentHint) name.appendChild(node('span', 'hint', ' ' + b.argumentHint));
            who.appendChild(name);
            if (b.description) who.appendChild(node('span', 'role', b.description));
            row.appendChild(who);
            return;
        }
        const av = node('div', 'avatar');
        fillAvatar(av, b, b.id);
        const who = node('div', 'who');
        who.appendChild(node('span', '', `${b.name} · @${b.id}`));
        if (b.area || b.role) who.appendChild(node('span', 'role', b.area || b.role));
        row.append(av, who);
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
    const before = v.slice(0, p.mention.start) + (p.mention.kind === 'command' ? '/' + b.name : '@' + mentionWord(b, mentionCandidates(p.chatId))) + ' ';
    text.value = before + v.slice(text.selectionStart).replace(/^\S*\s?/, '');
    text.setSelectionRange(before.length, before.length);
    closeMention(p);
    text.focus();
    textHeight(p);
}

/** @param {Pane} p */
export function closeMention(p) {
    p.mention.kind = 'bot';
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

// ---------------------------------------------------------- / commands
// "/" at the start of a message in a bot's chat suggests the slash commands Claude Code offers in the bot's folder:
// the user's, the project's, plugins' and a few built-in ones. The machine reports them on request (commands.ts); kept
// here for a few minutes per bot. Groups and other engines get none: the commands belong to Claude Code and to the
// folder of one bot. The list shares the element, keys and choosing with the @ mentions.

const COMMANDS_FRESH_MS = 5 * 60_000;
const OTHER_ENGINES = ['codex', 'cursor', 'copilot', 'antigravity', 'opencode'];
/** @type {Map<string, { list: any[] | null, at: number }>} */
const commandLists = new Map();

/** The bot whose commands fit the chat, null in groups, chats with people and chats on another engine. */
function commandBot(chatId) {
    if (isGroup(chatId) || isPerson(chatId)) return null;
    const model = String(modelOf(chatId));
    if (OTHER_ENGINES.some((e) => model === e || model.startsWith(e + ':'))) return null;
    return bot(botIdOf(chatId)) || null;
}

/** The known list (null = none yet); asks the bot's machine when there is none or it has grown old. */
function commandsOf(b) {
    const known = commandLists.get(b.id);
    if (!known || Date.now() - known.at > COMMANDS_FRESH_MS) {
        const r = responsibleMachine(b);
        if (r) {
            send({ type: 'commands', botId: b.id }, r);
            commandLists.set(b.id, { list: known ? known.list : null, at: Date.now() });
        }
    }
    return known ? known.list : null;
}

/** @param {Pane} p @param {string} query typed after the "/" */
function checkCommand(p, query) {
    const b = commandBot(p.chatId);
    const list = b && commandsOf(b);
    const q = query.toLowerCase();
    const hits = (list || [])
        .filter((c) => c.name.toLowerCase().includes(q))
        .sort((x, y) => Number(!x.name.toLowerCase().startsWith(q)) - Number(!y.name.toLowerCase().startsWith(q)));
    if (hits.length === 0) return closeMention(p);
    if (p.mention.kind !== 'command') p.mention.active = 0;
    p.mention.kind = 'command';
    p.mention.start = 0;
    p.mention.hits = hits;
    p.mention.active = Math.min(p.mention.active, hits.length - 1);
    renderMention(p);
}

/** The machine's answer; an input still waiting for it gets the list right away. */
export function receiveCommands(f) {
    commandLists.set(f.botId, { list: f.commands || [], at: Date.now() });
    for (const p of panes) {
        if (p.chatId && botIdOf(p.chatId) === f.botId && document.activeElement === p.el.text) checkMention(p);
    }
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
    // A conversation without a message yet says what it is for; the style hides it as soon as anything else is in the list
    if (isConversation(id) && state.history[id] && !entries.length) p.el.messages.append(node('p', 'conversation-hint', t('conversation.emptyHint', { name: (bot(botIdOf(id)) || {}).name || '' })));
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
    renderOutbox(p.chatId);
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
        const ev = node('div', 'event' + (e.person || e.from ? ' handover' : ''), e.text);
        // A bot handed the chat over to a person: the way to the chat with them
        if (e.person) {
            const go = node('button', 'handover-link', t('people.continueWith', { name: person('p:' + e.person).name }));
            go.type = 'button';
            go.addEventListener('click', () => openChat('p:' + e.person, undefined, undefined, p));
            ev.appendChild(go);
        }
        messages.appendChild(ev);
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
        // The other person writes like the user does, from the other side; in a chat of two no name above it
        const human = !fromMe && e.from.startsWith('person:');
        const b = node('div', 'bubble ' + (fromMe ? 'me' : routine ? 'me routine' : human ? 'bot person' : 'bot job'));
        if (!fromMe && !human) {
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
        showLike(b, e, chatId);
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
            codeBlocks(content);
            b.appendChild(content);
        }
        if (e.attachments && e.attachments.length) b.appendChild(attachmentBar(e.attachments));
        const time = node('span', 'time');
        if (e.id) time.appendChild(moreButton());
        if (e.text && e.id) time.appendChild(speakButton(e, chatId));
        time.appendChild(document.createTextNode(clockTime(e.ts)));
        b.appendChild(time);
        if (e.id) b.dataset.eid = e.id;
        showLike(b, e, chatId);
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

async function runCommand(chatId, botId, command) {
    const b = bot(botId);
    if (!b || !chatId) return;
    const where = responsibleMachine(b);
    if (!where || !state.agentOnline) { void alertDialog(t('bot.sleepsNoMachine', { name: b.name }) + '.'); return; }
    if (!(await confirmDialog(t('command.confirm', { name: b.name, command, machine: upper(where) })))) return;
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
    // a hand-over is an event someone sent (a bot), unlike the app's own notes
    return e.role === 'assistant' || (e.role === 'user' && e.from && e.from !== 'me' && !e.from.startsWith('routine:')) || (e.role === 'event' && !!e.from);
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

function moreButton() {
    const k = node('button', 'more', '⋯');
    k.type = 'button';
    k.title = t('message.moreTitle');
    k.setAttribute('aria-label', t('message.moreLabel'));
    return k;
}

// ---------------------------------------------------------- Likes
// In a chat with a person, each side can like what the other wrote; both see the heart at the message. In a bot's
// chat the user can like an answer; the bot hears of it with the next message (not in groups: that may go to another).

/** Whether the message menu offers a like for this entry. */
function likeable(chatId, e, from) {
    return isPerson(chatId) ? from.startsWith('person:') : e.role === 'assistant' && !isGroup(chatId);
}

/** Puts the heart at a liked message's bubble, or takes it away. */
function showLike(bubble, e, chatId) {
    const old = bubble.querySelector('.like-mark');
    if (old) old.remove();
    const on = !isGroup(chatId) && !!e.like && e.like.on;
    bubble.classList.toggle('liked', on);
    if (!on) return;
    const s = node('span', 'like-mark');
    s.title = !isPerson(chatId) ? t('message.likedBot', { name: (bot(chatId) || {}).name || '' })
        : e.role === 'user' && (!e.from || e.from === 'me') ? t('message.likedBy', { name: person(chatId).name }) : t('message.likedByMe');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', s.title);
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.5c0 5.8-7.5 10.4-7.5 10.4z"/></svg>';
    bubble.appendChild(s);
}

/** The backend's "liked": this account or the other person liked a message, or took the like back. */
export function setLike(chatId, id, on) {
    const e = (state.history[chatId] || []).find((x) => x.id === id);
    if (!e) return;
    e.like = { ...e.like, on };
    const p = paneFor(chatId);
    const b = p && p.el.messages.querySelector(`.bubble[data-eid="${CSS.escape(id)}"]`);
    if (!b) return;
    showLike(b, e, chatId);
    scroll(p);
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

/** Who a quote is from, for a forward with the word "Forwarded" in front. */
function quoteHead(q) {
    return q.forwarded ? t('forward.from', { name: senderName(q.from) }) : senderName(q.from);
}

/** Set the quote above the input field of a pane (or remove it with null); it goes out with the next message. */
export function setReply(p, q) {
    p.replyTo = q;
    p.el.replyBar.hidden = !q;
    p.el.replyBar.classList.toggle('forwarded', Boolean(q && q.forwarded));
    p.el.replyBar.classList.remove('open');
    // Above the input too, a tap shows the whole forwarded text before it goes out
    /** @type {HTMLElement} */ (p.el.replyBar.querySelector('.quote')).onclick = q && q.forwarded ? () => p.el.replyBar.classList.toggle('open') : null;
    // a forward goes without words of its own: the send button shows instead of the microphone
    composerButtons(p);
    if (!q) return;
    p.el.rbWho.textContent = quoteHead(q);
    p.el.rbText.textContent = q.text;
    p.el.text.focus();
}

/** @param {Pane} p */
function quoteNode(p, q) {
    const k = node('div', 'quote' + (q.forwarded ? ' forwarded' : ''));
    k.append(node('strong', '', quoteHead(q)), node('span', '', q.text));
    if (q.forwarded && q.origin) {
        // The line naming the origin leads to that chat at the message, while the chat is still there
        const there = Boolean(q.originChat && allChats().includes(q.originChat));
        const origin = node(there ? 'button' : 'small', there ? 'quote-origin' : '', t('forward.origin', { chat: q.origin }));
        if (there) {
            /** @type {HTMLButtonElement} */ (origin).type = 'button';
            origin.title = t('forward.openOrigin');
            origin.addEventListener('click', (ev) => { ev.stopPropagation(); openChat(q.originChat, q.id); });
        }
        k.append(origin);
    }
    k.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // A forward opens to its full text and closes again; the text stays selectable while open
        if (q.forwarded) {
            if (window.getSelection().toString()) return;
            k.classList.toggle('open');
            k.setAttribute('aria-expanded', String(k.classList.contains('open')));
            return;
        }
        // jumps to the quoted message if it is in the loaded history
        p.jumpTo = q.id;
        jumpToEntry(p);
    });
    return k;
}

// ---------------------------------------------------------- Forwarding
// "Forward" in a message's menu: a page with the chats to pick from; the chosen one opens with the message above its
// input field, where the user adds words of their own (or none) and sends it.

/** As FORWARD_TEXT_MAX in shared/protocol.ts: the backend keeps no more of a forwarded text. */
const FORWARD_TEXT_MAX = 20000;

/** The message waiting for its target while the page is open. */
let forwarding = null;

/** A chat's name as the list shows it: a conversation with its bot in front. */
function chatName(id) {
    if (isGroup(id)) return (group(id) || {}).name || id;
    if (isPerson(id)) return (person(id) || {}).name || id;
    const b = bot(id);
    if (!b) return id;
    return isConversation(id) ? `${b.name} · ${conversationTitle(id)}` : b.name;
}

function openForward(chatId, e, from) {
    const text = (e.text || (e.attachments || []).map((a) => a.name).join(', ') || t('message.noText')).slice(0, FORWARD_TEXT_MAX);
    forwarding = { id: e.id, from, text, forwarded: true, origin: chatName(chatId), originChat: chatId };
    el.forwardSub.textContent = plain(text).slice(0, 120);
    el.forwardSearch.value = '';
    renderForwardList();
    el.forward.hidden = false;
    // on the phone the keyboard would cover half of the list; there the list comes first
    if (window.innerWidth > 760) el.forwardSearch.focus();
}

/** The chats to forward to, newest first, filtered by the search field; the chat the message is in is left out. */
export function renderForwardList() {
    if (!forwarding) return;
    const word = el.forwardSearch.value.trim().toLowerCase();
    const ids = allChats()
        .filter((id) => id !== forwarding.originChat && (!word || chatName(id).toLowerCase().includes(word)))
        .map((id, i) => ({ id, i, ts: state.lastTs[id] || '' }))
        .sort((x, y) => y.ts.localeCompare(x.ts) || x.i - y.i);
    el.forwardList.replaceChildren(...ids.map(({ id }) => {
        const k = node('button', 'forward-target');
        k.type = 'button';
        const av = node('div', 'avatar' + (isGroup(id) ? ' group' : isPerson(id) ? ' person' : ''));
        fillAvatar(av, group(id) || bot(id) || person(id), isConversation(id) ? botIdOf(id) : id);
        k.append(av, node('span', '', chatName(id)));
        k.addEventListener('click', (ev) => { ev.stopPropagation(); forwardTo(id); });
        return k;
    }));
    if (!ids.length) el.forwardList.append(node('p', 'hint', t('forward.none')));
}

/** Opens the chosen chat with the forwarded message above its input field. */
function forwardTo(id) {
    const q = forwarding;
    forwarding = null;
    el.forward.hidden = true;
    if (!q) return;
    openChat(id);
    const p = paneFor(id);
    if (!p) return;
    // Another person sees neither the names of the user's chats nor can open them
    setReply(p, isPerson(id) ? { id: q.id, from: q.from, text: q.text, forwarded: true } : q);
}

// ---------------------------------------------------------- Terms for chats with people
// Apple wants users of an app with content from other people to agree to terms that tolerate no objectionable content
// or abuse (guideline 1.2). The store apps ask once per device, before the first message to a person; the browser and
// the desktop apps, which reach their own relay, do not.

const TERMS_KEY = 'openfolk-terms-accepted';

/** Whether a message to this chat has to wait for the terms: one to a person, in a store app, before they were accepted. */
export const termsNeeded = (chatId) => isNative && isPerson(chatId) && !readSetting(TERMS_KEY);

/** Whether a message may go to this chat, asking for the terms first where they are needed. */
export async function termsAccepted(chatId) {
    if (!termsNeeded(chatId)) return true;
    const yes = await confirmDialog(t('terms.ask'), {
        ok: t('terms.accept'),
        link: { href: `https://openfolk.app/${i18n.language === 'de' ? 'de' : 'en'}/terms`, text: t('terms.link') },
    });
    if (yes) writeSetting(TERMS_KEY, new Date().toISOString());
    return yes;
}

// ---------------------------------------------------------- Reporting
// "Report" in the menu of a bot's answer or a person's message (the app stores' rules for AI content and content of
// other people): the backend quotes the stored message into the person chat with each admin of the relay, who gets a
// push and can answer there. Without an admin (a relay of one's own) it goes to the publisher of the app, the OpenFolk
// team, through the push service of openfolk.app; the mail to the support address is the second way in both cases.

/** The message being reported while the page is open. */
let reporting = null;

/** The admins a report reaches: the people this account can chat with, except itself and those it blocked. */
function reportAdmins() {
    const me = state.account ? state.account.id : 'main';
    return state.people.filter((x) => x.admin && x.id !== me && !isBlocked('p:' + x.id));
}

function openReport(chatId, e, from) {
    const text = e.text || (e.attachments || []).map((a) => a.name).join(', ') || t('message.noText');
    reporting = { chatId, id: e.id, from, text };
    el.reportQuote.textContent = plain(text).slice(0, 600);
    el.reportReason.value = 'offensive';
    el.reportNote.value = '';
    el.reportError.hidden = true;
    el.reportSend.disabled = false;
    const admins = reportAdmins();
    el.reportTo.textContent = admins.length
        ? t('report.toAdmins', { names: admins.map((x) => x.name).join(', '), mail: SUPPORT_MAIL })
        : t('report.toSupport', { mail: SUPPORT_MAIL });
    el.report.hidden = false;
}

/** The mail to the support address with what the page holds; made on the tap, so it has the reason and note chosen. */
function reportMailHref() {
    const r = reporting;
    if (!r) return `mailto:${SUPPORT_MAIL}`;
    const model = !isGroup(r.chatId) && !isPerson(r.chatId) ? modelOf(r.chatId) : '';
    const body = [
        t('report.mailReason', { reason: t(`report.reason.${el.reportReason.value}`) }),
        t('report.mailFrom', { name: senderName(r.from), chat: chatName(r.chatId) }),
        ...(model ? [t('report.mailModel', { model })] : []),
        '', el.reportNote.value.trim(), '', '> ' + plain(r.text).slice(0, 1500).replace(/\n/g, '\n> '),
    ].join('\n');
    return `mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent(t('report.mailSubject'))}&body=${encodeURIComponent(body)}`;
}

export function setupReport() {
    el.reportMail.addEventListener('click', () => { el.reportMail.href = reportMailHref(); });
    el.reportForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!reporting) return;
        el.reportError.hidden = true;
        el.reportSend.disabled = true;
        const note = el.reportNote.value.trim();
        send({ type: 'report', chatId: reporting.chatId, entryId: reporting.id, reason: /** @type {any} */ (el.reportReason.value), ...(note ? { note } : {}) });
    });
}

/** The backend's answer: the report is in the chats with these admins. */
export function reportSent(f) {
    if (!reporting || reporting.id !== f.entryId) return;
    reporting = null;
    el.report.hidden = true;
    const names = (f.admins || []).map((id) => (person('p:' + id) || {}).name || id).join(', ');
    toast(names ? t('report.sent', { names }) : t('report.sentPublisher'));
}

export function reportFailed(message) {
    if (el.report.hidden) return false;
    el.reportSend.disabled = false;
    el.reportError.textContent = message;
    el.reportError.hidden = false;
    return true;
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
    // What the other person wrote or a bot answered; the heart appears once the backend has stored it. A bot's like
    // goes to its machine, which tells the bot with the next message there
    if (likeable(chatId, e, from)) {
        const liked = !!e.like && e.like.on;
        const b = isPerson(chatId) ? null : bot(chatId);
        item(liked ? 'unlike' : 'like', t(liked ? 'message.unlike' : 'message.like'), () => send({ type: 'like', chatId, entryId: e.id, on: !liked }, (b && responsibleMachine(b)) || undefined));
    }
    item(pinned ? 'unpin' : 'pin', pinned ? t('message.unpin') : t('message.pin'), () => sendPin(chatId, {
        id: e.id, text: e.text || (e.attachments || []).map((a) => a.name).join(', '), ts: e.ts, from,
    }, !pinned));
    if (e.text) item(isReading(e.id) ? 'stop' : 'speaker', isReading(e.id) ? t('message.stopReading') : t('message.readAloud'), () => readAloud(e, chatId));
    if (e.text) item('copy', t('message.copy'), () => { if (navigator.clipboard) navigator.clipboard.writeText(e.text).catch(() => undefined); });
    // The links of the message: the system's long press on a link is off (chat.css), copying them goes from here
    const links = [...new Set([...bubble.querySelectorAll('.content a[href]')].map((x) => /** @type {HTMLAnchorElement} */ (x).href).filter((h) => /^https?:/.test(h)))];
    if (links.length) item('link', t(links.length > 1 ? 'message.copyLinks' : 'message.copyLink'), () => { if (navigator.clipboard) navigator.clipboard.writeText(links.join('\n')).then(() => toast(t('message.linkCopied')), () => undefined); });
    item('forward', t('message.forward'), () => openForward(chatId, e, from));
    // What others wrote: a bot's answer, a person's message; not the user's own
    if (e.role === 'assistant' || from.startsWith('person:')) item('flag', t('message.report'), () => openReport(chatId, e, from));
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
