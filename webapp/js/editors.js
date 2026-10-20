/* OpenFolk web app: bot, group and routine editors, info panel, knowledge. */
import { locale, t } from './i18n.js';
import { AVATAR_EDGE, TEMPLATES, el, node, state, templateValues } from './core.js';
import { layoutPanes } from './panes.js';
import { bot, clockTime, fillAvatar, group, isConversation, responsibleMachine, send, upper } from './e2e.js';
import { shrinkImage } from './voice.js';
import { chatMenuButtons, closeDialog, gitOpenOf, renderInfoChat, showGitChanges } from './menus.js';

// ================================================================ Bot editor

/**
 * `machine`: move the bot there (the machine switch): a small dialog with folder and repository only, both filled
 * in from the bot's repository where that works; the rest of the bot stays as it is.
 */
export function openEditor(b, machine) {
    state.editorBot = b || null;
    moving = Boolean(b && machine);
    el.editor.classList.toggle('moving', moving);
    el.editor.classList.toggle('page', !moving);
    state.editorAvatar = b ? b.avatar : '';
    state.editorRemote = '';
    el.editorRepo.value = '';
    filled.folder = filled.repo = false;
    folderAsked = '';
    el.editorMachine.value = '';
    el.editorTitle.textContent = moving ? t('editor.moveTitle', { name: b.name, machine: upper(machine) }) : b ? t('editor.editBot') : t('editor.newBot');
    el.editorTemplateField.hidden = !!b;
    el.editorTemplate.value = '';
    editorValues(b || templateValues(TEMPLATES[0]));
    el.editorError.hidden = true;
    el.editorNameSuggestions.hidden = true;
    for (const k of Object.keys(suggestionsShown)) suggestionsShown[k] = [];
    renderEditorAvatar();
    setSaving(false);
    // The folder's repository, for when the bot gets a folder on another machine
    if (b && responsibleMachine(b)) send({ type: 'folder_check', folder: b.folder }, responsibleMachine(b));
    if (machine && machine !== el.editorMachine.value) {
        machineOptions(machine);
        machineChanged();
    }
    el.editor.hidden = false;
    (moving ? el.editorFolder : b ? el.editorName : el.editorTemplate).focus();
}

export function editorValues(v) {
    el.editorName.value = v.name || '';
    el.editorArea.value = v.area || '';
    el.editorRole.value = v.role || '';
    el.editorFolder.value = v.folder || '';
    const known = ['default', 'fable', 'opus', 'sonnet', 'haiku', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'];
    const model = v.model || 'default';
    // Other engines only if the machine offers them (login present) or the bot already uses them
    for (const engine of ['codex', 'cursor', 'copilot', 'antigravity', 'opencode']) {
        const option = /** @type {HTMLOptionElement | null} */ (el.editorModel.querySelector(`option[value="${engine}"]`));
        if (option) option.hidden = state.models.length > 0 && !state.models.some((m) => m.value === engine) && model !== engine;
    }
    el.editorModel.value = known.includes(model) ? model : 'custom';
    el.editorModelCustom.value = known.includes(model) ? '' : model;
    el.editorModelCustom.hidden = el.editorModel.value !== 'custom';
    el.editorApproval.value = v.approval || 'risky';
    el.editorTone.value = v.tone || '';
    canMessageValues(v);
    // A template keeps the machine already chosen; a new bot starts on the first machine awake
    machineOptions(v.machine || (v.id ? responsibleMachine(v) : '') || el.editorMachine.value || [...state.online].sort()[0] || '');
}

/** Which bots this one may give jobs: all (no list), none (empty list) or the ones ticked. */
function canMessageValues(v) {
    const list = v.canMessage;
    el.editorCanMessage.value = !list ? 'all' : list.length ? 'some' : 'none';
    const legend = el.editorCanMessageBots.querySelector('legend');
    el.editorCanMessageBots.replaceChildren(legend);
    for (const b of state.bots) {
        if (b.id === v.id) continue;
        const l = node('label', 'check');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = b.id;
        cb.checked = !!list && list.includes(b.id);
        l.append(cb, document.createTextNode(` ${b.name}${b.area || b.role ? ' – ' + (b.area || b.role) : ''}`));
        el.editorCanMessageBots.appendChild(l);
    }
    canMessageChanged();
}

export function canMessageChanged() {
    el.editorCanMessageBots.hidden = el.editorCanMessage.value !== 'some';
}

/** null = all bots, as the backend stores it. */
function canMessageInput() {
    if (el.editorCanMessage.value === 'all') return null;
    if (el.editorCanMessage.value === 'none') return [];
    return [...el.editorCanMessageBots.querySelectorAll('input:checked')].map((cb) => /** @type {HTMLInputElement} */ (cb).value);
}

/** Choice of machines: all known ones (awake or known to the wake service) plus the stored one. */
function machineOptions(value) {
    const st = state.machineStatus;
    const hosts = new Set([...state.online, ...(st ? Object.keys(st.hosts || {}) : []), ...(value ? [value] : [])]);
    el.editorMachine.innerHTML = '';
    for (const h of [...hosts].sort()) {
        const o = document.createElement('option');
        o.value = h;
        o.textContent = upper(h) + (state.online.includes(h) ? ' ' + t('editor.machineAwake') : '');
        el.editorMachine.appendChild(o);
    }
    el.editorMachine.value = value;
    folderHint();
}

function folderHint() {
    el.editorFolderHint.textContent = t('editor.folderHint', { machine: upper(el.editorMachine.value) || '–' });
}

/**
 * A repository instead of a folder: an address git clones from (https, ssh, git) or the scp form `git@host:team/repo`.
 * A folder path never looks like this, not even on Windows (`C:/…` has no '@' before the colon).
 */
export const isRepository = (text) => /^(https?|ssh|git):\/\/\S+$|^[\w.-]+@[\w.-]+:\S+$/.test(text.trim());

// ---------------------------------------------------------------- Folder and repository

/** Where the bot lives: its stored machine, or for a bot without one the machine that runs it. */
const homeOf = (b) => b.machine || responsibleMachine(b);

/** Which field the other one filled in; what the user typed is never overwritten. */
const filled = { folder: false, repo: false };

/** The bot's repository goes into its field, unless the user typed another one there. */
function fillRepo(remote) {
    if (el.editorRepo.value.trim() && !filled.repo) return;
    el.editorRepo.value = remote;
    filled.repo = Boolean(remote);
}

/** Asks the machine about the folder shortly after typing stops, not only when the field is left. */
let folderTimer = null;

/** The folder field typed in: an address there belongs into the repository field. */
export function folderTyped() {
    filled.folder = false;
    clearTimeout(folderTimer);
    const v = el.editorFolder.value.trim();
    if (!isRepository(v)) {
        folderTimer = setTimeout(folderChanged, 600);
        return;
    }
    el.editorFolder.value = '';
    el.editorRepo.value = v;
    filled.repo = false;
    repoChanged();
}

export function repoTyped() {
    filled.repo = false;
}

/** The folder last asked about, so leaving the field after the pause does not ask twice. */
let folderAsked = '';

/** A folder: its machine says whether it is a repository and where from. */
export function folderChanged() {
    clearTimeout(folderTimer);
    const folder = el.editorFolder.value.trim();
    const machine = el.editorMachine.value;
    if (!folder || filled.folder || !state.online.includes(machine) || `${machine}|${folder}` === folderAsked) return;
    folderAsked = `${machine}|${folder}`;
    send({ type: 'folder_check', folder }, machine);
}

/** A repository: its machine says which folder it goes into (or already lies in). */
export function repoChanged() {
    const url = el.editorRepo.value.trim();
    const machine = el.editorMachine.value;
    folderHint();
    if (!isRepository(url) || (el.editorFolder.value.trim() && !filled.folder) || !state.online.includes(machine)) return;
    send({ type: 'folder_propose', url }, machine);
}

export function receiveFolderProposed(f) {
    if (el.editor.hidden || f.url !== el.editorRepo.value.trim() || !f.ok || (el.editorFolder.value.trim() && !filled.folder)) return;
    el.editorFolder.value = f.folder;
    filled.folder = true;
    el.editorFolderHint.textContent = t(f.existing ? 'editor.repoThere' : 'editor.repoClone', { machine: upper(el.editorMachine.value), folder: f.folder });
}

/** The bot moves to a machine where its folder is not yet: its repository stays, the folder there comes from it. */
function offerRemote() {
    const b = state.editorBot;
    if (!b || !state.editorRemote || el.editorMachine.value === homeOf(b)) return;
    fillRepo(state.editorRemote);
    if (el.editorFolder.value.trim() === b.folder) {
        el.editorFolder.value = '';
        filled.folder = true;
    }
    repoChanged();
}

export function machineChanged() {
    folderHint();
    const b = state.editorBot;
    // A folder derived from the repository is the one on the previous machine: derive it there again
    if (filled.folder) repoChanged();
    if (!b || el.editorMachine.value === homeOf(b)) return;
    offerRemote();
    if (!state.online.includes(el.editorMachine.value)) showEditorError(t('editor.machineAsleep', { machine: upper(el.editorMachine.value) }));
}

/** The editor is the small move dialog (openEditor with a machine). */
let moving = false;

/** A save waiting for the bot's machine: `saving` to check the folder, `cloning` to clone the repository first. */
let saving = null;
let cloning = null;

function setSaving(on, label = t('editor.checkingFolder')) {
    const button = /** @type {HTMLButtonElement} */ (el.editorForm.querySelector('button[type="submit"]'));
    button.disabled = on;
    button.textContent = on ? label : t(moving ? 'editor.move' : 'common.save');
    if (!on && saving) { clearTimeout(saving.timer); saving = null; }
    if (!on && cloning) { clearTimeout(cloning.timer); cloning = null; }
}

/** Work to take along on this save: the bot's previous machine and its folder there (work-transfer.ts in the backend). */
let takeWork = null;

function saveBot(folder, to) {
    const b = state.editorBot;
    const model = el.editorModel.value === 'custom' ? el.editorModelCustom.value.trim() || 'default' : el.editorModel.value;
    // Only now that the new machine took the folder: the previous one packs once the move reaches it
    if (b && takeWork && takeWork.botId === b.id) send({ type: 'work_take', botId: b.id, machine: el.editorMachine.value, folder: takeWork.folder }, takeWork.from);
    takeWork = null;
    send({
        type: 'bot_save',
        bot: {
            id: b ? b.id : '',
            name: el.editorName.value.trim(), area: el.editorArea.value.trim(), role: el.editorRole.value.trim(), folder,
            model, tone: el.editorTone.value.trim(), avatar: state.editorAvatar, approval: el.editorApproval.value, machine: el.editorMachine.value,
            canMessage: canMessageInput(),
        },
    }, to);
    setSaving(false);
    closeDialog(el.editor);
}

/**
 * Saving a bot: only its machine can check the folder, so the folder goes there first and the bot is saved with the
 * folder as that machine stores it. Is the folder not there yet but a repository given, it is cloned into it (without
 * a folder: into a new one named after the repository). A bot whose machine sleeps can still be renamed and the like,
 * as long as machine and folder stay.
 */
export function submitEditor() {
    const b = state.editorBot;
    const machine = el.editorMachine.value;
    const asked = el.editorFolder.value.trim();
    const repo = el.editorRepo.value.trim();
    el.editorError.hidden = true;
    if (!asked && !repo) { showEditorError(t('editor.folderOrRepo')); el.editorFolder.focus(); return; }
    if (repo && !isRepository(repo)) { showEditorError(t('editor.repoInvalid')); el.editorRepo.focus(); return; }
    // Its sessions follow the bot to the new machine; what is not on the git server yet goes along only on request
    takeWork = null;
    if (b && b.machine && b.machine !== machine) {
        const unpushed = gitOpenOf(b).filter((r) => r.files.length || r.more || r.ahead);
        if (unpushed.length) {
            if (!confirm(t('editor.takeWork', { name: b.name, from: upper(b.machine), to: upper(machine), repos: unpushed.map((r) => r.name).join(', ') }))) return;
            takeWork = { botId: b.id, from: b.machine, folder: b.folder };
        }
    }
    if (!state.online.includes(machine)) {
        if (b && b.machine === machine && b.folder === asked && state.online.length) { saveBot(asked, undefined); return; }
        showEditorError(t('editor.machineAsleep', { machine: upper(machine) }));
        return;
    }
    if (!asked) { startClone(repo, ''); return; }
    checkThenSave(asked, repo);
}

function startClone(url, folder) {
    const machine = el.editorMachine.value;
    setSaving(true, t('editor.cloning'));
    // A large repository takes a while; the backend gives up after ten minutes
    cloning = { url, timer: setTimeout(() => receiveCloned({ url, ok: false, message: t('editor.noAnswer') }), 11 * 60_000) };
    send({ type: 'folder_clone', url, ...(folder ? { folder } : {}) }, machine);
}

/** `repo`: cloned into the folder when the folder is not there. */
function checkThenSave(asked, repo = '') {
    const machine = el.editorMachine.value;
    setSaving(true);
    saving = { asked, repo, save: (folder) => saveBot(folder, machine), timer: setTimeout(() => { setSaving(false); showEditorError(t('editor.noAnswer')); }, 20_000) };
    send({ type: 'folder_check', folder: asked }, machine);
}

/** The clone of a save: its folder goes into the field and the save goes on; without push access the user reads why first. */
export function receiveCloned(f) {
    if (!cloning || f.url !== cloning.url) return;
    setSaving(false);
    if (el.editor.hidden) return;
    if (!f.ok) { showEditorError(f.message || t('editor.noAnswer')); return; }
    el.editorFolder.value = f.folder;
    if (f.push === false) {
        let host = '';
        try { host = new URL(f.url).host; } catch { /* SSH form: never reported without push */ }
        el.editorFolderHint.textContent = t('editor.noPush', { machine: upper(el.editorMachine.value), host });
        return;
    }
    checkThenSave(f.folder);
}

export function receiveFolderChecked(f) {
    if (f.ok && f.remote && state.editorBot && f.asked === state.editorBot.folder) {
        state.editorRemote = f.remote;
        // Also for a bot without a stored machine: the one that runs it answered
        if (!el.editor.hidden && el.editorMachine.value === homeOf(state.editorBot)) fillRepo(f.remote);
        offerRemote();
    }
    if (!saving || f.asked !== saving.asked) {
        // A folder typed in: its repository goes into the other field
        if (!el.editor.hidden && f.ok && f.asked === el.editorFolder.value.trim() && !filled.folder) fillRepo(f.remote || '');
        return;
    }
    const s = saving;
    if (!f.ok && s.repo) { setSaving(false); startClone(s.repo, s.asked); return; }
    if (!f.ok) { setSaving(false); showEditorError(f.message || t('editor.noAnswer')); return; }
    s.save(f.folder);
}

/** A backend before 0.2 does not know folder_check and folder_clone: it checks the folder itself when saving. */
export function folderRequestUnknown(request, message) {
    if (request === 'folder_clone') { if (cloning) receiveCloned({ url: cloning.url, ok: false, message }); return; }
    // Only a help for filling in the folder
    if (request === 'folder_propose') return;
    if (saving) saving.save(saving.asked);
}

export function renderEditorAvatar() {
    fillAvatar(el.editorAvatar, { name: el.editorName.value || '?', avatar: state.editorAvatar }, el.editorName.value);
}

// Suggestions from the model: names with field of work as chips, role straight into the field, avatar as photo (data URL) or SVG portrait.
export const suggestButton = { name: () => el.editorNameSuggest, role: () => el.editorRoleSuggest, avatar: () => el.editorAvatarAi };
const suggestionsShown = { name: [], role: [], avatar: [] };

export function requestSuggestion(what) {
    const button = suggestButton[what]();
    if (button.disabled) return;
    if (!state.online.length) { showEditorError(t('editor.suggestOffline')); return; }
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = t('editor.thinking');
    el.editorError.hidden = true;
    // If the answer does not come (old backend, connection gone), release the button again
    clearTimeout(button.timeout);
    button.timeout = setTimeout(() => { if (button.disabled) receiveSuggestion({ what, error: t('editor.noAnswer') }); }, 120000);
    const model = el.editorModel.value === 'custom' ? el.editorModelCustom.value.trim() || 'default' : el.editorModel.value;
    send({
        type: 'bot_suggest',
        request: {
            what, folder: el.editorFolder.value.trim(), name: el.editorName.value.trim(), area: el.editorArea.value.trim(),
            role: el.editorRole.value.trim(),
            tone: el.editorTone.value.trim(), model, previous: suggestionsShown[what].slice(-9),
        },
    }, el.editorMachine.value || undefined);
}

export async function receiveSuggestion(f) {
    const button = Object.hasOwn(suggestButton, f.what) && suggestButton[f.what]();
    if (button) { button.disabled = false; button.textContent = button.dataset.label || button.textContent; }
    if (el.editor.hidden) return;
    if (f.error || !f.result) { showEditorError(f.error || t('editor.noSuggestion')); return; }
    const r = f.result;
    if (r.what === 'name') {
        el.editorNameSuggestions.innerHTML = '';
        r.names.forEach((n, i) => {
            const area = r.areas ? r.areas[i] || '' : null;
            suggestionsShown.name.push(area ? `${n} (${area})` : n);
            const chip = node('button', 'chip', area ? `${n} · ${area}` : n);
            chip.type = 'button';
            chip.addEventListener('click', () => {
                el.editorName.value = n;
                // Backends before the field of work send names only; then the field stays as it is
                if (area !== null) el.editorArea.value = area;
                renderEditorAvatar();
                el.editorNameSuggestions.hidden = true;
                el.editorName.focus();
            });
            el.editorNameSuggestions.appendChild(chip);
        });
        el.editorNameSuggestions.hidden = false;
    } else if (r.what === 'role') {
        suggestionsShown.role.push(r.role);
        el.editorRole.value = r.role;
    } else if (r.what === 'avatar') {
        suggestionsShown.avatar.push('x');
        try {
            const source = r.image ? dataUrlToBlob(r.image) : new Blob([r.svg], { type: 'image/svg+xml' });
            state.editorAvatar = await shrinkImage(source, AVATAR_EDGE, true);
            renderEditorAvatar();
        } catch (err) { showEditorError(t('editor.imageFailed', { error: err.message })); }
    }
}

/** Without fetch: the Content Security Policy (connect-src 'self') blocks fetch on data: URLs, Safari reports "Load failed". */
function dataUrlToBlob(url) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error(t('editor.unknownImageFormat'));
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: m[1] || 'text/plain' });
    const raw = atob(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

function showEditorError(text) {
    el.editorError.textContent = text;
    el.editorError.hidden = false;
}

// ================================================================ Group editor

export function openGroupEditor(g) {
    state.groupEditorGroup = g || null;
    state.groupAvatarData = g ? g.avatar : '';
    el.gTitle.textContent = g ? t('menu.editGroup') : t('group.new');
    el.gName.value = g ? g.name : '';
    el.gError.hidden = true;
    // what the ⋮ menu of the group held: search, favorite, delete
    el.gActions.hidden = !g;
    el.gActions.replaceChildren(...(g ? chatMenuButtons('g:' + g.id, true) : []));
    const legend = el.gMembers.querySelector('legend');
    el.gMembers.innerHTML = '';
    el.gMembers.appendChild(legend);
    const order = g ? [...g.members, ...state.bots.map((b) => b.id).filter((id) => !g.members.includes(id))] : state.bots.map((b) => b.id);
    for (const id of order) {
        const b = bot(id);
        if (!b) continue;
        const l = node('label', 'check');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = id;
        cb.checked = !!g && g.members.includes(id);
        l.append(cb, document.createTextNode(` ${b.name}${b.area || b.role ? ' – ' + (b.area || b.role) : ''}`));
        el.gMembers.appendChild(l);
    }
    fillAvatar(el.gAvatar, { name: el.gName.value || 'G', avatar: state.groupAvatarData }, 'group');
    el.gEditor.hidden = false;
    el.gName.focus();
}

// ================================================================ Info panel

const APPROVAL_LABELS = { never: 'approval.policy.never', risky: 'approval.policy.risky', write: 'approval.policy.write' };

/**
 * The bot's page: on top what the ⋮ menu held (model, machine, open changes, actions) for its main chat or for the
 * conversation `chatId` names, below it the bot's facts, routines and knowledge.
 */
export function openInfo(chatId) {
    const b = bot(chatId);
    if (!b) return;
    const botId = b.id;
    state.infoBot = botId;
    state.infoChat = isConversation(chatId) ? chatId : botId;
    fillAvatar(el.infoAvatar, b, b.id, true);
    el.infoName.textContent = b.name;
    el.infoArea.textContent = b.area || '';
    el.infoArea.hidden = !b.area;
    el.infoRole.textContent = b.role || '';
    el.infoFacts.innerHTML = '';
    const fact = (k, v) => { el.infoFacts.append(node('dt', '', k), node('dd', '', v)); };
    fact(t('info.folder'), b.folder);
    fact(t('info.approvals'), APPROVAL_LABELS[b.approval] ? t(APPROVAL_LABELS[b.approval]) : b.approval);
    state.infoKnowledge = null;
    renderKnowledge();
    el.infoSkills.textContent = t('common.loading');
    el.infoClaude.textContent = '';
    renderRoutines();
    // The machine: a tap opens the editor at its machine field, to move the bot (the chips above do the same)
    const where = node('button', 'link info-machine', upper(b.machine || responsibleMachine(b)) || '–');
    where.type = 'button';
    where.title = t('info.machineMove');
    where.addEventListener('click', () => {
        openEditor(b);
        el.editorMachine.focus();
    });
    const dd = node('dd', '');
    dd.appendChild(where);
    el.infoFacts.append(node('dt', '', t('info.machine')), dd);
    el.info.hidden = false;
    layoutPanes();
    renderInfoChat(true);
    showGitChanges(b, el.infoGit, (...parts) => el.infoGit.replaceChildren(...parts));
    send({ type: 'bot_info', botId }, responsibleMachine(b) || undefined);
}

export function fillInfo(info) {
    // Comes again after every change to the knowledge: append session and messages only once
    const first = !state.infoKnowledge;
    state.infoKnowledge = info.knowledge || [];
    renderKnowledge();
    if (!first) return;
    el.infoSkills.textContent = info.skills.length ? info.skills.join(' · ') : t('info.none');
    el.infoClaude.textContent = info.claudeMd || t('info.noClaudeMd');
    el.infoFacts.append(node('dt', '', t('info.session')), node('dd', '', info.sessionId ? info.sessionId.slice(0, 8) + '…' : t('info.noSessionYet')));
    el.infoFacts.append(node('dt', '', t('info.messages')), node('dd', '', String(info.messages)));
}

// ================================================================ Knowledge

const KNOWLEDGE_TABS = { bot: 'knowledge.tab.bot', folder: 'knowledge.tab.folder', group: 'knowledge.tab.group', all: 'knowledge.tab.all' };
const KNOWLEDGE_HINTS = {
    bot: 'knowledge.hint.bot',
    folder: 'knowledge.hint.folder',
    group: 'knowledge.hint.group',
    all: 'knowledge.hint.all',
};
const KNOWLEDGE_TYPES = { user: 'knowledge.type.user', workstyle: 'knowledge.type.workstyle', project: 'knowledge.type.project', reference: 'knowledge.type.reference', note: 'knowledge.type.note' };

function knowledgeKey(location) {
    return `${location.scope}/${location.key}`;
}

export function knowledgeSection() {
    const list = state.infoKnowledge || [];
    return list.find((s) => knowledgeKey(s.location) === state.infoKnowledgeTab) || list[0] || null;
}

export function renderKnowledge() {
    el.infoKnowledgeTabs.innerHTML = '';
    el.infoKnowledge.innerHTML = '';
    el.infoKnowledgeHint.textContent = '';
    const list = state.infoKnowledge;
    el.infoKnowledgeNew.hidden = !list;
    if (!list) {
        el.infoKnowledge.appendChild(node('li', 'empty-small', t('common.loading')));
        return;
    }
    const active = knowledgeSection();
    if (!active) return;
    state.infoKnowledgeTab = knowledgeKey(active.location);
    for (const s of list) {
        // Group tabs carry the group's name, the others the kind of scope
        const name = s.location.scope === 'group' ? (group('g:' + s.location.key) || {}).name || s.title : t(KNOWLEDGE_TABS[s.location.scope] || s.location.scope);
        const k = node('button', 'tab' + (s === active ? ' on' : ''), `${name}${s.facts.length ? ` ${s.facts.length}` : ''}`);
        k.type = 'button';
        k.setAttribute('role', 'tab');
        k.setAttribute('aria-selected', String(s === active));
        k.title = s.title;
        k.addEventListener('click', () => { state.infoKnowledgeTab = knowledgeKey(s.location); renderKnowledge(); });
        el.infoKnowledgeTabs.appendChild(k);
    }
    el.infoKnowledgeHint.textContent = t(KNOWLEDGE_HINTS[active.location.scope]) + (active.location.scope === 'bot' ? ' ' + t('knowledge.hint.botLearns') : '');
    if (!active.facts.length) el.infoKnowledge.appendChild(node('li', 'empty-small', t('knowledge.empty')));
    for (const f of active.facts) {
        const li = node('li');
        const text = node('div', 'r-text');
        text.append(node('strong', '', f.name), node('span', '', `${KNOWLEDGE_TYPES[f.type] ? t(KNOWLEDGE_TYPES[f.type]) : f.type} · ${shortDate(f.updatedAt)} · ${f.description}`));
        const edit = node('button', 'btn small', t('knowledge.open'));
        edit.addEventListener('click', () => openKnowledgeEditor(active, f));
        li.append(text, edit);
        el.infoKnowledge.appendChild(li);
    }
}

function shortDate(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function openKnowledgeEditor(section, f) {
    if (!section) return;
    state.knowledgeSection = section;
    state.knowledgeFact = f || null;
    el.kTitle.textContent = f ? t('knowledge.editFact') : t('knowledge.newFact');
    el.kLocation.textContent = `${section.title}: ${t(KNOWLEDGE_HINTS[section.location.scope])}`;
    el.kName.value = f ? f.name : '';
    el.kType.value = f ? f.type : 'note';
    el.kDescription.value = f ? f.description : '';
    el.kText.value = f ? f.text : '';
    el.kDelete.hidden = !f;
    el.kError.hidden = true;
    el.kEditor.hidden = false;
    (f ? el.kText : el.kName).focus();
}

export function knowledgeError(text) {
    if (el.kEditor.hidden) { alert(text); return; }
    el.kError.textContent = text;
    el.kError.hidden = false;
}

// ================================================================ Routines

const WEEKDAYS = ['routine.day.sun', 'routine.day.mon', 'routine.day.tue', 'routine.day.wed', 'routine.day.thu', 'routine.day.fri', 'routine.day.sat'];

function cronText(cron) {
    const m = /^(\d+) (\d+) \* \* (\*|1-5|[0-6])$/.exec(cron);
    if (m) {
        const time = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
        if (m[3] === '*') return t('routine.dailyAt', { time });
        if (m[3] === '1-5') return t('routine.weekdaysAt', { time });
        return `${t(WEEKDAYS[Number(m[3])])} ${time}`;
    }
    if (cron === '0 * * * *') return t('routine.hourly');
    return cron;
}

export function renderRoutines() {
    el.infoRoutines.innerHTML = '';
    const list = state.routines.filter((r) => r.botId === state.infoBot);
    if (list.length === 0) el.infoRoutines.appendChild(node('li', 'empty-small', t('routine.none')));
    for (const r of list) {
        const li = node('li', r.enabled ? '' : 'off');
        const text = node('div', 'r-text');
        const status = r.lastStatus === 'error' ? '✗' : r.lastStatus === 'running' ? '…' : '✓';
        text.append(node('strong', '', r.name), node('span', '', `${cronText(r.cron)}${r.wake ? ' · ' + t('routine.wakesMachine') : ''}${r.enabled ? '' : ' · ' + t('routine.paused')}${r.lastRun ? ` · ${t('routine.lastRun', { time: clockTime(r.lastRun) })} ${status}` : ''}`));
        const now = node('button', 'btn small', '▶ ' + t('routine.runNow'));
        now.addEventListener('click', () => send({ type: 'routine_run', id: r.id }));
        const edit = node('button', 'btn small', t('routine.edit'));
        edit.addEventListener('click', () => openRoutineEditor(r));
        li.append(text, now, edit);
        el.infoRoutines.appendChild(li);
    }
}

// ================================================================ Routine editor

export function openRoutineEditor(r) {
    state.routineEdit = r || null;
    el.rTitle.textContent = r ? t('routine.editTitle') : t('routine.newTitle');
    el.rName.value = r ? r.name : '';
    el.rPrompt.value = r ? r.prompt : '';
    el.rEnabled.checked = r ? r.enabled : true;
    el.rWake.checked = !!(r && r.wake);
    el.rDelete.hidden = !r;
    el.rError.hidden = true;
    const cron = r ? r.cron : '30 7 * * 1-5';
    const m = /^(\d+) (\d+) \* \* (\*|1-5|[0-6])$/.exec(cron);
    if (m) {
        el.rKind.value = m[3] === '*' ? 'daily' : m[3] === '1-5' ? 'weekdays' : 'weekly';
        el.rTime.value = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
        if (/^[0-6]$/.test(m[3])) el.rDay.value = m[3];
    } else if (cron === '0 * * * *') {
        el.rKind.value = 'hourly';
    } else {
        el.rKind.value = 'cron';
    }
    el.rCron.value = cron;
    routineFields();
    el.rEditor.hidden = false;
    el.rName.focus();
}

export function routineFields() {
    const kind = el.rKind.value;
    el.rTimeField.hidden = kind === 'hourly' || kind === 'cron';
    el.rDayField.hidden = kind !== 'weekly';
    el.rCronField.hidden = kind !== 'cron';
}

export function routineCron() {
    const [h, m] = (el.rTime.value || '07:30').split(':').map(Number);
    switch (el.rKind.value) {
        case 'daily': return `${m} ${h} * * *`;
        case 'weekdays': return `${m} ${h} * * 1-5`;
        case 'weekly': return `${m} ${h} * * ${el.rDay.value}`;
        case 'hourly': return '0 * * * *';
        default: return el.rCron.value.trim();
    }
}
