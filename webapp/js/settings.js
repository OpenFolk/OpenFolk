/* OpenFolk web app: settings (appearance, language, autologin per machine, entry to notifications and devices). */
import { BACKEND_LANGUAGE_KEY, LANGUAGE_KEY, i18n, isLanguage, locale, readSetting, resolveLanguage, setLanguage, t, writeSetting } from './i18n.js';
import { THEME_KEY, deviceAccounts, el, node, state, storage, toast } from './core.js';
import { clockTime, e2e, send, upper } from './e2e.js';
import { askAutologon, machineCan } from './machines.js';
import { setShowAllAccounts, showAllAccounts } from './others.js';
import { qrSvg } from './qr-login.js';
import { layoutPanes } from './panes.js';
import { relayAddress } from './platform.js';
import { loadPushSettings } from './push.js';
import { loadAccounts } from './accounts.js';
import { relayClaimForm } from './relay-claim.js';

// ================================================================ Settings

/** Machines whose autologin is being switched (until their backend reports the new state). */
const autologonPending = new Set();

/** Saves waiting for their backend's answer: machine names, '*' for the shared settings; the answer shows a toast. */
const savePending = new Set();

/** A backend answered with its settings: if this page asked for the change, it is saved. */
export function settingsSaved(key) {
    if (savePending.delete(key)) toast(t('settings.saved'));
}

/** A save was refused (the error says why): no toast for it. */
export function settingsSaveFailed() {
    savePending.clear();
}

export function openSettings() {
    el.settingsTheme.value = storage.get(THEME_KEY) || 'auto';
    el.settingsLanguage.value = readSetting(LANGUAGE_KEY);
    el.settingsAllAccountsField.hidden = deviceAccounts().length < 2;
    el.settingsAllAccounts.checked = showAllAccounts();
    // Query the state fresh: the backend caches it for up to a minute, a password stored just now would be missing
    for (const h of state.online) if (machineCan(h, 'autologon')) send({ type: 'machine_autologon' }, h);
    // Answered for the main account only; then "Add machine" and "Log out" for joined machines appear
    send({ type: 'machine_tokens' });
    renderMachineJoin(null);
    renderSettings();
    loadPushSettings();
    loadDevices();
    // Relays without accounts know no account frames
    if (state.account) loadAccounts();
    el.settings.hidden = false;
    layoutPanes();
}

/** The settings, scrolled to one of their blocks (notifications, devices, accounts). */
export function openSettingsAt(block) {
    openSettings();
    block.scrollIntoView({ block: 'start' });
}

/** The devices block: the list, the end-to-end key and the second factor, fresh from the relay. */
function loadDevices() {
    el.deviceList.replaceChildren(node('li', 'empty-small', t('common.loading')));
    showE2eStatus();
    renderPairLink(null);
    el.totpTitle.hidden = el.totpBox.hidden = true;
    send({ type: 'devices' });
    send({ type: 'totp_status' });
}

/** Moving from the relay embedded in a backend to one on a server; only while a machine runs it. */
function renderRelayClaim() {
    const form = relayClaimForm(renderRelayClaim);
    el.relayClaimBox.hidden = !form;
    el.relayClaimBox.querySelector('form')?.remove();
    if (form) el.relayClaimBox.append(form);
}

export function renderSettings() {
    const st = state.machineStatus;
    const joined = (state.machineTokens || []).map((x) => x.machine);
    const hosts = [...new Set([...state.online, ...(st ? Object.keys(st.hosts || {}) : []), ...joined])].sort();
    el.machineAddRow.hidden = !state.machineTokens || !state.online.length;
    el.settingsMachines.innerHTML = '';
    if (!hosts.length) el.settingsMachines.appendChild(node('li', 'empty-small', t('settings.noMachine')));
    for (const h of hosts) {
        const connected = state.online.includes(h);
        const available = machineCan(h, 'autologon');
        const auto = connected && available ? state.autologon[h] : null;
        const pending = autologonPending.has(h);
        const li = node('li', '');
        const label = document.createElement('label');
        label.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = Boolean(auto && auto.on);
        // Switching off always works, switching on only with a stored password
        box.disabled = !auto || pending || Boolean(state.shuttingDown[h]) || (!auto.on && !auto.password);
        box.addEventListener('change', () => {
            const on = box.checked;
            box.checked = !on;
            if (!askAutologon(h, on)) return;
            autologonPending.add(h);
            renderSettings();
        });
        label.append(box, node('strong', '', upper(h)), node('span', '', t('settings.autologon')));
        const hint = !connected ? t('settings.autologonAsleep')
            : !available ? t('settings.autologonUnavailable')
            : pending ? t('settings.autologonSwitching')
                : !auto ? t('settings.autologonQuerying')
                    : !auto.on && !auto.password ? t('settings.autologonNoPassword')
                        : auto.on ? t('settings.autologonOn') : t('settings.autologonOff');
        li.append(label, node('span', 'settings-hint', hint));
        if (joined.includes(h)) li.appendChild(machineLogout(h));
        const ms = connected ? state.machineSettings[h] : null;
        if (ms) li.appendChild(machineForm(h, ms));
        el.settingsMachines.appendChild(li);
    }
    renderSharedSettings();
    renderRelayClaim();
}

// ---------------------------------------------------------------- Machines joined by invitation

/** A joined machine: log it out at the relay (its token is gone, its backend disconnected). */
function machineLogout(host) {
    const row = node('div', 'settings-machine-joined');
    row.appendChild(node('span', 'settings-hint', t('machines.joined')));
    const b = node('button', 'btn small danger', t('machines.logout'));
    b.type = 'button';
    b.addEventListener('click', () => {
        if (confirm(t('machines.logoutConfirm', { machine: upper(host) }))) send({ type: 'machine_token_remove', machine: host });
    });
    row.appendChild(b);
    return row;
}

/** From the relay ("machine_tokens"): the main account may add and log out machines. */
export function receiveMachineTokens(list) {
    state.machineTokens = list;
    if (!el.settings.hidden) renderSettings();
}

/** "Add machine": a backend that is awake builds the invitation (it has the end-to-end key). */
export function askMachineJoin() {
    const machine = state.online[0];
    if (!machine) return;
    el.machineAdd.disabled = true;
    send({ type: 'machine_join_link' }, machine);
}

/**
 * The invitation from a backend ("machine_join_link"): the command to run on the new machine, to copy, and until when
 * it works. `null` clears the box.
 * @param {{ url: string, command: string, expiresAt: string, e2e: boolean } | null} invite
 */
export function renderMachineJoin(invite) {
    el.machineAdd.disabled = false;
    el.machineJoin.hidden = !invite;
    el.machineJoin.replaceChildren();
    if (!invite) return;
    const command = /** @type {HTMLInputElement} */ (node('input'));
    command.type = 'text';
    command.readOnly = true;
    command.value = invite.command;
    command.addEventListener('focus', () => command.select());
    const copy = node('button', 'btn small', t('pair.copy'));
    copy.type = 'button';
    copy.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(invite.command).then(() => { copy.textContent = t('pair.copied'); }, () => undefined);
    });
    const row = node('div', 'pair-url');
    row.append(command, copy);
    el.machineJoin.append(node('p', '', t('machines.joinIntro')), row,
        node('p', 'hint', t(invite.e2e ? 'machines.joinHint' : 'machines.joinHintNoKey', { until: clockTime(invite.expiresAt) })));
}

export function machineJoinError(message) {
    el.machineAdd.disabled = false;
    alert(message);
}

// ---------------------------------------------------------------- Settings of one machine

/** Machines whose settings are unfolded, so a new state from the backend does not fold them again. */
const openMachines = new Set();

/** @param {{ anthropicKey?: string, gitPushToken?: string, engineKeys?: Record<string, string> }} [secrets] */
function sendMachine(host, settings, secrets = {}) {
    savePending.add(host);
    send({ type: 'machine_settings_save', settings, ...secrets }, host);
}

/** A labelled select; `options`: [value, text key]. */
function selectField(textKey, value, options, onChange, disabled = false) {
    const label = node('label', '');
    const select = /** @type {HTMLSelectElement} */ (node('select'));
    for (const [v, k] of options) {
        const o = /** @type {HTMLOptionElement} */ (node('option', '', t(k)));
        o.value = v;
        select.appendChild(o);
    }
    select.value = value;
    select.disabled = disabled;
    select.addEventListener('change', () => onChange(select.value));
    label.append(node('span', '', t(textKey)), select);
    return label;
}

function checkField(textKey, checked, onChange, disabled = false) {
    const label = node('label', 'check');
    const box = /** @type {HTMLInputElement} */ (node('input'));
    box.type = 'checkbox';
    box.checked = checked;
    box.disabled = disabled;
    box.addEventListener('change', () => onChange(box.checked));
    label.append(box, node('span', '', t(textKey)));
    return label;
}

/** A text field, sent when it is left with a changed value. */
function textField(textKey, value, onChange, placeholderKey = '') {
    const label = node('label', '');
    const input = /** @type {HTMLInputElement} */ (node('input'));
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholderKey ? t(placeholderKey) : '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('change', () => { if (input.value.trim() !== value) onChange(input.value.trim()); });
    label.append(node('span', '', t(textKey)), input);
    return label;
}

function numberField(textKey, value, max, onChange, disabled = false) {
    const label = node('label', 'settings-number');
    const input = /** @type {HTMLInputElement} */ (node('input'));
    input.type = 'number';
    input.min = '0';
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.disabled = disabled;
    input.addEventListener('change', () => {
        const n = Number(input.value);
        if (Number.isInteger(n) && n >= 0 && n <= max) onChange(n);
        else input.value = String(value);
    });
    label.append(node('span', '', t(textKey)), input);
    return label;
}

/**
 * An API key: whether one is stored, a field for a new one and, if stored, a button to remove it. The key itself
 * never comes back from a backend.
 */
export function keyField(box, textKey, stored, onSave, disabled = false) {
    box.replaceChildren();
    const head = node('div', 'settings-key-head');
    head.append(node('strong', '', t(textKey)), node('span', 'settings-hint', t(stored ? 'settings.keyStored' : 'settings.keyMissing')));
    const row = node('div', 'settings-key-row');
    const input = /** @type {HTMLInputElement} */ (node('input'));
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = t(stored ? 'settings.keyReplace' : 'settings.keyEnter');
    input.disabled = disabled;
    const save = node('button', 'btn small', t('settings.keySave'));
    save.type = 'button';
    save.disabled = disabled;
    save.addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) return;
        input.value = '';
        onSave(v);
    });
    row.append(input, save);
    if (stored) {
        const remove = node('button', 'btn small danger', t('settings.keyRemove'));
        remove.type = 'button';
        remove.disabled = disabled;
        remove.addEventListener('click', () => { if (confirm(t('settings.keyRemoveConfirm'))) onSave(''); });
        row.appendChild(remove);
    }
    box.append(head, row);
}

/** The engines in the order of the settings, with ENGINE_NAMES of shared/protocol.ts. */
const ENGINES = ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'];
const ENGINE_NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot', antigravity: 'Antigravity', opencode: 'OpenCode' };
/** How to sign in to the subscription on the machine itself. */
const SIGN_IN_COMMANDS = {
    claude: 'claude', codex: 'codex login', cursor: 'agent login', copilot: 'npx copilot login', antigravity: 'npm run acp-login -w local -- antigravity',
};

/**
 * `<machine>:<engine>` → the mode picked ("key", "both") while no key is stored yet: the field shows, saving sends key
 * and choice together.
 */
const keyWanted = new Map();

/** Claude on subscription and key: when to switch, the daily cap for the key, and where the sessions run right now. */
function fallbackRules(host, ms) {
    const s = ms.settings;
    const box = node('div', 'settings-fallback');
    box.appendChild(selectField('settings.fallbackWhen', s.claudeFallback, [['limit', 'settings.fallbackLimit'], ['warning', 'settings.fallbackWarning']],
        (v) => sendMachine(host, { claudeFallback: v })));
    box.appendChild(numberField('settings.keyBudget', s.claudeKeyBudgetUsd, 10000, (v) => sendMachine(host, { claudeKeyBudgetUsd: v })));
    const f = ms.keyFallback;
    if (f) {
        const usd = f.spentUsd.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const now = f.budgetReached ? t('settings.fallbackBudget', { usd })
            : f.active ? t('settings.fallbackOnKey', { until: clockTime(new Date((f.until || 0) * 1000).toISOString()), usd })
                : t('settings.fallbackOnSubscription', { usd });
        box.appendChild(node('p', 'settings-fallback-now', now));
    }
    box.appendChild(node('p', 'hint', t('settings.fallbackHint')));
    return box;
}

/**
 * The AI providers of one machine: which engines run there and, per engine, subscription or key; the key field only
 * for the key. Backends before the choice report neither `disabledEngines` nor `engineKeys`: then Claude alone.
 */
function providersForm(host, ms, details) {
    const s = ms.settings;
    const choice = Array.isArray(s.disabledEngines) && Boolean(ms.engineKeys);
    const off = choice ? s.disabledEngines : [];
    const statuses = (state.setupPerMachine[host] || {}).engines || {};
    details.appendChild(node('h4', '', t('settings.providers')));
    if (choice) details.appendChild(node('p', 'hint', t(off.length === ENGINES.length ? 'settings.providersNone' : 'settings.providersHint')));
    for (const engine of choice ? ENGINES : ['claude']) {
        const on = !off.includes(engine);
        if (choice) {
            const label = node('label', 'check settings-engine-switch');
            const box = /** @type {HTMLInputElement} */ (node('input'));
            box.type = 'checkbox';
            box.checked = on;
            box.dataset.engine = engine;
            box.addEventListener('change', () => sendMachine(host, { disabledEngines: box.checked ? off.filter((e) => e !== engine) : [...off, engine] }));
            label.append(box, node('strong', '', ENGINE_NAMES[engine]));
            details.appendChild(label);
        } else {
            details.appendChild(node('strong', '', ENGINE_NAMES[engine]));
        }
        if (!on) continue;
        const part = node('div', 'settings-engine');
        part.dataset.engine = engine;
        const status = statuses[engine];
        part.appendChild(node('span', 'settings-hint', t(status === 'ready' ? 'settings.engineReady' : status === 'sign_in' ? 'settings.engineSignIn'
            : status === 'missing' ? 'settings.engineMissing' : 'settings.engineChecking')));
        if (engine === 'opencode') {
            part.appendChild(node('p', 'hint', t('settings.opencodeHint')));
            details.appendChild(part);
            continue;
        }
        const claude = engine === 'claude';
        const stored = claude ? ms.anthropicKey : Boolean(ms.engineKeys && ms.engineKeys[engine]);
        const auth = (claude ? s.claudeAuth : (s.engineAuth || {})[engine]) || 'subscription';
        const wanted = `${host}:${engine}`;
        const mode = keyWanted.get(wanted) || auth;
        /** The sign-in as a settings patch. */
        const authPatch = (v) => (claude ? { claudeAuth: v } : { engineAuth: { ...s.engineAuth, [engine]: v } });
        /** A key as the frame wants it ('' removes). */
        const keyPatch = (v) => (claude ? { anthropicKey: v } : { engineKeys: { [engine]: v } });
        const modes = [['subscription', `settings.authSubscription.${engine}`], ['apikey', `settings.authKey.${engine}`]];
        // Subscription and key by rules: Claude only, from backends that know the rules
        if (claude && typeof s.claudeKeyBudgetUsd === 'number') modes.push(['both', 'settings.authBoth']);
        part.appendChild(selectField('settings.engineAuth', mode, modes, (v) => {
            if (v !== 'subscription' && !stored) {
                // The backend switches to a key only once one is stored: first the field, then both at once
                keyWanted.set(wanted, v);
                renderSettings();
                return;
            }
            keyWanted.delete(wanted);
            if (v === auth) renderSettings();
            else sendMachine(host, authPatch(v));
        }));
        if (mode !== 'subscription') {
            const key = node('div', 'settings-key');
            keyField(key, `settings.engineKey.${engine}`, stored, (v) => {
                keyWanted.delete(wanted);
                // A key on its way switches over; without a key the machine goes back to the subscription
                sendMachine(host, authPatch(v ? mode : 'subscription'), keyPatch(v));
            });
            part.append(key, node('p', 'hint', t('settings.engineKeyHint')));
            if (claude && auth === 'both') part.appendChild(fallbackRules(host, ms));
        } else if (status === 'sign_in' || status === 'missing') {
            const how = node('p', 'hint', t('settings.engineHow') + ' ');
            how.appendChild(node('code', '', SIGN_IN_COMMANDS[engine]));
            part.appendChild(how);
        }
        details.appendChild(part);
    }
}

/** The AI providers, shutting down, handing chats over, the git token and voice messages of one machine. */
function machineForm(host, ms) {
    const s = ms.settings;
    const set = (patch) => sendMachine(host, patch);
    const details = /** @type {HTMLDetailsElement} */ (node('details', 'settings-machine'));
    details.open = openMachines.has(host);
    details.addEventListener('toggle', () => { if (details.open) openMachines.add(host); else openMachines.delete(host); });
    details.appendChild(node('summary', '', t('settings.machineMore')));

    providersForm(host, ms, details);

    details.appendChild(node('h4', '', t('settings.shutdown')));
    const noShutdown = !ms.offers.shutdown;
    details.appendChild(checkField('settings.shutdownAllowed', s.shutdown && !noShutdown, (v) => set({ shutdown: v }), noShutdown));
    details.appendChild(node('p', 'hint', noShutdown ? t('settings.shutdownUnavailable') : t('settings.shutdownHow', { method: ms.shutdownMethod })));
    const off = noShutdown || !s.shutdown;
    details.appendChild(numberField('settings.shutdownDelay', s.shutdownDelaySeconds, 3600, (v) => set({ shutdownDelaySeconds: v }), off));
    details.appendChild(selectField('settings.afterWake', s.afterWake, [['ifIdle', 'settings.afterWakeIfIdle'], ['always', 'settings.afterWakeAlways'], ['never', 'settings.afterWakeNever']],
        (v) => set({ afterWake: v }), off));
    const afterOff = off || s.afterWake === 'never';
    details.appendChild(numberField('settings.afterWakeSeconds', s.afterWakeSeconds, 3600, (v) => set({ afterWakeSeconds: v }), afterOff));
    details.appendChild(numberField('settings.afterWakeWait', s.afterWakeWaitMinutes, 1440, (v) => set({ afterWakeWaitMinutes: v }), afterOff));
    details.appendChild(numberField('settings.idleMinutes', s.idleMinutes, 1440, (v) => set({ idleMinutes: v }), afterOff || s.afterWake !== 'ifIdle'));

    details.appendChild(node('h4', '', t('settings.handover')));
    details.appendChild(checkField('settings.handoverIde', s.handoverIde && ms.offers.ide, (v) => set({ handoverIde: v }), !ms.offers.ide));
    details.appendChild(checkField('settings.handoverTerminal', s.handoverTerminal && ms.offers.terminal, (v) => set({ handoverTerminal: v }), !ms.offers.terminal));

    details.appendChild(node('h4', '', t('settings.git')));
    details.appendChild(textField('settings.gitPushHost', s.gitPushHost, (v) => set({ gitPushHost: v }), 'settings.gitPushHostExample'));
    details.appendChild(textField('settings.gitPushUser', s.gitPushUser, (v) => set({ gitPushUser: v })));
    const gitKey = node('div', 'settings-key');
    keyField(gitKey, 'settings.gitPushToken', ms.gitPushToken, (v) => sendMachine(host, {}, { gitPushToken: v }));
    details.appendChild(gitKey);
    details.appendChild(node('p', 'hint', t('settings.gitPushHint')));

    details.appendChild(node('h4', '', t('settings.voice')));
    if (ms.voice) details.appendChild(voiceSetupRow(host, ms.voice));
    details.appendChild(selectField('settings.voiceModel', s.voiceModel, [['', 'settings.voiceModelAuto'], ['large-v3-turbo', 'settings.voiceModelLarge'],
        ['medium', 'settings.voiceModelMedium'], ['small', 'settings.voiceModelSmall'], ['base', 'settings.voiceModelBase']], (v) => set({ voiceModel: v })));
    details.appendChild(selectField('settings.voiceDevice', s.voiceDevice, [['auto', 'settings.voiceDeviceAuto'], ['cuda', 'settings.voiceDeviceCuda'], ['cpu', 'settings.voiceDeviceCpu']],
        (v) => set({ voiceDevice: v })));
    details.appendChild(checkField('settings.voicePreload', s.voicePreload, (v) => set({ voicePreload: v })));
    return details;
}

/** Whether voice messages work on the machine, and the button that sets them up. */
function voiceSetupRow(host, voice) {
    const row = node('div', 'settings-voice-setup');
    const detail = voice.detail === 'no_python' ? t('settings.voiceNoPython') : voice.detail || '';
    const text = voice.state === 'ready' ? t('settings.voiceReady')
        : voice.state === 'installing' ? t(voice.detail === 'packages' ? 'settings.voiceInstallingPackages' : 'settings.voiceInstalling')
            : voice.state === 'failed' ? t('settings.voiceFailed', { error: detail })
                : voice.state === 'unavailable' ? t('settings.voiceUnavailable') : t('settings.voiceMissing');
    row.appendChild(node('span', 'settings-hint', text));
    if (voice.state === 'missing' || voice.state === 'failed') {
        const b = node('button', 'btn small', t(voice.state === 'failed' ? 'settings.voiceRetry' : 'settings.voiceSetup'));
        b.type = 'button';
        b.addEventListener('click', () => {
            b.disabled = true;
            send({ type: 'voice_setup' }, host);
        });
        row.appendChild(b);
    }
    return row;
}

// ---------------------------------------------------------------- Settings shared by the bots

/** Like the language, to every machine that is awake: each stores them, the sync settles the rest. */
function sendShared(settings, apiKeys) {
    if (state.online.length) savePending.add('*');
    for (const machine of state.online) send({ type: 'settings_save', settings, ...(apiKeys ? { apiKeys } : {}) }, machine);
}

export function renderSharedSettings() {
    const s = state.settings || {};
    const asleep = !state.online.length;
    el.settingsBotsAsleep.hidden = !asleep;
    for (const c of [el.settingsAvatarModel, el.settingsVoiceLanguage, el.settingsPushPreview, el.settingsGitPull]) c.disabled = asleep;
    el.settingsAvatarModel.value = s.avatarModel || 'gemini-3.1-flash-image';
    el.settingsVoiceLanguage.value = s.voiceLanguage || '';
    el.settingsPushPreview.value = s.pushPreview || 'title';
    el.settingsGitPull.checked = s.gitAutoPull !== false;
    renderAvatarKeys();
}

/** Only the key of the provider the chosen image model needs; the choice applies here at once, before the answer. */
export function renderAvatarKeys() {
    const keys = (state.settings || {}).apiKeys || {};
    const needed = el.settingsAvatarModel.value === 'gpt-image-1' ? 'openai' : 'gemini';
    for (const box of /** @type {NodeListOf<HTMLElement>} */ (el.settingsBots.querySelectorAll('.settings-key'))) {
        const name = box.dataset.key || '';
        box.hidden = name !== needed;
        keyField(box, `settings.key.${name}`, Boolean(keys[name]), (v) => sendShared({}, { [name]: v }), !state.online.length);
    }
}

/** A change on the settings page (start.js wires the fields). */
export function chooseShared(field, value) {
    sendShared({ [field]: value });
}

/** New state from a backend (or an error): switching is finished for this machine. */
export function autologonReported(host, ok = false) {
    if (autologonPending.delete(host) && ok) toast(t('settings.saved'));
    if (!el.settings.hidden) renderSettings();
}

/** The shared chat list of all accounts this device is signed in to, on or off (others.js). */
export function chooseAllAccounts() {
    setShowAllAccounts(el.settingsAllAccounts.checked);
    toast(t('settings.saved'));
}

// ---------------------------------------------------------------- Language

/** Machines this page has already told the browser language (once per page, see receiveSettings). */
const languageOffered = new Set();

/** Choice in the settings: '' = automatic, otherwise the language for this device and, shared, for the bots. */
export function chooseLanguage(value) {
    writeSetting(LANGUAGE_KEY, isLanguage(value) ? value : '');
    if (isLanguage(value)) for (const machine of state.online) send({ type: 'language', language: value }, machine);
    if (setLanguage(resolveLanguage())) document.dispatchEvent(new Event('openfolk:language'));
    toast(t('settings.saved'));
}

/**
 * Shared settings from a backend (the newest wins). The language applies here unless this device chose its own.
 * A backend whose language was never chosen (no `updatedAt`) gets this page's language once, so the bots answer
 * in the language of the first browser without anybody having to pick it.
 */
export function receiveSettings(settings, machine) {
    if (!settings) return;
    if (!settings.updatedAt) {
        if (machine && !languageOffered.has(machine)) {
            languageOffered.add(machine);
            send({ type: 'language', language: i18n.language }, machine);
        }
        return;
    }
    if (state.settings && (state.settings.updatedAt || '') > settings.updatedAt) return;
    state.settings = settings;
    if (!el.settings.hidden) renderSharedSettings();
    if (!isLanguage(settings.language)) return;
    writeSetting(BACKEND_LANGUAGE_KEY, settings.language);
    if (!readSetting(LANGUAGE_KEY) && setLanguage(settings.language)) document.dispatchEvent(new Event('openfolk:language'));
}

// ================================================================ Devices and keys

export function renderDevices(list, current) {
    el.deviceList.innerHTML = '';
    for (const d of list) {
        const li = node('li', d.id === current ? 'current-device' : '');
        const text = node('div', 'd-text');
        const name = node('strong', '', d.name);
        if (d.id === current) name.appendChild(node('span', 'tag', t('devices.thisDevice')));
        text.append(name, node('span', '', t('devices.meta', { lastSeen: clockTime(d.lastSeen), ip: d.ip, created: new Date(d.created).toLocaleDateString(locale()) })));
        const logout = node('button', 'btn small danger', t('devices.logout'));
        logout.type = 'button';
        logout.addEventListener('click', () => {
            const question = d.id === current ? t('devices.logoutThisConfirm') : t('devices.logoutConfirm', { name: d.name });
            if (confirm(question)) send({ type: 'device_logout', id: d.id });
        });
        li.append(text, logout);
        el.deviceList.appendChild(li);
    }
    if (!list.length) el.deviceList.appendChild(node('li', 'empty-small', t('devices.none')));
}

/**
 * Pairing link for one more device (from a backend, "pair_link"): the link to copy, the QR code and until when it
 * works. `null` clears the box; the button is usable again once a backend answered or on opening the dialog. The
 * invitation to a new account (accounts.js) shows the same in its own box with its own hint.
 * @param {{ url: string, expiresAt: string, svg: string, e2e: boolean } | null} link
 * @param {HTMLElement} [box]
 * @param {string} [hint]
 */
export function renderPairLink(link, box = el.pairBox, hint) {
    if (box === el.pairBox) el.pairCreate.disabled = false;
    box.hidden = !link;
    box.replaceChildren();
    if (!link) return;
    const qr = node('div', 'pair-qr');
    // SVG from the backend (qrcode library), sanitized like everything else that arrives as markup
    qr.innerHTML = DOMPurify.sanitize(link.svg, { USE_PROFILES: { svg: true } });
    const url = /** @type {HTMLInputElement} */ (node('input'));
    url.type = 'text';
    url.readOnly = true;
    url.value = link.url;
    url.addEventListener('focus', () => url.select());
    const copy = node('button', 'btn small', t('pair.copy'));
    copy.type = 'button';
    copy.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(link.url).then(() => { copy.textContent = t('pair.copied'); }, () => undefined);
    });
    const row = node('div', 'pair-url');
    row.append(url, copy);
    box.append(qr, row, node('p', 'hint', hint || t(link.e2e ? 'pair.hintWithKey' : 'pair.hint', { until: clockTime(link.expiresAt) })));
}

// ---------------------------------------------------------------- Second factor

/** A code field and a button; the code goes to the relay with `type`. */
function totpCodeRow(buttonKey, type, danger = false) {
    const row = node('div', 'totp-row');
    const input = /** @type {HTMLInputElement} */ (node('input'));
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    // room for the space many authenticator apps show in the middle
    input.maxLength = 7;
    input.placeholder = t('totp.codePlaceholder');
    const b = node('button', danger ? 'btn danger' : 'btn', t(buttonKey));
    b.type = 'button';
    const go = () => {
        const code = input.value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) return totpError(t('totp.sixDigits'));
        el.totpBox.querySelector('.error')?.remove();
        send({ type, code });
    };
    b.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    row.append(input, b);
    return row;
}

/** State from the relay ("totp"): set up or not; nothing at all for an account that may not set it. */
export function renderTotp(status) {
    el.totpTitle.hidden = el.totpBox.hidden = !status.available;
    el.totpBox.replaceChildren();
    if (!status.available) return;
    if (status.active) {
        el.totpBox.append(node('p', '', '🔐 ' + t('totp.on')), node('p', 'hint', t('totp.offHint')), totpCodeRow('totp.switchOff', 'totp_off', true));
        return;
    }
    const start = node('button', 'btn', t('totp.setUp'));
    start.type = 'button';
    start.addEventListener('click', () => {
        let label = 'OpenFolk';
        try { label = new URL(relayAddress()).host || label; } catch { /* keep the default */ }
        send({ type: 'totp_begin', label });
    });
    const actions = node('div', 'actions left');
    actions.appendChild(start);
    el.totpBox.append(node('p', '', t('totp.offText')), actions);
}

/** The new secret: QR code for the authenticator app, the key to type in, and the confirmation with a code. */
export function renderTotpSetup(setup) {
    el.totpBox.replaceChildren();
    const qr = node('div', 'pair-qr');
    if (typeof (/** @type {any} */ (window).qrcode) === 'function') qr.appendChild(qrSvg(setup.uri));
    const key = node('code', 'totp-secret', setup.secret.replace(/(.{4})/g, '$1 ').trim());
    const cancel = node('button', 'btn small', t('common.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => send({ type: 'totp_status' }));
    el.totpBox.append(node('p', '', t('totp.scan')), qr, node('p', 'hint', t('totp.typeKey')), key, node('p', '', t('totp.confirmText')),
        totpCodeRow('totp.confirm', 'totp_confirm'), cancel);
    /** @type {HTMLInputElement | null} */ (el.totpBox.querySelector('input'))?.focus();
}

export function totpError(message) {
    el.totpBox.querySelector('.error')?.remove();
    const p = node('p', 'error', message);
    const row = el.totpBox.querySelector('.totp-row');
    if (row) row.after(p);
    else el.totpBox.appendChild(p);
}

export function showE2eStatus() {
    el.e2eStatus.textContent = e2e.key
        ? '🔒 ' + t('e2e.statusOn')
        : e2e.seenActive ? t('e2e.statusMissing') : t('e2e.statusOff');
    el.e2eDelete.hidden = !e2e.key;
}
