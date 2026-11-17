// Setup page, built like the web app's sign-in: first the link someone sent (an invitation into an account, a setup
// link, a machine's invitation; main.js tells them apart), then the QR code, the relay's address with a password, and
// "on this computer" (the backend inside the app with the relay embedded). The main process stores the choice and
// loads the web app. Also shown while the backend starts and when it does not.
// Texts come from the main process (English or German, depending on the operating system's language).
'use strict';
const params = new URLSearchParams(location.search);
const input = document.getElementById('url');
const error = document.getElementById('error');
const failed = document.getElementById('failed');
input.value = params.get('url') || '';

/** Texts and mode of the app, set once the main process has answered. */
let texts = {};
let currentMode = '';

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));

/** The folders list of "on this computer", once the texts are there. */
let folders = null;

window.openfolkDesktop.info().then((i) => {
    texts = i.texts;
    currentMode = i.mode;
    qrInput.value = i.url || '';
    folders = window.mountFolders(document.getElementById('setup-folders'), { roots: i.roots || [], home: i.home || '', defaultRoot: i.defaultRoot || '', env: i.envRoots || '', texts: i.texts });
    document.documentElement.lang = i.language;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = i.texts[el.dataset.i18n] ?? el.textContent;
    const foldersHint = document.querySelector('[data-i18n="foldersSetupHint"]');
    foldersHint.textContent = fill(i.texts.foldersSetupHint, { default: i.defaultRoot || '' });
    document.getElementById('info').textContent = fill(i.texts.setupHint, { version: i.version });
    const starting = params.get('starting') === '1';
    document.getElementById('starting').hidden = !starting;
    document.getElementById('choice').hidden = starting;
    // The address field has the focus when that is the way in use or a relay did not answer
    if (!starting && (i.mode === 'relay' || (!!params.get('error') && !params.get('log')))) {
        document.getElementById('password-way').open = true;
        input.focus();
    } else if (!starting) {
        joinInput.focus();
    }
    if (params.get('error') && params.get('log')) {
        failed.hidden = false;
        failed.textContent = fill(i.texts.setupFailed, { error: params.get('error'), log: params.get('log') });
    } else if (params.get('error')) {
        error.textContent = fill(i.texts.setupNoAnswer, { error: params.get('error') });
    }
});

document.getElementById('local').addEventListener('click', async () => {
    const r = await window.openfolkDesktop.chooseLocal(folders ? folders.get() : undefined);
    if (r && r.error && folders) folders.error(r.error);
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
const qrInput = document.getElementById('qr-relay');
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
    if (r && r.error) qrError.textContent = r.error;
});
document.getElementById('qr-cancel').addEventListener('click', () => {
    void window.openfolkDesktop.qrJoinStop();
    qrWaiting(false);
});
window.openfolkDesktop.onQrJoin((s) => {
    if (s.state === 'code') {
        // Markup from the main process (qr-join.js), drawn from the request id and key only
        qrCode.innerHTML = s.svg;
        qrHint.textContent = texts.setupQrHint || qrHint.textContent;
        qrWaiting(true);
    } else if (s.state === 'joining') {
        qrCode.replaceChildren();
        qrHint.textContent = texts.setupQrJoining || '';
    } else if (s.state === 'error') {
        qrWaiting(false);
        const text = (texts.setupQrFailed || {})[s.reason];
        qrError.textContent = text ? fill(text, { message: s.message || '' }) : s.message || s.reason;
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
        f.querySelector('input').disabled = on;
        f.querySelector('button').hidden = on;
    }
}

async function saveAddress() {
    asking(null);
    const r = await window.openfolkDesktop.saveAddress(input.value);
    if (r.error) error.textContent = r.error;
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    error.textContent = '';
    if (!input.value.trim()) { error.textContent = texts.invalidAddress || ''; return; }
    // Already the way in use: nothing changes for the backend, no question
    if (currentMode === 'relay') { void saveAddress(); return; }
    // Connecting to a server means this app starts no backend here: said before it happens
    asking(() => void saveAddress());
});
document.getElementById('relay-confirm-yes').addEventListener('click', () => { if (confirmed) confirmed(); });
document.getElementById('relay-confirm-no').addEventListener('click', () => asking(null));
