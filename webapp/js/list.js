/* OpenFolk web app: sidebar: chat list, swiping in the overview, search across all chats. */
import { locale, t, tn } from './i18n.js';
import { el, node, state, closest } from './core.js';
import { CHAT_DRAG, activePane, paneFor, visibleChats } from './panes.js';
import { bot, clockTime, conversationTitle, fillAvatar, group, isConversation, isGroup, modelOf, openApprovals, responsibleMachine, send, senderName, shortFolder, upper } from './e2e.js';
import { allChats, baseChats, collapsed, conversationsOf, isFavorite, isMuted, toggleConversations, toggleFavorite } from './connection.js';
import { loadingBar, openBeside, openChat, swipeBack } from './chat.js';
import { isUnread, toggleUnread } from './chat-features.js';

/** @typedef {import('./panes.js').Pane} Pane */
import { ICONS, archiveConversation, chatMenuAction, fillChatMenu, gitOpenOf, modelDisplay, openGitPage } from './menus.js';
import { setBadge } from './platform.js';
import { openEditor } from './editors.js';
import { renderWelcome } from './welcome.js';
import { openSettingsAt } from './settings.js';
import { openOtherChat, otherRows, otherUnreadCount } from './others.js';

// ================================================================ Sidebar

/** Running background tasks of a chat (bot chat or conversation; across all machines). */
export function backgroundOf(chatId) {
    if (!chatId || isGroup(chatId)) return [];
    return Object.values(state.backgroundPerMachine).flatMap((perSession) => perSession[chatId] || []);
}

/** Waiting messages of a chat, across all machines and sessions (in groups at the members). */
function queuedIn(chatId) {
    let n = 0;
    for (const j of Object.values(state.perMachine)) for (const perChat of Object.values(j.queues || {})) n += perChat[chatId] || 0;
    return n;
}

/** Hourglass with count in the overview, as long as messages are in the queue. */
function queueBadge(meta, chatId) {
    const n = queuedIn(chatId);
    if (!n) return;
    const m = node('span', 'queue-badge');
    m.title = tn('queue.waiting', n);
    m.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/></svg>';
    m.append(String(n));
    meta.appendChild(m);
}

export function backgroundText(tasks) {
    const n = tasks.length;
    const what = tasks[0].description || t('background.taskRunning');
    return n > 1 ? t('background.many', { n, what }) : t('background.one', { what });
}

export function chatStatus(chatId) {
    // waiting: open question in exactly this chat; thinking: a bot has a running job here
    if (openApprovals(chatId).length) return { state: 'waiting', activity: '' };
    const ids = isGroup(chatId) ? ((group(chatId) || {}).members || []) : [chatId];
    for (const id of ids) {
        const s = state.states[id];
        if ((s === 'thinking' || s === 'waiting') && state.activeChats[id] === chatId) {
            return { state: 'thinking', activity: (isGroup(chatId) ? senderName(id) + ': ' : '') + (state.activity[id] || t('status.thinking')) };
        }
    }
    if (!isGroup(chatId) && state.states[chatId] === 'error') return { state: 'error', activity: '' };
    return { state: 'idle', activity: '' };
}

/** Time of the newest message (ISO, '' = none); for a bot its conversations count too. */
function latest(chatId) {
    const b = isGroup(chatId) || isConversation(chatId) ? null : bot(chatId);
    return [chatId, ...(b ? conversationsOf(b) : [])].reduce((ts, c) => ((state.lastTs[c] || '') > ts ? state.lastTs[c] : ts), '');
}

/** Chats by newest message, those without a message at the end in their previous order. */
function byTime(ids) {
    return ids.map((id, i) => ({ id, i, ts: latest(id) })).sort((x, y) => y.ts.localeCompare(x.ts) || x.i - y.i).map((x) => x.id);
}

/** Time of the last message at the top right: today the time, yesterday "Yesterday", within the week the day, else the date. */
function timeBadge(meta, ts) {
    if (!ts) return;
    const d = new Date(ts);
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 864e5);
    const text = days <= 0 ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
        : days === 1 ? t('time.yesterday')
            : days < 7 ? d.toLocaleDateString(locale(), { weekday: 'short' })
                : d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
    const z = node('span', 'time', text);
    z.title = d.toLocaleString(locale());
    meta.appendChild(z);
}

// Status messages often re-render the list. If that happens between touching down and lifting the finger,
// the tapped row is replaced and the click is lost; so postpone it meanwhile.
export const listTap = { active: false, pending: false, timer: null };

export function renderChatList() {
    if (listTap.active) {
        listTap.pending = true;
        return;
    }
    el.chatList.innerHTML = '';
    const ids = baseChats();
    // Bots and groups of the other accounts this device is signed in to (others.js), sorted in with the own ones
    const foreign = otherRows();
    if (ids.length === 0) {
        // Nothing to list yet: the first steps instead (machine, first bot, other devices)
        el.chatList.appendChild(renderWelcome({ newBot: () => openEditor(null), devices: () => openSettingsAt(el.settingsDevices) }));
        for (const r of foreign.sort((x, y) => x.section - y.section || y.ts.localeCompare(x.ts))) el.chatList.appendChild(foreignRow(r));
        setBadge(otherUnreadCount());
        return;
    }
    // Order: running or waiting chats, then favorites, then the rest (each newest message first);
    // a bot counts as running if one of its conversations runs, and takes them all along
    const section = (id) => {
        const b = isGroup(id) ? null : bot(id);
        const running = [id, ...(b ? conversationsOf(b) : [])].some((c) => {
            const st = chatStatus(c).state;
            return st === 'thinking' || st === 'waiting' || backgroundOf(c).length > 0;
        });
        if (running) return 0;
        return isFavorite(id) ? 1 : 2;
    };
    const sorted = [
        ...ids.map((id, i) => ({ id, i, s: section(id), ts: latest(id), foreign: null })),
        ...foreign.map((r, i) => ({ id: r.id, i: ids.length + i, s: r.section, ts: r.ts, foreign: r })),
    ].sort((x, y) => x.s - y.s || y.ts.localeCompare(x.ts) || x.i - y.i);
    const titles = [t('list.running'), t('list.favorites'), t('list.all')];
    const several = new Set(sorted.map((x) => x.s)).size > 1;
    let lastSection = -1;
    for (const { id, s, foreign: other } of sorted) {
        if (several && s !== lastSection) {
            el.chatList.appendChild(node('li', 'section', titles[s]));
            lastSection = s;
        }
        if (other) {
            el.chatList.appendChild(foreignRow(other));
            continue;
        }
        const g = isGroup(id) ? group(id) : null;
        const b = g ? null : bot(id);
        const li = node('li');
        li.dataset.chat = id;
        markOpen(li, id);
        const av = node('div', 'avatar' + (g ? ' group' : ''));
        fillAvatar(av, g || b, id);
        const info = node('div', 'info');
        const name = node('div', 'name', (g || b).name);
        if (b && (b.area || b.role)) name.appendChild(node('small', '', ' · ' + (b.area || b.role)));
        const { state: st, activity } = chatStatus(id);
        const open = openApprovals(id).length;
        const where = b ? responsibleMachine(b) : null;
        const sleeping = b && !where && st === 'idle';
        const behind = st === 'idle' ? backgroundOf(id) : [];
        const last = node('div', 'last',
            st === 'waiting' ? '⏳ ' + t('status.waitingForYou') : st === 'thinking' ? activity
                : behind.length ? backgroundText(behind)
                : sleeping ? '💤 ' + (b.machine ? t('list.sleepingMachineOff', { machine: upper(b.machine) }) : t('list.sleepingNoMachine'))
                    : (state.last[id] || (g ? tn('list.bots', g.members.length) : shortFolder(b.folder))));
        if (sleeping) last.classList.add('sleeping');
        if (st === 'thinking' || behind.length) last.classList.add('working');
        if (st === 'waiting') last.classList.add('waiting');
        info.append(name, last);
        const meta = node('div', 'meta');
        timeBadge(meta, latest(id));
        const tags = node('div', 'tags');
        if (b) tags.appendChild(modelBadge(id));
        if (where && state.online.length > 1) tags.appendChild(node('span', 'machine-badge', upper(where)));
        if (tags.firstChild) meta.appendChild(tags);
        const git = b ? gitOpenOf(b) : [];
        if (git.length) meta.appendChild(gitBadge(b, git));
        if (isMuted(id)) meta.appendChild(node('span', 'muted-badge', '🔕'));
        if (open) meta.appendChild(node('span', 'badge', String(open)));
        else meta.appendChild(node('i', 'dot ' + (st === 'idle' && isUnread(id) ? 'new' : st)));
        if (isUnread(id)) li.classList.add('unread');
        queueBadge(meta, id);
        const subs = b ? byTime(conversationsOf(b)) : [];
        const closed = subs.length > 0 && collapsed.has(id);
        if (subs.length) {
            // collapsed: dot on the button when something runs or something new waits in a hidden conversation
            const important = closed && subs.some((c) => chatStatus(c).state !== 'idle' || backgroundOf(c).length || isUnread(c));
            const button = node('button', 'collapse' + (closed ? ' closed' : '') + (important ? ' important' : ''));
            button.type = 'button';
            button.title = closed ? tn('list.showConversations', subs.length) : t('list.hideConversations');
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-expanded', String(!closed));
            button.innerHTML = `<span>${subs.length}</span><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`;
            button.addEventListener('click', (ev) => { ev.stopPropagation(); toggleConversations(id); });
            meta.appendChild(button);
        }
        li.append(av, info, meta);
        openOnClick(li, id);
        el.chatList.appendChild(li);
        // collapsed: only conversations that are open in a pane right now stay visible
        for (const cid of subs) if (!closed || paneFor(cid)) el.chatList.appendChild(conversationRow(cid));
    }
    setBadge(allChats().filter(isUnread).length + otherUnreadCount());
}

/** A steady colour per account for its badge in the list. */
function accountHue(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9973;
    // the golden angle spreads neighbouring values over the circle
    return Math.round((h * 137.508) % 360);
}

/**
 * A bot or group of another account this device is signed in to: name with the account's badge, what it does or
 * said last, time and unread. A tap opens it in that account.
 * @param {ReturnType<typeof otherRows>[number]} r
 */
function foreignRow(r) {
    const li = node('li', 'other-account');
    li.dataset.chat = r.id;
    li.dataset.account = r.account.id;
    const av = node('div', 'avatar' + (r.group ? ' group' : ''));
    fillAvatar(av, r.item, r.id);
    const info = node('div', 'info');
    const name = node('div', 'name', r.item.name);
    if (!r.group && (r.item.area || r.item.role)) name.appendChild(node('small', '', ' · ' + (r.item.area || r.item.role)));
    const badge = node('span', 'account-badge', r.account.name);
    badge.style.setProperty('--account-hue', String(accountHue(r.account.id)));
    name.appendChild(badge);
    const last = node('div', 'last',
        r.state === 'waiting' ? '⏳ ' + t('status.waitingForYou') : r.state === 'thinking' ? r.activity || t('status.thinking')
            : r.sleeping ? '💤 ' + t('list.sleepingMachineOff', { machine: upper(r.machine) })
                : (r.last || (r.group ? tn('list.bots', (r.item.members || []).length) : shortFolder(r.item.folder || ''))));
    if (r.sleeping) last.classList.add('sleeping');
    if (r.state === 'thinking') last.classList.add('working');
    if (r.state === 'waiting') last.classList.add('waiting');
    info.append(name, last);
    const meta = node('div', 'meta');
    timeBadge(meta, r.ts);
    if (r.approvals) meta.appendChild(node('span', 'badge', String(r.approvals)));
    else meta.appendChild(node('i', 'dot ' + (r.state === 'idle' && r.unread ? 'new' : r.state)));
    if (r.unread) li.classList.add('unread');
    li.append(av, info, meta);
    li.title = t('list.otherAccount', { account: r.account.name });
    li.addEventListener('click', () => openOtherChat(r.account.id, r.id));
    return li;
}

/** .active: the chat of the active pane; .open: shown in another pane next to it. */
function markOpen(li, id) {
    if (id === activePane().chatId) li.classList.add('active');
    else if (visibleChats().includes(id)) li.classList.add('open');
}

/** With a mouse a row can be dragged onto a pane; touch screens keep swiping and the long press instead. */
const canDrag = window.matchMedia('(pointer: fine)');

/** A click opens the chat in the active pane; Ctrl/Cmd-click or the middle button opens it beside (wide screens). */
function openOnClick(li, id) {
    li.addEventListener('click', (ev) => (ev.ctrlKey || ev.metaKey ? openBeside(id) : openChat(id)));
    li.addEventListener('auxclick', (ev) => { if (ev.button === 1) { ev.preventDefault(); openBeside(id); } });
    if (!canDrag.matches) return;
    li.draggable = true;
    li.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData(CHAT_DRAG, id);
        ev.dataTransfer.effectAllowed = 'move';
    });
}

// ---------------------------------------------------------- Swiping in the overview
// Swipe a row (bot or group) to the left: "★ Favorite" appears underneath; from 80 px, releasing toggles the
// favorite and the row springs back. A conversation to the left: into the archive (back via the bot's menu).
// To the right (conversations too): read/unread.
const SWIPE_FAVORITE_PX = 80;

export function setupListSwipe() {
    let g = null;
    let swipeEnd = 0;
    const reset = (li, strip) => {
        li.style.transition = 'transform .18s ease-out';
        li.style.transform = '';
        setTimeout(() => { li.classList.remove('swiped'); li.style.transition = ''; strip.remove(); }, 180);
    };
    el.chatList.addEventListener('touchstart', (ev) => {
        g = null;
        const li = closest(ev, 'li[data-chat]');
        if (!li || ev.touches.length !== 1) return;
        const touch = ev.touches[0];
        g = { li, x: touch.clientX, y: touch.clientY, dx: 0, horizontal: null, strip: null };
    }, { passive: true });
    el.chatList.addEventListener('touchmove', (ev) => {
        if (!g) return;
        const touch = ev.touches[0];
        const dx = touch.clientX - g.x;
        const dy = touch.clientY - g.y;
        if (g.horizontal === null) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            g.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
            if (!g.horizontal) { g = null; return; }
            g.right = dx > 0;
            // strip behind the row, same height and position
            const c = g.li.dataset.chat;
            g.strip = g.right
                ? node('div', 'swipe-favorite swipe-read', isUnread(c) ? t('list.markRead') : t('list.markUnread'))
                : g.li.classList.contains('sub') ? node('div', 'swipe-favorite swipe-archive', '🗄 ' + t('list.archive'))
                    : node('div', 'swipe-favorite', isFavorite(c) ? '☆ ' + t('list.unfavorite') : '★ ' + t('list.favorite'));
            g.strip.style.top = g.li.offsetTop + 'px';
            g.strip.style.height = g.li.offsetHeight + 'px';
            el.chatList.appendChild(g.strip);
            g.li.classList.add('swiped');
            g.li.style.transition = 'none';
        }
        g.dx = g.right ? Math.max(0, Math.min(160, dx)) : Math.max(-160, Math.min(0, dx));
        g.li.style.transform = `translateX(${g.dx}px)`;
        g.strip.classList.toggle('ready', Math.abs(g.dx) >= SWIPE_FAVORITE_PX);
    }, { passive: true });
    const end = () => {
        if (!g || !g.horizontal) { g = null; return; }
        const { li, strip, dx, right } = g;
        g = null;
        swipeEnd = Date.now();
        reset(li, strip);
        if (Math.abs(dx) < SWIPE_FAVORITE_PX) return;
        if (right) toggleUnread(li.dataset.chat);
        // only once the row has sprung back; then it disappears from the list
        else if (li.classList.contains('sub')) setTimeout(() => archiveConversation(li.dataset.chat, true), 200);
        else toggleFavorite(li.dataset.chat);
    };
    el.chatList.addEventListener('touchend', end);
    el.chatList.addEventListener('touchcancel', end);
    // The click that follows the swipe must not open the chat
    el.chatList.addEventListener('click', (ev) => {
        if (Date.now() - swipeEnd < 400) { ev.stopPropagation(); ev.preventDefault(); }
    }, true);
}

// ---------------------------------------------------------- Long press in the overview
// A long press on a chat opens its menu at the finger, the same as the ⋮ menu of the open chat; with the mouse a right
// click does. If the finger moves before (scrolling, swiping), there is none.
const LONG_PRESS_MS = 500;
export let rowMenu = null;
/** Puts follow-up content (archive, git changes) into the open row menu at the same place. */
let rowShow = null;

/**
 * Puts content into the menu and places it at (x, y), kept inside the window. On the phone the menu is a page of its own
 * instead (chat.css), with the chat's picture and name and a back arrow at the top.
 */
function rowMenuAt(chatId, x, y) {
    return (...buttons) => {
        delete rowMenu.dataset.view;
        const page = window.innerWidth <= 760;
        rowMenu.classList.toggle('menu-page', page);
        rowMenu.replaceChildren(...(page ? [rowHead(chatId)] : []), ...buttons);
        rowMenu.hidden = false;
        if (page) { rowMenu.style.left = rowMenu.style.top = ''; return; }
        const r = rowMenu.getBoundingClientRect();
        rowMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
        rowMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    };
}

/** Badge on a bot with open repos; tapping opens the page with its open changes. */
function gitBadge(b, open) {
    const m = node('button', 'git-badge');
    m.type = 'button';
    m.title = tn('git.reposWithChanges', open.length);
    m.setAttribute('aria-label', m.title);
    m.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.git}</svg>`;
    m.appendChild(node('span', '', String(open.length)));
    m.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openGitPage(b);
    });
    return m;
}

/** Head of the row menu as a page: back, picture, name (a conversation with its bot below). */
function rowHead(chatId) {
    const g = isGroup(chatId) ? group(chatId) : null;
    const b = g ? null : bot(chatId);
    const head = node('div', 'menu-head');
    const back = node('button', 'menu-back');
    back.type = 'button';
    back.title = t('common.back');
    back.setAttribute('aria-label', t('common.back'));
    back.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.back}</svg>`;
    back.addEventListener('click', (ev) => { ev.stopPropagation(); rowMenu.hidden = true; });
    const avatar = node('div', 'avatar');
    fillAvatar(avatar, g || b, chatId);
    const title = node('div', 'title');
    title.append(node('strong', '', isConversation(chatId) ? conversationTitle(chatId) : (g || b).name));
    if (isConversation(chatId)) title.append(node('span', '', b.name));
    head.append(back, avatar, title);
    return head;
}

function openRowMenu(chatId, x, y) {
    if (!bot(chatId) && !group(chatId)) return;
    rowMenu.dataset.chat = chatId;
    fillChatMenu(rowMenu, chatId);
    rowShow = rowMenuAt(chatId, x, y);
    rowShow(...rowMenu.childNodes);
}

export function setupListLongPress() {
    rowMenu = node('div', 'menu message-menu');
    rowMenu.id = 'row-menu';
    rowMenu.hidden = true;
    document.body.appendChild(rowMenu);
    swipeBack(rowMenu, {
        allowed: (ev) => rowMenu.classList.contains('menu-page') && !closest(ev, '.git-list'),
        close: () => { rowMenu.hidden = true; },
    });
    rowMenu.addEventListener('click', (ev) => {
        const action = closest(ev, '[data-action]');
        if (!action || !rowMenu.contains(action)) return;
        ev.stopPropagation();
        // archive and open changes put themselves into the menu again
        rowMenu.hidden = true;
        chatMenuAction(rowMenu.dataset.chat, action.dataset.action, rowMenu, rowShow);
    });
    let g = null;
    const rowOf = (ev) => (ev.target.closest && ev.target.closest('li[data-chat]')) || null;
    el.chatList.addEventListener('touchstart', (ev) => {
        if (g) clearTimeout(g.timer);
        g = null;
        const li = rowOf(ev);
        if (!li || ev.touches.length !== 1) return;
        const touch = ev.touches[0];
        g = { x: touch.clientX, y: touch.clientY, open: false, timer: 0 };
        g.timer = setTimeout(() => {
            g.open = true;
            if (navigator.vibrate) navigator.vibrate(15);
            openRowMenu(li.dataset.chat, g.x, g.y);
        }, LONG_PRESS_MS);
    }, { passive: true });
    el.chatList.addEventListener('touchmove', (ev) => {
        if (!g || g.open) return;
        const touch = ev.touches[0];
        if (Math.abs(touch.clientX - g.x) > 10 || Math.abs(touch.clientY - g.y) > 10) { clearTimeout(g.timer); g = null; }
    }, { passive: true });
    const end = (ev) => {
        if (!g) return;
        clearTimeout(g.timer);
        // no click afterwards: it would open the chat and close the menu right away
        if (g.open && ev.cancelable) ev.preventDefault();
        g = null;
    };
    el.chatList.addEventListener('touchend', end);
    el.chatList.addEventListener('touchcancel', end);
    let pointer = 'mouse';
    el.chatList.addEventListener('pointerdown', (ev) => { pointer = ev.pointerType; }, true);
    // Android also reports the long press as contextmenu; there the own menu comes from the timer
    el.chatList.addEventListener('contextmenu', (ev) => {
        const li = rowOf(ev);
        if (!li) return;
        ev.preventDefault();
        if (pointer !== 'touch') openRowMenu(li.dataset.chat, ev.clientX, ev.clientY);
    });
    document.addEventListener('click', (ev) => { if (!rowMenu.contains(ev.target)) rowMenu.hidden = true; });
    el.chatList.addEventListener('scroll', () => { rowMenu.hidden = true; });
}

// Search box on the phone: collapsed until the list is pulled down at the very top; scrolling down again with
// an empty field collapses it (with a mouse it always stays visible via CSS).
const PULL_OPEN_PX = 50;

export function setupSearchBox() {
    let start = null;
    el.chatList.addEventListener('touchstart', (ev) => {
        start = el.chatList.scrollTop <= 0 && ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
    }, { passive: true });
    el.chatList.addEventListener('touchmove', (ev) => {
        if (!start || !el.searchBox.classList.contains('closed')) return;
        const dy = ev.touches[0].clientY - start.y;
        const dx = Math.abs(ev.touches[0].clientX - start.x);
        if (dy > PULL_OPEN_PX && dy > dx * 1.5) {
            el.searchBox.classList.remove('closed');
            start = null;
        }
    }, { passive: true });
    el.chatList.addEventListener('scroll', () => {
        if (el.chatList.scrollTop > 60 && !el.search.value && document.activeElement !== el.search) el.searchBox.classList.add('closed');
    });
    el.search.addEventListener('blur', () => {
        if (!el.search.value && el.chatList.scrollTop > 0) el.searchBox.classList.add('closed');
    });
}

// ---------------------------------------------------------- Search across all chats
// The backend searches the whole history of all chats; hits replace the chat list, a tap opens
// the chat and jumps to the message.
let searchTimer = null;

export function onSearchInput() {
    clearTimeout(searchTimer);
    const text = el.search.value.trim();
    const active = text.length >= 2;
    el.searchResults.hidden = !active;
    el.chatList.hidden = active;
    if (!active) return;
    if (!el.searchResults.children.length) el.searchResults.appendChild(node('li', 'empty-hint', t('search.searching')));
    searchTimer = setTimeout(() => send({ type: 'search', text }), 250);
}

function chatTitle(chatId) {
    if (isGroup(chatId)) return (group(chatId) || {}).name || chatId;
    const b = bot(chatId);
    if (!b) return chatId;
    return isConversation(chatId) ? `${b.name} · ${conversationTitle(chatId)}` : b.name;
}

/** Text with the search word highlighted, without innerHTML (contents come from chats). */
function withMark(text, word) {
    const f = document.createDocumentFragment();
    const lower = text.toLowerCase();
    const s = word.toLowerCase();
    let pos = 0;
    for (let i = lower.indexOf(s); i >= 0 && s; i = lower.indexOf(s, pos)) {
        f.append(text.slice(pos, i), node('mark', '', text.slice(i, i + s.length)));
        pos = i + s.length;
    }
    f.append(text.slice(pos));
    return f;
}

// Search in one chat (⋮ "Search in chat"): hits newest first; ▲ jumps to the older, ▼ to the newer one.
// Every pane has its own search (`cs` of the pane: hits, index, timer).

/** @param {Pane} p */
export function openChatSearch(p) {
    p.el.chatSearch.hidden = false;
    p.el.csText.value = '';
    p.cs.hits = [];
    countChatSearch(p);
    p.el.csText.focus();
}

/** @param {Pane} p */
export function closeChatSearch(p) {
    p.el.chatSearch.hidden = true;
    clearTimeout(p.cs.timer);
    p.cs.hits = [];
    p.globalSearch = null;
    removeSearchMarks(p);
}

// Mark the search word in the loaded messages; the hit jumped to more strongly
/** @param {Pane} p */
function removeSearchMarks(p) {
    for (const m of p.el.messages.querySelectorAll('mark.search-mark')) {
        const parent = m.parentNode;
        m.replaceWith(document.createTextNode(m.textContent));
        parent.normalize();
    }
}

/** Search word and the message jumped to: from the chat search, otherwise from the search across all chats. */
function activeSearch(p) {
    if (!p.el.chatSearch.hidden) {
        const hit = p.cs.hits[p.cs.index];
        return { word: p.el.csText.value.trim(), target: hit && hit.id };
    }
    return p.globalSearch || { word: '', target: null };
}

/** @param {Pane} p */
export function setSearchMarks(p) {
    removeSearchMarks(p);
    const { word, target } = activeSearch(p);
    const s = word.toLowerCase();
    if (s.length < 2) return;
    for (const area of p.el.messages.querySelectorAll('.bubble .text, .bubble .content, .bubble .transcript')) {
        const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.toLowerCase().includes(s)) nodes.push(n);
        for (const n of nodes) {
            const text = n.nodeValue;
            const f = document.createDocumentFragment();
            let pos = 0;
            for (let i = text.toLowerCase().indexOf(s); i >= 0; i = text.toLowerCase().indexOf(s, pos)) {
                f.append(text.slice(pos, i), node('mark', 'search-mark', text.slice(i, i + s.length)));
                pos = i + s.length;
            }
            f.append(text.slice(pos));
            /** @type {Text} */ (n).replaceWith(f);
        }
    }
    const current = target && p.el.messages.querySelector(`[data-eid="${CSS.escape(target)}"], [data-id="${CSS.escape(target)}"]`);
    if (current) for (const m of current.querySelectorAll('mark.search-mark')) m.classList.add('current');
}

/** @param {Pane} p */
export function onChatSearchInput(p) {
    clearTimeout(p.cs.timer);
    const text = p.el.csText.value.trim();
    p.cs.hits = [];
    countChatSearch(p);
    removeSearchMarks(p);
    if (text.length < 2) return;
    const chatId = p.chatId;
    p.cs.timer = setTimeout(() => send({ type: 'search', text, chatId }), 250);
}

/** @param {Pane} p */
function countChatSearch(p) {
    const n = p.cs.hits.length;
    const text = p.el.csText.value.trim();
    p.el.csCount.textContent = text.length < 2 ? '' : n ? `${p.cs.index + 1}/${n}` : '0';
    p.el.csOlder.disabled = !n || p.cs.index >= n - 1;
    p.el.csNewer.disabled = !n || p.cs.index <= 0;
}

/** @param {Pane} p */
export function jumpChatSearch(p) {
    const hit = p.cs.hits[p.cs.index];
    countChatSearch(p);
    if (!hit) return;
    p.jumpTo = hit.id;
    // not in the loaded history: fetch more, jump (and mark) after loading
    if (p.el.messages.querySelector(`[data-eid="${CSS.escape(hit.id)}"], [data-id="${CSS.escape(hit.id)}"]`)) {
        setSearchMarks(p);
        jumpToEntry(p);
    } else {
        loadingBar(p, true);
        send({ type: 'history', chatId: p.chatId, limit: 5000 });
    }
}

/** ▲ (older, +1) and ▼ (newer, -1) in the chat search. @param {Pane} p */
export function stepChatSearch(p, step) {
    const i = p.cs.index + step;
    if (i < 0 || i >= p.cs.hits.length) return;
    p.cs.index = i;
    jumpChatSearch(p);
}

export function renderSearchResult(f) {
    if (f.chatId) {
        const p = paneFor(f.chatId);
        if (!p || p.el.chatSearch.hidden || f.text !== p.el.csText.value.trim()) return;
        p.cs.hits = f.hits;
        p.cs.index = 0;
        jumpChatSearch(p);
        return;
    }
    if (f.text !== el.search.value.trim()) return;
    el.searchResults.innerHTML = '';
    const hits = f.hits.filter((h) => allChats().includes(h.chatId));
    if (!hits.length) el.searchResults.appendChild(node('li', 'empty-hint', t('search.nothingFound', { text: f.text })));
    for (const h of hits) {
        const li = node('li');
        const head = node('div', 's-head', chatTitle(h.chatId));
        head.appendChild(node('span', '', clockTime(h.ts)));
        const text = node('div', 's-text');
        if (h.from && (h.from !== 'me' || isGroup(h.chatId))) text.append(`${senderName(h.from)}: `);
        text.append(withMark(h.excerpt, f.text));
        li.append(head, text);
        li.addEventListener('click', () => openChat(h.chatId, h.id, f.text));
        el.searchResults.appendChild(li);
    }
}

/** Jumps to the message in `jumpTo` of the pane, if it is in the loaded history. @param {Pane} p */
export function jumpToEntry(p) {
    const id = p.jumpTo;
    p.jumpTo = null;
    if (!id) return;
    const target = /** @type {HTMLElement | null} */ (p.el.messages.querySelector(`[data-eid="${CSS.escape(id)}"], [data-id="${CSS.escape(id)}"]`));
    if (!target) return;
    p.follow = false;
    target.scrollIntoView({ block: 'center' });
    target.classList.remove('highlighted');
    void target.offsetWidth;
    target.classList.add('highlighted');
    p.el.toBottom.hidden = false;
}

/** The model a bot's chat runs on (a conversation can have its own), the name that really runs, never "Default". */
function modelBadge(chatId) {
    const name = modelDisplay(modelOf(chatId));
    const badge = node('span', 'model-badge', name);
    badge.title = name;
    return badge;
}

/** Indented row of a further conversation below its bot. */
function conversationRow(chatId) {
    const li = node('li', 'sub');
    li.dataset.chat = chatId;
    markOpen(li, chatId);
    const info = node('div', 'info');
    info.appendChild(node('div', 'name', conversationTitle(chatId)));
    const { state: st, activity } = chatStatus(chatId);
    const behind = st === 'idle' ? backgroundOf(chatId) : [];
    const last = node('div', 'last',
        st === 'waiting' ? '⏳ ' + t('status.waitingForYou') : st === 'thinking' ? activity
            : behind.length ? backgroundText(behind) : (state.last[chatId] || t('list.noMessageYet')));
    if (st === 'thinking' || behind.length) last.classList.add('working');
    if (st === 'waiting') last.classList.add('waiting');
    info.appendChild(last);
    const meta = node('div', 'meta');
    timeBadge(meta, latest(chatId));
    const tags = node('div', 'tags');
    tags.appendChild(modelBadge(chatId));
    meta.appendChild(tags);
    const open = openApprovals(chatId).length;
    meta.appendChild(open ? node('span', 'badge', String(open)) : node('i', 'dot ' + (st === 'idle' && isUnread(chatId) ? 'new' : st)));
    if (isUnread(chatId)) li.classList.add('unread');
    queueBadge(meta, chatId);
    li.append(node('div', 'sub-mark', '↳'), info, meta);
    openOnClick(li, chatId);
    return li;
}

export function renderUsage() {
    const claude = state.usage;
    const codex = state.usageCodex;
    if (!claude && !codex) return;
    el.usage.hidden = false;
    el.usage.innerHTML = '';
    const bar = (label, w) => {
        if (!w) return;
        const p = Math.round(w.utilization * 100);
        const row = node('div', 'usage-bar' + (p >= 90 ? ' critical' : p >= 70 ? ' warning' : ''));
        row.title = w.resetsAt ? t('usage.resets', { time: new Date(w.resetsAt * 1000).toLocaleString(locale()) }) : '';
        row.append(node('span', '', label));
        const track = node('span', 'track');
        const fill = node('span', 'fill');
        fill.style.width = Math.min(p, 100) + '%';
        track.appendChild(fill);
        row.append(track, node('span', 'value', p + ' %'));
        el.usage.appendChild(row);
    };
    // Claude plan and ChatGPT plan (Codex) have their own limits; the prefix only appears once both are there
    const both = !!(claude && codex);
    for (const [u, name] of [[claude, 'Claude'], [codex, 'Codex']]) {
        if (!u) continue;
        const prefix = both ? name + ' ' : '';
        bar(prefix + t('usage.fiveHours'), u.fiveHour);
        bar(prefix + t('usage.week'), u.sevenDay);
        if (u.status === 'rejected') {
            const until = u.resetsAt ? new Date(u.resetsAt * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : t('usage.later');
            el.usage.appendChild(node('div', 'limit', t(name === 'Codex' ? 'usage.codexLimit' : 'usage.planLimit', { time: until })));
        }
    }
}
