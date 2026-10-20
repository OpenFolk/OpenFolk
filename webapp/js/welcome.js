/* OpenFolk web app: the first steps, shown in place of the chat list while there is nothing to show yet. */
import { t } from './i18n.js';
import { node, state } from './core.js';
import { send, upper } from './e2e.js';
import { keyField } from './settings.js';
import { renderChatList } from './list.js';
import { relayClaimForm } from './relay-claim.js';

/** Engines the web app can sign in with a device code (DEVICE_LOGIN_ENGINES in shared/protocol.ts). */
const DEVICE_LOGIN = ['codex', 'copilot'];
const ENGINES = ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'];
const ENGINE_NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot', antigravity: 'Antigravity', opencode: 'OpenCode' };
/** The engines ticked in the first steps, sent together with the button: one at a time would end the step at the first. */
const picked = new Set();
/** The sign-in terminal asked for on a machine: on its way, open, or why it failed. */
let terminal = /** @type {{ machine: string, state: 'opening' | 'open' | 'failed', message?: string } | null} */ (null);
/** The API key being typed: the list renders anew with every state that arrives, the field must not lose it. */
const keyDraft = { value: '', focused: false };

/**
 * The backend's answer to "claude_sign_in": the terminal is open, or why not.
 * @param {string} machine
 * @param {string} [message]
 */
export function signInTerminalAnswer(machine, message = '') {
    if (!terminal || terminal.machine !== machine) return;
    terminal = message ? { machine, state: 'failed', message } : { machine, state: 'open' };
    renderChatList();
}

/**
 * @typedef {{ title?: string, done: boolean, text: string, code?: string, buttons?: { label: string, run: () => void, disabled?: boolean }[], extra?: HTMLElement }} Step
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
    return { done: false, text: t('welcome.aiChoose', { machine: upper(machine) }), extra: box };
}

/**
 * The sign-in step from the machines' setup_status: done once one machine has an engine that is ready. Backends from
 * before setup_status report nothing; then the step counts as done, as it did before it existed.
 * @returns {Step}
 */
function signInStep() {
    const known = state.online.filter((m) => state.setupPerMachine[m]);
    if (!known.length) return { done: true, text: t('welcome.aiDone') };
    const ready = known.filter((m) => Object.values(state.setupPerMachine[m].engines || {}).includes('ready'));
    if (ready.length) return { done: true, text: t('welcome.aiDone') };
    const machine = known[0];
    const s = state.setupPerMachine[machine];
    if (s.noEngine) return chooseStep(machine);
    const engines = s.engines || {};
    if (!Object.keys(engines).length) return { done: false, text: t('welcome.aiChecking', { machine: upper(machine) }) };
    // Without Claude among the engines picked: the others' sign-in, the commands are in the settings
    const claude = 'claude' in engines;
    // The backend opens a terminal with Claude Code itself: the desktop apps bring it without a `claude` on the PATH
    const opens = claude && Boolean(s.claudeTerminal);
    /** @type {Step} */
    const step = {
        done: false,
        text: t(!claude ? 'welcome.aiOther' : s.container ? 'welcome.aiContainer' : opens ? 'welcome.aiTerminal' : 'welcome.aiText', { machine: upper(machine) }),
        // Another account than the machine's owner signs in into a folder of its own; the backend knows which
        code: !claude || opens ? '' : s.claudeCommand || (s.container ? 'docker compose -f docker-compose.server.yml exec -u node local claude' : 'claude'),
        buttons: [
            ...(opens ? [{
                label: t('welcome.aiTerminalButton'),
                disabled: terminal?.machine === machine && terminal.state === 'opening',
                run: () => {
                    // The list renders again only after the tap lock: a second tap before must not open a second terminal
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
        extra.append(terminal.state === 'open' ? node('p', 'welcome-login', t('welcome.aiTerminalOpen', { machine: upper(machine) }))
            : node('p', 'welcome-login error', t('welcome.aiTerminalFailed', { error: terminal.message || '' })));
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
        extra.append(node('p', 'hint', t('welcome.aiKey')), key);
        // Once the list has put the field on the page again
        if (keyDraft.focused) queueMicrotask(() => input.focus());
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
 * Four steps a new installation goes through: a machine with a backend, a sign-in to an AI provider there, the first
 * bot, the other devices. Steps that are done get a check mark; the next open one carries its button. Re-rendered
 * with the chat list, so it follows the machines, their sign-ins and the bots as they appear.
 * @param {{ newBot: () => void, devices: () => void }} actions
 */
export function renderWelcome(actions) {
    const box = node('li', 'welcome');
    box.append(node('h2', '', t('welcome.title')), node('p', 'welcome-intro', t('welcome.intro')));
    const machineDone = state.online.length > 0;
    const botDone = state.bots.length > 0;
    const ai = machineDone ? signInStep() : { done: false, text: t('welcome.aiWaiting') };
    // Only this computer reaches an embedded relay; a phone needs a relay of one's own on a server
    const embedded = state.online.some((m) => state.setupPerMachine[m]?.relay === 'embedded');
    /** @type {Step[]} */
    const steps = [
        {
            done: machineDone,
            title: t('welcome.machine'),
            text: machineDone ? t('welcome.machineDone', { machines: state.online.map(upper).join(', ') })
                : state.onlineKnown ? t('welcome.machineOff') : t('welcome.machineConnecting'),
            code: machineDone || !state.onlineKnown ? '' : 'npm start',
        },
        { title: t('welcome.ai'), ...ai },
        {
            done: botDone,
            title: t('welcome.bot'),
            text: botDone ? t('welcome.botDone') : t('welcome.botText'),
            buttons: botDone || !machineDone ? [] : [{ label: t('welcome.botButton'), run: actions.newBot }],
        },
        {
            done: false,
            title: t('welcome.devices'),
            text: t('welcome.devicesText') + (embedded ? ` ${t('welcome.devicesEmbedded')}` : ''),
            buttons: machineDone && !embedded ? [{ label: t('welcome.devicesButton'), run: actions.devices }] : [],
            // The phone needs a relay on a server: claim it from here, the backend moves over
            extra: (embedded && relayClaimForm(renderChatList)) || undefined,
        },
    ];
    const list = node('ol', 'welcome-steps');
    steps.forEach((s, i) => {
        const item = node('li', s.done ? 'done' : '');
        const mark = node('span', 'welcome-mark', s.done ? '✓' : String(i + 1));
        const body = node('div', 'welcome-body');
        body.append(node('strong', '', s.title), node('span', '', s.text));
        if (s.code && !s.done) body.append(node('code', '', s.code));
        for (const button of s.buttons ?? []) {
            const b = /** @type {HTMLButtonElement} */ (node('button', 'primary small', button.label));
            b.type = 'button';
            b.disabled = Boolean(button.disabled);
            b.addEventListener('click', button.run);
            body.append(b);
        }
        if (s.extra) body.append(s.extra);
        item.append(mark, body);
        list.append(item);
    });
    box.append(list);
    const docs = node('p', 'welcome-docs');
    docs.innerHTML = t('welcome.docs');
    box.append(docs);
    return box;
}
