/* OpenFolk web app: open a chat in a pane, header, status line. */
import { missionsBack } from './missions.js';
import { t, tn } from './i18n.js';
import { $, el, node, state, closest } from './core.js';
import { activePane, capacity, closeSettings, createPane, isWide, layoutPanes, paneFor, panes, removePane, savePanes, setActivePane } from './panes.js';
import { bot, conversationTitle, fillAvatar, group, isConversation, isGroup, isPerson, modelOf, modelsOfChat, person, responsibleMachine, send, senderName, shortFolder, upper } from './e2e.js';
import { backgroundOf, backgroundText, chatStatus, closeChatSearch, latest, renderChatList, revealInList } from './list.js';
import { renderMembers } from './machines.js';
import { closeMention, isUnread, markSeen, renderHistory, renderPinned, setReply } from './chat-features.js';
import { rec, renderUploads, stopRecording } from './voice.js';
import { closeGitPage, gitOpenOf, gitPageFromChat, modelDisplay, renderInfoChat, tokensShort } from './menus.js';
import { allChats, conversationsOf, isBlocked } from './connection.js';
import { loadDraft, saveDraft } from './queue.js';
import { confirmDialog } from './dialogs.js';

/** @typedef {import('./panes.js').Pane} Pane */

// ================================================================ Chat

/**
 * Opens a chat. If a pane shows it already, that pane comes to the front; otherwise it opens in `target` (default:
 * the active pane), replacing what was there.
 * jumpTo: from the search; after loading jump to this message (fetching more history for it).
 * searchWord: from the search across all chats; marked in the chat until another chat or the chat search opens.
 * @param {string} id
 * @param {string} [jumpTo]
 * @param {string} [searchWord]
 * @param {Pane} [target]
 */
export function openChat(id, jumpTo, searchWord, target) {
    // The settings give way to the chat: on wide screens no chat stands next to them
    if (!el.settings.hidden) closeSettings();
    const open = paneFor(id);
    if (open && !jumpTo) {
        setActivePane(open);
        el.gitPage.hidden = true;
        paneActivated();
        return;
    }
    const p = open || target || activePane();
    setActivePane(p);
    // A voice message belongs to the chat it was started in
    if (rec.pane === p && p.chatId !== id) stopRecording(false);
    p.jumpTo = jumpTo || null;
    // What was typed stays with the chat it was typed in; this chat brings its own draft, or an empty field
    const switching = p.chatId !== id;
    if (switching) saveDraft(p);
    p.chatId = id;
    if (switching) loadDraft(p);
    el.gitPage.hidden = true;
    p.uploads = [];
    renderUploads(p);
    renderChatHeader(p);
    renderMembers(p);
    closeMention(p);
    p.queueOpen = false;
    p.el.queue.hidden = true;
    p.fxIndex = 0;
    el.messageMenu.hidden = true;
    renderPinned(p);
    setReply(p, null);
    closeChatSearch(p);
    p.globalSearch = searchWord && jumpTo ? { word: searchWord, target: jumpTo } : null;
    p.el.messages.innerHTML = '';
    p.rendered = { id: null, snapshot: '' };
    if (state.live[id]) for (const l of Object.values(state.live[id])) { l.wrap = null; l.bubble = null; l.rows = new Map(); }
    if (state.history[id]) renderHistory(p, []);
    markSeen(id);
    loadingBar(p, true);
    send(jumpTo ? { type: 'history', chatId: id, limit: 5000 } : { type: 'history', chatId: id });
    layoutPanes();
    savePanes();
    paneActivated();
}

/** Opens a chat in a new pane next to the others; without room (or on narrow screens) like a normal click. */
export function openBeside(id) {
    if (paneFor(id) || !isWide() || panes.length >= capacity()) return openChat(id);
    openChat(id, undefined, undefined, createPane());
}

/**
 * A chat dragged onto a pane (`target`) or onto the + strip (null). If it is open in another pane already, the two
 * panes swap their chats, so nothing gets closed; onto an empty pane it moves.
 */
export function dropChat(id, target) {
    const from = paneFor(id);
    if (!target) {
        if (from) return openChat(id);
        return openBeside(id);
    }
    if (from === target) return openChat(id);
    if (!from) return openChat(id, undefined, undefined, target);
    const other = target.chatId;
    // free both panes first: openChat would otherwise only focus the pane that shows the chat
    saveDraft(from);
    saveDraft(target);
    from.chatId = null;
    target.chatId = null;
    openChat(id, undefined, undefined, target);
    if (other) openChat(other, undefined, undefined, from);
    else closeChat(from);
    setActivePane(target);
    paneActivated();
}

/** A new empty pane at the end, active; the next chat chosen in the list opens there. */
export function addEmptyPane() {
    if (!isWide() || panes.length >= capacity()) return;
    setActivePane(createPane());
    savePanes();
    paneActivated();
}

// The chats opened one after the other, for back and forward (Ctrl+[ and Ctrl+]), like a browser's history
const visited = { list: /** @type {string[]} */ ([]), at: -1, stepping: false };

function noteVisited(id) {
    if (!id || visited.stepping || visited.list[visited.at] === id) return;
    visited.list.splice(visited.at + 1, Infinity, id);
    if (visited.list.length > 100) visited.list.shift();
    visited.at = visited.list.length - 1;
}

/** Back (-1) or forward (+1) through the chats opened before, skipping deleted ones; false at either end. */
export function stepVisited(step) {
    let i = visited.at + step;
    while (i >= 0 && i < visited.list.length && !allChats().includes(visited.list[i])) i += step;
    if (i < 0 || i >= visited.list.length) return false;
    visited.at = i;
    visited.stepping = true;
    try { openChat(visited.list[i]); } finally { visited.stepping = false; }
    return true;
}

/** After the active pane changed: the list marks its chat, the address names it. */
export function paneActivated() {
    layoutPanes();
    renderChatList();
    const id = activePane().chatId;
    revealInList(id);
    noteVisited(id);
    try { history.replaceState(null, '', id ? '?chat=' + encodeURIComponent(id) : location.pathname); } catch { /* ignore */ }
}

/**
 * Stops the background tasks of a chat (shells, subagents a bot left running) after asking: each machine gets the ids
 * it reported. Its next background frame takes them off the line.
 */
export async function stopBackground(chatId) {
    const tasks = backgroundOf(chatId);
    if (!tasks.length) return;
    const what = tasks.length > 1 ? t('chat.stopTasksMany', { n: tasks.length }) : t('chat.stopTasksOne', { what: tasks[0].description || t('background.taskRunning') });
    if (!(await confirmDialog(what))) return;
    for (const [machine, perSession] of Object.entries(state.backgroundPerMachine)) {
        const ids = (perSession[chatId] || []).map((x) => x.id).filter(Boolean);
        if (ids.length) send({ type: 'task_stop', chatId, taskIds: ids }, machine === '?' ? undefined : machine);
    }
}

/** Every pane with a chat: header, sleep hint, send button, status line. */
export function renderHeaders() {
    for (const p of panes) if (p.chatId) renderChatHeader(p);
    renderInfoChat();
}

// Status line as in the Claude Code terminal: while a chat is working, a pulsing star,
// a random word (changes every few seconds) and the time since the start.
// Only characters without an emoji variant: ✳ (U+2733) is shown as a colorful emoji on iOS
const STAR_PHASES = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢'];
const work = { timer: null, since: {}, word: '', wordSince: 0, phase: 0 };
/** Panes whose chat is running right now; one timer ticks them all and stops when there is none. */
const runningPanes = new Set();

function renderWorking() {
    // remember the start time per chat while it works (also when it is not open)
    for (const c of Object.keys(work.since)) if (chatStatus(c).state !== 'thinking') delete work.since[c];
    runningPanes.clear();
    for (const p of panes) if (renderWorkingIn(p)) runningPanes.add(p);
    if (!runningPanes.size) {
        clearInterval(work.timer);
        work.timer = null;
        return;
    }
    if (!work.timer) work.timer = setInterval(workingTick, 120);
    workingTick();
}

/** @param {Pane} p @returns {boolean} whether the line animates */
function renderWorkingIn(p) {
    const id = p.chatId;
    const st = id ? chatStatus(id).state : 'idle';
    // "waiting" (approval or question open) counts as running in the list, but here the bot waits for you:
    // then without animation, but with stop
    const waiting = st === 'waiting' || (st === 'thinking' && state.states[id] === 'waiting');
    const running = st === 'thinking' && !waiting;
    // Nothing runs in the foreground, but a background agent: calm line without animation and without stop
    const behind = !running && !waiting ? backgroundOf(id) : [];
    p.el.working.hidden = !running && !waiting && !behind.length;
    p.el.working.classList.toggle('waiting', waiting);
    p.el.working.classList.toggle('background', behind.length > 0);
    p.el.btnStopTasks.hidden = !behind.length;
    if (!running) {
        p.el.workingStar.textContent = '';
        p.el.workingText.textContent = waiting ? t('status.waitingForYouLine') : behind.length ? backgroundText(behind) : '';
        return false;
    }
    if (!work.since[id]) work.since[id] = Date.now();
    return true;
}

function workingTick() {
    const now = Date.now();
    if (!work.word || now - work.wordSince > 3500) {
        const words = t('working.words').split('|');
        let w;
        do w = words[Math.floor(Math.random() * words.length)]; while (w === work.word && words.length > 1);
        work.word = w;
        work.wordSince = now;
    }
    work.phase = (work.phase + 1) % STAR_PHASES.length;
    for (const p of runningPanes) {
        p.el.workingStar.textContent = STAR_PHASES[work.phase];
        const s = Math.round((now - (work.since[p.chatId] || now)) / 1000);
        p.el.workingText.innerHTML = '';
        p.el.workingText.append(`${work.word} … `, node('span', 'duration', `(${s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'})`));
    }
}

/** Running bar at the top of the chat until the history arrives from the machine (gone after 15 s at the latest). */
export function loadingBar(p, on) {
    clearTimeout(p.loadingTimer);
    p.el.loadingBar.hidden = !on;
    if (on) p.loadingTimer = setTimeout(() => { p.el.loadingBar.hidden = true; }, 15000);
}

/** Closes the chat of a pane: with several panes the pane goes, the last one shows the empty page (phone: the list). */
export function closeChat(p = activePane()) {
    markSeen(p.chatId);
    if (rec.pane === p) stopRecording(false);
    loadingBar(p, false);
    saveDraft(p);
    if (panes.length > 1) removePane(p);
    else {
        p.chatId = null;
        loadDraft(p);
    }
    savePanes();
    renderWorking();
    paneActivated();
}

/**
 * Phone: swiping to the right closes the chat like the back button. The chat follows the finger;
 * from a third of the width (or with momentum) it closes, otherwise it springs back.
 * Not in fields and horizontally scrollable blocks (code, tables), there the gesture belongs to the content.
 */
export function setupSwipeBack() {
    const chat = $('chat');
    swipeBack(chat, {
        allowed: (ev) => (!!activePane().chatId || !el.gitPage.hidden) && !closest(ev, 'textarea, input, select, pre, table, .mention, .members, .attachments, .queue-list'),
        // the list lies underneath, unless the git page goes back to its chat
        moving: (on) => el.app.classList.toggle('swiping', on && !gitPageFromChat()),
        close: () => {
            if (missionsBack()) return;
            if (!el.gitPage.hidden) closeGitPage();
            else closeChat();
        },
    });
}

/**
 * Phone gesture "swipe to the right = back" on `area`; `moved` (default: the area) follows the finger.
 * `close` runs once it slid out, `moving` brackets the gesture (e.g. to show what lies underneath).
 * @param {HTMLElement} area
 * @param {{ allowed: (ev: TouchEvent) => boolean, close: () => void, moving?: (on: boolean) => void, moved?: () => HTMLElement }} o
 */
export function swipeBack(area, o) {
    let g = null;
    const moved = () => (o.moved ? o.moved() : area);
    const reset = (m) => {
        m.style.transition = '';
        m.style.transform = '';
        o.moving?.(false);
    };
    area.addEventListener('touchstart', (ev) => {
        g = null;
        if (window.innerWidth > 760 || ev.touches.length !== 1 || !o.allowed(ev)) return;
        const touch = ev.touches[0];
        g = { x: touch.clientX, y: touch.clientY, dx: 0, trail: [], horizontal: null, m: moved() };
    }, { passive: true });
    area.addEventListener('touchmove', (ev) => {
        if (!g) return;
        const touch = ev.touches[0];
        const dx = touch.clientX - g.x;
        const dy = touch.clientY - g.y;
        if (g.horizontal === null) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            g.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5;
            if (!g.horizontal) { g = null; return; }
            g.m.style.transition = 'none';
            o.moving?.(true);
        }
        g.dx = Math.max(0, dx);
        g.trail.push({ dx: g.dx, t: Date.now() });
        if (g.trail.length > 8) g.trail.shift();
        g.m.style.transform = `translateX(${g.dx}px)`;
    }, { passive: true });
    const end = () => {
        if (!g || !g.horizontal) { g = null; return; }
        // momentum: speed of the last 100 ms, not since the start of the touch
        const now = Date.now();
        const old = g.trail.find((p) => now - p.t <= 100) || g.trail[g.trail.length - 1];
        const fling = g.dx > 40 && old && (g.dx - old.dx) / Math.max(16, now - old.t) > 0.4;
        const close = fling || g.dx > window.innerWidth / 3;
        const m = g.m;
        g = null;
        m.style.transition = 'transform .18s ease-out';
        m.style.transform = close ? 'translateX(100%)' : 'translateX(0)';
        setTimeout(() => {
            if (close) o.close();
            reset(m);
        }, 180);
    };
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', end);
}

/** @param {Pane} p */
/**
 * The tabs above a bot's chat: its main chat, then its conversations ordered like the chat list, and "+" for a new
 * one. Only for a bot with conversations; a dot for something running or unread in a tab that is not open.
 * @param {import('./panes.js').Pane} p
 */
export function renderConversationTabs(p) {
    const id = p.chatId;
    const b = id && !isGroup(id) && !isPerson(id) ? bot(id) : null;
    const subs = b ? conversationsOf(b) : [];
    p.el.convTabs.hidden = !subs.length;
    if (!subs.length) {
        p.el.convTabs.replaceChildren();
        return;
    }
    // The conversations move like the list: working or waiting first, then finished with something unread, then the
    // rest, each newest message first; the main chat stays the first tab
    const rank = (cid) => {
        const st = chatStatus(cid).state;
        return st === 'thinking' || st === 'waiting' || backgroundOf(cid).length ? 0 : isUnread(cid) ? 1 : 2;
    };
    const order = subs.map((cid, i) => ({ cid, i, r: rank(cid), ts: latest(cid) }))
        .sort((x, y) => x.r - y.r || y.ts.localeCompare(x.ts) || x.i - y.i).map((x) => x.cid);
    const tabs = [b.id, ...order].map((cid) => {
        const k = node('button', 'conv-tab' + (cid === id ? ' on' : ''), cid === b.id ? t('chat.tabMain') : conversationTitle(cid));
        k.type = 'button';
        k.dataset.chat = cid;
        k.setAttribute('role', 'tab');
        k.setAttribute('aria-selected', String(cid === id));
        const st = chatStatus(cid).state;
        if (cid !== id && (st === 'thinking' || st === 'waiting' || backgroundOf(cid).length)) k.appendChild(node('i', 'dot ' + (st === 'waiting' ? 'waiting' : 'thinking')));
        else if (cid !== id && isUnread(cid)) k.appendChild(node('i', 'dot new'));
        return k;
    });
    const add = node('button', 'conv-tab conv-new', '+');
    add.type = 'button';
    add.title = t('conversation.new');
    add.setAttribute('aria-label', add.title);
    add.disabled = !responsibleMachine(b);
    add.dataset.new = b.id;
    p.el.convTabs.setAttribute('role', 'tablist');
    p.el.convTabs.replaceChildren(...tabs, add);
    const on = /** @type {HTMLElement | null} */ (p.el.convTabs.querySelector('.on'));
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function renderChatHeader(p) {
    const id = p.chatId;
    renderConversationTabs(p);
    if (isPerson(id)) {
        renderPersonHeader(p);
        return;
    }
    const g = isGroup(id) ? group(id) : null;
    const b = g ? null : bot(id);
    if (!g && !b) return;
    fillAvatar(p.el.chatAvatar, g || b, id, true);
    // Conversation: title as name, the bot is in the line below
    p.el.chatName.textContent = isConversation(id) ? conversationTitle(id) : (g || b).name;
    // like the overview: the bot's area right after its name
    if (b && !isConversation(id) && (b.area || b.role)) p.el.chatName.appendChild(node('small', '', ' · ' + (b.area || b.role)));
    const { state: st, activity } = chatStatus(id);
    const where = b ? responsibleMachine(b) : null;
    const behind = backgroundOf(id);
    p.el.chatSub.textContent = st === 'waiting' ? t('status.waitingForYou')
        : st === 'thinking' ? activity
            : behind.length ? backgroundText(behind)
            : g ? g.members.map((m) => senderName(m)).join(', ')
                : `${isConversation(id) ? b.name : shortFolder(b.folder)}`
                    + (state.context[id] ? ` · ${t('chat.context', { tokens: tokensShort(state.context[id]) })}` : '');
    p.el.chatSettings.hidden = false;
    p.el.chatSettings.title = p.el.chatSettings.ariaLabel = t(g ? 'header.groupSettings' : 'header.botSettings');
    // the model stays in sight while the line below shows what the bot is doing
    p.el.chatModel.hidden = !b;
    if (b) p.el.chatModel.textContent = modelDisplay(modelOf(id), modelsOfChat(id));
    // where the bot lives, or would live once its machine wakes
    const home = b ? b.machine || where : '';
    p.el.chatMachine.hidden = !home;
    p.el.chatMachine.textContent = upper(home || '');
    // open changes of the bot's repos, as the list shows them
    const git = b ? gitOpenOf(b) : [];
    p.el.chatGit.hidden = !git.length;
    if (git.length) {
        p.el.chatGit.title = tn('git.reposWithChanges', git.length);
        p.el.chatGit.setAttribute('aria-label', p.el.chatGit.title);
        /** @type {HTMLElement} */ (p.el.chatGit.querySelector('span')).textContent = String(git.length);
    }
    p.el.btnStop.hidden = st !== 'thinking' && st !== 'waiting';
    p.el.text.placeholder = g ? t('composer.placeholderGroup') : t('composer.placeholder');
    renderSleepHint(p);
    updateSendAllowed();
    renderWorking();
}

/** A person chat: the name and that it is a person, nothing about models, machines or work. @param {Pane} p */
function renderPersonHeader(p) {
    const who = person(p.chatId);
    fillAvatar(p.el.chatAvatar, who, p.chatId);
    p.el.chatName.textContent = who.name;
    p.el.chatSub.textContent = who.gone ? t('people.unreachableShort') : isBlocked(p.chatId) ? t('people.blocked') : t('people.badge');
    p.el.chatModel.hidden = true;
    p.el.chatMachine.hidden = true;
    p.el.chatGit.hidden = true;
    // a person has no settings page: their menu sits behind the name
    p.el.chatSettings.hidden = true;
    p.el.btnStop.hidden = true;
    p.el.btnStopTasks.hidden = true;
    p.el.text.placeholder = t(isBlocked(p.chatId) ? 'people.blockedPlaceholder' : 'people.placeholder', { name: who.name });
    renderSleepHint(p);
    updateSendAllowed();
}

/**
 * A backend's connection to the relay drops now and then and is back after a few seconds.
 * Meanwhile a machine that just disappeared still counts as awake for the sleep hint.
 */
export const BRIEFLY_GONE_MS = 20000;

function almostOnline() {
    const brief = Object.entries(state.goneSince).filter(([, ts]) => Date.now() - ts < BRIEFLY_GONE_MS).map(([r]) => r);
    return [...new Set([...state.online, ...brief])];
}

/** Which machine would have to be woken so the chat can answer (null = none needed). */
export function machineToWake(id) {
    if (!id) return null;
    const online = almostOnline();
    if (isGroup(id)) return online.length ? null : (preferredMachine() || '?');
    const b = bot(id);
    if (!b || responsibleMachine(b, online)) return null;
    return b.machine || preferredMachine() || '?';
}

/** Any known machine to wake (from the wake status), preferably the first. */
function preferredMachine() {
    const hosts = state.machineStatus ? Object.keys(state.machineStatus.hosts || {}) : [];
    return hosts.sort()[0] || null;
}

/** @param {Pane} p */
function renderSleepHint(p) {
    // Before the first machine list after (re)connecting "online" is empty without any machine being off
    const host = state.onlineKnown ? machineToWake(p.chatId) : null;
    p.el.sleep.hidden = !host;
    if (!host) return;
    const b = bot(p.chatId);
    const who = b ? b.name : t('sleep.theGroup');
    const waking = state.waking[host];
    const configured = state.machineStatus && state.machineStatus.configured;
    p.el.sleepText.textContent = waking
        ? t('sleep.waking', { machine: upper(host), who })
        : host === '?' ? t('sleep.noMachine', { who }) : t('sleep.machineOff', { who, machine: upper(host) });
    p.el.sleepWake.hidden = !!waking || host === '?' || !configured;
    p.el.sleepWake.textContent = t('sleep.wake', { machine: upper(host) });
    p.el.sleepWake.dataset.host = host;
}

/** Send buttons of all panes: only with a connection and an awake machine for the chat. */
export function updateSendAllowed() {
    for (const p of panes) p.el.btnSend.disabled = !state.agentOnline || !!machineToWake(p.chatId) || (isPerson(p.chatId) && (!!person(p.chatId).gone || isBlocked(p.chatId)));
}
