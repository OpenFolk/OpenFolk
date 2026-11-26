/* OpenFolk web app: menus, git changes and dialogs. */
import { renderMissionsPage, showMissionList } from './missions.js';
import { locale, t, tn } from './i18n.js';
import { MIN_BACKEND_PROTOCOL, PROTOCOL_VERSION, el, node, state, toast } from './core.js';
import { activePane, capacity, layoutPanes, onSettingsGone, paneFor, settingsDialogDocked } from './panes.js';
import { bot, clockTime, conversation, conversationTitle, group, isConversation, isGroup, isPerson, modelOf, modelsOfChat, person, responsibleMachine, send, shortFolder, upper } from './e2e.js';
import { archivedOf, isBlocked, isFavorite, isMuted, toggleFavorite, toggleMuted, categoryOf, setCategory, sortedCategories } from './connection.js';
import { listTap, openChatSearch, renderChatList, rowMenu } from './list.js';
import { closeChat, openChat, paneActivated, renderChatHeader, renderHeaders } from './chat.js';
import { refreshMachinesPage, renderMachines, renderStatusBadge, wake } from './machines.js';
import { closeVscodeSession, openVscode } from './vscode.js';
import { flushEditor, moveBot, openEditor, openGroupEditor, openInfo } from './editors.js';
import { alertDialog, confirmDialog, dangerDialog } from './dialogs.js';
import { closePalette } from './palette.js';

// ================================================================ Menus

/** From this context size the menu recommends a new conversation (every message sends everything along). */
const CONTEXT_LARGE = 300000;

export function tokensShort(n) {
    return n >= 1e6 ? t('tokens.millions', { n: (n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : `${Math.max(1, Math.round(n / 1000))}k`;
}

// Menu icons: lines 24×24 like the other icons of the app (stroke in text color, see svg in chat.css)
export const ICONS = {
    moveTo: '<path d="M4 12h11m0 0l-4-4m4 4l-4 4"/><path d="M19 5v14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    conversation: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/><path d="M12 9v6M9 12h6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    starOff: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/><path d="M3 3l18 18"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    bellOff: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M3 3l18 18"/>',
    restart: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
    group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01"/>',
    reply: '<path d="M9 15l-5-5 5-5"/><path d="M4 10h10a6 6 0 0 1 6 6v4"/>',
    like: '<path d="M12 20.5s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.5c0 5.8-7.5 10.4-7.5 10.4z"/>',
    unlike: '<path d="M12 20.5s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.5c0 5.8-7.5 10.4-7.5 10.4z"/><path d="M3 3l18 18"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
    unpin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7M3 3l18 18"/>',
    speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    forward: '<path d="M15 5l5 5-5 5"/><path d="M20 10H10a6 6 0 0 0-6 6v4"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"/>',
};

/** Uniform menu entry: first the icon, then the label. */
export function menuButton(icon, text, cls) {
    const b = node('button', cls || '');
    b.type = 'button';
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon] || ''}</svg>`;
    b.appendChild(node('span', '', text));
    return b;
}

/**
 * The entries of a chat's menu as buttons with `data-action` (handled by chatMenuAction). `onPage`: for the bot's page
 * (info) and the group editor, which show the open changes and the archive themselves and are the info or the editor.
 */
export function chatMenuButtons(id, onPage = false) {
    const b = isGroup(id) ? null : bot(id);
    // Without an awake machine nobody answers a new conversation or the git list
    const asleep = Boolean(b) && !responsibleMachine(b);
    const fav = isFavorite(id) ? ['favorite', 'starOff', t('menu.unfavorite')] : ['favorite', 'star', t('menu.favorite')];
    // No notification for answers and routines of this chat; approvals and questions still come (every device)
    const mute = isMuted(id) ? ['mute', 'bell', t('menu.unmute')] : ['mute', 'bellOff', t('menu.mute')];
    const open = b ? gitOpenOf(b).length : 0;
    const git = ['git', 'git', open ? t('git.openChangesCount', { repos: repoCount(open) }) : t('git.openChanges'), '', asleep];
    const search = ['search', 'search', t('menu.searchChat')];
    const conversationNew = ['conversation_new', 'conversation', t('conversation.new'), '', asleep];
    // the main chat with its context into a conversation; the bot's machine holds the session
    const mainMove = ['main_to_conversation', 'moveTo', t('menu.mainToConversation'), '', asleep];
    const vscode = ['vscode', 'monitor', t('menu.vscode')];
    // The archived conversations of a bot behind one entry, which lists them in the menu's place
    const archive = b && !isConversation(id) && archivedOf(b).length ? [['archive', 'archive', t('menu.archiveCount', { n: archivedOf(b).length })]] : [];
    // "New session" is not among the entries: chatSwitches puts it below the context at the top
    const editBot = ['edit', 'pencil', t('menu.editBot')];
    // The bot's machine makes the copy (its folder is there); a bot of an admin's setup is not the account's to copy
    const duplicate = b && !b.managed ? [['duplicate', 'copy', t('menu.duplicateBot'), '', asleep]] : [];
    // The folder of the list the chat is in; conversations follow their bot, the group editor has a field of its own
    const cat = categoryOf(id);
    const catName = cat ? (state.categories.find((c) => c.id === cat) || {}).name : '';
    const folder = ['category', 'folder', catName ? t('menu.categoryIn', { name: catName }) : t('menu.category')];
    const entries = isPerson(id)
        ? [search, fav, mute, folder, isBlocked(id) ? ['person_block', 'block', t('people.unblock')] : ['person_block', 'block', t('people.block'), 'danger'],
            ['person_delete', 'delete', t('people.deleteChat'), 'danger']]
        : !b
        ? [search, ...(onPage ? [] : [['group', 'group', t('menu.editGroup')]]), fav, mute, ...(onPage ? [] : [folder]), ['group_delete', 'delete', t('menu.deleteGroup'), 'danger']]
        : isConversation(id)
            ? [conversationNew, ['rename', 'pencil', t('menu.renameConversation')], ...(onPage ? [] : [git]), search,
                ['main_chat', 'back', t('menu.mainChat', { name: b.name })], vscode, editBot,
                ['to_archive', 'archive', t('menu.toArchive')], ['conversation_delete', 'delete', t('menu.deletePermanently'), 'danger']]
            : onPage
                ? [conversationNew, mainMove, search, ...archive, vscode, editBot, ...duplicate, fav, mute, folder, ['delete', 'delete', t('menu.deleteBot'), 'danger']]
                : [conversationNew, mainMove, git, search, ...archive,
                    vscode, ['info', 'info', t('menu.info')], editBot, ...duplicate, fav, mute, folder, ['delete', 'delete', t('menu.deleteBot'), 'danger']];
    return entries.map(([action, icon, text, cls, disabled]) => {
        const k = menuButton(icon, text, cls);
        k.dataset.action = action;
        k.disabled = Boolean(disabled);
        if (action === 'conversation_new') k.title = t('conversation.explain');
        if (action === 'main_to_conversation') k.title = t('menu.mainToConversationExplain');
        return k;
    });
}

/**
 * Context size of the chat's session with "Clear context" in its line (groups: different per bot, so not shown), model
 * and machine switch. `picked`
 * runs after a choice: the menu closes, the bot's page shows the new state.
 */
export function chatSwitches(id, picked) {
    const b = isGroup(id) ? null : bot(id);
    const parts = [];
    const tokens = b ? state.context[id] : 0;
    if (tokens) {
        const info = node('div', 'menu-info' + (tokens >= CONTEXT_LARGE ? ' large' : ''));
        // "Clear context" in the line of the figure it clears, a chip like the model's (handled like the menu's entries)
        const line = node('div', 'context-line');
        const clear = node('button', 'chip context-clear', t('menu.clearContext'));
        clear.type = 'button';
        clear.dataset.action = 'restart';
        clear.title = t('menu.newSession');
        line.append(node('strong', '', t('menu.contextTokens', { tokens: tokens.toLocaleString(locale()) })), clear);
        info.append(line);
        if (tokens >= CONTEXT_LARGE) info.append(node('span', '', t('menu.contextLarge')));
        parts.push(info);
    }
    if (b) parts.push(modelSwitch(id, picked));
    const machineRow = machineSwitch(b, picked);
    if (machineRow) parts.push(machineRow);
    return parts;
}

/**
 * The menu of a chat on a long press or right click in the list: the switches, then the entries, led by "New
 * conversation" and "Move to a conversation" (chatMenuButtons puts them first).
 */
export function fillChatMenu(menu, id) {
    delete menu.dataset.view;
    menu.replaceChildren(...chatSwitches(id, () => { menu.hidden = true; }), ...chatMenuButtons(id));
}

// Model switch at the top of the chat menu: takes effect right away, the context stays (in the main chat for the bot,
// in a conversation only for it). Names and what is behind 'default' come from the CLI of the bot's machine (modelsOfChat);
// always the model that really runs is shown, never "Default".
const MODEL_SHORT = ['fable', 'opus', 'sonnet', 'haiku'];
// Other engines: in the switch by their name as soon as the machine offers them (login present)
const ENGINES = { codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot', antigravity: 'Antigravity', opencode: 'OpenCode' };

/** Short name that really runs ('default' → 'opus' as long as the CLI takes Opus as default). */
function actualModel(model, list = state.models) {
    const target = (list.find((m) => m.value === model) || {}).resolvedModel || model;
    const alias = list.find((m) => MODEL_SHORT.includes(m.value) && m.resolvedModel === target);
    return alias ? alias.value : model;
}

/**
 * A model's name without its version, as withoutVersion() in shared/protocol.ts: "Opus 5.5" → "Opus". The app names
 * models by family only (decision of the user, 2026-11-16).
 */
export function withoutVersion(name) {
    const short = name.replace(/[\s-]+v?\d+(?:[.-]\d+)*(?![\w.])/gi, '').replace(/\s{2,}/g, ' ').trim();
    return short || name;
}

/** Display name like modelDisplayName() in shared/protocol.ts, e.g. "Opus". */
export function modelDisplay(model, list = state.models) {
    const entry = list.find((m) => m.value === model);
    const target = entry ? entry.resolvedModel : model;
    const alias = list.find((m) => m.value !== 'default' && !ENGINES[m.value] && m.resolvedModel === target);
    const name = (alias || entry || {}).displayName;
    if (name) return withoutVersion(name);
    // list from the machine not there yet
    return model === 'default' ? t('model.default') : withoutVersion(model.charAt(0).toUpperCase() + model.slice(1));
}

function modelSwitch(chatId, picked) {
    const models = modelsOfChat(chatId);
    const current = actualModel(modelOf(chatId), models);
    const row = node('div', 'model-switch');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('model.label'));
    const values = models.length ? models.map((m) => m.value).filter((v) => MODEL_SHORT.includes(v) || ENGINES[v]) : MODEL_SHORT;
    if (!values.includes(current)) values.push(current);
    // Strongest on the left, weakest on the right (MODEL_SHORT's order), whatever order the machine lists them in; the
    // other engines and a pinned model after the Claude families
    const rank = (v) => (MODEL_SHORT.includes(v) ? MODEL_SHORT.indexOf(v) : ENGINES[v] ? MODEL_SHORT.length : MODEL_SHORT.length + 1);
    values.sort((a, b) => rank(a) - rank(b));
    // The default of an engine is named after the engine in the switch, not after the model behind it; a family by its
    // name, never with a version
    const label = (value) => ENGINES[value] || (MODEL_SHORT.includes(value) ? value.charAt(0).toUpperCase() + value.slice(1) : modelDisplay(value, models));
    const labels = values.map(label);
    for (const [i, value] of values.entries()) {
        // A pinned id from the editor that would read like a family's chip ("Opus") says that it is pinned
        const pinned = !MODEL_SHORT.includes(value) && !ENGINES[value];
        const text = pinned && labels.filter((x) => x === labels[i]).length > 1 ? t('model.pinned', { name: labels[i] }) : labels[i];
        const k = node('button', 'chip' + (value === current ? ' on' : ''), text);
        k.type = 'button';
        k.setAttribute('role', 'radio');
        k.setAttribute('aria-checked', String(value === current));
        k.addEventListener('click', (ev) => {
            ev.stopPropagation();
            chooseModel(chatId, value);
            picked();
        });
        row.appendChild(k);
    }
    return row;
}

function chooseModel(chatId, model) {
    const b = bot(chatId);
    if (!b || model === actualModel(modelOf(chatId), modelsOfChat(chatId))) return;
    // show right away; the bot list from the backend confirms it
    const c = conversation(chatId);
    if (c) c.model = model;
    else b.model = model;
    renderHeaders();
    renderChatList();
    send({ type: 'model', chatId, model }, responsibleMachine(b) || undefined);
}

// Machine switch below: active is the machine the bot lives on. A tap on another one opens the bot editor to move it
// there, because the bot needs a folder on that machine (chosen or cloned); a sleeping one is woken for that once
// the user confirms it.
// Applies to the whole bot including conversations; the Claude sessions follow it, the history is shared.
function machineSwitch(b, picked) {
    if (!b) return null;
    const st = state.machineStatus;
    const hosts = [...new Set([...state.online, ...(st ? Object.keys(st.hosts || {}) : []), ...(b.machine ? [b.machine] : [])])].sort();
    if (hosts.length < 2) return null;
    const current = b.machine || responsibleMachine(b);
    const row = node('div', 'model-switch machine-switch');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('machine.label'));
    for (const h of hosts) {
        const awake = state.online.includes(h);
        const k = node('button', 'chip' + (h === current ? ' on' : '') + (awake ? '' : ' sleeping'), upper(h) + (awake ? '' : ' · ' + t('machine.asleep')));
        k.type = 'button';
        k.setAttribute('role', 'radio');
        k.setAttribute('aria-checked', String(h === current));
        k.addEventListener('click', (ev) => {
            ev.stopPropagation();
            picked();
            chooseMachine(b, h);
        });
        row.appendChild(k);
    }
    return row;
}

function chooseMachine(b, host) {
    if (host === (b.machine || responsibleMachine(b))) return;
    // The sessions move along; a running job would be cut off
    const working = Object.entries(state.states).some(([cid, s]) => bot(cid) === b && (s === 'thinking' || s === 'waiting'));
    if (working) { void alertDialog(t('machine.moveBusy', { name: b.name })); return; }
    // Only an awake machine can check or clone the folder there: a sleeping one is woken, the move goes on once it is
    if (!state.online.includes(host) && !state.waking[host]) wake(host);
    moveBot(b, host);
}

/**
 * An entry of a chat's menu; the chat need not be open (long press in the list, the bot's page). The caller closes its
 * menu first; `show` puts follow-up content (archive, git changes) into it. False if a question was answered with no.
 * @returns {Promise<boolean>}
 */
export async function chatMenuAction(id, action, menu, show = (...k) => { menu.replaceChildren(...k); menu.hidden = false; }) {
    const p = paneFor(id);
    const b = bot(id);
    const g = group(id);
    if (action === 'favorite') toggleFavorite(id);
    if (action === 'category' && (b || g || isPerson(id))) {
        // continue in the same menu: the folders to choose from; on the bot's page the entries come back afterwards
        const done = () => { if (menu === el.infoActions) renderInfoChat(true); else menu.hidden = true; };
        show(node('div', 'menu-info', t('category.choose')), ...categoryButtons(id, done));
    }
    if (action === 'mute') toggleMuted(id);
    if (action === 'info' && b) openInfo(id);
    if (action === 'edit' && b) openEditor(b);
    if (action === 'duplicate' && b) duplicateBot(b);
    if (action === 'restart' && b) {
        if (!(await confirmDialog(t('menu.newSessionConfirm', { name: isConversation(id) ? conversationTitle(id) : b.name })))) return false;
        send({ type: 'restart', botId: b.id, chatId: id });
        // The context is gone with the session: show it right away, the machine's context frame confirms it
        state.context[id] = 0;
        renderHeaders();
    }
    if (action === 'delete' && b) {
        const folder = await askFolderDeletion(b);
        const option = folderOption(b, folder);
        if (!(await confirmDeleteBot(b, option))) return false;
        // With its folder only the bot's machine deletes it; it hands the deletion on to the others like any change
        if (option?.checked) send({ type: 'bot_delete', botId: b.id, deleteFolder: true }, responsibleMachine(b));
        else send({ type: 'bot_delete', botId: b.id });
        if (p) closeChat(p);
    }
    if (action === 'conversation_new' && b) send({ type: 'conversation_new', botId: b.id }, responsibleMachine(b) || undefined);
    if (action === 'main_to_conversation' && b) {
        if (!(await confirmDialog(t('menu.mainToConversationConfirm', { name: b.name })))) return false;
        send({ type: 'main_to_conversation', botId: b.id }, responsibleMachine(b) || undefined);
    }
    if (action === 'main_chat' && b) openChat(b.id, undefined, undefined, p || undefined);
    if (action === 'vscode' && b) openVscode(b.id, id);
    if (action === 'search') {
        if (!p) openChat(id);
        const pane = paneFor(id);
        if (pane) openChatSearch(pane);
    }
    if (action === 'rename' && b) renameConversation(id);
    if (action === 'to_archive' && b) archiveConversation(id, true);
    if (action === 'archive' && b) {
        if (menu !== el.infoActions) menu.hidden = true;
        openArchive(b);
    }
    if (action === 'git' && b) {
        if (window.innerWidth <= 760) openGitPage(b, Boolean(p));
        else showGitChanges(b, menu, show);
    }
    if (action === 'conversation_delete' && b) return await deleteConversation(id);
    if (action === 'person_delete' && isPerson(id)) {
        if (!(await confirmDialog(t('people.deleteChatConfirm', { name: person(id).name })))) return false;
        send({ type: 'person_chat_delete', account: id.slice(2) });
        if (p) closeChat(p);
    }
    if (action === 'person_block' && isPerson(id)) {
        const on = !isBlocked(id);
        if (on && !(await confirmDialog(t('people.blockConfirm', { name: person(id).name })))) return false;
        send({ type: 'person_block', account: id.slice(2), on });
    }
    if (action === 'group' && g) openGroupEditor(g);
    if (action === 'group_delete' && g) {
        if (!(await confirmDeleteGroup(g))) return false;
        send({ type: 'group_delete', groupId: g.id });
        if (p) closeChat(p);
    }
    return true;
}

// ================================================================ The bot's page (info)

/** What renderInfoChat last drew; the page is drawn anew only when that changes, so a tap never hits a replaced button. */
let infoShown = '';

/**
 * The upper part of the bot's page for its main chat or a conversation (state.infoChat): the conversation's title,
 * context, model and machine, the entries of the chat's menu (the archive behind one of them). The open changes below come from
 * showGitChanges when the page opens.
 */
export function renderInfoChat(force = false) {
    const id = state.infoChat;
    const b = id ? bot(id) : null;
    if (!b || el.info.hidden) return;
    const conv = isConversation(id) ? conversation(id) : null;
    const archived = conv ? [] : archivedOf(b);
    const key = JSON.stringify([id, locale(), conv && conv.title, modelOf(id), b.machine, responsibleMachine(b), state.online, state.machineStatus && Object.keys(state.machineStatus.hosts || {}),
        modelsOfChat(id).map((m) => m.value), state.context[id], isFavorite(id), isMuted(id), categoryOf(id), archived]);
    if (!force && key === infoShown) return;
    infoShown = key;
    const parts = chatSwitches(id, () => renderInfoChat());
    if (conv) {
        const head = node('div', 'menu-info');
        head.append(node('strong', '', conversationTitle(id)), node('span', '', t('info.conversation')));
        parts.unshift(head);
    }
    // The entries below the switches, "New conversation" and "Move to a conversation" at their top
    el.infoSwitches.replaceChildren(...parts);
    el.infoActions.replaceChildren(...chatMenuButtons(id, true));
}

/** The info covers the chat on the phone and as an overlay: whatever leads to the chat leaves it; docked it stays. */
export function leaveInfo() {
    if (!el.app.classList.contains('info-docked')) closeDialog(el.info);
}

/** An entry on the bot's page. */
export async function infoAction(action) {
    const id = state.infoChat;
    // the folders to choose from take the entries' place until one is picked
    if (action === 'category') { chatMenuAction(id, action, el.infoActions); return; }
    // the editor takes the place of the page in the side panel (editors.js); the page stays below it
    if (action === 'edit') {
        const b = bot(id);
        if (b) openEditor(b);
        return;
    }
    if (!(await chatMenuAction(id, action, el.infoActions)) || ['favorite', 'mute', 'rename', 'restart'].includes(action)) {
        renderInfoChat(true);
        return;
    }
    // the bot or the conversation is gone: its page too
    if (['delete', 'conversation_delete', 'to_archive'].includes(action)) closeDialog(el.info);
    else leaveInfo();
}

// ---------------------------------------------------------------- Folders of the chat list

/** The folders to choose from for a bot or group: a check on the current one, none, and a new one. */
export function categoryButtons(chatId, done) {
    const current = categoryOf(chatId);
    const entry = (icon, text, pick) => {
        const k = menuButton(icon, text);
        k.addEventListener('click', (ev) => { ev.stopPropagation(); pick(); done(); });
        return k;
    };
    return [
        entry(current ? 'folder' : 'check', t('category.none'), () => setCategory(chatId, '')),
        ...sortedCategories().map((c) => entry(c.id === current ? 'check' : 'folder', c.name, () => setCategory(chatId, c.id))),
        entry('add', t('category.createNew'), () => newCategory(chatId)),
    ];
}

/** A new folder by name ("+" menu, the chooser); the backend makes the id and answers with the list; `chatId` goes into it. */
export function newCategory(chatId) {
    askText({
        title: t('category.new'), hint: t('category.newHint'), maxLength: 40,
        done: (name) => send({ type: 'category_save', category: { id: '', name }, ...(chatId ? { chatId } : {}) }),
    });
}

/** A folder keeps its bots in place, or lets them move up while busy again (its menu); shown right away. */
export function toggleCategoryStay(id) {
    const c = state.categories.find((x) => x.id === id);
    if (!c) return;
    c.stay = !c.stay;
    // an older backend drops the field and sends the folder back without it: then the app says so (connection.js)
    state.categoryStayPending = { id, stay: c.stay, until: Date.now() + 15_000 };
    renderChatList();
    send({ type: 'category_save', category: { id, name: c.name, stay: c.stay } });
}

/** Rename (long press on the heading); shown right away, the backend confirms it. */
export function renameCategory(id) {
    const c = state.categories.find((x) => x.id === id);
    if (!c) return;
    askText({
        title: t('category.rename'), value: c.name, maxLength: 40,
        done: (name) => {
            c.name = name;
            renderChatList();
            send({ type: 'category_save', category: { id, name } });
        },
    });
}

/** Delete (long press on the heading); the bots and groups in it stay, without a folder. */
export async function deleteCategory(id) {
    const c = state.categories.find((x) => x.id === id);
    if (!c || !(await confirmDialog(t('category.deleteConfirm', { name: c.name })))) return;
    if (!state.categories.some((x) => x.id === id)) return;
    state.categories = state.categories.filter((x) => x.id !== id);
    for (const o of [...state.bots, ...state.groups]) if (o.category === id) delete o.category;
    renderChatList();
    send({ type: 'category_delete', categoryId: id });
}

/** A copy of the bot under a new name: its machine makes it and answers "bot_duplicated" (receiveDuplicated). */
function duplicateBot(b) {
    askText({
        title: t('menu.duplicateBot'), hint: t('menu.duplicateHint'), value: t('menu.duplicateName', { name: b.name }),
        submit: t('menu.duplicateSubmit'), maxLength: 60,
        done: (name) => send({ type: 'bot_duplicate', botId: b.id, name }, responsibleMachine(b) || undefined),
    });
}

/** The copy is there: its page opens, so it can be adjusted right away; paused routines are named. */
export function receiveDuplicated(f) {
    const copy = bot(f.id);
    if (!copy) return;
    openInfo(copy.id);
    const routines = state.routines.filter((r) => r.botId === copy.id).length;
    toast(routines ? tn('menu.duplicatedRoutines', routines, { name: copy.name }) : t('menu.duplicated', { name: copy.name }), 5000);
}

/** What the open text dialog does with the text once it is submitted. */
let textDone = null;

/**
 * One line of text instead of prompt(): a page on the phone, a dialog on the PC. The value is fully selected, typing
 * replaces it; `done` gets the trimmed text, never an empty one.
 * @param {{ title: string, hint?: string, value?: string, submit?: string, maxLength?: number, done: (text: string) => void }} o
 */
export function askText(o) {
    textDone = o.done;
    el.textTitle.textContent = o.title;
    el.textHint.textContent = o.hint || '';
    el.textHint.hidden = !o.hint;
    el.textSubmit.textContent = o.submit || t('common.save');
    if (o.maxLength) el.textInput.maxLength = o.maxLength;
    else el.textInput.removeAttribute('maxlength');
    el.textInput.value = o.value || '';
    el.textDialog.hidden = false;
    // focus within the same tap, otherwise iOS does not open the keyboard; select() alone selects nothing there
    el.textInput.focus();
    el.textInput.setSelectionRange(0, el.textInput.value.length);
}

export function submitText() {
    const text = el.textInput.value.trim();
    const done = textDone;
    textDone = null;
    el.textDialog.hidden = true;
    if (text && done) done(text);
}

/** Rename (chat menu, long press in the overview); shown right away, the backend confirms it. */
export function renameConversation(chatId) {
    const c = conversation(chatId);
    if (!bot(chatId) || !c) return;
    askText({
        title: t('menu.renameConversation'), value: c.title || '', maxLength: 60,
        done: (title) => {
            const b = bot(chatId);
            if (!b || title === c.title) return;
            c.title = title;
            const p = paneFor(chatId);
            if (p) renderChatHeader(p);
            listTap.active = false;
            renderChatList();
            send({ type: 'conversation_rename', chatId, title }, responsibleMachine(b) || undefined);
        },
    });
}

/** Into the archive (swipe to the left, chat menu) or back (archive in the bot's menu); brought back it opens. */
export function archiveConversation(chatId, on) {
    const b = bot(chatId);
    const c = conversation(chatId);
    if (!b || !c) return;
    // show right away; the bot list from the backend confirms it
    if (on) c.archived = new Date().toISOString();
    else delete c.archived;
    send({ type: 'conversation_archive', chatId, on }, responsibleMachine(b) || undefined);
    listTap.active = false;
    if (!on) openChat(chatId);
    else if (paneFor(chatId)) toMainChat(paneFor(chatId), b);
    else renderChatList();
}

/** A pane whose conversation goes away shows the bot's main chat instead, or closes if another pane has it. */
function toMainChat(p, b) {
    if (paneFor(b.id)) closeChat(p);
    else openChat(b.id, undefined, undefined, p);
}

/** The page with a bot's archived conversations; a tap brings one back and opens it. */
export function openArchive(b) {
    el.archiveSub.textContent = `${b.name} · ${shortFolder(b.folder)}`;
    el.archiveList.replaceChildren(...archiveButtons(b, () => closeDialog(el.archive)));
    el.archive.hidden = false;
}

/** Buttons of a bot's archived conversations (title and date); a tap brings them back. */
export function archiveButtons(b, close) {
    return archivedOf(b).map((cid) => {
        const k = menuButton('archive', conversationTitle(cid));
        k.querySelector('span').appendChild(node('small', 'archive-date', ' · ' + new Date(conversation(cid).archived).toLocaleDateString(locale())));
        k.addEventListener('click', (ev) => {
            ev.stopPropagation();
            close();
            archiveConversation(cid, false);
        });
        return k;
    });
}

// Open changes: uncommitted files of the git repos in the bot's folder, according to the machine it runs on.
// The list appears in the same menu (chat menu or long press); the answer comes later, `show` puts it in.
// Per repo a button commits and pushes everything (without open files only push); `busy` is "bot id:path" of the repo at work.
// botId '*' is the total list from git_status: the open repos of all bots, without a request of its own.
const gitView = { botId: null, menu: null, show: null, repos: [], busy: null, message: null, all: null };

export function showGitChanges(b, menu, show) {
    const r = responsibleMachine(b);
    Object.assign(gitView, { botId: b.id, menu, show, repos: [], busy: gitView.all ? gitView.busy : null, message: null });
    gitShow(node('div', 'menu-info', r ? t('git.loading') : t('bot.sleepsNoMachine', { name: b.name }) + '.'));
    if (r) send({ type: 'git_changes', botId: b.id }, r);
}

/** The list fills a page (the git page, the section on the bot's page) instead of a menu: no close button, with the hints. */
const gitOnPage = () => gitView.menu === el.gitPage || gitView.menu === el.infoGit;

/** Put into the menu and mark it as git list (the long-press menu removes the mark on every render). */
function gitShow(...parts) {
    if (gitOnPage()) {
        gitView.show(...parts);
        gitView.menu.dataset.view = 'git';
        return;
    }
    const close = node('button', 'git-close');
    close.type = 'button';
    close.title = t('common.close');
    close.setAttribute('aria-label', t('common.close'));
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        gitView.menu.hidden = true;
    });
    gitView.show(close, ...parts);
    gitView.menu.dataset.view = 'git';
}

/** Take over an answer or error only as long as the menu still shows this list. */
function gitViewOpen(botId) {
    const m = gitView.menu;
    return m && !m.hidden && !(m === el.infoGit && el.info.hidden) && m.dataset.view === 'git' && (!botId || gitView.botId === botId);
}

const GIT_STATUS = { M: 'git.status.modified', A: 'git.status.added', D: 'git.status.deleted', R: 'git.status.renamed', C: 'git.status.copied', U: 'git.status.untracked', T: 'git.status.typeChanged' };

export function receiveGitChanges(f) {
    if (!gitViewOpen(f.botId)) return;
    gitView.repos = f.repos;
    renderGitList();
}

function renderGitList() {
    const total = gitView.botId === '*';
    const b = total ? null : bot(gitView.botId);
    const all = total ? gitOpenAll() : gitView.repos;
    const open = all.filter(gitIsOpen);
    if (!total) open.sort((x, y) => (x.path === '' ? -1 : y.path === '' ? 1 : x.name.localeCompare(y.name)));
    const clean = all.length - open.length;
    const head = node('div', 'menu-info');
    // on the page of its own the title is in the header bar
    if (!gitOnPage()) head.append(node('strong', '', `${t('git.openChanges')} · ${total ? t('git.allBots') : b ? b.name : gitView.botId}`));
    const bots = new Set(open.map((r) => r.botId)).size;
    head.append(node('span', '', total ? (open.length ? t('git.reposAtBots', { repos: repoCount(open.length), bots: tn('list.bots', bots) }) : t('git.allClean'))
        : !all.length ? t('git.noRepo')
            : !open.length ? t('git.allCleanCount', { repos: repoCount(all.length) })
                : t('git.openOf', { n: open.length, total: all.length }) + (clean ? ', ' + t('git.cleanCount', { n: clean }) : '')));
    if (gitView.message) head.append(node('span', 'git-message' + (gitView.message.ok ? ' ok' : ' error'), gitView.message.text));
    const doable = open.map((r) => ({ b: total ? bot(r.botId) : b, r })).filter(({ b: rb, r }) => rb && (r.files.length || r.ahead) && !r.error);
    if (doable.length > 1 || gitView.all) head.append(gitAllButton(doable));
    const inRows = restartInRows(open.map((r) => ({ b: total ? bot(r.botId) : b, r })));
    // restart hints only on the page of its own: all machines, for one bot its machine
    const hints = gitOnPage() ? backendHints(total ? null : (b && responsibleMachine(b)) || '-', inRows) : [];
    const list = node('div', 'git-list');
    // tapping into the list does not close the menu
    list.addEventListener('click', (ev) => ev.stopPropagation());
    for (const r of open) {
        const rb = total ? bot(r.botId) : b;
        const repo = node('div', 'git-repo');
        repo.append(node('strong', '', r.name));
        const where = total && rb && state.online.length > 1 ? responsibleMachine(rb) : null;
        const meta = [total && rb ? rb.name + (where ? ` (${upper(where)})` : '') : '', r.branch, r.ahead ? t('git.notPushed', { n: r.ahead }) : '', r.behind ? t('git.notPulled', { n: r.behind }) : '',
            r.since ? t('git.since', { time: clockTime(r.since) }) : '']
            .filter(Boolean).join(' · ');
        if (meta) repo.append(node('span', 'git-meta', meta));
        if (r.files.length || r.ahead) repo.append(gitButton(rb, r));
        else if (r.behind && !r.error) repo.append(pullButton(rb, r));
        const m = r.backend && rb && responsibleMachine(rb);
        if (m && inRows.has(m) && outdatedBackends().includes(m)) repo.append(Object.assign(restartButton(m), { className: 'git-button git-restart' }));
        list.appendChild(repo);
        if (r.error) list.appendChild(node('div', 'git-file git-error', r.error));
        for (const d of r.files) {
            const code = d.status === '??' ? 'U' : /U|AA|DD/.test(d.status) ? '!' : (d.status[0] !== ' ' ? d.status[0] : d.status[1]);
            const z = node('div', 'git-file');
            const mark = node('span', `git-code git-${code === '!' ? 'conflict' : code}`, code);
            mark.title = code === '!' ? t('git.status.conflict') : GIT_STATUS[code] ? t(GIT_STATUS[code]) : d.status;
            z.append(mark, node('span', 'git-path', d.path));
            list.appendChild(z);
        }
        if (r.more) list.appendChild(node('div', 'git-file git-meta', t('git.andMore', { n: r.more })));
    }
    gitShow(head, ...hints, ...(open.length ? [list] : []));
}

/** "Commit & push" (asks for the message, suggested from the file names) or "Push" (asks to confirm). */
function gitButton(b, r) {
    const key = `${b ? b.id : ''}:${r.path}`;
    const k = node('button', 'git-button', gitView.busy === key ? t('tools.running') : r.files.length ? t('git.commitPush') : t('git.push'));
    k.type = 'button';
    k.disabled = gitView.busy !== null || !b || !responsibleMachine(b);
    const run = (message) => {
        gitView.busy = key;
        gitView.message = null;
        renderGitList();
        send({ type: 'git_commit', botId: b.id, path: r.path, message }, responsibleMachine(b));
    };
    k.addEventListener('click', () => {
        if (r.files.length) {
            askText({ title: r.name, hint: tn('git.commitPrompt', r.files.length + r.more, { repo: r.name }), value: gitSuggestion(r), submit: t('git.commitPush'), done: run });
        } else {
            void confirmDialog(t('git.pushConfirm', { commits: tn('git.commits', r.ahead), repo: r.name })).then((yes) => { if (yes) run(''); });
        }
    });
    return k;
}

/** "Pull": fetch and fast-forward on the bot's machine; the backend refuses whatever would need a merge and says why. */
function pullButton(b, r) {
    const key = `${b ? b.id : ''}:${r.path}`;
    const k = node('button', 'git-button', gitView.busy === key ? t('tools.running') : t('git.pull'));
    k.type = 'button';
    k.disabled = gitView.busy !== null || !b || !responsibleMachine(b);
    k.addEventListener('click', () => {
        gitView.busy = key;
        gitView.message = null;
        renderGitList();
        send({ type: 'git_pull', botId: b.id, path: r.path }, responsibleMachine(b));
    });
    return k;
}

/** Commit message from the file names, e.g. "Update a.ts, b.md and 3 more". */
function gitSuggestion(r) {
    const count = r.files.length + r.more;
    const names = r.files.map((d) => d.path.replace(/\/$/, '').split('/').pop());
    return t(count > 3 ? 'git.suggestionMore' : 'git.suggestion', { files: names.slice(0, 3).join(', '), n: count - 3 });
}

/**
 * "Commit & push all": after asking, one repo after the other, messages from the file names. Repos with an
 * error stay out. `gitView.all` holds the remaining jobs and the results until all are through.
 */
function gitAllButton(doable) {
    const a = gitView.all;
    const k = node('button', 'git-button git-all', a ? t('git.allRunning', { n: a.done.length + 1, total: a.total }) : t('git.commitPushAll', { n: doable.length }));
    k.type = 'button';
    k.disabled = !!a || gitView.busy !== null || doable.some(({ b }) => !responsibleMachine(b));
    k.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const files = doable.reduce((n, { r }) => n + r.files.length + r.more, 0);
        if (!(await confirmDialog(t(files ? 'git.allConfirmFiles' : 'git.allConfirm', { repos: repoCount(doable.length), files: tn('git.files', files) })))) return;
        gitView.all = {
            total: doable.length, done: [],
            rest: doable.map(({ b, r }) => ({ botId: b.id, path: r.path, name: r.name, message: r.files.length ? gitSuggestion(r) : '' })),
        };
        gitView.message = null;
        gitAllNext();
    });
    return k;
}

/** Next repo in line to its machine; at the end one message with all errors. */
function gitAllNext() {
    const a = gitView.all;
    const n = a.rest.shift();
    const b = n && bot(n.botId);
    if (n && !(b && responsibleMachine(b))) {
        a.done.push({ ok: false, message: t('git.machineAsleep', { repo: n.name }) });
        return gitAllNext();
    }
    if (!n) {
        const errors = a.done.filter((e) => !e.ok);
        gitView.all = null;
        gitView.busy = null;
        gitView.message = { ok: !errors.length, text: t('git.pushedOf', { n: a.done.length - errors.length, repos: repoCount(a.total) }) + (errors.length ? ' ' + errors.map((e) => e.message).join(' · ') : '') };
        if (gitViewOpen(gitView.botId)) renderGitList();
        else if (errors.length) void alertDialog(gitView.message.text);
        return;
    }
    a.current = n;
    gitView.busy = `${n.botId}:${n.path}`;
    if (gitViewOpen(gitView.botId)) renderGitList();
    send({ type: 'git_commit', botId: n.botId, path: n.path, message: n.message }, responsibleMachine(b));
}

export function receiveGitCommit(f) {
    const a = gitView.all;
    if (a && a.current && a.current.botId === f.botId && a.current.path === f.path) {
        a.done.push({ ok: f.ok, message: f.message });
        gitAllNext();
        return;
    }
    if (gitView.botId !== f.botId && gitView.botId !== '*') return;
    gitView.busy = null;
    gitView.message = { ok: f.ok, text: f.message };
    // menu already closed: still show an error; the new list follows right after
    if (gitViewOpen(gitView.botId)) renderGitList();
    else if (!f.ok) void alertDialog(f.message);
}

const repoCount = (n) => tn('git.repos', n);
const gitIsOpen = (r) => r.files.length || r.more || r.ahead || r.behind || r.error;

/** Open repos of a bot according to the machine it runs on. */
export function gitOpenOf(b) {
    const r = responsibleMachine(b);
    return ((r && state.gitPerMachine[r] && state.gitPerMachine[r][b.id]) || []).filter(gitIsOpen);
}

/** Open repos of all bots, each with `botId`, in the order of the bots. */
function gitOpenAll() {
    return state.bots.flatMap((b) => gitOpenOf(b).map((r) => Object.assign({ botId: b.id }, r)));
}

export function receiveGitStatus(f) {
    state.gitPerMachine[f.machine || '?'] = f.status || {};
    renderChatList();
    // the headers show the open changes of their bot too
    renderHeaders();
    renderGitTotal();
    refreshMachinesPage();
}

/** What the open changes add to the status tab's badge (machines.js renderStatusBadge). */
export const reposBadge = { count: 0, hint: false, title: '' };

/**
 * The open changes on the tab "Status": the number of repos with open changes for its badge, "!" when there are only
 * hints (versions, restart, push access); the summary is its title. Keeps an open total list current.
 */
export function renderGitTotal() {
    const open = gitOpenAll();
    const inRows = restartInRows(open.map((r) => ({ b: bot(r.botId), r })));
    const old = outdatedBackends().filter((m) => !inRows.has(m));
    const mismatch = protocolMismatches();
    const noPush = pushGaps();
    const parts = [
        mismatch.length ? t('protocol.notice', { machines: mismatch.map((m) => upper(m.machine)).join(', ') }) : '',
        open.length ? tn('git.reposWithChanges', open.length) : '',
        old.length ? t('backend.restartNeeded', { machines: old.map(upper).join(', ') }) : '',
        noPush.length ? t('git.noPushNotice', { machines: [...new Set(noPush.map((g) => upper(g.machine)))].join(', ') }) : '',
    ].filter(Boolean);
    const hints = mismatch.length || outdatedBackends().length || noPush.length;
    Object.assign(reposBadge, { count: open.length, hint: Boolean(hints), title: parts.join(' · ') });
    renderStatusBadge();
    if (gitViewOpen()) renderGitList();
}

/**
 * Machines awake whose backend does not fit this web app: 'app' = the app is too old for the backend, 'backend' = the
 * backend is too old for the app. Backends from before the version report none (0).
 */
export function protocolMismatches() {
    const result = [];
    for (const r of Object.keys(state.backendPerMachine).filter((m) => state.online.includes(m)).sort()) {
        const st = state.backendPerMachine[r];
        if (PROTOCOL_VERSION < (st.minClientProtocol || 0)) result.push({ machine: r, side: 'app' });
        else if ((st.protocol || 0) < MIN_BACKEND_PROTOCOL) result.push({ machine: r, side: 'backend' });
    }
    return result;
}

/** Git hosts the bots of a machine awake push to, without credentials on that machine (setup_status). */
function pushGaps() {
    return state.online.filter((m) => state.setupPerMachine[m]?.push).sort()
        .flatMap((m) => state.setupPerMachine[m].push.map((g) => ({ machine: m, host: g.host, bots: g.bots })));
}

/** Machines awake whose backend runs with old code (files changed since the start). */
function outdatedBackends() {
    return Object.keys(state.backendPerMachine).filter((r) => state.online.includes(r) && (state.backendPerMachine[r].changed || []).length).sort();
}

/** Machines whose backend runs from one of these open repos (each with its bot): the restart button goes into that row. */
function restartInRows(rows) {
    return new Set(rows.filter(({ b, r }) => r.backend && b).map(({ b }) => responsibleMachine(b)).filter(Boolean));
}

/** Gentle restart of a machine's backend; waits until no bot is working. */
function restartButton(machine) {
    const st = state.backendPerMachine[machine];
    const k = node('button', 'git-button', st.requested ? t('backend.waiting') : t('backend.restart'));
    k.type = 'button';
    k.disabled = !!st.requested;
    const names = st.changed.map((d) => d.split('/').pop());
    k.title = st.requested ? t('backend.requested', { time: clockTime(st.requested.since) })
        : t('backend.runningSince', { time: clockTime(st.since), files: names.slice(0, 4).join(', ') + (names.length > 4 ? ' ' + t('common.andMore', { n: names.length - 4 }) : '') });
    k.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!(await confirmDialog(t('backend.restartConfirm', { machine: upper(machine) })))) return;
        send({ type: 'backend_restart' }, machine);
    });
    return k;
}

/**
 * Hint per outdated backend above the repos, with a button for the gentle restart; `only`: only this machine.
 * Machines in `inRows` get no hint, their button sits in the row of the backend's repo.
 */
function backendHints(only, inRows = new Set()) {
    const versions = protocolMismatches().filter((m) => !only || m.machine === only).map((m) => {
        const box = node('div', 'backend-hint');
        const text = node('div', 'backend-text');
        text.append(
            node('strong', '', t(m.side === 'app' ? 'protocol.appTooOld' : 'protocol.backendTooOld', { machine: upper(m.machine) })),
            node('span', '', t(m.side === 'app' ? 'protocol.updateApp' : 'protocol.updateBackend')),
        );
        box.append(text);
        return box;
    });
    const noPush = pushGaps().filter((g) => !only || g.machine === only).map((g) => {
        const box = node('div', 'backend-hint');
        const text = node('div', 'backend-text');
        const names = g.bots.map((id) => bot(id)?.name || id).join(', ');
        const container = state.setupPerMachine[g.machine]?.container;
        text.append(
            node('strong', '', t('git.noPushTitle', { machine: upper(g.machine), host: g.host })),
            node('span', '', t(container ? 'git.noPushContainer' : 'git.noPushText', { machine: upper(g.machine), host: g.host, bots: names })),
        );
        box.append(text);
        return box;
    });
    return versions.concat(noPush, outdatedBackends().filter((r) => (!only || r === only) && !inRows.has(r)).map((r) => {
        const st = state.backendPerMachine[r];
        const box = node('div', 'backend-hint');
        const text = node('div', 'backend-text');
        text.append(node('strong', '', t('backend.restartTitle', { machine: upper(r) })));
        const names = st.changed.map((d) => d.split('/').pop());
        text.append(node('span', '', t('backend.runningSince', { time: clockTime(st.since), files: names.slice(0, 4).join(', ') + (names.length > 4 ? ' ' + t('common.andMore', { n: names.length - 4 }) : '') })));
        if (st.requested) text.append(node('span', 'backend-waiting', t('backend.requested', { time: clockTime(st.requested.since) })));
        box.append(text, restartButton(r));
        return box;
    }));
}

let gitFromChat = false;

/** Whether "back" from the git page returns to the chat instead of the list (phone). */
export const gitPageFromChat = () => gitFromChat && !el.gitPage.hidden;

/**
 * Page of its own over the panes: all bots (without `b`) or one bot; back at the top left or swipe to the right.
 * The panes stay as they are underneath; "Back" shows them again on the PC, on the phone the list (or the chat the
 * page was opened from).
 */
export function openGitPage(b, fromChat = false) {
    // all bots' open changes are part of the status page
    if (!b) return openMachinesPage();
    showPage('bot', fromChat);
    el.gitSub.textContent = b ? b.name : t('git.allBots');
    const show = (...parts) => el.gitPageContent.replaceChildren(...parts);
    showGitChanges(b, el.gitPage, show);
}

/**
 * The tab "Status": the machines with waking and shutting down, the open changes of all bots' repos, the plans' quota
 * and the engines' versions.
 */
export function openMachinesPage() {
    showPage('machines', false);
    el.gitSub.textContent = '';
    renderMachines();
    const show = (...parts) => el.statusRepos.replaceChildren(...parts);
    Object.assign(gitView, { botId: '*', menu: el.gitPage, show, repos: [], busy: gitView.all ? gitView.busy : null, message: null });
    el.gitPage.dataset.view = 'git';
    renderGitList();
}

/** The tab "Missions": the overview of the missions, from there one mission or the builder (missions.js). */
export function openMissionsPage() {
    // First: showPage draws the page (renderPageTitle), which must know whether a builder is resumed
    showMissionList();
    showPage('missions', false);
}

/** The page frame over the panes, with the repos of one bot, the status (machines and all repos) or the missions. */
function showPage(page, fromChat) {
    gitFromChat = fromChat;
    rowMenu.hidden = true;
    el.settings.hidden = true;
    el.gitPage.hidden = false;
    el.gitPage.dataset.page = page;
    // a git answer arriving later must not fill the page while it shows the machines
    if (page === 'missions') delete el.gitPage.dataset.view;
    el.gitPageContent.hidden = page === 'machines' || page === 'missions';
    el.machinesPage.hidden = page !== 'machines';
    el.missionsPage.hidden = page !== 'missions';
    renderPageTitle();
    layoutPanes();
}

/** The page's title, also after a change of language. */
export function renderPageTitle() {
    if (el.gitPage.dataset.page === 'missions') return renderMissionsPage();
    el.gitTitle.textContent = t(el.gitPage.dataset.page === 'machines' ? 'tabs.status' : 'git.openChanges');
}

export function closeGitPage() {
    el.gitPage.hidden = true;
    delete el.gitPage.dataset.view;
    if (window.innerWidth <= 760 && activePane().chatId && !gitFromChat) closeChat();
    else paneActivated();
}

export function gitError(message) {
    if (gitView.all && gitView.all.current) {
        gitView.all.done.push({ ok: false, message: `${gitView.all.current.name}: ${message}` });
        gitAllNext();
        return;
    }
    gitView.busy = null;
    if (gitViewOpen()) gitShow(node('div', 'menu-info', message));
}

/**
 * The questions before something is deleted for good. Only what this page knows is listed; the backend decides what
 * goes. A bot's working folder is not deleted. A bot or group is confirmed by typing its name; one conversation is a
 * smaller loss, and its title is often just "New conversation", so there the button is enough.
 */
function confirmDeleteBot(b, option) {
    const items = [t('danger.history')];
    const conversations = (b.conversations || []).length;
    const routines = state.routines.filter((r) => r.botId === b.id).length;
    const groups = state.groups.filter((g) => g.members.includes(b.id)).length;
    if (conversations) items.push(tn('danger.conversations', conversations));
    if (routines) items.push(tn('danger.routines', routines));
    if (groups) items.push(tn('danger.groups', groups));
    const notes = b.folder && !option ? [t('danger.botFolder', { folder: b.folder })] : [];
    return dangerDialog({ title: t('danger.botTitle', { name: b.name }), items, notes, name: b.name, action: t('menu.deleteBot'), ...(option ? { option } : {}) });
}

/** The answer of the bot's machine to "folder_delete_check" while the delete dialog waits for it. */
let folderAsk = null;

/**
 * Whether the bot's machine lets its working folder go with it: the answer, or null when that machine is asleep or
 * too old to know the question (then the folder stays, as before).
 */
function askFolderDeletion(b) {
    const machine = responsibleMachine(b);
    if (!b.folder || !machine || !state.online.includes(machine)) return Promise.resolve(null);
    if (folderAsk) folderAsk.resolve(null);
    return new Promise((resolve) => {
        const timer = setTimeout(() => answerFolderAsk(b.id, null), 5000);
        folderAsk = { botId: b.id, resolve: (r) => { clearTimeout(timer); folderAsk = null; resolve(r); } };
        send({ type: 'folder_delete_check', botId: b.id }, machine);
    });
}

/**
 * connection.js: "folder_delete_checked", or null for an error (a backend before the question); an error names no
 * bot (`botId` null) and answers whichever question waits.
 */
export function answerFolderAsk(botId, f) {
    if (folderAsk && (botId === null || folderAsk.botId === botId)) folderAsk.resolve(f);
}

/** The box "Also delete the working folder" of the delete dialog; ticked off with the reason when the folder stays. */
function folderOption(b, f) {
    if (!f) return null;
    const folder = f.folder || b.folder;
    return f.ok ? { label: t('danger.botFolderDelete', { folder }), hint: t('danger.botFolderDeleteHint') } : { label: t('danger.botFolderDelete', { folder }), hint: f.message, disabled: true };
}

function confirmDeleteGroup(g) {
    return dangerDialog({ title: t('danger.groupTitle', { name: g.name }), items: [t('danger.history')], notes: [t('danger.groupBots')], name: g.name, action: t('menu.deleteGroup') });
}

function confirmDeleteConversation(chatId) {
    return dangerDialog({ title: t('danger.conversationTitle', { title: conversationTitle(chatId) }), items: [t('danger.history')], notes: [t('danger.archiveKeeps')], action: t('danger.deleteConversation') });
}

/** Delete permanently after asking (chat menu); if it was open, go to the main chat. */
async function deleteConversation(chatId) {
    const b = bot(chatId);
    if (!b || !(await confirmDeleteConversation(chatId))) return false;
    send({ type: 'conversation_delete', chatId }, responsibleMachine(b) || undefined);
    const p = paneFor(chatId);
    if (p) toMainChat(p, b);
    return true;
}

export function closeAllMenus() {
    el.newMenu.hidden = true;
    el.accountMenu.hidden = true;
    for (const m of document.querySelectorAll('.header-menu')) /** @type {HTMLElement} */ (m).hidden = true;
}

/**
 * A tap on the model or machine badge in a chat's header: the switch right below it, as in the chat's menu. A
 * second tap closes it. The machine switch moves the bot (the small move dialog); with only one machine known it says
 * so instead.
 * @param {import('./panes.js').Pane} p
 * @param {'model' | 'machine'} kind
 */
export function toggleHeaderSwitch(p, kind) {
    const menu = p.el.headerMenu;
    const open = !menu.hidden && menu.dataset.kind === kind;
    closeAllMenus();
    const b = bot(p.chatId);
    if (open || !b) return;
    const close = () => { menu.hidden = true; };
    const part = kind === 'model' ? modelSwitch(p.chatId, close) : machineSwitch(b, close);
    menu.replaceChildren(part || node('div', 'menu-info', t('header.oneMachine')));
    menu.dataset.kind = kind;
    menu.hidden = false;
}

// ================================================================ Dialogs

/** Closes a dialog right away, changes or not; true, for callers that go on afterwards. */
/** What the settings dialog holds right now and where it came from. @type {{ content: HTMLElement, parent: HTMLElement, next: Node | null } | null} */
let settingsDialogHome = null;
/** Where the settings dialog lives as an overlay; next to the settings pane it stands in the panes. */
const settingsDialogParent = /** @type {HTMLElement} */ (el.settingsDialog.parentElement);
onSettingsGone(() => closeSettingsDialog());

/**
 * Adding something in the settings: `content` (a form or a result box of a block) moves into the small dialog and
 * shows there; closing hides it and puts it back. With the settings as a pane and room for two, the dialog is the
 * pane next to them, otherwise over them. `ownActions`: the content brings its own buttons, no "Close" row.
 * @param {string} title
 * @param {HTMLElement} content
 */
export function openSettingsDialog(title, content, ownActions = false) {
    if (settingsDialogHome && settingsDialogHome.content !== content) closeSettingsDialog();
    if (!settingsDialogHome) settingsDialogHome = { content, parent: /** @type {HTMLElement} */ (content.parentElement), next: content.nextSibling };
    el.settingsDialogTitle.textContent = title;
    el.settingsDialogBody.replaceChildren(content);
    content.hidden = false;
    el.settingsDialogActions.hidden = ownActions;
    // Next to the settings only where two columns fit
    const docked = !el.settings.hidden && el.settings.parentElement === el.panes && capacity() >= 2;
    if (docked && el.settings.nextElementSibling !== el.settingsDialog) el.settings.after(el.settingsDialog);
    if (!docked && el.settingsDialog.parentElement !== settingsDialogParent) settingsDialogParent.appendChild(el.settingsDialog);
    el.settingsDialog.classList.toggle('docked', docked);
    el.settingsDialog.hidden = false;
    if (docked) layoutPanes();
}

/** Closes the settings dialog, with `content` only if that is what it holds. @param {HTMLElement} [content] */
export function closeSettingsDialog(content) {
    const home = settingsDialogHome;
    if (!home || (content && home.content !== content)) return;
    settingsDialogHome = null;
    home.content.hidden = true;
    home.parent.insertBefore(home.content, home.next);
    el.settingsDialog.hidden = true;
    if (settingsDialogDocked()) {
        settingsDialogParent.appendChild(el.settingsDialog);
        el.settingsDialog.classList.remove('docked');
        layoutPanes();
    }
}

export function closeDialog(o) {
    if (o === el.settingsDialog) { closeSettingsDialog(); return true; }
    if (o === el.palette) { closePalette(); return true; }
    // a change of the bot editor still in its pause is saved before it goes
    if (o === el.editor && !o.hidden) flushEditor();
    o.hidden = true;
    if (o === el.info) { state.infoBot = null; state.infoChat = null; infoShown = ''; layoutPanes(); }
    if (o === el.settings) layoutPanes();
    if (o === el.kEditor) state.knowledgeWaiting = false;
    if (o === el.vscode) closeVscodeSession();
    return true;
}
