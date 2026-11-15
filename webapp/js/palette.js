/* OpenFolk web app: the command palette (Ctrl+K) over chats, actions, routines, settings, messages and files, the
   keyboard shortcuts and their overview (Ctrl+/). The desktop app's menu runs the same commands (openfolk:command). */
import { t } from './i18n.js';
import { el, node, state } from './core.js';
import { appleKeys, browserOwnsKeys, shortcutKey } from './platform.js';
import { activePane, toggleSidebar } from './panes.js';
import { clockTime, isGroup, send, senderName, upper } from './e2e.js';
import { allChats } from './connection.js';
import { chatKind, chatTitle, findChats, findRoutines, matchesWords, openChatSearch, openRoutine } from './list.js';
import { openBeside, openChat, paneActivated, stepVisited } from './chat.js';
import { ICONS, openMachinesPage } from './menus.js';
import { newGroup, openEditor } from './editors.js';
import { openSettings, openSettingsAt } from './settings.js';
import { wake, wakeableMachines } from './machines.js';
import { sendMessage } from './queue.js';

/** Messages are searched in this many days first; "Search older messages" drops the limit. */
export const RECENT_DAYS = 28;
/** The most chats, routines and the like per section, so the messages stay in reach. */
const PER_SECTION = 8;

/**
 * @typedef {object} PaletteItem
 * @property {string} key       stays the same across renders, so the selection survives arriving results
 * @property {string} section   i18n key of the heading
 * @property {string} icon      key of ICONS
 * @property {string} label
 * @property {string} [sub]
 * @property {string} [meta]    shortcut or time at the right
 * @property {(beside: boolean) => void | 'stay'} run   'stay': the palette stays open (searching older messages)
 */

const pal = {
    query: '',
    /** ISO time the messages are searched from; '' once older ones are asked for. */
    since: '',
    /** @type {any[] | null} hits of the backends (SearchHit), null while searching */
    messages: null,
    /** @type {any[] | null} */
    files: null,
    /** @type {PaletteItem[]} */
    items: [],
    active: 0,
    timer: null,
    /** @type {Element | null} where the focus goes back to when the palette closes without opening anything */
    opener: null,
};

// ---------------------------------------------------------------- Opening and closing

export function openPalette() {
    pal.opener = document.activeElement;
    el.palette.hidden = false;
    el.paletteInput.value = '';
    el.paletteHint.textContent = t('palette.hint', { mod: keyLabel('mod') });
    setQuery('');
    el.paletteInput.focus();
}

/** Closes the palette; `restore`: the focus goes back where it was (Escape, a click beside it). */
export function closePalette(restore = true) {
    if (el.palette.hidden) return;
    el.palette.hidden = true;
    clearTimeout(pal.timer);
    const back = /** @type {HTMLElement | null} */ (pal.opener);
    pal.opener = null;
    if (restore && back && back.isConnected && typeof back.focus === 'function') back.focus();
}

/** The text in the palette changed: local hits at once, the backend's after a pause in typing. */
export function onPaletteInput() {
    setQuery(el.paletteInput.value.trim());
}

function setQuery(query) {
    pal.query = query;
    pal.since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
    pal.messages = null;
    pal.files = null;
    // a new query starts at its best hit; only arriving results keep the selection
    pal.items = [];
    pal.active = 0;
    clearTimeout(pal.timer);
    if (query.length >= 2) {
        pal.timer = setTimeout(() => {
            send({ type: 'search', text: query, since: pal.since });
            send({ type: 'search', text: query, files: true });
        }, 250);
    }
    render();
}

function searchOlder() {
    pal.since = '';
    pal.messages = null;
    send({ type: 'search', text: pal.query });
    render();
    return /** @type {'stay'} */ ('stay');
}

/** An answer to a search; those for another text, a chat's search or an earlier time limit are not the palette's. */
export function renderPaletteResult(f) {
    if (el.palette.hidden || f.chatId || f.text !== pal.query) return;
    // every awake machine answers for its chats
    const merge = (/** @type {any[] | null} */ before) => {
        const seen = new Set((before || []).map((h) => h.chatId + '\n' + h.id));
        return [...(before || []), ...f.hits.filter((h) => !seen.has(h.chatId + '\n' + h.id) && allChats().includes(h.chatId))]
            .sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 30);
    };
    // A backend before `since` answers without it, over the whole history: still hits for the query
    if (f.files) pal.files = merge(pal.files);
    else if (!f.since || f.since === pal.since) pal.messages = merge(pal.messages);
    else return;
    render();
}

// ---------------------------------------------------------------- What it finds

/** Shortcut of an action, as the overview writes it. */
const keysOf = (id) => SHORTCUTS.find((s) => s.id === id)?.keys.map(keyLabel).join(' + ') || '';

function actions() {
    /** @type {PaletteItem[]} */
    const list = [
        { key: 'a:newBot', section: 'palette.actions', icon: 'bot', label: t('editor.newBot'), meta: keysOf('newBot'), run: () => openEditor(null) },
        { key: 'a:newGroup', section: 'palette.actions', icon: 'group', label: t('group.new'), meta: keysOf('newGroup'), run: () => newGroup() },
        { key: 'a:settings', section: 'palette.actions', icon: 'sliders', label: t('settings.title'), meta: keysOf('settings'), run: () => openSettings() },
        { key: 'a:status', section: 'palette.actions', icon: 'monitor', label: t('tabs.status'), run: () => openMachinesPage() },
    ];
    for (const host of wakeableMachines()) {
        list.push({ key: 'a:wake:' + host, section: 'palette.actions', icon: 'restart', label: t('palette.wake', { machine: upper(host) }), run: () => wake(host) });
    }
    list.push({ key: 'a:shortcuts', section: 'palette.actions', icon: 'info', label: t('shortcuts.title'), meta: keysOf('shortcuts'), run: () => openShortcuts() });
    return list;
}

/** The headings of the settings page; a hit opens the settings there. Blocks hidden for this device stay out. */
function settingsBlocks() {
    return [...el.settings.querySelectorAll('.dialog h3')]
        .filter((h) => !h.parentElement.closest('[hidden]:not(#settings)'))
        .map((h) => /** @type {HTMLElement} */ (h));
}

const chatIcon = (id) => (isGroup(id) ? 'group' : id.startsWith('p:') ? 'person' : id.includes('~') ? 'conversation' : 'bot');

/** @returns {PaletteItem} */
function chatItem(id) {
    return { key: 'c:' + id, section: 'palette.chats', icon: chatIcon(id), label: chatTitle(id), sub: chatKind(id), run: (beside) => (beside ? openBeside(id) : openChat(id)) };
}

/** Without a query: the chats written in last, then the actions. */
function recentChats() {
    return allChats().map((id, i) => ({ id, i, ts: state.lastTs[id] || '' }))
        .sort((x, y) => y.ts.localeCompare(x.ts) || x.i - y.i).slice(0, 6).map((x) => x.id);
}

/** @returns {PaletteItem} */
function hitItem(h, section, word) {
    const from = h.from && (h.from !== 'me' || isGroup(h.chatId)) ? `${senderName(h.from)}: ` : '';
    return {
        key: `${section}:${h.chatId}:${h.id}`, section, icon: section === 'palette.files' ? 'folder' : 'search', label: chatTitle(h.chatId),
        sub: from + h.excerpt, meta: clockTime(h.ts), run: () => openChat(h.chatId, h.id, word),
    };
}

/**
 * The sections with their entries; `note` stands where no entry says how the search goes.
 * @returns {{ section: string, items: PaletteItem[], note?: string }[]}
 */
function collect() {
    const q = pal.query;
    if (!q) return [{ section: 'palette.chats', items: recentChats().map(chatItem) }, { section: 'palette.actions', items: actions() }];
    const sections = [
        { section: 'palette.chats', items: findChats(q).slice(0, PER_SECTION).map(chatItem) },
        { section: 'palette.actions', items: actions().filter((a) => matchesWords(a.label, q)) },
        {
            section: 'palette.routines', items: findRoutines(q).slice(0, PER_SECTION).map((r) => /** @type {PaletteItem} */ ({
                key: 'r:' + r.id, section: 'palette.routines', icon: 'restart', label: r.name, sub: `${chatTitle(r.botId)} · ${r.cron}`, run: () => openRoutine(r),
            })),
        },
        {
            section: 'palette.settings', items: settingsBlocks().filter((h) => matchesWords(h.textContent, q)).slice(0, PER_SECTION).map((h, i) => /** @type {PaletteItem} */ ({
                key: 's:' + i, section: 'palette.settings', icon: 'sliders', label: h.textContent, sub: t('settings.title'), run: () => openSettingsAt(h),
            })),
        },
    ];
    if (q.length >= 2) {
        const hits = (pal.messages || []).map((h) => hitItem(h, 'palette.messages', q));
        if (pal.messages && pal.since) {
            hits.push({ key: 'older', section: 'palette.messages', icon: 'search', label: t('palette.older'), sub: t('palette.olderSub', { days: RECENT_DAYS }), run: searchOlder });
        }
        const note = !pal.messages ? t('search.searching') : pal.messages.length ? '' : pal.since ? t('palette.noRecent', { days: RECENT_DAYS }) : t('search.nothingFound', { text: q });
        sections.push({ section: 'palette.messages', items: hits, note });
        sections.push({ section: 'palette.files', items: (pal.files || []).map((h) => hitItem(h, 'palette.files', '')) });
    }
    return sections.filter((x) => x.items.length || x.note);
}

// ---------------------------------------------------------------- Showing it

function render() {
    const before = pal.items[pal.active]?.key;
    const sections = collect();
    pal.items = sections.flatMap((x) => x.items);
    const kept = pal.items.findIndex((x) => x.key === before);
    pal.active = kept >= 0 ? kept : Math.min(pal.active, Math.max(0, pal.items.length - 1));
    const rows = [];
    let i = 0;
    for (const x of sections) {
        rows.push(heading(x.section));
        if (x.note) rows.push(node('li', 'palette-note', x.note));
        for (const item of x.items) rows.push(option(item, i++));
    }
    if (!rows.length) rows.push(node('li', 'palette-note', t('search.nothingFound', { text: pal.query })));
    el.paletteList.replaceChildren(...rows);
    markActive(false);
}

function heading(key) {
    const li = node('li', 'palette-section', t(key));
    li.setAttribute('role', 'presentation');
    return li;
}

function option(item, i) {
    const li = node('li', 'palette-option');
    li.id = 'palette-option-' + i;
    li.dataset.index = String(i);
    li.dataset.key = item.key;
    li.setAttribute('role', 'option');
    li.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[item.icon] || ''}</svg>`;
    const text = node('span', 'palette-text');
    text.append(node('span', 'palette-label', item.label));
    if (item.sub) text.append(node('span', 'palette-sub', item.sub));
    li.append(text);
    if (item.meta) li.append(node('span', 'palette-meta', item.meta));
    return li;
}

function markActive(scroll = true) {
    let current = null;
    for (const li of el.paletteList.querySelectorAll('[role=option]')) {
        const on = Number(/** @type {HTMLElement} */ (li).dataset.index) === pal.active;
        li.setAttribute('aria-selected', String(on));
        if (on) current = li;
    }
    if (current) el.paletteInput.setAttribute('aria-activedescendant', current.id);
    else el.paletteInput.removeAttribute('aria-activedescendant');
    if (current && scroll) current.scrollIntoView({ block: 'nearest' });
}

function runItem(i, beside = false) {
    const item = pal.items[i];
    if (!item) return;
    if (item.run(beside) === 'stay') {
        el.paletteInput.focus();
        return;
    }
    closePalette(false);
}

/** Arrows choose, Enter opens, Ctrl+Enter (Cmd on a Mac) opens a chat in a pane beside the others. */
export function paletteKey(/** @type {KeyboardEvent} */ ev) {
    const n = pal.items.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!n) return;
        pal.active = (pal.active + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
        markActive();
    } else if (ev.key === 'Enter') {
        ev.preventDefault();
        runItem(pal.active, shortcutKey(ev));
    }
}

export function setupPalette() {
    el.paletteInput.addEventListener('input', onPaletteInput);
    el.paletteInput.addEventListener('keydown', paletteKey);
    // Choosing with the mouse must not take the focus from the field
    el.paletteList.addEventListener('pointerdown', (ev) => ev.preventDefault());
    el.paletteList.addEventListener('click', (ev) => {
        const li = ev.target instanceof Element ? /** @type {HTMLElement | null} */ (ev.target.closest('[role=option]')) : null;
        if (li) runItem(Number(li.dataset.index), ev.ctrlKey || ev.metaKey);
    });
    el.paletteList.addEventListener('pointermove', (ev) => {
        const li = ev.target instanceof Element ? /** @type {HTMLElement | null} */ (ev.target.closest('[role=option]')) : null;
        if (!li || Number(li.dataset.index) === pal.active) return;
        pal.active = Number(li.dataset.index);
        markActive(false);
    });
}

// ---------------------------------------------------------------- Shortcuts

/** `mod`: Ctrl, Cmd on a Mac. The order is the overview's. */
const SHORTCUTS = [
    { id: 'palette', keys: ['mod', 'K'] },
    { id: 'newBot', keys: ['mod', 'N'] },
    { id: 'newGroup', keys: ['mod', 'shift', 'N'] },
    { id: 'search', keys: ['mod', 'F'] },
    { id: 'chatN', keys: ['mod', '1 … 9'] },
    { id: 'previous', keys: ['alt', '↑'] },
    { id: 'next', keys: ['alt', '↓'] },
    { id: 'back', keys: ['mod', '['] },
    { id: 'forward', keys: ['mod', ']'] },
    { id: 'composer', keys: ['mod', 'I'] },
    { id: 'send', keys: ['mod', 'enter'] },
    { id: 'sidebar', keys: ['mod', 'B'] },
    { id: 'settings', keys: ['mod', ','] },
    { id: 'shortcuts', keys: ['mod', '/'] },
    { id: 'close', keys: ['Esc'] },
];

function keyLabel(k) {
    if (k === 'mod') return appleKeys ? '⌘' : 'Ctrl';
    if (k === 'alt') return appleKeys ? '⌥' : 'Alt';
    if (k === 'shift') return appleKeys ? '⇧' : t('keys.shift');
    if (k === 'enter') return t('keys.enter');
    return k;
}

/** The command a key press means, or null. Letters by their key, the brackets and digits by their place on the keyboard. */
function commandOf(/** @type {KeyboardEvent} */ ev) {
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) return ev.key === 'ArrowUp' ? 'previous' : ev.key === 'ArrowDown' ? 'next' : null;
    if (!shortcutKey(ev)) return null;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (key === 'Enter') return 'send';
    // A German keyboard has / on Shift+7
    if (key === '/') return 'shortcuts';
    if (ev.shiftKey) return key === 'n' ? 'newGroup' : null;
    if (/^Digit[1-9]$/.test(ev.code)) return 'chat' + ev.code.slice(5);
    if (key === '[' || ev.code === 'BracketLeft') return 'back';
    if (key === ']' || ev.code === 'BracketRight') return 'forward';
    return { k: 'palette', n: 'newBot', f: 'search', i: 'composer', b: 'sidebar', ',': 'settings' }[key] || null;
}

/** A dialog or page over the chats; navigating behind it would surprise. The settings are a pane on wide screens. */
function dialogOpen() {
    return [...document.querySelectorAll('.overlay')].some((o) => !(/** @type {HTMLElement} */ (o).hidden) && o !== el.settings && o !== el.info && o !== el.palette && o !== el.shortcuts);
}

/** The keydown on the document: a shortcut runs its command and the browser does not see the key. */
export function onShortcutKey(/** @type {KeyboardEvent} */ ev) {
    if (ev.defaultPrevented || ev.isComposing || !state.signedIn) return;
    const command = commandOf(ev);
    if (!command) return;
    const anywhere = command === 'palette' || command === 'shortcuts';
    if (!anywhere && (!el.palette.hidden || dialogOpen())) return;
    if (runCommand(command)) ev.preventDefault();
}

/** The chats of the list from the top (favorites once, other accounts' rows not), for Ctrl+1 … 9 and Alt+arrows. */
function listedChats() {
    return [...el.chatList.querySelectorAll(':scope > li[data-chat]:not(.other-account)')].map((li) => /** @type {HTMLElement} */ (li).dataset.chat);
}

function stepList(step) {
    const ids = listedChats();
    if (!ids.length) return;
    const i = ids.indexOf(activePane().chatId);
    const next = ids[i < 0 ? (step > 0 ? 0 : ids.length - 1) : i + step];
    if (next) openChat(next);
}

/** Runs a command of a shortcut or of the desktop app's menu; false when it does nothing here (the key stays the browser's). */
export function runCommand(command) {
    const p = activePane();
    const n = /^chat([1-9])$/.exec(command);
    if (n) {
        const id = listedChats()[Number(n[1]) - 1];
        if (id) openChat(id);
        return true;
    }
    switch (command) {
        case 'palette':
            if (el.palette.hidden) openPalette();
            else closePalette();
            return true;
        case 'shortcuts':
            if (el.shortcuts.hidden) openShortcuts();
            else el.shortcuts.hidden = true;
            return true;
        case 'newBot': openEditor(null); return true;
        case 'newGroup': newGroup(); return true;
        case 'settings': openSettings(); return true;
        case 'search':
            if (p.chatId) { openChatSearch(p); return true; }
            if (el.app.classList.contains('sidebar-hidden')) return false;
            el.searchBox.classList.remove('closed');
            el.search.focus();
            return true;
        case 'composer':
            if (!p.chatId) return false;
            p.el.text.focus();
            return true;
        case 'send':
            if (!p.chatId) return false;
            sendMessage(p);
            return true;
        case 'sidebar':
            if (!toggleSidebar()) return false;
            paneActivated();
            return true;
        case 'back': stepVisited(-1); return true;
        case 'forward': stepVisited(1); return true;
        case 'previous': stepList(-1); return true;
        case 'next': stepList(1); return true;
    }
    return false;
}

/** The overview of the shortcuts; in a browser tab with the note on the keys the browser keeps. */
export function openShortcuts() {
    const rows = SHORTCUTS.flatMap((s) => {
        const keys = node('dt');
        s.keys.forEach((k, i) => {
            if (i) keys.append(' + ');
            keys.append(node('kbd', '', keyLabel(k)));
        });
        return [keys, node('dd', '', t(`shortcuts.${s.id}`))];
    });
    el.shortcutsList.replaceChildren(...rows);
    el.shortcutsNote.textContent = t('shortcuts.browserNote', { mod: keyLabel('mod'), shift: keyLabel('shift') });
    el.shortcutsNote.hidden = !browserOwnsKeys;
    el.shortcuts.hidden = false;
    /** @type {HTMLElement} */ (el.shortcuts.querySelector('[data-close]')).focus();
}
