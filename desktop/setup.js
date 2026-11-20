// Setup page, a wizard in three steps. Step 1, the setup method, then only its fields: the link someone sent (an
// invitation into an account, a setup link, a machine's invitation; main.js tells them apart), the relay's address
// with a password, the QR code for that address, or "without setup" (backend and relay on this computer). Step 2,
// "set up this computer": the folders, then the backend starts here: against the relay signed in at (the page opens
// with ?step=machine once main.js holds that relay's invitation for this computer), or with the relay embedded
// ("without setup"). Step 3 opens right below while that backend starts: the choice of one AI provider, then its
// sign-in: Claude with the subscription or an API key, Codex or Copilot with a device code, or OpenCode's free models
// without one; it goes on by itself when an engine is ready already.
// The main process then loads the web app. Also shown while the backend starts and when it does not.
// Texts come from the main process (English or German, depending on the operating system's language).
'use strict';
const params = new URLSearchParams(location.search);
const input = document.getElementById('url');
const password = /** @type {HTMLInputElement} */ (document.getElementById('password'));
const error = document.getElementById('error');
const failed = document.getElementById('failed');
input.value = params.get('url') || '';

/** Texts and mode of the app, set once the main process has answered. */
let texts = {};
let currentMode = '';

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));

const method = /** @type {HTMLSelectElement} */ (document.getElementById('method'));
/**
 * The second step after a sign-in at a relay: this computer joins that relay. Step 1 stays in sight with the method
 * that signed in (main.js passes it); another method there leaves this step (machineDrop) and goes that way.
 */
let machineStep = params.get('step') === 'machine';
if (machineStep) {
    const used = params.get('method') || '';
    method.value = ['invite', 'password', 'qr'].includes(used) ? used : 'password';
}

/**
 * The QR code needs the relay's address only while none is known: with one (saved, or typed for the password) the code
 * shows at once. After a failure or "Cancel" the field is back, to correct the address.
 */
let qrNeedsUrl = false;

/** Shows the elements of the chosen method; nothing but the choice while none is chosen. */
function applyMethod() {
    // After a sign-in step 2 shows below the method that signed in
    const tags = machineStep ? [method.value, 'local'] : [method.value];
    if (method.value === 'qr' && (qrNeedsUrl || !input.value.trim())) tags.push('qr-url');
    for (const n of document.querySelectorAll('[data-for]')) n.classList.toggle('method-off', !n.dataset.for.split(' ').some((x) => tags.includes(x)));
}

/** The first field of the chosen method gets the focus, the choice while there is none. */
function focusMethod() {
    const urlFirst = !input.value.trim() ? 'url' : 'password';
    const first = machineStep ? 'local' : { invite: 'join', password: urlFirst, qr: 'url', local: 'local' }[method.value] || 'method';
    const n = document.getElementById(first);
    if (n.offsetParent) n.focus();
}

function chooseMethod(m) {
    method.value = m;
    applyMethod();
}

method.addEventListener('change', () => {
    // Another way in after a sign-in: the invitation for this computer is dropped, the page goes that way instead
    if (machineStep) {
        machineStep = false;
        for (const n of document.getElementById('local-way').querySelectorAll('button, input')) n.disabled = false;
        void window.openfolkDesktop.machineDrop();
    }
    // Another way in while step 3 is open: it closes, a sign-in under way ends, this computer is not set up by it
    closeAiStep();
    applyMethod();
    focusMethod();
    // A known address: the code at once
    if (method.value === 'qr' && !qrNeedsUrl && input.value.trim()) qrForm.requestSubmit();
});
applyMethod();

/** The folders list of "on this computer", once the texts are there. */
let folders = null;

window.openfolkDesktop.info().then((i) => {
    texts = i.texts;
    currentMode = i.mode;
    if (!input.value) input.value = i.url || '';
    folders = window.mountFolders(document.getElementById('setup-folders'), { roots: i.roots || [], home: i.home || '', defaultRoot: i.defaultRoot || '', env: i.envRoots || '', texts: i.texts });
    document.documentElement.lang = i.language;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = i.texts[el.dataset.i18n] ?? el.textContent;
    document.getElementById('info').textContent = fill(i.texts.setupHint, { version: i.version });
    const starting = params.get('starting') === '1';
    document.getElementById('starting').hidden = !starting;
    document.getElementById('choice').hidden = starting;
    // Chosen beforehand: the relay's address when that is the way in use or a relay did not answer, this computer when
    // its backend did not start
    const refused = params.get('refused');
    if (machineStep) applyMethod();
    else if (refused) {
        // The sign-in at the relay was refused (a used link, a wrong password): the same way again, with the reason
        const way = ['invite', 'password', 'qr'].includes(params.get('method') || '') ? params.get('method') : 'password';
        chooseMethod(way);
        document.getElementById({ invite: 'join-error', password: 'error', qr: 'qr-error' }[way]).textContent = refused;
    } else if (params.get('error') && params.get('log')) chooseMethod('local');
    else if (i.mode === 'relay' || params.get('error')) chooseMethod('password');
    if (!starting) focusMethod();
    if (params.get('error') && params.get('log')) {
        failed.hidden = false;
        failed.textContent = fill(i.texts.setupFailed, { error: params.get('error'), log: params.get('log') });
    } else if (params.get('error')) {
        error.textContent = fill(i.texts.setupNoAnswer, { error: params.get('error') });
    }
});

const machineError = document.getElementById('machine-error');
document.getElementById('local').addEventListener('click', async (e) => {
    const button = /** @type {HTMLButtonElement} */ (e.currentTarget);
    const list = folders ? folders.get() : undefined;
    machineError.textContent = '';
    button.disabled = true;
    const r = await (machineStep ? window.openfolkDesktop.machineSetup(list) : window.openfolkDesktop.chooseLocal(list));
    button.disabled = false;
    if (r && r.error) {
        machineError.textContent = r.error;
        return;
    }
    // Step 3 opens below; steps 1 and 2 stay open: another method, or other folders and "Set up this computer" again.
    // After a sign-in the invitation is redeemed: step 2 is done there.
    if (machineStep) for (const n of document.getElementById('local-way').querySelectorAll('button, input')) n.disabled = true;
    void startAiStep();
});

const joinError = document.getElementById('join-error');
const joinInput = document.getElementById('join');
const joinForm = document.getElementById('join-form');

async function join(link) {
    asking(null);
    joinError.textContent = '';
    const button = joinForm.querySelector('button');
    button.disabled = true;
    const r = await window.openfolkDesktop.joinServer(link);
    button.disabled = false;
    if (r && r.error) joinError.textContent = r.error;
    if (r && r.signingIn) signingIn();
}

/**
 * The app signs in at the relay out of sight (main.js signInAway); the page stays until step 2 or the web app comes,
 * its fields off meanwhile.
 */
function signingIn() {
    document.getElementById('signing-in').hidden = false;
    for (const n of document.getElementById('choice').querySelectorAll('button, input, select')) n.disabled = true;
}

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinError.textContent = '';
    const link = joinInput.value.trim();
    if (!link) { joinError.textContent = texts.setupInviteEmpty || ''; return; }
    // An invitation into an account signs this window in at that relay without a backend here, as the address with a
    // password does: asked first when this computer runs bots of its own
    if (/[#&]pair=/.test(link) && currentMode === 'local') { asking(() => void join(link)); return; }
    void join(link);
});

// The same invitation by QR code: main.js waits at the relay (qr-join.js), a signed-in phone scans and approves
const qrForm = document.getElementById('qr-form');
// The one URL field of the password way serves the QR code too
const qrInput = input;
const qrError = document.getElementById('qr-error');
const qrBox = document.getElementById('qr-box');
const qrCode = document.getElementById('qr-code');
const qrHint = document.getElementById('qr-hint');

function qrWaiting(on) {
    qrBox.hidden = !on;
    qrForm.hidden = on;
    if (!on) qrCode.replaceChildren();
}

qrForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    qrError.textContent = '';
    if (!qrInput.value.trim()) { qrError.textContent = texts.invalidAddress || ''; return; }
    const button = qrForm.querySelector('button');
    button.disabled = true;
    const r = await window.openfolkDesktop.qrJoinStart(qrInput.value);
    button.disabled = false;
    if (r && r.error) qrFailed(r.error);
});

/** The code did not come or was dropped: the address field is back, with the reason if there is one. */
function qrFailed(text) {
    qrWaiting(false);
    qrNeedsUrl = true;
    qrError.textContent = text;
    applyMethod();
}
document.getElementById('qr-cancel').addEventListener('click', () => {
    void window.openfolkDesktop.qrJoinStop();
    qrFailed('');
});
window.openfolkDesktop.onQrJoin((s) => {
    if (s.state === 'code') {
        // Markup from the main process (qr-join.js), drawn from the request id and key only
        qrCode.innerHTML = s.svg;
        qrHint.textContent = '';
        qrWaiting(true);
    } else if (s.state === 'joining') {
        qrCode.replaceChildren();
        qrHint.textContent = texts.setupQrJoining || '';
    } else if (s.state === 'error') {
        const text = (texts.setupQrFailed || {})[s.reason];
        qrFailed(text ? fill(text, { message: s.message || '' }) : s.message || s.reason);
    }
});

const form = document.getElementById('form');
const confirmBox = document.getElementById('relay-confirm');

/** What "Yes" does while the question is open; null when none is. */
let confirmed = null;

/**
 * The question before this computer stops running bots of its own; null closes it. While it is open the fields cannot
 * change and their buttons are out of the way.
 * @param {(() => void) | null} then
 */
function asking(then) {
    confirmed = then;
    const on = !!then;
    confirmBox.hidden = !on;
    for (const f of [form, joinForm]) {
        for (const i of f.querySelectorAll('input')) i.disabled = on;
        f.querySelector('button').hidden = on;
    }
}

async function saveAddress() {
    asking(null);
    const r = await window.openfolkDesktop.saveAddress(input.value, password.value);
    if (r.error) error.textContent = r.error;
    if (r.signingIn) signingIn();
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Enter in the URL field of the QR code method shows the code
    if (method.value === 'qr') { qrForm.requestSubmit(); return; }
    error.textContent = '';
    if (!input.value.trim()) { error.textContent = texts.invalidAddress || ''; return; }
    // Already the way in use: nothing changes for the backend, no question
    if (currentMode === 'relay') { void saveAddress(); return; }
    // Connecting to a server means this app starts no backend here: said before it happens
    asking(() => void saveAddress());
});
document.getElementById('relay-confirm-yes').addEventListener('click', () => { if (confirmed) confirmed(); });
document.getElementById('relay-confirm-no').addEventListener('click', () => asking(null));

// ---- Step 3: the sign-in to an AI provider (main.js ai-*, local/tools/ai-setup.mjs)
const aiWay = document.getElementById('ai-way');
const aiState = document.getElementById('ai-state');
const aiError = document.getElementById('ai-error');

/** Counts the openings of step 3, so the check of an earlier one stops when it closed or opened anew. */
let aiOpened = 0;

/** Shows the step at once; meanwhile asks until the backend has checked its engines: one ready goes on to the app. */
async function startAiStep() {
    const opened = ++aiOpened;
    aiWay.hidden = false;
    aiBusy(false);
    applyProvider();
    provider.focus();
    aiWay.scrollIntoView({ block: 'nearest' });
    for (let i = 0; i < 90 && opened === aiOpened; i++) {
        const s = await window.openfolkDesktop.aiStatus();
        if (opened !== aiOpened) return;
        if (s && s.ok && s.ready) { aiBusy(true); void window.openfolkDesktop.aiSkip(); return; }
        if (s && s.ok && s.known) return;
        await new Promise((r) => setTimeout(r, 1000));
    }
}

/** Step 1 changed while step 3 was open: it closes, and the main process ends what it began. */
function closeAiStep() {
    if (aiWay.hidden) return;
    aiOpened++;
    aiWay.hidden = true;
    provider.value = '';
    applyProvider();
    void window.openfolkDesktop.aiCancel();
}

/**
 * Switches everything off while a way is under way (the main process goes on to the app when it worked), steps 1 and
 * 2 too: they would change the computer under it. Step 2 stays off after a sign-in, its invitation is redeemed.
 */
function aiBusy(on) {
    for (const b of aiWay.querySelectorAll('button, input, select')) b.disabled = on;
    for (const b of document.getElementById('choice').querySelectorAll('button, input, select')) {
        if (!(machineStep && b.closest('#local-way'))) b.disabled = on;
    }
}

const provider = /** @type {HTMLSelectElement} */ (document.getElementById('ai-provider'));
const aiCode = document.getElementById('ai-code');

/** Shows the button or field of the chosen provider only; nothing but the choice while none is chosen. */
function applyProvider() {
    for (const n of aiWay.querySelectorAll('[data-ai]')) n.classList.toggle('ai-off', !n.dataset.ai.split(' ').includes(provider.value));
    const label = (texts.setupAiSignIn || {})[provider.value];
    if (label) document.getElementById('ai-login').textContent = label;
    aiError.textContent = '';
    aiState.textContent = '';
    aiCode.hidden = true;
}
provider.addEventListener('change', () => {
    applyProvider();
    const first = { claude: 'ai-login', codex: 'ai-login', copilot: 'ai-login', 'claude-key': 'ai-key', free: 'ai-try' }[provider.value];
    if (first) document.getElementById(first).focus();
});

document.getElementById('ai-login').addEventListener('click', () => {
    aiError.textContent = '';
    aiState.textContent = '';
    aiCode.hidden = true;
    void window.openfolkDesktop.aiLogin(provider.value);
});
window.openfolkDesktop.onAiState?.((s) => {
    if (s.state === 'browser') aiState.textContent = texts.setupAiBrowser || '';
    else if (s.state === 'code' && /^https:\/\//.test(s.url || '')) {
        // The device code of Codex or Copilot: the page to open (in the browser, main.js) and the code to enter there
        const text = document.getElementById('ai-code-text');
        const [before, after] = (texts.setupAiCode || '{url}').split('{url}');
        const link = document.createElement('a');
        link.href = s.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = s.url;
        text.replaceChildren(before, link, after);
        document.getElementById('ai-code-value').textContent = s.code || '';
        aiCode.hidden = false;
    } else if (s.state === 'done') { aiState.textContent = ''; aiBusy(true); }
    else if (s.state === 'failed') {
        aiState.textContent = '';
        aiCode.hidden = true;
        aiError.textContent = fill(texts.setupAiFailed || '{message}', { message: s.message || '' });
    }
});
document.getElementById('ai-key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const keyError = document.getElementById('ai-key-error');
    keyError.textContent = '';
    aiBusy(true);
    const r = await window.openfolkDesktop.aiKey(/** @type {HTMLInputElement} */ (document.getElementById('ai-key')).value);
    if (r && r.error) {
        aiBusy(false);
        keyError.textContent = r.error;
    }
});
document.getElementById('ai-try').addEventListener('click', async () => {
    const tryError = document.getElementById('ai-try-error');
    tryError.textContent = '';
    aiBusy(true);
    const r = await window.openfolkDesktop.aiTry();
    if (r && r.error) {
        aiBusy(false);
        tryError.textContent = r.error;
    }
});
