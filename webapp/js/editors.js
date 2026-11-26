/* OpenFolk web app: bot, group and routine editors, info panel, knowledge. */
import { locale, t, tn } from './i18n.js';
import { desktopLocal } from './platform.js';
import { AVATAR_EDGE, TEMPLATES, el, node, state, toast } from './core.js';
import { initialOf, namesWith } from './names.js';
import { layoutPanes, paneFor } from './panes.js';
import { bot, clockTime, duration, fillAvatar, group, isConversation, modelsOf, responsibleMachine, send, upper } from './e2e.js';
import { openChat } from './chat.js';
import { shrinkImage } from './voice.js';
import { backendVoice, guessVoice, previewVoice, stopPreview } from './read-aloud.js';
import { VOICE_CATALOG } from './voices.js';
import { chatMenuButtons, closeDialog, gitOpenOf, leaveInfo, menuButton, openGitPage, renderInfoChat, showGitChanges } from './menus.js';
import { sortedCategories } from './connection.js';
import { alertDialog } from './dialogs.js';
import { openGitSettings } from './settings.js';

// ================================================================ Bot editor

/**
 * `machine`: move the bot there (the machine switch): a small dialog with folder and repository only, both filled
 * in from the bot's repository where that works; the rest of the bot stays as it is.
 */
export function openEditor(b, machine) {
    // A bot of an admin's setup changes through the setup; its machine refuses the save anyway
    if (b && b.managed) {
        toast(t('setup.managedBot', { name: b.name }), 5000);
        return;
    }
    state.editorBot = b || null;
    moving = Boolean(b && machine);
    autosaving = false;
    clearTimeout(autoTimer);
    autoTimer = null;
    el.editorSaved.textContent = '';
    savedSnapshot = '';
    // Editing saves every change by itself: no Save and Cancel (editorChanged)
    el.editor.classList.toggle('autosave', Boolean(b) && !moving);
    // From the bot's page, the editor takes the place of that page in the side panel instead of opening over everything
    el.editor.classList.toggle('side-edit', Boolean(b && !moving && !el.info.hidden && state.infoBot === b.id));
    el.editor.classList.toggle('moving', moving);
    el.editor.classList.toggle('page', !moving);
    // A new bot: the short page (role, name, folder, repository); the rest it asks in its chat or waits in its settings
    el.editor.classList.toggle('new', !b);
    state.editorAvatar = b ? b.avatar : '';
    // The repository the bot's machine wrote down; the folder check below brings it too, if that machine is awake
    state.editorRemote = b?.place?.repo || '';
    el.editorRepo.value = '';
    filled.folder = filled.repo = false;
    folderAsked = '';
    el.editorMachine.value = '';
    el.editorTitle.textContent = moving ? t('editor.moveTitle', { name: b.name, machine: upper(machine) }) : b ? t('editor.editBot') : t('editor.newBot');
    editorValues(b || blankBot());
    // The machine only where there is a choice; a new bot starts on the first machine awake
    el.editorMachineField.hidden = !b && el.editorMachine.options.length < 2;
    el.editorError.hidden = true;
    el.editorNameSuggestions.hidden = true;
    for (const k of Object.keys(suggestionsShown)) suggestionsShown[k] = [];
    pickedTemplate = null;
    nameInitial = '';
    el.editorRoleSuggestions.hidden = !!b;
    if (!b) renderRoleChips();
    renderEditorAvatar();
    setSaving(false);
    // The folder's repository, for when the bot gets a folder on another machine
    if (b && responsibleMachine(b)) send({ type: 'folder_check', folder: b.folder }, responsibleMachine(b));
    if (machine && machine !== el.editorMachine.value) {
        machineOptions(machine);
        machineChanged();
    }
    el.editor.hidden = false;
    if (b && !moving) savedSnapshot = editorSnapshot();
    // In the side panel the editor is looked at first, not typed into: no field takes the focus (no keyboard on a tablet)
    if (!el.editor.classList.contains('side-edit')) (moving ? el.editorFolder : b ? el.editorName : el.editorRole).focus();
}

/** A new bot before anything is typed. */
const blankBot = () => ({ name: '', role: '', tone: '', folder: '', approval: newApproval(), machine: '' });

/** The approval level a new bot starts with: the one of the settings (Settings › Bots). */
const newApproval = () => state.settings?.botApproval || 'risky';

// ---------------------------------------------------------------- A new bot: role and name chips
// The templates stand behind the role chips: a tap takes the role and, unseen on this page, the template's working
// instructions, which a role typed over it drops again; the approval level stays the one of the settings. The names come from names.js.
let pickedTemplate = null;
/** The initial the shown names share; the chips are drawn anew only when it changes (or on "Others"). */
let nameInitial = '';

function renderRoleChips() {
    el.editorRoleSuggestions.replaceChildren(...TEMPLATES.map((tpl) => {
        const chip = node('button', 'chip', t(tpl.name));
        chip.type = 'button';
        chip.title = t(tpl.role);
        chip.addEventListener('click', () => {
            pickedTemplate = tpl;
            el.editorRole.value = t(tpl.role);
            el.editorTone.value = t(tpl.tone);
            renderNameChips();
        });
        return chip;
    }));
    el.editorRoleSuggestions.hidden = false;
}

/** The role typed (new bot only): a template's presets stay only while its role does; the names follow the initial. */
export function roleChanged() {
    if (state.editorBot) return;
    if (pickedTemplate && el.editorRole.value.trim() !== t(pickedTemplate.role)) {
        pickedTemplate = null;
        el.editorTone.value = '';
    }
    renderNameChips();
}

/** Three names alliterating with the role, and "Others" for three more; none without a role. */
function renderNameChips(again = false) {
    const initial = initialOf(el.editorRole.value);
    if (initial === nameInitial && !again) return;
    nameInitial = initial;
    const shown = again ? [...el.editorNameSuggestions.querySelectorAll('.chip')].map((c) => c.textContent) : [];
    const names = namesWith(initial, 3, shown);
    el.editorNameSuggestions.replaceChildren(...names.map((n) => {
        const chip = node('button', 'chip', n);
        chip.type = 'button';
        chip.addEventListener('click', () => { el.editorName.value = n; renderEditorAvatar(); });
        return chip;
    }));
    if (names.length) {
        const more = node('button', 'chip', t('editor.otherNames'));
        more.type = 'button';
        more.addEventListener('click', () => renderNameChips(true));
        el.editorNameSuggestions.appendChild(more);
    }
    el.editorNameSuggestions.hidden = !names.length;
}

export function editorValues(v) {
    el.editorName.value = v.name || '';
    el.editorArea.value = v.area || '';
    el.editorRole.value = v.role || '';
    el.editorFolder.value = v.folder || '';
    const known = ['default', 'fable', 'opus', 'sonnet', 'haiku', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'];
    // A new bot starts on the first machine awake
    const machine = v.machine || (v.id ? responsibleMachine(v) : '') || el.editorMachine.value || [...state.online].sort()[0] || '';
    const model = v.model || (v.id ? 'default' : newBotModel(machine));
    el.editorModel.value = known.includes(model) ? model : 'custom';
    el.editorModelCustom.value = known.includes(model) ? '' : model;
    el.editorModelCustom.hidden = el.editorModel.value !== 'custom';
    el.editorApproval.value = v.approval || 'risky';
    el.editorTone.value = v.tone || '';
    el.editorVoice.value = v.voice || '';
    el.editorTalkFast.checked = v.talkFast !== false;
    editorVoices = { ...v.voices };
    fillCategoryOptions(el.editorCategory, v.category);
    canMessageValues(v);
    contactValues(v);
    allowedToolValues(v);
    machineOptions(machine);
    engineOptions(model);
    renderVoiceChoice();
}

/**
 * A new bot runs on Claude, unless its machine has Claude not ready but OpenCode's free models (the first steps' "try
 * without signing in"): a first bot that cannot answer would be a worse start than one on a free model.
 */
function newBotModel(machine) {
    const engines = state.setupPerMachine[machine]?.engines || {};
    // Claude switched off on that machine: the first engine that is on
    const off = state.machineSettings[machine]?.settings?.disabledEngines || [];
    const on = off.includes('claude') && ['codex', 'cursor', 'copilot', 'antigravity', 'opencode'].find((e) => !off.includes(e));
    if (on) return on;
    return engines.claude !== 'ready' && engines.opencode === 'ready' ? 'opencode' : 'default';
}

/** The folders of the list to choose from ('' = none); a folder that no longer exists counts as none. */
export function fillCategoryOptions(select, current) {
    const none = node('option', '', t('category.none'));
    none.value = '';
    select.replaceChildren(none, ...sortedCategories().map((c) => { const o = node('option', '', c.name); o.value = c.id; return o; }));
    select.value = current && state.categories.some((c) => c.id === current) ? current : '';
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

/** Whom the bot hands a chat over to (hand_over): a person on the relay; shown only when there is one. */
function contactValues(v) {
    const current = v.contact || '';
    const choices = [...state.people];
    if (current && !choices.some((p) => p.id === current)) choices.push({ id: current, name: current });
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('editor.contactNone');
    el.editorContact.replaceChildren(none, ...choices.map((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        return o;
    }));
    el.editorContact.value = current;
    el.editorContactBlock.hidden = choices.length === 0;
}

/** undefined (unchanged) while the field is hidden, '' takes the contact off. */
function contactInput() {
    return el.editorContactBlock.hidden ? undefined : el.editorContact.value;
}

/** The MCP tools allowed for good on an approval card; unticking one takes it off when saving. */
function allowedToolValues(v) {
    const list = v.id ? v.allowedTools || [] : [];
    const legend = el.editorAllowedTools.querySelector('legend');
    el.editorAllowedTools.replaceChildren(legend);
    for (const tool of list) {
        const l = node('label', 'check');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = tool;
        cb.checked = true;
        l.append(cb, document.createTextNode(` ${tool.replace(/^mcp__/, '').replace(/__/g, ' › ')}`));
        el.editorAllowedTools.appendChild(l);
    }
    el.editorAllowedTools.appendChild(node('p', 'hint', t('editor.allowedToolsHint')));
    el.editorAllowedTools.hidden = list.length === 0;
}

/** undefined (unchanged) unless the bot has tools on the list. */
function allowedToolsInput() {
    if (el.editorAllowedTools.hidden) return undefined;
    return [...el.editorAllowedTools.querySelectorAll('input:checked')].map((cb) => /** @type {HTMLInputElement} */ (cb).value);
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

/** Other engines only if the chosen machine offers them (login present) or the bot already uses them (#63). */
function engineOptions(model = state.editorBot?.model || 'default') {
    const models = modelsOf(el.editorMachine.value);
    for (const engine of ['codex', 'cursor', 'copilot', 'antigravity', 'opencode']) {
        const option = /** @type {HTMLOptionElement | null} */ (el.editorModel.querySelector(`option[value="${engine}"]`));
        if (option) option.hidden = models.length > 0 && !models.some((m) => m.value === engine) && model !== engine;
    }
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
    engineOptions();
    const b = state.editorBot;
    // A folder derived from the repository is the one on the previous machine: derive it there again
    if (filled.folder) repoChanged();
    if (!b || el.editorMachine.value === homeOf(b)) return;
    offerRemote();
    if (!state.online.includes(el.editorMachine.value)) showEditorError(t('editor.machineAsleep', { machine: upper(el.editorMachine.value) }));
}

// ---------------------------------------------------------------- Folder picker

/**
 * The folder the picker shows ('' = the allowed roots), the machine it lists, the folder still awaited and the name
 * of a new folder still being created.
 */
const picker = { folder: '', machine: '', asked: null, creating: null, onChoose: /** @type {((folder: string) => void) | null} */ (null) };

export function openFolderPicker() {
    const machine = el.editorMachine.value;
    if (!state.online.includes(machine)) { showEditorError(t('editor.machineAsleep', { machine: upper(machine) })); return; }
    showPicker(machine, el.editorFolder.value.trim(), null);
}

/** The picker outside the bot editor (the default folder in a machine's settings); the machine must be awake. */
export function pickFolderOn(machine, folder, onChoose) {
    showPicker(machine, folder, onChoose);
}

function showPicker(machine, folder, onChoose) {
    picker.machine = machine;
    picker.creating = null;
    picker.onChoose = onChoose;
    el.pickerPath.textContent = '';
    el.pickerNewName.value = '';
    el.folderPicker.hidden = false;
    listPicker(folder);
}

function listPicker(folder) {
    picker.asked = folder;
    el.pickerError.hidden = true;
    el.pickerChoose.disabled = true;
    el.pickerList.replaceChildren(node('p', 'empty-small', t('common.loading')));
    send({ type: 'folder_list', folder }, picker.machine);
}

function pickerEntry(icon, text, folder) {
    const k = menuButton(icon, text);
    k.addEventListener('click', () => listPicker(folder));
    return k;
}

export function receiveFolderListed(f) {
    if (el.folderPicker.hidden || f.asked !== picker.asked) return;
    picker.asked = null;
    if (!f.ok) { pickerFailed(f.message); return; }
    picker.folder = f.folder;
    const machine = upper(picker.machine);
    el.pickerPath.textContent = f.folder ? t('picker.where', { folder: f.folder, machine }) : t('picker.roots', { machine });
    const entries = f.parent !== undefined ? [pickerEntry('back', t('picker.up'), f.parent)] : [];
    // The roots by their full path, folders inside one by name
    for (const p of f.folders) entries.push(pickerEntry('folder', f.folder ? p.split('/').pop() : p, p));
    if (!f.folders.length) entries.push(node('p', 'empty-small', t('picker.empty')));
    el.pickerList.replaceChildren(...entries);
    el.pickerChoose.disabled = !f.folder;
    // A new folder goes below the one shown, not next to the roots
    el.pickerNewName.disabled = el.pickerCreate.disabled = !f.folder;
}

/** "New folder" in the picker: the machine creates it below the folder shown, and the picker goes into it. */
export function createPickerFolder() {
    const name = el.pickerNewName.value.trim();
    if (!name || !picker.folder || picker.creating) return;
    picker.creating = name;
    el.pickerError.hidden = true;
    el.pickerCreate.disabled = true;
    send({ type: 'folder_create', name, parent: picker.folder }, picker.machine);
}

/** A folder created for a save (createOwnFolder) or from the picker (createPickerFolder). */
export function receiveFolderCreated(f) {
    if (creating && f.name === creating.name) {
        setSaving(false);
        if (el.editor.hidden) return;
        if (!f.ok) { showEditorError(f.message || t('editor.noAnswer'), f.refused); return; }
        el.editorFolder.value = f.folder;
        filled.folder = false;
        checkThenSave(f.folder);
        return;
    }
    if (el.folderPicker.hidden || f.name !== picker.creating) return;
    picker.creating = null;
    el.pickerCreate.disabled = false;
    if (!f.ok) {
        el.pickerError.textContent = f.message || t('editor.noAnswer');
        el.pickerError.hidden = false;
        return;
    }
    el.pickerNewName.value = '';
    listPicker(f.folder);
}

/** Also for a backend from before the picker, which does not know folder_list. */
export function pickerFailed(message) {
    picker.asked = null;
    el.pickerList.replaceChildren();
    el.pickerError.textContent = message || t('editor.noAnswer');
    el.pickerError.hidden = false;
}

export function chooseFolder() {
    if (!picker.folder) return;
    if (picker.onChoose) {
        closeDialog(el.folderPicker);
        picker.onChoose(picker.folder);
        return;
    }
    el.editorFolder.value = picker.folder;
    queueMicrotask(() => editorChanged());
    filled.folder = false;
    closeDialog(el.folderPicker);
    folderChanged();
}

/** The editor is the small move dialog (openEditor with a machine). */
let moving = false;

/**
 * A save waiting for the bot's machine: `saving` to check the folder, `cloning` to clone the repository first,
 * `creating` to create the bot's own folder first.
 */
let saving = null;
let cloning = null;
let creating = null;

function setSaving(on, label = t('editor.checkingFolder')) {
    const button = /** @type {HTMLButtonElement} */ (el.editorForm.querySelector('button[type="submit"]'));
    button.disabled = on;
    button.textContent = on ? label : t(moving ? 'editor.move' : state.editorBot ? 'common.save' : 'editor.create');
    if (!on && saving) { clearTimeout(saving.timer); saving = null; }
    if (!on && cloning) { clearTimeout(cloning.timer); cloning = null; }
    if (!on && creating) { clearTimeout(creating.timer); creating = null; }
}

/** Work to take along on this save: the bot's previous machine and its folder there (work-transfer.ts in the backend). */
let takeWork = null;

function saveBot(folder, to) {
    const b = state.editorBot;
    const model = el.editorModel.value === 'custom' ? el.editorModelCustom.value.trim() || 'default' : el.editorModel.value;
    // Only now that the new machine took the folder: the previous one packs once the move reaches it
    if (b && takeWork && takeWork.botId === b.id) {
        send({ type: 'work_take', botId: b.id, machine: el.editorMachine.value, folder: takeWork.folder }, takeWork.from);
        toast(t('move.workAlong', { from: upper(takeWork.from), repos: takeWork.repos }), 5000);
    }
    takeWork = null;
    if (!b) state.openNewBot = { known: state.bots.map((x) => x.id), until: Date.now() + 60_000 };
    send({
        type: 'bot_save',
        // Every new bot sets itself up in its chat (a template only fills in a part): its machine starts the setup
        // conversation once it is saved, and that chat opens here as soon as the bot list names the new bot
        ...(!b ? { setup: true } : {}),
        bot: {
            id: b ? b.id : '',
            name: el.editorName.value.trim(), area: el.editorArea.value.trim(), role: el.editorRole.value.trim(), folder,
            model, tone: el.editorTone.value.trim(), avatar: state.editorAvatar, approval: el.editorApproval.value, machine: el.editorMachine.value,
            voice: el.editorVoice.value, voices: { ...editorVoices }, talkFast: el.editorTalkFast.checked, category: el.editorCategory.value, canMessage: canMessageInput(), allowedTools: allowedToolsInput(), contact: contactInput(),
        },
    }, to);
    setSaving(false);
    if (autosaving) {
        autosaving = false;
        el.editorSaved.textContent = t('editor.saved');
        el.editorSaved.classList.add('done');
        return;
    }
    closeDialog(el.editor);
}

// ---------------------------------------------------------------- Editing a bot saves by itself
// No Save button while editing: every change goes to the bot's machine on its own, typing after a short pause, a
// choice at once. Folder, repository and machine only once they are left (each step would check a folder), and only a
// bot with a name and a folder; the checks (folder, clone, move) run as on a save, and the editor stays open.
let autosaving = false;
let autoTimer = null;
const AUTOSAVE_MS = 800;
const AT_LEAVING = new Set(['editor-folder', 'editor-repo', 'editor-machine']);

/** A field of the editor changed (input, change), or a picture or a suggestion was taken (no event). */
export function editorChanged(ev) {
    const b = state.editorBot;
    if (!b || moving || el.editor.hidden) return;
    const id = ev && ev.target && /** @type {HTMLElement} */ (ev.target).id;
    if (ev && ev.type === 'input' && AT_LEAVING.has(id)) return;
    // a select or a box reports input and change: the change saves (at once)
    const target = /** @type {HTMLInputElement | null} */ (ev && ev.target);
    if (ev && ev.type === 'input' && target && (target.tagName === 'SELECT' || target.type === 'checkbox' || target.type === 'radio')) return;
    clearTimeout(autoTimer);
    el.editorSaved.textContent = t('editor.saving');
    el.editorSaved.classList.remove('done');
    autoTimer = setTimeout(autosave, ev && ev.type === 'input' ? AUTOSAVE_MS : 0);
}

/** What the editor holds right now, to save only what really changed (leaving a field reports a change too). */
const editorSnapshot = () => JSON.stringify([
    [...el.editorForm.elements].map((x) => (/** @type {HTMLInputElement} */ (x).type === 'checkbox' ? /** @type {HTMLInputElement} */ (x).checked : /** @type {HTMLInputElement} */ (x).value)),
    state.editorAvatar, editorVoices,
]);
let savedSnapshot = '';

function autosave() {
    if (el.editor.hidden || !state.editorBot || !el.editorName.value.trim() || (!el.editorFolder.value.trim() && !el.editorRepo.value.trim())) {
        el.editorSaved.textContent = '';
        return;
    }
    const now = editorSnapshot();
    if (now === savedSnapshot) {
        el.editorSaved.textContent = t('editor.saved');
        el.editorSaved.classList.add('done');
        return;
    }
    savedSnapshot = now;
    autosaving = true;
    void submitEditor();
}

/** Leaving the editor with a change still waiting for its pause: saved now. */
export function flushEditor() {
    if (!autoTimer) return;
    clearTimeout(autoTimer);
    autoTimer = null;
    if (el.editorSaved.textContent === t('editor.saving')) autosave();
}

/**
 * Saving a bot: only its machine can check the folder, so the folder goes there first and the bot is saved with the
 * folder as that machine stores it. Is the folder not there yet but a repository given, it is cloned into it (without
 * a folder: into a new one named after the repository). Without both, the machine creates a folder named after the
 * bot under its folder for bots. A bot whose machine sleeps can still be renamed and the like, as long as machine and
 * folder stay.
 */
export async function submitEditor() {
    const b = state.editorBot;
    const machine = el.editorMachine.value;
    const asked = el.editorFolder.value.trim();
    const repo = el.editorRepo.value.trim();
    el.editorError.hidden = true;
    if (repo && !isRepository(repo)) { showEditorError(t('editor.repoInvalid')); el.editorRepo.focus(); return; }
    // Its sessions follow the bot to the new machine, and so does what is not on the git server yet
    takeWork = b && b.machine && b.machine !== machine ? workToTake(b) : null;
    // A change saved by itself with folder and machine as they were: nothing to check, straight to the machine (also
    // when the editor closes right after, which would drop the folder check's answer)
    if (autosaving && b && b.folder === asked && (b.machine || '') === machine && !repo) { saveBot(asked, state.online.includes(machine) ? machine : undefined); return; }
    if (!state.online.includes(machine)) {
        if (b && b.machine === machine && b.folder === asked && state.online.length) { saveBot(asked, undefined); return; }
        showEditorError(t('editor.machineAsleep', { machine: upper(machine) }));
        return;
    }
    if (!asked && !repo) { createOwnFolder(el.editorName.value.trim()); return; }
    if (!asked) { startClone(repo, ''); return; }
    checkThenSave(asked, repo);
}

/** Neither folder nor repository: a folder named after the bot under the machine's folder for bots, the next free name. */
function createOwnFolder(name) {
    setSaving(true, t('editor.creatingFolder'));
    creating = { name, timer: setTimeout(() => receiveFolderCreated({ name, ok: false, message: t('editor.noAnswer') }), 20_000) };
    send({ type: 'folder_create', name, nextFree: true }, el.editorMachine.value);
}

function startClone(url, folder) {
    const machine = el.editorMachine.value;
    setSaving(true, t('editor.cloning'));
    // A large repository takes a while; the backend gives up after ten minutes
    cloning = { url, timer: setTimeout(() => receiveCloned({ url, ok: false, message: t('editor.noAnswer') }), 11 * 60_000) };
    send({ type: 'folder_clone', url, ...(folder ? { folder } : {}) }, machine);
}

/** The same repository, with or without ".git" and a trailing slash (sameRepo in local/src/folders.ts). */
const sameRepository = (a, b) => Boolean(a) && a.trim().replace(/(\.git)?\/*$/, '') === b.trim().replace(/(\.git)?\/*$/, '');

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
    if (!f.ok) {
        showEditorError(f.message || t('editor.noAnswer'), f.refused);
        if (f.credentials) credentialsHint(el.editorMachine.value, f.url);
        return;
    }
    el.editorFolder.value = f.folder;
    if (f.push === false) {
        let host = '';
        try { host = new URL(f.url).host; } catch { /* SSH form: never reported without push */ }
        el.editorFolderHint.textContent = t('editor.noPush', { machine: upper(el.editorMachine.value), host });
        return;
    }
    checkThenSave(f.folder);
}

/**
 * A clone that git refused for want of credentials: where the token goes, and a button there. The settings are a page
 * below the editor, so the editor closes; the bot is saved again once the token is in.
 */
function credentialsHint(machine, url) {
    let host = '';
    try { host = new URL(url).host; } catch { /* SSH form: a key of the machine, not a token */ }
    el.editorError.append(node('span', 'error-hint', t(host ? 'editor.cloneCredentials' : 'editor.cloneCredentialsSsh', { machine: upper(machine), host })));
    const go = node('button', 'btn small', t('editor.openGitSettings', { machine: upper(machine) }));
    go.type = 'button';
    go.addEventListener('click', () => {
        closeDialog(el.editor);
        openGitSettings(machine);
    });
    el.editorError.append(go);
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
    // The folder is there but no clone of the repository given (empty, say, after a clone that failed): the backend
    // clones into it if it is empty and refuses otherwise, instead of the bot being saved without its repository
    if (f.ok && s.repo && !sameRepository(f.remote, s.repo)) { setSaving(false); startClone(s.repo, s.asked); return; }
    if (!f.ok) { setSaving(false); showEditorError(f.message || t('editor.noAnswer'), f.refused); return; }
    s.save(f.folder);
}

// ---------------------------------------------------------------- Moving a bot without the dialog

/** A move in progress: the bot, the machine, whether it waits for that machine to wake, the work to take along. */
let move = null;

/** Open files, unpushed or unpulled commits in the bot's repos: they are not on the git server yet. */
const unpushedOf = (b) => gitOpenOf(b).filter((r) => r.files.length || r.more || r.ahead);

/**
 * Work not on the git server yet goes along to the new machine (work-transfer.ts in the backend): the bot's machine,
 * its folder there and the repos concerned; null when everything is on the server.
 */
function workToTake(b) {
    const unpushed = b.machine ? unpushedOf(b) : [];
    return unpushed.length ? { botId: b.id, from: b.machine, folder: b.folder, repos: unpushed.map((r) => r.name).join(', ') } : null;
}

/**
 * Moving a bot to `host` without a question: the machine there puts it at its place (Bot.place) under its folder for
 * bots, clones or creates what is missing and saves the bot there; work not on the git server yet comes along. Without
 * a place, with a place that is taken there or with a backend before bot_move, the small move dialog asks for folder
 * and repository as before.
 */
export function moveBot(b, host) {
    if (!b.place) { openEditor(b, host); return; }
    move = { botId: b.id, host, waiting: !state.online.includes(host), work: workToTake(b) };
    if (move.waiting) { toast(t('move.waiting', { machine: upper(host) }), 4000); return; }
    toast(t('move.started', { name: b.name, machine: upper(host) }), 4000);
    send({ type: 'bot_move', botId: b.id }, host);
}

/** The machine of a move woke up: move the bot there now. */
export function continueMove() {
    if (!move || !move.waiting || !state.online.includes(move.host)) return;
    move.waiting = false;
    const b = bot(move.botId);
    if (b) toast(t('move.started', { name: b.name, machine: upper(move.host) }), 4000);
    send({ type: 'bot_move', botId: move.botId }, move.host);
}

function moveByDialog(message, refused) {
    const b = move && bot(move.botId);
    const host = move?.host;
    move = null;
    if (!b) return;
    openEditor(b, host);
    if (message) showEditorError(message, refused);
}

export function receiveMoved(f) {
    if (!move || f.botId !== move.botId) return;
    const b = bot(f.botId);
    const { host, work } = move;
    if (!b) { move = null; return; }
    if (!f.ok) { moveByDialog(f.message, f.refused); return; }
    // Only now that the new machine took the bot: the previous one packs once the move reaches it
    if (work) send({ type: 'work_take', botId: b.id, machine: host, folder: work.folder }, work.from);
    move = null;
    const done = t('move.done', { name: b.name, machine: upper(host), folder: f.folder });
    toast(work ? `${done} ${t('move.workAlong', { from: upper(work.from), repos: work.repos })}` : done, work ? 6000 : 4000);
}

/** A backend before bot_move, or a bot it does not know: the dialog asks instead. */
export function moveRequestFailed() {
    moveByDialog('');
}

/**
 * A backend before 0.2 does not know folder_check and folder_clone: it checks the folder itself when saving. One
 * before folder_create cannot give a bot a folder of its own; the user enters one.
 */
export function folderRequestUnknown(request, message) {
    if (request === 'folder_clone') { if (cloning) receiveCloned({ url: cloning.url, ok: false, message }); return; }
    if (request === 'folder_create') {
        if (creating) receiveFolderCreated({ name: creating.name, ok: false, message: t('editor.folderOld', { machine: upper(el.editorMachine.value) }) });
        else if (picker.creating) receiveFolderCreated({ name: picker.creating, ok: false, message });
        return;
    }
    // Only a help for filling in the folder
    if (request === 'folder_propose') return;
    if (saving) saving.save(saving.asked);
}

export function renderEditorAvatar() {
    fillAvatar(el.editorAvatar, { name: el.editorName.value || '?', avatar: state.editorAvatar }, el.editorName.value);
}

// ---------------------------------------------------------------- The set of profile pictures
// "AI avatar" first offers the ready-made portraits of webapp/avatars (manifest.json lists them with the voice each
// calls for); a tap stores one like an uploaded image. The image model is the last entry of the page.

/** The manifest, fetched once per page load. */
let avatarSet = null;

export async function openAvatarPicker() {
    el.avatarError.hidden = true;
    el.avatarPicker.hidden = false;
    if (!avatarSet) {
        el.avatarGrid.replaceChildren(node('p', 'empty-small', t('common.loading')));
        try {
            const r = await fetch('avatars/manifest.json');
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            avatarSet = await r.json();
        } catch (e) {
            el.avatarGrid.replaceChildren();
            el.avatarError.textContent = t('avatars.loadFailed', { error: e.message });
            el.avatarError.hidden = false;
            return;
        }
    }
    const groups = [['female', t('avatars.female')], ['male', t('avatars.male')]];
    el.avatarGrid.replaceChildren(...groups.flatMap(([voice, title]) => {
        const grid = node('div', 'avatar-grid');
        for (const a of avatarSet.filter((x) => x.voice === voice)) {
            const k = node('button', 'avatar-choice');
            k.type = 'button';
            k.dataset.file = a.file;
            const img = document.createElement('img');
            img.src = `avatars/${a.file}`;
            img.alt = '';
            img.loading = 'lazy';
            k.appendChild(img);
            k.addEventListener('click', () => pickAvatar(a.file));
            grid.appendChild(k);
        }
        return [node('h4', '', title), grid];
    }));
}

/** Takes a picture of the set over as the bot's avatar (shrunk like an upload, so it is stored the same way). */
async function pickAvatar(file) {
    try {
        const r = await fetch(`avatars/${file}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        state.editorAvatar = await shrinkImage(await r.blob(), AVATAR_EDGE, true);
        renderEditorAvatar();
        closeDialog(el.avatarPicker);
    } catch (e) {
        el.avatarError.textContent = t('avatars.loadFailed', { error: e.message });
        el.avatarError.hidden = false;
    }
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
                if (r.voices && r.voices[i]) el.editorVoice.value = r.voices[i];
                renderEditorAvatar();
                el.editorNameSuggestions.hidden = true;
                el.editorName.focus();
                editorChanged();
            });
            el.editorNameSuggestions.appendChild(chip);
        });
        el.editorNameSuggestions.hidden = false;
    } else if (r.what === 'role') {
        suggestionsShown.role.push(r.role);
        el.editorRole.value = r.role;
        editorChanged();
    } else if (r.what === 'avatar') {
        suggestionsShown.avatar.push('x');
        try {
            const source = r.image ? dataUrlToBlob(r.image) : new Blob([r.svg], { type: 'image/svg+xml' });
            state.editorAvatar = await shrinkImage(source, AVATAR_EDGE, true);
            renderEditorAvatar();
            editorChanged();
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

/**
 * A folder outside the backend's ALLOWED_ROOTS: since 0.2.1 the answer names folder and allowed folders in `refused`;
 * a backend before that sends only the message (bots.folderNotAllowed in local/src/i18n.ts, English or German by its
 * language), so there the text is what tells it apart.
 */
const folderNotAllowed = (text) => /not\s+under|nicht\s+unter/i.test(text);

/**
 * The refusal reads "Folder is not under {roots}: {folder}", which puts the refused folder right behind the list and
 * looks like one more allowed folder. Split at the last ": " (the folders are joined with ", ") into two parts;
 * null when the text does not have that shape.
 * @param {string} text
 */
function splitFolderRefusal(text) {
    const m = /^(?:Folder is not under|Ordner liegt nicht unter)\s+(.+): (.+)$/s.exec(text.trim());
    if (!m) return null;
    const roots = m[1].split(', ').map((r) => r.trim()).filter(Boolean);
    return roots.length ? { roots, folder: m[2].trim() } : null;
}

/** @param {string} text @param {{ folder: string, roots: string[] }} [refused] from the backend's answer */
/** An error of the editor; a change saved by itself is not saved then. */
function showEditorError(text, refused) {
    autosaving = false;
    savedSnapshot = '';
    el.editorSaved.textContent = '';
    showEditorErrorShown(text, refused);
}

function showEditorErrorShown(text, refused) {
    const parts = refused?.folder && Array.isArray(refused.roots) ? refused : folderNotAllowed(text) ? splitFolderRefusal(text) : null;
    el.editorError.textContent = parts ? t('editor.folderNotAllowed', { folder: parts.folder }) : text;
    if (parts) el.editorError.append(node('span', 'error-roots', t('editor.allowedFolders') + '\n' + parts.roots.join('\n')));
    // The desktop app that runs the backend has a menu for it; the .env and the variable stay as the second way
    if (refused || folderNotAllowed(text)) el.editorError.append(node('span', 'error-hint', (desktopLocal ? t('editor.folderNotAllowedMenu') + '\n' : '') + t('editor.folderNotAllowedHint')));
    el.editorError.hidden = false;
}

// ================================================================ Group editor

/** "New group" from the "+" menu, the palette or Ctrl+Shift+N: a group needs two bots. */
export function newGroup() {
    if (state.bots.length < 2) { void alertDialog(t('group.needTwoBots')); return; }
    openGroupEditor(null);
}

export function openGroupEditor(g) {
    state.groupEditorGroup = g || null;
    state.groupAvatarData = g ? g.avatar : '';
    el.gTitle.textContent = g ? t('menu.editGroup') : t('group.new');
    el.gName.value = g ? g.name : '';
    fillCategoryOptions(el.gCategory, g ? g.category : '');
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

const APPROVAL_LABELS = { never: 'approval.policy.never', risky: 'approval.policy.risky', write: 'approval.policy.write', read: 'approval.policy.read' };

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
    infoDrawn = infoFields(b);
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
    // the next runs as of now; the list in hand may be hours old
    send({ type: 'routines' }, responsibleMachine(b) || undefined);
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

/**
 * The open changes of a bot (the git badge in the chat's header and in the list): on a tablet or a computer in the side
 * panel, as the bot's page scrolled to them, like "Edit bot"; on the phone the page of their own as before.
 * `chatId`: the chat the badge belongs to (a conversation keeps its page).
 */
export function openBotChanges(chatId, fromChat = false) {
    const b = bot(chatId);
    if (!b) return;
    if (window.innerWidth <= 760) {
        openGitPage(b, fromChat);
        return;
    }
    if (el.info.hidden || state.infoChat !== chatId) openInfo(chatId);
    // right below the page's head, which stays in view while the page scrolls
    const panel = /** @type {HTMLElement} */ (el.infoGit.closest('.panel'));
    const head = /** @type {HTMLElement | null} */ (panel?.querySelector('.panel-top'));
    if (panel) panel.scrollTop += el.infoGit.getBoundingClientRect().top - panel.getBoundingClientRect().top - (head ? head.offsetHeight : 0);
}

/** What the top of the bot's page shows of the bot; the page is drawn again when it changes. */
const infoFields = (b) => JSON.stringify([b.name, b.area, b.role, b.folder, b.approval, b.avatar, b.machine]);
let infoDrawn = '';

/**
 * The bot's page keeps what openInfo drew: after the bot changed (saved in the editor, or on another device) it is drawn
 * again, unless the editor is open over it.
 */
export function refreshInfo() {
    const b = bot(state.infoBot);
    if (!b || el.info.hidden || !el.editor.hidden || infoFields(b) === infoDrawn) return;
    openInfo(state.infoChat || b.id);
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
    if (el.kEditor.hidden) { void alertDialog(text); return; }
    el.kError.textContent = text;
    el.kError.hidden = false;
}

// ================================================================ Routines

const WEEKDAYS = ['routine.day.sun', 'routine.day.mon', 'routine.day.tue', 'routine.day.wed', 'routine.day.thu', 'routine.day.fri', 'routine.day.sat'];

/** The weekday field in words; '' for every day, null for what has no short form. */
function cronDays(field) {
    if (field === '*') return '';
    if (field === '1-5') return t('routine.days.weekdays');
    if (field === '0,6' || field === '6,0' || field === '6,7' || field === '6-7') return t('routine.days.weekends');
    const day = (d) => t(WEEKDAYS[Number(d) % 7]);
    const parts = field.split(',').map((p) => {
        const m = /^([0-7])(?:-([0-7]))?$/.exec(p);
        if (!m) return null;
        return m[2] ? `${day(m[1])}–${day(m[2])}` : day(m[1]);
    });
    return parts.includes(null) ? null : parts.join(', ');
}

/**
 * A cron expression in words ("weekdays 8:00", "every 2 hours"), in the forms the editor and bots write; anything
 * else stays the expression itself.
 */
export function cronText(cron) {
    const f = cron.trim().split(/\s+/);
    if (f.length !== 5 || f[3] !== '*') return cron;
    const [min, hour, dom, , dow] = f;
    const days = cronDays(dow);
    if (days === null || (dom !== '*' && dow !== '*')) return cron;
    const num = /^\d+$/;
    // fixed times: one or a few hours at one minute
    if (num.test(min) && /^\d+(,\d+)*$/.test(hour)) {
        const time = hour.split(',').map((h) => `${Number(h)}:${min.padStart(2, '0')}`).join(', ');
        if (num.test(dom)) return t('routine.monthly', { day: Number(dom), time });
        if (dom !== '*') return cron;
        return `${days || t('routine.days.daily')} ${time}`;
    }
    if (dom !== '*') return cron;
    let every = '';
    const hourStep = /^(\*|(\d+)-(\d+))(?:\/(\d+))?$/.exec(hour);
    const minStep = /^\*\/(\d+)$/.exec(min);
    if (num.test(min) && hourStep) {
        const n = Number(hourStep[4] || 1);
        every = n === 1 && Number(min) ? t('routine.hourlyAt', { minute: min.padStart(2, '0') }) : tn('routine.everyHours', n);
    } else if ((min === '*' || minStep) && hourStep && !hourStep[4]) {
        every = tn('routine.everyMinutes', minStep ? Number(minStep[1]) : 1);
    } else {
        return cron;
    }
    if (hourStep[2] !== undefined) every += ' ' + t('routine.hoursRange', { from: Number(hourStep[2]), to: Number(hourStep[3]) });
    return days ? `${days}, ${every}` : every;
}

/** Date and time of a run or the next one: today only the time, otherwise with weekday and date. */
function runTime(iso) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const RUN_STATUS = { ok: 'routine.status.ok', error: 'routine.status.error', running: 'routine.status.running' };

/** Routines opened on the bot's page; they stay open when the list comes again. */
const openRoutines = new Set();

/**
 * The bot's routines on its page: a row each with name, when in words, next run and a switch active/paused; a tap on
 * the row opens the instruction, the actions and the last runs.
 */
export function renderRoutines() {
    el.infoRoutines.innerHTML = '';
    const list = state.routines.filter((r) => r.botId === state.infoBot);
    if (list.length === 0) el.infoRoutines.appendChild(node('li', 'empty-small', t('routine.none')));
    for (const r of list) {
        const open = openRoutines.has(r.id);
        const li = node('li', 'routine' + (r.enabled ? '' : ' off') + (open ? ' open' : ''));
        li.dataset.id = r.id;
        const head = node('div', 'r-head');
        const toggle = node('button', 'r-text');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(open));
        const status = r.lastStatus === 'error' ? ' ✗' : r.lastStatus === 'running' ? ' …' : ' ✓';
        const when = [cronText(r.cron)];
        if (!r.enabled) when.push(t('routine.paused'));
        else if (r.nextRun) when.push(t('routine.next', { time: runTime(r.nextRun) }));
        if (r.lastRun) when.push(t('routine.lastRun', { time: clockTime(r.lastRun) }) + status);
        toggle.append(node('strong', '', r.name), node('span', '', when.join(' · ')));
        toggle.addEventListener('click', () => {
            if (open) openRoutines.delete(r.id);
            else openRoutines.add(r.id);
            renderRoutines();
        });
        const active = /** @type {HTMLInputElement} */ (node('input', 'switch'));
        active.type = 'checkbox';
        active.checked = r.enabled;
        active.setAttribute('role', 'switch');
        active.title = t(r.enabled ? 'routine.activeOn' : 'routine.activeOff');
        active.setAttribute('aria-label', t('routine.activeSwitch', { name: r.name }));
        active.addEventListener('change', () => send({
            type: 'routine_save',
            routine: { id: r.id, botId: r.botId, name: r.name, cron: r.cron, prompt: r.prompt, enabled: active.checked, wake: !!r.wake },
        }));
        head.append(toggle, active);
        li.append(head);
        if (open) li.append(routineDetails(r));
        el.infoRoutines.appendChild(li);
    }
}

/** What an opened routine shows: instruction, actions, the last runs. */
function routineDetails(r) {
    const body = node('div', 'r-body');
    body.append(node('div', 'r-label', t('routine.instruction')), node('p', 'r-prompt', r.prompt));
    if (r.wake) body.append(node('p', 'hint', t('routine.wakesMachine')));
    const actions = node('div', 'r-actions');
    const button = (text, run) => {
        const k = node('button', 'btn small', text);
        k.type = 'button';
        k.addEventListener('click', run);
        actions.append(k);
        return k;
    };
    button(t('routine.runNow'), () => send({ type: 'routine_run', id: r.id })).dataset.action = 'run';
    button(t('routine.edit'), () => openRoutineEditor(r)).dataset.action = 'edit';
    button(t('routine.editInChat'), () => editRoutineInChat(r)).dataset.action = 'chat';
    body.append(actions, node('div', 'r-label', t('routine.history')));
    const runs = r.runs || [];
    if (!runs.length) {
        body.append(node('p', 'hint', t('routine.noRuns')));
        return body;
    }
    const ul = node('ul', 'r-runs');
    for (const x of runs) {
        const li = node('li', 'r-run st-' + x.status);
        const took = x.end ? duration(new Date(x.end).getTime() - new Date(x.start).getTime()) : '';
        li.append(node('span', 'r-when', runTime(x.start)), node('span', 'r-took', took), node('span', 'r-status', t(RUN_STATUS[x.status] || x.status)));
        if (x.entryId) {
            const go = node('button', 'link', t('routine.toAnswer'));
            go.type = 'button';
            go.addEventListener('click', () => {
                leaveInfo();
                openChat(r.botId, x.entryId);
            });
            li.append(go);
        }
        if (x.error) li.append(node('div', 'r-error', x.error));
        ul.append(li);
    }
    body.append(ul);
    return body;
}

/** "Edit in chat": the composer of the bot's chat gets the start of the request, the bot changes it (set_routine). */
function editRoutineInChat(r) {
    const chatId = state.infoChat || r.botId;
    leaveInfo();
    openChat(chatId);
    const p = paneFor(chatId);
    if (!p) return;
    const text = p.el.text;
    const start = t('routine.editInChatText', { name: r.name });
    // a draft stays; the request starts on a line of its own after it
    text.value = text.value.trim() ? `${text.value.trimEnd()}\n${start}` : start;
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
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

// ================================================================ The bot's voice

/** The bot's own voice per provider while the editor is open; saved with the bot. */
let editorVoices = {};

/** The bot the editor shows, as far as the voice needs it: its machine (also a new one's) and name. */
function editedBot() {
    const b = state.editorBot;
    return { ...b, machine: el.editorMachine.value || (b && b.machine) || '', name: el.editorName.value.trim() };
}

/**
 * The voices of the provider that reads for this bot right now, with "as the kind above" first. Without a voice of
 * the backend (no key, no machine that reads aloud) only a hint: the device reads and has nothing to choose.
 */
export function renderVoiceChoice() {
    stopPreview();
    const where = backendVoice(editedBot());
    el.editorVoiceChoice.hidden = !where;
    el.editorVoiceHint.hidden = Boolean(where);
    el.editorVoiceHint.textContent = where ? '' : t('editor.voiceDeviceOnly');
    if (!where) return;
    el.editorVoiceWhere.textContent = t(`editor.voiceWhere.${where.provider}`, { machine: upper(where.machine) });
    const language = (state.settings && state.settings.language) || 'en';
    const kindText = (k) => (k ? t(k === 'male' ? 'editor.voiceKindMale' : 'editor.voiceKindFemale') : '');
    const kind = el.editorVoice.value || guessVoice(el.editorName.value);
    const options = [['', t('editor.voiceOwnDefault', { voice: kindText(kind) })]];
    for (const v of VOICE_CATALOG[where.provider]) {
        if (v.lang && v.lang !== language) continue;
        const name = where.provider === 'local' ? v.id.split('-')[1].replace(/_/g, ' ') : v.id;
        options.push([v.id, `${name[0].toUpperCase()}${name.slice(1)}${v.kind ? ` · ${kindText(v.kind)}` : ''}`]);
    }
    el.editorVoiceName.replaceChildren(...options.map(([value, text]) => {
        const o = /** @type {HTMLOptionElement} */ (node('option', '', text));
        o.value = value;
        return o;
    }));
    const chosen = editorVoices[where.provider] || '';
    el.editorVoiceName.value = options.some(([value]) => value === chosen) ? chosen : '';
}

/** A voice chosen: kept for this provider; its kind becomes the bot's kind, so the other voices match it. */
export function chooseVoiceName() {
    const where = backendVoice(editedBot());
    if (!where) return;
    const id = el.editorVoiceName.value;
    if (id) editorVoices[where.provider] = id;
    else delete editorVoices[where.provider];
    const v = VOICE_CATALOG[where.provider].find((x) => x.id === id);
    if (v && v.kind) el.editorVoice.value = v.kind;
    renderVoiceChoice();
}

/** "Listen": a sample sentence in the chosen voice, or in the kind's when none is chosen. */
export function listenToVoice() {
    const where = backendVoice(editedBot());
    if (!where) return;
    const button = el.editorVoiceListen;
    button.disabled = true;
    const kind = el.editorVoice.value || guessVoice(el.editorName.value);
    previewVoice(where, el.editorVoiceName.value, /** @type {'female' | 'male'} */ (kind), (error) => {
        button.disabled = false;
        if (error) toast(t('editor.voiceListenFailed', { error }));
    });
}
