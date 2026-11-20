/* OpenFolk web app: the sign-in to an AI provider in the start view, while no engine of a connected machine is ready. */
import { t } from './i18n.js';
import { el, node, state } from './core.js';
import { responsibleMachine, send, upper } from './e2e.js';
import { keyField } from './settings.js';
import { renderChatList } from './list.js';

/** Engines the web app can sign in with a device code (DEVICE_LOGIN_ENGINES in shared/protocol.ts). */
const DEVICE_LOGIN = ['codex', 'copilot'];
const ENGINES = ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'];
const ENGINE_NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot', antigravity: 'Antigravity', opencode: 'OpenCode' };
/** Where the Claude Console creates API keys. */
const CONSOLE_KEYS = 'https://platform.claude.com/settings/keys';
/** The engines ticked in the first steps, sent together with the button: one at a time would end the step at the first. */
const picked = new Set();
/** The Claude sign-in asked for on a machine: on its way, open in the browser or a terminal there, or why it failed. */
let terminal = /** @type {{ machine: string, state: 'opening' | 'browser' | 'open' | 'failed', message?: string } | null} */ (null);
/** The API key being typed: the list renders anew with every state that arrives, the field must not lose it. */
const keyDraft = { value: '', focused: false };

/**
 * The backend's answer to "claude_sign_in": the browser or the terminal is open, or why not.
 * @param {string} machine
 * @param {string} [message]
 * @param {'browser'} [via]
 */
export function signInTerminalAnswer(machine, message = '', via = undefined) {
    if (!terminal || terminal.machine !== machine) return;
    terminal = message ? { machine, state: 'failed', message } : { machine, state: via === 'browser' ? 'browser' : 'open' };
    renderChatList();
}

/**
 * @typedef {{ title?: string, done: boolean, lost?: boolean, text: string, code?: string, buttons?: { label: string, run: () => void, disabled?: boolean }[], extra?: HTMLElement }} Step
 */

/**
 * A new installation runs no engine until the user picks theirs. Only the main account receives and changes the
 * machine settings; another account waits for it.
 * @param {string} machine
 * @returns {Step}
 */
function chooseStep(machine) {
    if (!state.machineSettings[machine]) return { done: false, text: t('welcome.aiNoChoice', { machine: upper(machine) }) };
    const box = node('div', 'welcome-engines');
    const button = /** @type {HTMLButtonElement} */ (node('button', 'primary small', t('welcome.aiPick')));
    button.type = 'button';
    button.disabled = !picked.size;
    for (const engine of ENGINES) {
        const label = node('label', 'check');
        const tick = /** @type {HTMLInputElement} */ (node('input'));
        tick.type = 'checkbox';
        tick.checked = picked.has(engine);
        tick.dataset.engine = engine;
        tick.addEventListener('change', () => {
            if (tick.checked) picked.add(engine);
            else picked.delete(engine);
            button.disabled = !picked.size;
        });
        label.append(tick, node('span', '', ENGINE_NAMES[engine]));
        box.append(label);
    }
    button.addEventListener('click', () => send({ type: 'machine_settings_save', settings: { disabledEngines: ENGINES.filter((e) => !picked.has(e)) } }, machine));
    box.append(button);
    const extra = node('div', 'welcome-extra');
    extra.append(box, tryWithoutSignIn(machine, () => ENGINES.filter((e) => e !== 'opencode' && !picked.has(e))));
    return { done: false, text: t('welcome.aiChoose', { machine: upper(machine) }), extra };
}

/**
 * OpenCode's free models need no sign-in at all: a way to try OpenFolk without a subscription or a key, with what it
 * costs said next to it. Switches OpenCode on, besides what `off` leaves on.
 * @param {string} machine
 * @param {() => string[]} off the engines to stay off, at the time of the tap
 */
function tryWithoutSignIn(machine, off) {
    const box = node('div', 'welcome-try');
    const button = /** @type {HTMLButtonElement} */ (node('button', 'btn small', t('welcome.aiTry')));
    button.type = 'button';
    button.addEventListener('click', () => send({ type: 'machine_settings_save', settings: { disabledEngines: off() } }, machine));
    box.append(node('p', 'hint', t('welcome.aiTryHint')), button);
    return box;
}

/**
 * The sign-in step from the machines' setup_status: done once one machine has an engine that is ready. Backends from
 * before setup_status report nothing; then the step counts as done, as it did before it existed.
 * @returns {Step}
 */
function signInStep() {
    const known = state.online.filter((m) => state.setupPerMachine[m]);
    if (!known.length) return { done: true, text: t('welcome.aiDone') };
    const ready = (m) => Object.values(state.setupPerMachine[m].engines || {}).includes('ready');
    // A machine that runs bots and lost its sign-in (it expired, a token was revoked): named with its bots, also while
    // another machine is fine, since those bots answer nothing until it is signed in again
    const lost = known.find((m) => !ready(m) && Object.keys(state.setupPerMachine[m].engines || {}).length && botsOn(m).length);
    if (lost) {
        const step = machineStep(lost);
        return { ...step, lost: true, title: t('welcome.aiLostTitle', { machine: upper(lost) }), text: `${t('welcome.aiLost', { machine: upper(lost), bots: botsOn(lost).join(', ') })} ${step.text}` };
    }
    if (known.some(ready)) return { done: true, text: t('welcome.aiDone') };
    return machineStep(known[0]);
}

/** Names of the bots that run on a machine right now. */
function botsOn(machine) {
    return state.bots.filter((b) => responsibleMachine(b) === machine).map((b) => b.name);
}

/**
 * The sign-in on one machine, while none of its engines is ready.
 * @param {string} machine
 * @returns {Step}
 */
function machineStep(machine) {
    const s = state.setupPerMachine[machine];
    if (s.noEngine) return chooseStep(machine);
    const engines = s.engines || {};
    if (!Object.keys(engines).length) return { done: false, text: t('welcome.aiChecking', { machine: upper(machine) }) };
    // Without Claude among the engines picked: the others' sign-in, the commands are in the settings
    const claude = 'claude' in engines;
    // The backend signs in itself, in the browser there or a terminal: the desktop apps bring Claude Code without a `claude` on the PATH
    const opens = claude && Boolean(s.claudeTerminal);
    /** @type {Step} */
    const step = {
        done: false,
        text: t(!claude ? 'welcome.aiOther' : s.container ? 'welcome.aiContainer' : opens ? 'welcome.aiTerminal' : 'welcome.aiText', { machine: upper(machine) }),
        // Another account than the machine's owner signs in into a folder of its own; the backend knows which
        code: !claude || opens ? '' : s.claudeCommand || (s.container ? 'docker compose -f docker-compose.server.yml exec -u node local claude' : 'claude'),
        buttons: [
            ...(opens ? [{
                label: t('welcome.aiSignInButton'),
                disabled: terminal?.machine === machine && terminal.state === 'opening',
                run: () => {
                    // The list renders again only after the tap lock: a second tap before must not open a second terminal.
                    // A tap after the browser opened starts over there, for a tab closed too early.
                    if (terminal?.machine === machine && terminal.state === 'opening') return;
                    terminal = { machine, state: 'opening' };
                    send({ type: 'claude_sign_in' }, machine);
                    renderChatList();
                },
            }] : []),
            ...DEVICE_LOGIN.filter((e) => engines[e] === 'sign_in').map((e) => ({
                label: t(claude ? 'welcome.aiDevice' : 'welcome.aiDeviceOnly', { engine: ENGINE_NAMES[e] }),
                run: () => send({ type: 'engine_login', engine: e }, machine),
            })),
        ],
    };
    const extra = node('div', 'welcome-extra');
    if (opens && terminal?.machine === machine && terminal.state !== 'opening') {
        extra.append(terminal.state === 'failed' ? node('p', 'welcome-login error', t('welcome.aiSignInFailed', { error: terminal.message || '' }))
            : node('p', 'welcome-login', t(terminal.state === 'browser' ? 'welcome.aiBrowserOpen' : 'welcome.aiTerminalOpen', { machine: upper(machine) })));
    }
    // The machine's owner may use an API key instead; the key is the owner's only, another account cannot use it
    if (claude && state.machineSettings[machine]) {
        const key = node('div', 'settings-key welcome-key');
        keyField(key, 'settings.engineKey.claude', Boolean(state.machineSettings[machine].anthropicKey), (v) => {
            keyDraft.value = '';
            send({ type: 'machine_settings_save', settings: { claudeAuth: v ? 'apikey' : 'subscription' }, anthropicKey: v }, machine);
        });
        const input = /** @type {HTMLInputElement} */ (key.querySelector('input'));
        input.value = keyDraft.value;
        input.addEventListener('input', () => { keyDraft.value = input.value; });
        input.addEventListener('focus', () => { keyDraft.focused = true; });
        // Taking the field off the page blurs it too; only a field still on the page lost the focus to the user
        input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) keyDraft.focused = false; }));
        const hint = node('p', 'hint', `${t('welcome.aiKey')} `);
        const link = /** @type {HTMLAnchorElement} */ (node('a', '', t('welcome.aiKeyLink')));
        link.href = CONSOLE_KEYS;
        link.target = '_blank';
        link.rel = 'noreferrer';
        hint.append(link);
        extra.append(hint, key, node('p', 'hint', t('welcome.aiKeyBilling')));
        // Once the list has put the field on the page again
        if (keyDraft.focused) queueMicrotask(() => input.focus());
        // Neither a subscription nor a key at hand: OpenCode, if it is not on already (then it would be ready or missing)
        const disabled = state.machineSettings[machine].settings?.disabledEngines;
        if (Array.isArray(disabled) && disabled.includes('opencode')) extra.append(tryWithoutSignIn(machine, () => disabled.filter((e) => e !== 'opencode')));
    }
    // A device code on its way or shown: the link and the code to enter there, or why it failed
    const login = DEVICE_LOGIN.map((e) => state.engineLogin[`${machine}:${e}`]).find((l) => l && l.state !== 'done');
    if (login) {
        const box = node('div', 'welcome-login');
        if (login.state === 'code' && (login.url || '').startsWith('https://')) {
            const a = node('a', '', login.url);
            a.href = login.url;
            a.target = '_blank';
            a.rel = 'noreferrer';
            box.append(node('span', '', t('welcome.aiCode', { engine: ENGINE_NAMES[login.engine] })), a, node('code', '', login.code || ''));
        } else if (login.state === 'failed') {
            box.append(node('span', 'error', t('welcome.aiFailed', { engine: ENGINE_NAMES[login.engine], error: login.message || '' })));
        }
        extra.append(box);
    }
    if (extra.childElementCount) step.extra = extra;
    return step;
}

/**
 * The sign-in to an AI provider while a machine is connected and none of its engines is ready yet; null otherwise.
 * Shown in the start view next to the list (renderStartSetup) and, on a phone, where the start view is out of sight,
 * at the top of the list (list.js). Built anew with every render of the list, so it follows the sign-ins as they come.
 * @returns {HTMLElement | null}
 */
export function setupCard(lost = false) {
    const step = state.online.length ? signInStep() : null;
    // A machine that lost its sign-in is a matter of the status page (and the "!" on its tab), not of the chat list;
    // the list and the start view keep the first steps of a new installation
    if (!step || step.done || Boolean(step.lost) !== lost) return null;
    const body = node('div', 'welcome-body');
    body.append(node('strong', '', step.title || t('welcome.ai')), node('span', '', step.text));
    if (step.code) body.append(node('code', '', step.code));
    for (const button of step.buttons ?? []) {
        const b = /** @type {HTMLButtonElement} */ (node('button', 'primary small', button.label));
        b.type = 'button';
        b.disabled = Boolean(button.disabled);
        b.addEventListener('click', button.run);
        body.append(b);
    }
    if (step.extra) body.append(step.extra);
    return body;
}

/** Whether a machine that runs bots lost its sign-in (the status page shows it, its tab gets a "!"). */
export function signInLost() {
    return state.online.length > 0 && Boolean(signInStep().lost);
}

/** The start view's copy of the sign-in (setupCard), or nothing. */
export function renderStartSetup() {
    const box = el.chatSetup;
    if (!box) return;
    const card = setupCard();
    box.replaceChildren(...(card ? [card] : []));
    box.hidden = !card;
}
