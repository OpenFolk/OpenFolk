/* OpenFolk web app: chat panes. Every open chat lives in a pane cloned from #pane-template; on wide screens several
   panes stand side by side, on phones and laptops there is exactly one. A pane holds the UI state of its chat (follow,
   queue, uploads, reply, search, mention); a chat is open in at most one pane, so frames find their pane by chat id.
   Imports only i18n.js and core.js, so every module may use it; the event wiring is delegated in start.js because
   panes appear after it ran. */
import { applyI18n } from './i18n.js';
import { $, PANES_KEY, el, storage } from './core.js';

/**
 * @typedef {object} PaneElements
 * @property {HTMLElement} chatAvatar
 * @property {HTMLButtonElement} chatTitle
 * @property {HTMLElement} chatName
 * @property {HTMLElement} chatSub
 * @property {HTMLButtonElement} chatModel
 * @property {HTMLButtonElement} chatMachine
 * @property {HTMLElement} headerMenu
 * @property {HTMLButtonElement} btnBack
 * @property {HTMLButtonElement} btnClose
 * @property {HTMLElement} chatSearch
 * @property {HTMLInputElement} csText
 * @property {HTMLElement} csCount
 * @property {HTMLButtonElement} csOlder
 * @property {HTMLButtonElement} csNewer
 * @property {HTMLButtonElement} csClose
 * @property {HTMLElement} pinnedBar
 * @property {HTMLButtonElement} fxText
 * @property {HTMLButtonElement} fxUnpin
 * @property {HTMLElement} loadingBar
 * @property {HTMLElement} messages
 * @property {HTMLButtonElement} toBottom
 * @property {HTMLElement} working
 * @property {HTMLElement} workingStar
 * @property {HTMLElement} workingText
 * @property {HTMLButtonElement} btnStop
 * @property {HTMLElement} sleep
 * @property {HTMLElement} sleepText
 * @property {HTMLButtonElement} sleepWake
 * @property {HTMLElement} mention
 * @property {HTMLElement} queue
 * @property {HTMLButtonElement} queueHead
 * @property {HTMLElement} queueList
 * @property {HTMLElement} members
 * @property {HTMLElement} attachments
 * @property {HTMLElement} replyBar
 * @property {HTMLElement} rbWho
 * @property {HTMLElement} rbText
 * @property {HTMLButtonElement} rbCancel
 * @property {HTMLFormElement} composer
 * @property {HTMLButtonElement} btnAttach
 * @property {HTMLInputElement} fileInput
 * @property {HTMLTextAreaElement} text
 * @property {HTMLButtonElement} btnSend
 * @property {HTMLButtonElement} btnMic
 * @property {HTMLElement} recording
 * @property {HTMLButtonElement} recDiscard
 * @property {HTMLElement} recDot
 * @property {HTMLElement} recTime
 * @property {HTMLElement} recLevel
 * @property {HTMLButtonElement} recPause
 * @property {HTMLButtonElement} recSend
 */

/**
 * @typedef {object} Pane
 * @property {HTMLElement} root
 * @property {PaneElements} el
 * @property {string | null} chatId
 * @property {boolean} follow          follows new content until the user scrolls up
 * @property {boolean} queueOpen
 * @property {any} queueSettle
 * @property {any[]} uploads           { name, type, size, data, thumb }
 * @property {any} replyTo             quote for the next message
 * @property {string | null} jumpTo    message to jump to once the history is there
 * @property {any} globalSearch        { word, target } from the search across all chats
 * @property {{ id: string | null, snapshot: string }} rendered
 * @property {number} fxIndex          pinned message shown in the bar
 * @property {{ hits: any[], index: number, timer: any }} cs
 * @property {{ start: number, hits: any[], active: number }} mention
 * @property {any} loadingTimer
 * @property {() => void} dispose
 */

/** Below this every window has one pane (phone layout). */
export const NARROW_PX = 760;
/** A pane narrower than this squeezes code and tables. */
export const MIN_PANE_PX = 640;
export const SIDEBAR_PX = 360;
export const INFO_PX = 400;

/** Data type of a chat dragged from the list onto a pane or the + strip. */
export const CHAT_DRAG = 'application/x-openfolk-chat';

/** @type {Pane[]} */
export const panes = [];
let active = null;

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** @returns {Pane} */
export function createPane() {
    const template = /** @type {HTMLTemplateElement} */ ($('pane-template'));
    const root = /** @type {HTMLElement} */ (template.content.firstElementChild.cloneNode(true));
    const els = /** @type {PaneElements} */ ({});
    for (const n of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-el]'))) els[camel(n.dataset.el)] = n;
    applyI18n(root);
    /** @type {Pane} */
    const p = {
        root, el: els, chatId: null, follow: true, queueOpen: false, queueSettle: null, uploads: [], replyTo: null,
        jumpTo: null, globalSearch: null, rendered: { id: null, snapshot: '' }, fxIndex: 0,
        cs: { hits: [], index: 0, timer: null }, mention: { start: -1, hits: [], active: 0 }, loadingTimer: null,
        dispose: () => undefined,
    };
    // Every change in the history (text chunks, tool rows, cards), every resize (phone keyboard) and every image
    // that gets taller after inserting keeps a following pane at the bottom
    const m = els.messages;
    const stick = () => { if (p.follow) m.scrollTop = m.scrollHeight; };
    const mutations = new MutationObserver(stick);
    mutations.observe(m, { childList: true, subtree: true, characterData: true });
    const resize = new ResizeObserver(stick);
    resize.observe(m);
    m.addEventListener('load', stick, true);
    p.dispose = () => { mutations.disconnect(); resize.disconnect(); };
    // the settings stay the last column
    el.panes.insertBefore(root, el.settings.parentElement === el.panes ? el.settings : null);
    panes.push(p);
    if (!active) active = p;
    return p;
}

export function activePane() {
    return active;
}

/** @param {Pane} p */
export function setActivePane(p) {
    if (!p || p === active) return;
    active = p;
    markActive();
}

/** The pane showing this chat, or null. */
export function paneFor(chatId) {
    return (chatId && panes.find((p) => p.chatId === chatId)) || null;
}

/** The pane an event or element belongs to, or null. */
export function paneOf(target) {
    const t = target instanceof Event ? target.target : target;
    const root = t instanceof Element ? t.closest('.pane') : null;
    return (root && panes.find((p) => p.root === root)) || null;
}

/** Removes a pane (never the last one); the left neighbour becomes active if it was. */
export function removePane(p) {
    const i = panes.indexOf(p);
    if (i < 0 || panes.length === 1) return;
    p.dispose();
    clearTimeout(p.queueSettle);
    clearTimeout(p.loadingTimer);
    clearTimeout(p.cs.timer);
    p.root.remove();
    panes.splice(i, 1);
    if (active === p) active = panes[Math.max(0, i - 1)];
    layoutPanes();
}

/** Whether there is room for more than one pane. */
export const isWide = () => window.innerWidth >= SIDEBAR_PX + 2 * MIN_PANE_PX;

/** The info panel docks as a column of its own when a pane still fits next to it. */
export const canDockInfo = () => window.innerWidth >= SIDEBAR_PX + MIN_PANE_PX + INFO_PX;

function infoDocked() {
    return !el.info.hidden && canDockInfo();
}

/** How many panes fit side by side. */
export function capacity() {
    const w = window.innerWidth;
    if (w <= NARROW_PX) return 1;
    return Math.max(1, Math.floor((w - SIDEBAR_PX - (infoDocked() ? INFO_PX : 0)) / MIN_PANE_PX));
}

/** On wide screens the settings are a pane of their own after the chats; on a phone a page over everything. */
function placeSettings() {
    const target = window.innerWidth > NARROW_PX ? el.panes : el.app;
    if (el.settings.parentElement !== target) target.appendChild(el.settings);
}

/** Whether the settings take the room of a pane. */
const settingsInPanes = () => !el.settings.hidden && el.settings.parentElement === el.panes;

export function closeSettings() {
    el.settings.hidden = true;
    layoutPanes();
}

/** Panes on screen: the active one plus the others from the left, as many as fit next to the settings; the rest is parked. */
export function visiblePanes() {
    if (!el.gitPage.hidden) return [];
    const cap = capacity() - (settingsInPanes() ? 1 : 0);
    if (cap < 1) return [];
    const shown = new Set(active ? [active] : []);
    for (const p of panes) {
        if (shown.size >= cap) break;
        shown.add(p);
    }
    return panes.filter((p) => shown.has(p) && (p.chatId || panes.length > 1));
}

/** Chats the user sees right now; they count as read. */
export function visibleChats() {
    return visiblePanes().map((p) => p.chatId).filter(Boolean);
}

function markActive() {
    const several = visiblePanes().length > 1;
    for (const p of panes) p.root.classList.toggle('active', several && p === active);
}

/**
 * Shows the visible panes, parks the others (they keep their chat, draft and scroll position) and sets the layout
 * classes: `multi` lifts the width cap of the browser layout, `info-docked` gives the info panel its own column.
 */
export function layoutPanes() {
    placeSettings();
    const shown = visiblePanes();
    const settings = settingsInPanes();
    for (const p of panes) {
        p.root.hidden = !shown.includes(p);
        p.root.classList.toggle('no-chat', !p.chatId);
    }
    const single = panes.length === 1;
    el.panes.hidden = !el.gitPage.hidden;
    el.chatEmpty.hidden = !el.gitPage.hidden || !single || !!panes[0].chatId || settings;
    el.app.classList.toggle('chat-open', !el.gitPage.hidden || !!(active && active.chatId));
    el.app.classList.toggle('multi', shown.length + (settings ? 1 : 0) > 1);
    el.app.classList.toggle('info-docked', infoDocked());
    el.paneAdd.hidden = !isWide() || !el.gitPage.hidden || panes.length >= capacity() - (settings ? 1 : 0);
    for (const p of panes) p.el.btnClose.hidden = single;
    markActive();
}

/** Remembers the open chats of all panes on this device (restored after a reload on a wide screen). */
export function savePanes() {
    if (!isWide()) return;
    storage.set(PANES_KEY, JSON.stringify(panes.map((p) => p.chatId)));
}

/** Chat ids remembered by savePanes (null for an empty pane). */
export function rememberedPanes() {
    try {
        const list = JSON.parse(storage.get(PANES_KEY) || '[]');
        return Array.isArray(list) ? list.filter((x) => x === null || typeof x === 'string') : [];
    } catch {
        return [];
    }
}

