/* OpenFolk web app: basics: DOM elements, state, Markdown, storage and small helpers. */
import { t } from './i18n.js';
import { bundled, relayAddress, setRelayAddress } from './platform.js';

/** @param {string} id */
export const $ = (id) => document.getElementById(id);

/**
 * Version of the messages this web app speaks, and the oldest backend version it still works with. Same meaning as
 * PROTOCOL_VERSION in shared/protocol.ts (a test keeps both equal); backends report theirs in "backend_status".
 */
export const PROTOCOL_VERSION = 2;
export const MIN_BACKEND_PROTOCOL = 0;
export const el = {
    app: $('app'), login: $('login'), loginForm: /** @type {HTMLFormElement} */ ($('login-form')), loginToken: /** @type {HTMLInputElement} */ ($('login-token')), loginRelay: /** @type {HTMLInputElement} */ ($('login-relay')), loginError: $('login-error'),
    loginTotp: /** @type {HTMLInputElement} */ ($('login-totp')), loginTotpField: $('login-totp-field'), loginName: /** @type {HTMLInputElement} */ ($('login-name')), loginIntro: $('login-intro'),
    settingsDevices: $('settings-devices'), deviceList: $('device-list'), e2eStatus: $('e2e-status'), relayClaimBox: $('relay-claim-box'),
    loginAccount: /** @type {HTMLInputElement} */ ($('login-account')), loginOtherAccount: $('login-other-account'), loginCancel: /** @type {HTMLButtonElement} */ ($('login-cancel')),
    accountSwitch: /** @type {HTMLButtonElement} */ ($('account-switch')), accountMenu: $('account-menu'),
    settingsAccounts: $('settings-accounts'), accountsOwnName: /** @type {HTMLInputElement} */ ($('accounts-own-name')), accountsPassword: /** @type {HTMLInputElement} */ ($('accounts-password')),
    accountsOwnHint: $('accounts-own-hint'), accountsOwnSave: /** @type {HTMLButtonElement} */ ($('accounts-own-save')), accountsList: $('accounts-list'), accountsNewName: /** @type {HTMLInputElement} */ ($('accounts-new-name')),
    accountsNewAdmin: /** @type {HTMLInputElement} */ ($('accounts-new-admin')), accountsCreate: /** @type {HTMLButtonElement} */ ($('accounts-create')),
    accountsNewForm: $('accounts-new-form'), accountsNewCancel: /** @type {HTMLButtonElement} */ ($('accounts-new-cancel')),
    accountsLink: /** @type {HTMLInputElement} */ ($('accounts-link')), accountsLinkGo: /** @type {HTMLButtonElement} */ ($('accounts-link-go')),
    inviteBox: $('invite-box'), accountsError: $('accounts-error'),
    accountsIntro: $('accounts-intro'), accountsJoin: /** @type {HTMLButtonElement} */ ($('accounts-join')), accountsScan: /** @type {HTMLButtonElement} */ ($('accounts-scan')), accountsOwn: $('accounts-own'),
    settingsAllAccounts: /** @type {HTMLInputElement} */ ($('settings-all-accounts')), settingsAllAccountsField: $('settings-all-accounts-field'),
    e2eEnter: /** @type {HTMLButtonElement} */ ($('e2e-enter')), e2eDelete: /** @type {HTMLButtonElement} */ ($('e2e-delete')),
    pairCreate: /** @type {HTMLButtonElement} */ ($('pair-create')), pairBox: $('pair-box'), totpTitle: $('totp-title'), totpBox: $('totp-box'),
    loginQr: $('login-qr'), loginQrCode: $('login-qr-code'), loginQrRenew: $('login-qr-renew'), loginFirst: $('login-first'),
    loginFirstCode: /** @type {HTMLInputElement} */ ($('login-first-code')), loginFirstSend: /** @type {HTMLButtonElement} */ ($('login-first-send')), loginScan: /** @type {HTMLButtonElement} */ ($('login-scan')),
    devicesScan: /** @type {HTMLButtonElement} */ ($('devices-scan')), devicesScanHint: $('devices-scan-hint'),
    settingsPush: $('settings-push'), pushStatus: $('push-status'), pushEnable: /** @type {HTMLButtonElement} */ ($('push-enable')),
    pushKinds: $('push-kinds'),
    settings: $('settings'), settingsTheme: /** @type {HTMLSelectElement} */ ($('settings-theme')), settingsAutoRead: /** @type {HTMLInputElement} */ ($('settings-auto-read')), settingsLanguage: /** @type {HTMLSelectElement} */ ($('settings-language')),
    settingsMachines: $('settings-machines'), machineAddRow: $('machine-add-row'), machineAdd: /** @type {HTMLButtonElement} */ ($('machine-add')),
    machineJoin: $('machine-join'), settingsBots: $('settings-bots'), settingsBotsAsleep: $('settings-bots-asleep'),
    settingsAiAsleep: $('settings-ai-asleep'), aiList: $('settings-ai-list'), aiAddRow: $('settings-ai-add-row'), aiAdd: /** @type {HTMLButtonElement} */ ($('settings-ai-add')),
    aiForm: $('settings-ai-form'), aiProvider: /** @type {HTMLSelectElement} */ ($('settings-ai-provider')), aiKey: /** @type {HTMLInputElement} */ ($('settings-ai-key')),
    aiSave: /** @type {HTMLButtonElement} */ ($('settings-ai-save')), aiCancel: /** @type {HTMLButtonElement} */ ($('settings-ai-cancel')),
    settingsAvatarModel: /** @type {HTMLSelectElement} */ ($('settings-avatar-model')), settingsVoiceLanguage: /** @type {HTMLSelectElement} */ ($('settings-voice-language')),
    settingsPushPreview: /** @type {HTMLSelectElement} */ ($('settings-push-preview')), settingsReadAloud: /** @type {HTMLSelectElement} */ ($('settings-read-aloud')), settingsGitPull: /** @type {HTMLInputElement} */ ($('settings-git-pull')),
    keyDialog: $('key-dialog'), keyForm: /** @type {HTMLFormElement} */ ($('key-form')), keyInput: /** @type {HTMLInputElement} */ ($('key-input')), keyText: $('key-text'), keyError: $('key-error'),
    settingsDialog: $('settings-dialog'), settingsDialogTitle: $('settings-dialog-title'), settingsDialogBody: $('settings-dialog-body'), settingsDialogActions: $('settings-dialog-actions'),
    textDialog: $('text-dialog'), textForm: /** @type {HTMLFormElement} */ ($('text-form')), textInput: /** @type {HTMLInputElement} */ ($('text-input')),
    textTitle: $('text-title'), textHint: $('text-hint'), textSubmit: /** @type {HTMLButtonElement} */ ($('text-submit')),
    agentStatus: $('agent-status'), chatList: $('chat-list'), account: $('account'), usage: $('usage'),
    btnNew: /** @type {HTMLButtonElement} */ ($('btn-new')), newMenu: $('new-menu'), searchBox: $('search-box'), search: /** @type {HTMLInputElement} */ ($('search')), searchResults: $('search-results'),
    chatEmpty: $('chat-empty'), panes: $('panes'), paneAdd: /** @type {HTMLButtonElement} */ ($('pane-add')), sidebarResize: $('sidebar-resize'),
    messageMenu: $('message-menu'),
    speechBar: $('speech-bar'), speechBarOpen: $('speech-bar-open'), speechBarWho: $('speech-bar-who'), speechBarText: $('speech-bar-text'), speechBarStop: $('speech-bar-stop'),
    speechBarPlay: $('speech-bar-play'), speechBarSeek: /** @type {HTMLInputElement} */ ($('speech-bar-seek')), speechBarElapsed: $('speech-bar-elapsed'), speechBarTotal: $('speech-bar-total'),
    editor: $('editor'), editorForm: /** @type {HTMLFormElement} */ ($('editor-form')), editorTitle: $('editor-title'), editorTemplateField: $('editor-template-field'),
    editorTemplate: /** @type {HTMLSelectElement} */ ($('editor-template')), editorAvatar: $('editor-avatar'), editorImage: /** @type {HTMLInputElement} */ ($('editor-image')), editorImageRemove: /** @type {HTMLButtonElement} */ ($('editor-image-remove')),
    editorAvatarAi: /** @type {HTMLButtonElement} */ ($('editor-avatar-ai')), editorNameSuggest: /** @type {HTMLButtonElement} */ ($('editor-name-suggest')), editorNameSuggestions: $('editor-name-suggestions'),
    editorRoleSuggest: /** @type {HTMLButtonElement} */ ($('editor-role-suggest')),
    editorName: /** @type {HTMLInputElement} */ ($('editor-name')), editorArea: /** @type {HTMLInputElement} */ ($('editor-area')), editorRole: /** @type {HTMLInputElement} */ ($('editor-role')), editorFolder: /** @type {HTMLInputElement} */ ($('editor-folder')), editorRepo: /** @type {HTMLInputElement} */ ($('editor-repo')), editorModel: /** @type {HTMLSelectElement} */ ($('editor-model')),
    editorModelCustom: /** @type {HTMLInputElement} */ ($('editor-model-custom')), editorApproval: /** @type {HTMLSelectElement} */ ($('editor-approval')), editorTone: /** @type {HTMLTextAreaElement} */ ($('editor-tone')), editorVoice: /** @type {HTMLSelectElement} */ ($('editor-voice')),
    editorCanMessage: /** @type {HTMLSelectElement} */ ($('editor-can-message')), editorCanMessageBots: $('editor-can-message-bots'), editorAllowedTools: $('editor-allowed-tools'), editorError: $('editor-error'),
    editorMachine: /** @type {HTMLSelectElement} */ ($('editor-machine')), editorFolderHint: $('editor-folder-hint'), editorFolderBrowse: /** @type {HTMLButtonElement} */ ($('editor-folder-browse')),
    folderPicker: $('folder-picker'), pickerPath: $('picker-path'), pickerList: $('picker-list'), pickerError: $('picker-error'), pickerChoose: /** @type {HTMLButtonElement} */ ($('picker-choose')),
    gEditor: $('group-editor'), gForm: /** @type {HTMLFormElement} */ ($('group-form')), gTitle: $('group-title'), gAvatar: $('group-avatar'), gImage: /** @type {HTMLInputElement} */ ($('group-image')),
    gName: /** @type {HTMLInputElement} */ ($('group-name')), gMembers: $('group-members'), gError: $('group-error'),
    info: $('info'), infoAvatar: $('info-avatar'), infoName: $('info-name'), infoArea: $('info-area'), infoRole: $('info-role'), infoFacts: $('info-facts'),
    infoRoutines: $('info-routines'), infoRoutineNew: /** @type {HTMLButtonElement} */ ($('info-routine-new')), infoKnowledgeTabs: $('info-knowledge-tabs'),
    infoKnowledgeHint: $('info-knowledge-hint'), infoKnowledge: $('info-knowledge'), infoKnowledgeNew: /** @type {HTMLButtonElement} */ ($('info-knowledge-new')),
    infoSwitches: $('info-switches'), infoGit: $('info-git'), infoActions: $('info-actions'), infoArchiveHead: $('info-archive-head'), infoArchive: $('info-archive'),
    gActions: $('group-actions'),
    infoSkills: $('info-skills'), infoClaude: $('info-claude'),
    rEditor: $('routine-editor'), rForm: /** @type {HTMLFormElement} */ ($('routine-form')), rTitle: $('routine-title'), rName: /** @type {HTMLInputElement} */ ($('routine-name')), rKind: /** @type {HTMLSelectElement} */ ($('routine-kind')),
    rTimeField: $('routine-time-field'), rTime: /** @type {HTMLInputElement} */ ($('routine-time')), rDayField: $('routine-day-field'), rDay: /** @type {HTMLSelectElement} */ ($('routine-day')),
    rCronField: $('routine-cron-field'), rCron: /** @type {HTMLInputElement} */ ($('routine-cron')), rPrompt: /** @type {HTMLTextAreaElement} */ ($('routine-prompt')), rEnabled: /** @type {HTMLInputElement} */ ($('routine-enabled')), rWake: /** @type {HTMLInputElement} */ ($('routine-wake')),
    rError: $('routine-error'), rDelete: /** @type {HTMLButtonElement} */ ($('routine-delete')),
    kEditor: $('knowledge-editor'), kForm: /** @type {HTMLFormElement} */ ($('knowledge-form')), kTitle: $('knowledge-title'), kLocation: $('knowledge-location'), kName: /** @type {HTMLInputElement} */ ($('knowledge-name')),
    kType: /** @type {HTMLSelectElement} */ ($('knowledge-type')), kDescription: /** @type {HTMLInputElement} */ ($('knowledge-description')), kText: /** @type {HTMLTextAreaElement} */ ($('knowledge-text')), kError: $('knowledge-error'), kDelete: /** @type {HTMLButtonElement} */ ($('knowledge-delete')),
    machines: $('machines'), machinesNone: $('machines-none'), usageNone: $('usage-none'), machinesPage: $('machines-page'),
    tabBar: $('tab-bar'), tabRepos: $('tab-repos'), tabReposBadge: $('tab-repos-badge'),
    gitPage: $('git-page'), gitPageContent: $('git-page-content'), gitBack: /** @type {HTMLButtonElement} */ ($('git-back')), gitTitle: $('git-title'), gitSub: $('git-sub'),
    vscode: $('vscode'), vsBack: /** @type {HTMLButtonElement} */ ($('vs-back')), vsTitle: $('vs-title'), vsSub: $('vs-sub'), vsList: $('vs-list'), vsShow: $('vs-show'), vsTerminal: $('vs-terminal'),
    vsHistory: $('vs-history'), vsError: $('vs-error'), vsFooter: $('vs-footer'), vsHint: $('vs-hint'), vsAdopt: /** @type {HTMLButtonElement} */ ($('vs-adopt')),
};

/** Bot templates for the editor; texts are dictionary keys, the folder is left to the user. */
export const TEMPLATES = [
    { id: '', name: '', role: '', tone: '', approval: 'risky' },
    { id: 'chief', name: 'template.chief.name', role: 'template.chief.role', tone: 'template.chief.tone', approval: 'risky' },
    { id: 'developer', name: 'template.developer.name', role: 'template.developer.role', tone: 'template.developer.tone', approval: 'risky' },
    { id: 'infra', name: 'template.infra.name', role: 'template.infra.role', tone: 'template.infra.tone', approval: 'risky' },
    { id: 'social', name: 'template.social.name', role: 'template.social.role', tone: 'template.social.tone', approval: 'risky' },
    { id: 'landing', name: 'template.landing.name', role: 'template.landing.role', tone: 'template.landing.tone', approval: 'risky' },
    { id: 'product', name: 'template.product.name', role: 'template.product.role', tone: 'template.product.tone', approval: 'write' },
    { id: 'mail', name: 'template.mail.name', role: 'template.mail.role', tone: 'template.mail.tone', approval: 'risky' },
];

/** Values of a template in the current language, shaped like a bot for the editor. */
export function templateValues(tpl) {
    return {
        name: tpl.name ? t(tpl.name) : '', role: tpl.role ? t(tpl.role) : '', tone: tpl.tone ? t(tpl.tone) : '',
        folder: '', approval: tpl.approval, machine: '',
    };
}

export const COLORS = ['#d97757', '#0f9d8a', '#7c5cff', '#e0a800', '#3b82f6', '#e5487c', '#16a34a', '#a16207'];
// Stored edge length of avatars: large enough for the zoomed view, about 30-60 KB as JPEG
export const AVATAR_EDGE = 512;

/**
 * Parameters behind '#' in the address the page was opened with (`#pair=…&e2e=…` from a pairing link). They never
 * reach a server; the app reads them once here and removes them from the address bar and the history.
 */
export const startParams = (() => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (location.hash) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    }
    return params;
})();

// Maps two levels deep keyed by ids from frames have no prototype: an id '__proto__' must not reach Object.prototype
export const state = {
    ws: null, signedIn: false, agentOnline: false,
    pairToken: startParams.get('pair') || '',  // one-time token of a pairing link, used instead of the password once
    account: null,           // { id, name, admin } of the signed-in account, from the relay; null for a relay without accounts
    stashedDevice: '',       // while adding an account: the current account's key, not used for signing in meanwhile
    online: [],              // machines that are awake (backends at the relay)
    onlineKnown: false,      // "online" is reliable only after the relay's machine list (per connection)
    pinned: {},              // chatId -> pinned messages [{ id, text, ts, from }]
    perMachine: Object.create(null), // machine -> { states, activity, activeChats, queues } according to its backend
    pushKeys: {},            // machine -> public VAPID key
    pushChannels: {},        // machine -> push channels its backend can send to ('web', 'apns', 'fcm')
    pushSettings: null,      // { kinds: { done: 'normal', … }, updatedAt } for all devices
    settings: null,          // shared settings { language, avatarModel, …, apiKeys, updatedAt }, the newest any backend reported
    machineSettings: {},     // host -> { settings, anthropicKey, gitPushToken, engineKeys, keyFallback, offers, shutdownMethod, voice }
    machineTokens: null,     // machines joined by invitation [{ machine, created }]; null = not the main account or an older relay from its backend (main account only)
    machineStatus: null,     // last answer to wake_status
    waking: {},              // host -> time since it is being woken
    shuttingDown: {},        // host -> time (ms) when it shuts down
    restarting: {},          // host -> true if what is planned in shuttingDown is a restart
    goneSince: {},           // host -> time (ms) since it is no longer connected
    shutdownPlanned: {},     // host -> true if it was about to shut down when it disconnected
    autologon: {},           // host -> { on, password } according to its backend (automatic Windows sign-in)
    capabilities: {},        // host -> { shutdown, shutdownSeconds, cancelShutdown, autologon, restart } from its settings
    bots: [], groups: [], states: {}, activity: {}, activeChats: {}, approvals: {}, routines: [],
    usage: null, pushKey: '',
    models: [],              // models of the CLI [{ value, resolvedModel, displayName }], 'default' points to the real one
    history: {},             // chatId -> HistoryEntry[]
    voicePending: {},        // chatId -> { length (ms), since (ms) } of the sent recording until its transcript arrives
    historyFrom: {},         // chatId -> machine that sent the history (tool outputs are requested there)
    last: {},                // chatId -> preview text
    lastTs: {},              // chatId -> time of the last message (sorting and time in the overview)
    incoming: {},            // chatId -> time of the last incoming message (bot, job from a bot)
    context: {},             // session key (bot id or conversation chatId) -> tokens in context
    backgroundPerMachine: Object.create(null), // machine -> { session key -> [{ id, description }] } running background tasks
    gitPerMachine: {},       // machine -> { bot id -> open repos } for the bots running there (git_status)
    backendPerMachine: {},   // machine -> { since, changed, requested } according to its backend (backend_status)
    setupPerMachine: {},     // machine -> { relay, container, engines } for the first steps (setup_status)
    engineLogin: {},         // 'machine:engine' -> { state, url, code, message } of a sign-in with a device code
    live: Object.create(null), // chatId -> { botId -> { wrap, bubble, content, text, tools: Map, rows: Map, timer } }
    editorBot: null, editorAvatar: '', editorRemote: '', // origin of the edited bot's folder, offered for cloning
    groupEditorGroup: null, groupAvatarData: '',
    infoBot: null, infoChat: null, routineEdit: null,
    retryDelay: 1000,
    lastReceived: 0,         // time of the last frame from the relay (sign of life of the connection)
    catchUp: false,          // after signing in: fetch history and previews again as soon as machines are there
};

marked.setOptions({ breaks: true, gfm: true });
// Links in messages always open in a new tab, without access of the target page to this window
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});
// Bot text keeps no class, id, style or data-* attribute: the app's handlers key on data-el and data-close, and with
// classes a bot could draw its text as the user's own bubble, an event or an approval card
const PURIFY = { USE_PROFILES: { html: true }, ALLOW_DATA_ATTR: false, FORBID_ATTR: ['class', 'id', 'style'] };
export const md = (text) => DOMPurify.sanitize(marked.parse(text || ''), PURIFY);

// Finished answers cached per text: marked and DOMPurify are the biggest cost when rendering a history
// (on the iPad every chat switch stalled). Not for running answers, their text grows with every chunk.
const mdCache = new Map();
export function mdCached(text) {
    let html = mdCache.get(text);
    if (html === undefined) {
        html = md(text);
        if (mdCache.size >= 3000) mdCache.delete(mdCache.keys().next().value);
    } else {
        mdCache.delete(text);
    }
    mdCache.set(text, html);
    return html;
}

// ================================================================ Helpers

export const storage = {
    get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
/**
 * The relays this device knows, [{ url, name, scope }]: an app can be signed in to several, e.g. one per customer.
 * `scope` is appended to the names of what this device keeps per relay (device key, accounts, end-to-end key, what
 * was seen): '' for the first one, so the names from before stay valid, '@<n>' for the ones added later. It never
 * changes, so removing a relay leaves the others' data in place. The browser loads the web app from its relay and
 * knows only that one; the list stays empty there.
 */
export const RELAYS_KEY = 'openfolk-relays';
/** Base names of what this device keeps per relay; core.js appends the relay's scope (and the account's). */
export const RELAY_KEYS = ['openfolk-token', 'openfolk-device', 'openfolk-accounts', 'openfolk-collapsed', 'openfolk-seen', 'openfolk-panes'];

/** @returns {{ url: string, name: string, scope: string }[]} */
export function deviceRelays() {
    try {
        const list = JSON.parse(storage.get(RELAYS_KEY) || '[]');
        return Array.isArray(list) ? list.filter((r) => r && typeof r.url === 'string' && typeof r.scope === 'string') : [];
    } catch {
        return [];
    }
}

/** @param {{ url: string, name: string, scope: string }[]} list */
export function saveRelays(list) {
    storage.set(RELAYS_KEY, JSON.stringify(list));
}

/** The entry of the relay at `url`, added to the list with a scope of its own if it is new. */
export function relayEntry(url) {
    const list = deviceRelays();
    const known = list.find((r) => r.url === url);
    if (known) return known;
    const used = new Set(list.map((r) => r.scope));
    let scope = '';
    for (let n = 2; used.has(scope); n++) scope = `@${n}`;
    const entry = { url, name: new URL(url).host, scope };
    saveRelays([...list, entry]);
    return entry;
}

// The relay switch and notifications open the page with ?relay=<address>: that relay, if this device knows it. Here,
// before anything reads a key, like ?account= below.
const wantedRelay = deviceRelays().find((r) => r.url === new URLSearchParams(location.search).get('relay'));
if (bundled && wantedRelay) setRelayAddress(wantedRelay.url);
// The desktop app opens its page with #relay=<address>, next to a pairing link's #pair= and #e2e=: that relay, new or known
const startRelay = bundled ? startParams.get('relay') : null;
if (startRelay && setRelayAddress(startRelay)) relayEntry(relayAddress());

/** The scope of the relay the page was loaded for (RELAYS_KEY). */
export const relayScope = bundled && relayAddress() ? relayEntry(relayAddress()).scope : '';
/** Slot of the relay's end-to-end key in IndexedDB or the Keychain/Keystore. */
export const E2E_SLOT = 'e2e' + relayScope;

/** Used to hold the password; it is exchanged for a device key on the first connection. */
export const TOKEN_KEY = 'openfolk-token' + relayScope;
export const DEVICE_KEY = 'openfolk-device' + relayScope;
export const THEME_KEY = 'openfolk-theme';
export const SIDEBAR_WIDTH_KEY = 'openfolk-sidebar-width';
/**
 * The accounts this device is signed in to on the current relay, [{ id, name, admin, device }] with each one's device
 * key. The current one is the account of DEVICE_KEY; switching sets that key and loads the page again.
 */
export const ACCOUNTS_KEY = 'openfolk-accounts' + relayScope;

/**
 * The accounts of the current relay, or with `scope` those of another one this device knows.
 * @returns {{ id: string, name: string, admin: boolean, device: string }[]}
 */
export function deviceAccounts(scope = relayScope) {
    try {
        const list = JSON.parse(storage.get('openfolk-accounts' + scope) || '[]');
        return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string' && typeof a.device === 'string') : [];
    } catch {
        return [];
    }
}

// A notification of another account opens the page with ?account=<id>: that one, if this device is signed in to it.
// Here, before anything reads the key, so it needs no second load.
const wantedAccount = deviceAccounts().find((a) => a.id === new URLSearchParams(location.search).get('account'));
if (wantedAccount) storage.set(DEVICE_KEY, wantedAccount.device);
{
    // Gone from the address, or switching later (a reload) would land in this relay and account again
    const rest = new URLSearchParams(location.search);
    if (rest.has('account') || rest.has('relay')) {
        rest.delete('account');
        rest.delete('relay');
        try { history.replaceState(null, '', location.pathname + (rest.size ? `?${rest}` : '') + location.hash); } catch { /* ignore */ }
    }
}

/** The account the page was loaded for ('main' on a relay or device without accounts). */
export const loadedAccount = deviceAccounts().find((a) => a.device === storage.get(DEVICE_KEY))?.id || 'main';
/** Name suffix of what this device remembers per relay and account: two of them can have a bot with the same id. */
export const accountScopeOf = (id, scope = relayScope) => scope + (id === 'main' ? '' : `:${id}`);
const accountScope = accountScopeOf(loadedAccount);
export const COLLAPSED_KEY = 'openfolk-collapsed' + accountScope;
export const SEEN_KEY = 'openfolk-seen' + accountScope;
export const PANES_KEY = 'openfolk-panes' + accountScope;

// ================================================================ DOM

/**
 * The element under the event that matches the selector (event delegation); null if there is none or the target is
 * not an element.
 * @param {Event} ev
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
export function closest(ev, selector) {
    return ev.target instanceof Element ? /** @type {HTMLElement | null} */ (ev.target.closest(selector)) : null;
}

/** Like closest, for the app's own controls: inside rendered bot text (.content) nothing is one, whatever its attributes say. */
export function control(ev, selector) {
    const hit = closest(ev, selector);
    return hit && hit.parentElement && hit.parentElement.closest('.content') ? null : hit;
}

export function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

let toastTimer = 0;

/** A short message at the bottom of the window, gone after a moment (`ms`); a new one replaces it. */
export function toast(text, ms = 2500) {
    let box = $('toast');
    if (!box) {
        box = node('div', 'toast');
        box.id = 'toast';
        box.setAttribute('role', 'status');
        document.body.appendChild(box);
    }
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (box) box.hidden = true; }, ms);
}
