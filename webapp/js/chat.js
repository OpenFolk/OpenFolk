/* OpenFolk web app: open a chat in a pane, header, status line. */
import { t } from './i18n.js';
import { $, el, node, state, closest } from './core.js';
import { activePane, capacity, closeSettings, createPane, isWide, layoutPanes, paneFor, panes, removePane, savePanes, setActivePane } from './panes.js';
import { bot, conversationTitle, fillAvatar, group, isConversation, isGroup, modelOf, responsibleMachine, send, senderName, shortFolder, upper } from './e2e.js';
import { backgroundOf, backgroundText, chatStatus, closeChatSearch, renderChatList } from './list.js';
import { renderMembers } from './machines.js';
import { closeMention, markSeen, renderHistory, renderPinned, setReply } from './chat-features.js';
import { rec, renderUploads, stopRecording } from './voice.js';
import { closeGitPage, gitPageFromChat, modelDisplay, renderInfoChat, tokensShort } from './menus.js';

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
    // Settings that take the only column give way to the chat
    if (!el.settings.hidden && capacity() < 2) closeSettings();
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
    p.chatId = id;
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
    if (window.innerWidth > 760) p.el.text.focus();
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

/** After the active pane changed: the list marks its chat, the address names it. */
export function paneActivated() {
    layoutPanes();
    renderChatList();
    const id = activePane().chatId;
    try { history.replaceState(null, '', id ? '?chat=' + encodeURIComponent(id) : location.pathname); } catch { /* ignore */ }
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
    if (panes.length > 1) removePane(p);
    else p.chatId = null;
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
export function renderChatHeader(p) {
    const id = p.chatId;
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
    // the model stays in sight while the line below shows what the bot is doing
    p.el.chatModel.hidden = !b;
    if (b) p.el.chatModel.textContent = modelDisplay(modelOf(id));
    // where the bot lives, or would live once its machine wakes
    const home = b ? b.machine || where : '';
    p.el.chatMachine.hidden = !home;
    p.el.chatMachine.textContent = upper(home || '');
    p.el.btnStop.hidden = st !== 'thinking' && st !== 'waiting';
    p.el.text.placeholder = g ? t('composer.placeholderGroup') : t('composer.placeholder');
    renderSleepHint(p);
    updateSendAllowed();
    renderWorking();
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
    for (const p of panes) p.el.btnSend.disabled = !state.agentOnline || !!machineToWake(p.chatId);
}
