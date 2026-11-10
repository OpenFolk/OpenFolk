/* OpenFolk web app: VS Code sessions. */
import { t } from './i18n.js';
import { el, md, node, state } from './core.js';
import { codeBlocks } from './code-blocks.js';
import { paneFor } from './panes.js';
import { bot, clockTime, fileSize, responsibleMachine, send, shortFolder, upper } from './e2e.js';
import { renderTools, showEvent, toolRow } from './queue.js';
import { alertDialog, confirmDialog } from './dialogs.js';

// ================================================================ VS Code sessions
// Sessions that run on the machine in VS Code (or in the terminal): list per machine, history to watch along
// (the backend reports new lines while the view is open) and "Continue here" as a branch. From a bot's page the
// list holds its folder; from the "+" menu (botId null) every folder of the machines.
export const vs = { botId: null, chatId: null, lists: {}, machine: null, session: null, base: 0, entries: [], working: false, adopting: false };

/** The engine of a session for open and adopt: only Codex is named, Claude is what older backends know. */
function engineOf(s) {
    return s && s.engine === 'codex' ? { engine: 'codex' } : {};
}

/** The fields of a request that say whose sessions: the bot's folder, or nothing for the whole machine. */
function scope() {
    return vs.botId ? { botId: vs.botId } : {};
}

/**
 * `botId` null: the sessions of every folder; `chatId`: the chat the list was opened from, which the list offers to
 * open in VS Code.
 */
export function openVscode(botId, chatId = botId) {
    closeVscodeSession();
    vs.botId = botId;
    vs.chatId = chatId;
    vs.lists = {};
    el.vscode.hidden = false;
    showVscodeList();
}

export function showVscodeList() {
    closeVscodeSession();
    const b = bot(vs.botId);
    el.vsTitle.textContent = t('vscode.title');
    el.vsSub.textContent = b ? `${b.name} · ${shortFolder(b.folder)}` : vs.botId ? '' : t('vscode.allFolders');
    el.vsBack.hidden = true;
    el.vsHistory.hidden = true;
    el.vsFooter.hidden = true;
    el.vsError.hidden = true;
    el.vsList.hidden = false;
    renderHandoverButtons();
    for (const r of state.online) send({ type: 'vscode_sessions', ...scope() }, r);
    renderVscodeList();
}

/** After reconnecting the browser is new to the backends: the list again, or watching registered again. */
export function vscodeReconnected(online) {
    if (el.vscode.hidden) return;
    if (!vs.session) { showVscodeList(); return; }
    if (online.includes(vs.machine)) send({ type: 'vscode_open', ...scope(), ...engineOf(vs.session), sessionId: vs.session.id, folder: vs.session.folder }, vs.machine);
    renderVscodeAdoptButton();
}

export function receiveVscodeSessions(f) {
    if ((f.botId || null) !== vs.botId) return;
    vs.lists[f.machine || '?'] = f.sessions;
    if (!vs.session) renderVscodeList();
}

function renderVscodeList() {
    el.vsList.innerHTML = '';
    if (!state.online.length) {
        el.vsList.appendChild(node('li', 'empty-small', t('vscode.noMachine')));
        return;
    }
    const several = state.online.length > 1;
    let any = false;
    for (const r of [...state.online].sort()) {
        const list = vs.lists[r];
        if (several) el.vsList.appendChild(node('li', 'vs-machine', upper(r)));
        if (!list) {
            el.vsList.appendChild(node('li', 'empty-small', t('common.loading')));
            continue;
        }
        if (!list.length) {
            el.vsList.appendChild(node('li', 'empty-small', t(vs.botId ? 'vscode.noSessions' : 'vscode.noSessionsMachine', { machine: upper(r) })));
            continue;
        }
        any = true;
        for (const s of list) el.vsList.appendChild(vscodeRow(r, s));
    }
    if (!any && Object.keys(vs.lists).length >= state.online.length) {
        el.vsList.appendChild(node('li', 'empty-small vs-explanation', t(vs.botId ? 'vscode.explanation' : 'vscode.explanationAll')));
    }
}

function vscodeRow(machine, s) {
    const li = node('li', 'vs-session');
    const head = node('div', 'vs-row');
    head.append(node('strong', '', s.title));
    if (s.working) head.append(node('span', 'vs-badge vs-running', t('vscode.working')));
    else if (s.open) head.append(node('span', 'vs-badge vs-open', t('vscode.open')));
    li.appendChild(head);
    if (s.firstPrompt && s.firstPrompt !== s.title) li.appendChild(node('span', 'vs-first', s.firstPrompt));
    const parts = [clockTime(s.lastModified), fileSize(s.size)];
    if (s.engine === 'codex') parts.push('Codex');
    if (s.origin === 'terminal') parts.push(t('vscode.terminal'));
    if (s.folder) parts.push(vscodeSubfolder(s.folder));
    if (s.branch) parts.push(s.branch);
    li.appendChild(node('span', 'vs-meta', parts.join(' · ')));
    li.addEventListener('click', () => openVscodeSession(machine, s));
    return li;
}

/** Subfolder relative to the bot's folder, e.g. "backend/". */
function vscodeSubfolder(folder) {
    const b = bot(vs.botId);
    const base = b ? b.folder.replace(/\\/g, '/').replace(/\/$/, '') : '';
    const o = folder.replace(/\\/g, '/');
    return (base && o.toLowerCase().startsWith(base.toLowerCase() + '/') ? o.slice(base.length + 1) : shortFolder(o)) + '/';
}

function openVscodeSession(machine, s) {
    vs.machine = machine;
    vs.session = s;
    vs.base = 0;
    vs.entries = [];
    vs.working = s.working;
    el.vsTitle.textContent = s.title;
    el.vsBack.hidden = false;
    el.vsList.hidden = true;
    el.vsShow.hidden = true;
    el.vsTerminal.hidden = true;
    el.vsError.hidden = true;
    el.vsHistory.hidden = false;
    el.vsHistory.innerHTML = '';
    el.vsHistory.appendChild(node('div', 'event', t('common.loading')));
    el.vsFooter.hidden = false;
    renderVscodeAdoptButton();
    renderVscodeSub();
    send({ type: 'vscode_open', ...scope(), ...engineOf(s), sessionId: s.id, folder: s.folder }, machine);
}

/** Leave the view of a session; the backend then stops watching the file. */
export function closeVscodeSession() {
    if (vs.session && state.online.includes(vs.machine)) send({ type: 'vscode_close', sessionId: vs.session.id }, vs.machine);
    vs.session = null;
    vs.entries = [];
    vs.adopting = false;
}

export function renderVscodeSub() {
    const s = vs.session;
    if (!s) return;
    const where = state.online.length > 1 ? `${upper(vs.machine)} · ` : '';
    el.vsSub.textContent = where + (vs.working ? t('vscode.workingNow') : s.open ? t('vscode.openWaiting') : t('vscode.lastActive', { time: clockTime(s.lastModified) }));
    el.vsSub.classList.toggle('vs-running', vs.working);
}

/**
 * The bot that can continue a session of `folder` on `machine`: it runs there and the folder lies in its own, the most
 * specific one if several do. Case does not count, as Windows paths differ in it; the backend checks again.
 */
function botForFolder(machine, folder) {
    const norm = (f) => (f || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const o = norm(folder);
    let best = null;
    for (const b of state.bots) {
        const base = norm(b.folder);
        if (!base || responsibleMachine(b) !== machine || (o !== base && !o.startsWith(base + '/'))) continue;
        if (!best || base.length > norm(best.folder).length) best = b;
    }
    return best;
}

/** The bot "Continue here" uses: the one the list belongs to, or in the machine-wide list the one of the folder. */
function adoptingBot() {
    return vs.botId ? bot(vs.botId) : vs.session ? botForFolder(vs.machine, vs.session.folder) : null;
}

/** Continuing only works where the transcript is: the bot has to run on this machine right now. */
export function renderVscodeAdoptButton() {
    const b = adoptingBot();
    const where = b ? responsibleMachine(b) : null;
    const fits = Boolean(b) && where === vs.machine;
    el.vsAdopt.disabled = !fits || vs.adopting;
    el.vsAdopt.textContent = vs.adopting ? t('vscode.adopting') : t('vscode.continueHere');
    el.vsHint.textContent = !vs.botId && !b
        ? t('vscode.adoptNoBot', { machine: upper(vs.machine) })
        : fits
            ? (vs.session && vs.session.engine === 'codex' ? t('vscode.adoptHintCodex', { name: b.name })
                : vs.botId ? t('vscode.adoptHint') : t('vscode.adoptHintBot', { name: b.name }))
            : t('vscode.adoptOtherMachine', { machine: upper(vs.machine), name: b ? b.name : t('vscode.theBot'), where: where ? upper(where) : t('vscode.noMachineAwake') });
}

export function receiveVscodeHistory(f) {
    if (!vs.session || f.sessionId !== vs.session.id || f.machine !== vs.machine) return;
    const atBottom = el.vsHistory.scrollHeight - el.vsHistory.scrollTop - el.vsHistory.clientHeight < 80;
    const first = !vs.entries.length && !el.vsHistory.querySelector('[data-vsi]');
    const before = vs.working;
    vs.working = f.working;
    if (first || f.from < vs.base) {
        vs.base = f.from;
        vs.entries = f.entries;
        el.vsHistory.innerHTML = '';
        if (vs.base > 0) el.vsHistory.appendChild(node('div', 'event', t('vscode.olderInVscode', { n: vs.base })));
        if (!f.entries.length) el.vsHistory.appendChild(node('div', 'event', t('vscode.noMessage')));
        vs.entries.forEach((e, i) => el.vsHistory.appendChild(vscodeEntry(e, vs.base + i)));
    } else {
        const from = f.from - vs.base;
        vs.entries.splice(from, Infinity, ...f.entries);
        for (const n of /** @type {NodeListOf<HTMLElement>} */ (el.vsHistory.querySelectorAll('[data-vsi]'))) if (Number(n.dataset.vsi) >= f.from) n.remove();
        f.entries.forEach((e, i) => el.vsHistory.appendChild(vscodeEntry(e, f.from + i)));
    }
    // End of the turn: tools of the last answer without a result no longer count as running
    if (before && !vs.working && vs.entries.length) {
        const i = vs.base + vs.entries.length - 1;
        const old = el.vsHistory.querySelector(`[data-vsi="${i}"]`);
        if (old) old.replaceWith(vscodeEntry(vs.entries[vs.entries.length - 1], i));
    }
    renderVscodeSub();
    if (first || atBottom) el.vsHistory.scrollTop = el.vsHistory.scrollHeight;
}

/** An entry as in the chat, only without menu, ticks and read aloud. */
function vscodeEntry(e, index) {
    let n;
    if (e.role === 'event') {
        n = node('div', 'event', e.text);
    } else if (e.role === 'user') {
        n = node('div', 'bubble me');
        n.append(node('div', 'text', e.text), node('span', 'time', clockTime(e.ts)));
    } else {
        n = node('div', 'answer');
        const running = vs.working && index === vs.base + vs.entries.length - 1;
        if (running) for (const tool of e.tools || []) n.appendChild(toolRow(tool));
        else renderTools(n, e.tools || []);
        if (e.text) {
            const b = node('div', 'bubble bot');
            const content = node('div', 'content');
            content.innerHTML = md(e.text);
            codeBlocks(content);
            b.append(content, node('span', 'time', clockTime(e.ts)));
            n.appendChild(b);
        }
    }
    n.dataset.vsi = String(index);
    return n;
}

export function adoptVscodeSession() {
    const b = adoptingBot();
    if (!vs.session || !b || el.vsAdopt.disabled) return;
    vs.adopting = true;
    el.vsError.hidden = true;
    renderVscodeAdoptButton();
    send({ type: 'vscode_adopt', botId: b.id, ...engineOf(vs.session), sessionId: vs.session.id, folder: vs.session.folder }, vs.machine);
}

export function vscodeError(f, message) {
    if (el.vscode.hidden) return;
    // List: an older backend does not know the request; count only this machine as "without sessions"
    if (f.request === 'vscode_sessions' && !vs.session) {
        vs.lists[f.machine || '?'] = [];
    }
    vs.adopting = false;
    el.vsError.textContent = (f.machine && state.online.length > 1 ? `${upper(f.machine)}: ` : '') + message;
    el.vsError.hidden = false;
    if (vs.session) renderVscodeAdoptButton();
    else renderVscodeList();
}

// ---------------------------------------------------------------- Hand over to the machine
// The other way round: open the session of a chat at its machine, in an IDE window or a terminal. The bot hands it
// over; the next message here continues the same session, with everything that was added at the machine.

/** @param {'ide' | 'terminal'} target */
function placeOf(target) {
    return t(target === 'ide' ? 'vscode.inIde' : 'vscode.inTerminal');
}

/** The buttons for the targets the chat's machine offers; a backend from before knows only the IDE. */
function renderHandoverButtons() {
    const b = vs.chatId ? bot(vs.chatId) : null;
    const where = b && responsibleMachine(b);
    const status = where ? state.backendPerMachine[where] : null;
    const targets = vs.chatId ? (status?.handover ?? ['ide']) : [];
    el.vsShow.hidden = !targets.includes('ide');
    el.vsTerminal.hidden = !targets.includes('terminal');
}

/**
 * Returns whether the request went out.
 * @param {'ide' | 'terminal'} target
 */
export async function showInVscode(chatId, target) {
    const b = bot(chatId);
    const where = b && responsibleMachine(b);
    if (!b) return false;
    if (!where) { void alertDialog(t('bot.sleepsNoMachine', { name: b.name }) + '.'); return false; }
    if (!(await confirmDialog(t('vscode.showConfirm', { place: placeOf(target), machine: upper(where), name: b.name })))) return false;
    send({ type: 'vscode_show', chatId, target }, where);
    showEvent(t('vscode.showing', { place: placeOf(target), machine: upper(where) }), false, chatId);
    return true;
}

export function vscodeShown(f) {
    if (paneFor(f.chatId)) showEvent(f.ok ? f.message : t('vscode.showFailed', { error: f.message }), !f.ok, f.chatId);
    else if (!f.ok) void alertDialog(t('vscode.showFailed', { error: f.message }));
}
