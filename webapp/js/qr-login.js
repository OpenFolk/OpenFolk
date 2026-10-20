/* OpenFolk web app: sign-in by QR code. A device that is not signed in shows a code with a request id and a key of
   its own; a signed-in device scans it (camera app, or the scanner of the mobile app), the user confirms, and it asks
   a backend for a pairing link and sends it back sealed for that key. The relay passes the box on without being able
   to open it or to swap the key, which only travels in the QR code.
   The main account's first device, while there is none to scan with: a backend in a container prints a code to its log,
   this page sends its key with "pair_first", and the backend seals the link with that key and the code
   (local/src/first-device.ts, the same derivation as firstKey below). The code is typed here and never sent. */
import { t } from './i18n.js';
import { el, state } from './core.js';
import { adoptPairingLink, send } from './e2e.js';
import { connect, showLogin } from './connection.js';
import { canScanQr, isNative, parsePairingLink, relayAddress, scanQrCode, socketUrl } from './platform.js';

const textEnc = new TextEncoder();
const SEAL_INFO = textEnc.encode('openfolk:pair-qr');
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

function b64url(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text) {
    const s = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** The AES key both sides derive: ECDH of one's private key with the other's public key, HKDF bound to the request. */
async function boxKey(privateKey, publicRaw, id) {
    const pub = await crypto.subtle.importKey('raw', publicRaw, CURVE, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256);
    const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: textEnc.encode(id), info: SEAL_INFO }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Seals `text` for the device with public key `pk` (base64url) and request `id`; PairBox in shared/protocol.ts. */
export async function sealForDevice(text, id, pk) {
    const own = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
    const key = await boxKey(own.privateKey, unb64url(pk), id);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: textEnc.encode(id) }, key, textEnc.encode(text));
    return { pk: b64url(await crypto.subtle.exportKey('raw', own.publicKey)), iv: b64url(iv), data: b64url(data) };
}

const FIRST_INFO = textEnc.encode('openfolk:pair-first');
const FIRST_ITERATIONS = 210000;

/** As typed: case, spaces and dashes do not matter, O reads as 0 and I or L as 1 (Crockford's base32). */
export function normalizeCode(code) {
    return code.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
}

/** The key of a first-device box: ECDH bits and the code stretched with PBKDF2, through HKDF bound to the request. */
async function firstKey(privateKey, publicRaw, id, code) {
    const pub = await crypto.subtle.importKey('raw', publicRaw, CURVE, false, []);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256));
    const pass = await crypto.subtle.importKey('raw', textEnc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveBits']);
    const stretched = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: textEnc.encode(`openfolk:pair-first:${id}`), iterations: FIRST_ITERATIONS }, pass, 256));
    const ikm = new Uint8Array(64);
    ikm.set(bits, 0);
    ikm.set(stretched, 32);
    const hkdf = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: textEnc.encode(id), info: FIRST_INFO }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function openBox(privateKey, id, box, code = '') {
    if (code) {
        const key = await firstKey(privateKey, unb64url(box.pk), id, code);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(box.iv), additionalData: textEnc.encode(id) }, key, unb64url(box.data));
        return new TextDecoder().decode(plain);
    }
    const key = await boxKey(privateKey, unb64url(box.pk), id);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(box.iv), additionalData: textEnc.encode(id) }, key, unb64url(box.data));
    return new TextDecoder().decode(plain);
}

// ================================================================ The device that wants to be signed in

/** The open request: its own connection (not state.ws), its key pair and the id from the relay. */
let waiting = null;
/** The relay refused the request: one from before QR sign-in. Not asked again until the page reloads. */
let unsupported = false;

/** Draws the QR code as SVG (qrcode-generator from /vendor, error correction M). */
export function qrSvg(text) {
    const qr = /** @type {any} */ (window).qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    // four modules of quiet zone on each side, as scanners expect
    svg.setAttribute('viewBox', `-4 -4 ${n + 8} ${n + 8}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
}

function renderCode(link) {
    el.loginQrCode.replaceChildren(qrSvg(link));
    el.loginQrCode.dataset.link = link;
    el.loginQr.hidden = false;
}

function hideCode() {
    el.loginQr.hidden = true;
    el.loginFirst.hidden = true;
    el.loginQrCode.replaceChildren();
    delete el.loginQrCode.dataset.link;
}

/**
 * While the start page is open: ask the relay for a request and show its QR code. Without a relay address (the app
 * before its first sign-in) there is nobody to ask yet; the start page calls this again once there is one.
 */
export async function startQrLogin() {
    if (waiting || unsupported || el.login.hidden || !relayAddress() || !window.crypto || !crypto.subtle || typeof (/** @type {any} */ (window).qrcode) !== 'function') return;
    /** `code`: typed for a first-device request, kept here to open the box with. */
    const me = { ws: /** @type {WebSocket | null} */ (null), keys: null, id: '', code: '' };
    waiting = me;
    try {
        me.keys = await crypto.subtle.generateKey(CURVE, false, ['deriveBits']);
    } catch {
        // without ECDH (very old browser) the page keeps password and pairing link
        waiting = null;
        unsupported = true;
        return;
    }
    if (waiting !== me) return;
    const pk = b64url(await crypto.subtle.exportKey('raw', me.keys.publicKey));
    const ws = new WebSocket(socketUrl('/ws/client'));
    me.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'pair_wait' }));
    ws.onmessage = (ev) => {
        let f;
        try { f = JSON.parse(ev.data); } catch { return; }
        if (f.type === 'pair_wait' && f.id) {
            me.id = f.id;
            renderCode(`${relayAddress()}/#approve=${f.id}&pk=${pk}`);
            // No device of the main account yet: a backend may sign this one in with the code from its log
            el.loginFirst.hidden = !f.first;
            el.loginFirstSend.disabled = false;
            const ask = () => {
                const code = el.loginFirstCode.value;
                if (normalizeCode(code).length < 16 || waiting !== me || ws.readyState !== WebSocket.OPEN) {
                    if (normalizeCode(code).length < 16) showLogin(t('first.short'));
                    return;
                }
                me.code = code;
                el.loginFirstSend.disabled = true;
                el.loginError.hidden = true;
                ws.send(JSON.stringify({ type: 'pair_first', pk }));
            };
            el.loginFirstSend.onclick = ask;
            // Enter in the field asks, instead of submitting the password form around it
            el.loginFirstCode.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } };
        } else if (f.type === 'pair_wait' && f.box) {
            void finish(me, f.box);
        } else if (f.type === 'pair_first' && f.ok === false) {
            me.code = '';
            el.loginFirstSend.disabled = false;
            showLogin(t(`first.${['not_first', 'no_backend', 'off', 'busy'].includes(f.reason) ? f.reason : 'off'}`));
        } else if (f.type === 'auth' && !f.ok) {
            unsupported = true;
        }
    };
    ws.onclose = (ev) => {
        if (waiting !== me) return;
        waiting = null;
        hideCode();
        // Expired (4005) or the connection dropped: a fresh code while the start page is still open
        if (!unsupported && !el.login.hidden) setTimeout(startQrLogin, ev.code === 4005 ? 0 : 5000);
    };
}

/** Signed in some other way, or leaving the start page: the request is dropped. */
export function stopQrLogin() {
    const w = waiting;
    waiting = null;
    hideCode();
    if (w && w.ws) w.ws.close();
}

/** A fresh code on request; the relay drops the old request with its connection, so the old code stops working. */
export function renewQrLogin() {
    stopQrLogin();
    void startQrLogin();
}

/** Approved: the box holds `pair=…&e2e=…`, the same as a pairing link behind '#'. */
async function finish(me, box) {
    waiting = null;
    hideCode();
    let params;
    try {
        params = new URLSearchParams(await openBox(me.keys.privateKey, me.id, box, me.code));
        if (!params.get('pair')) throw new Error('no pairing token');
    } catch (e) {
        // A first-device box that does not open: the code was mistyped or is from an earlier start of the backend
        showLogin(me.code ? t('first.wrongCode') : t('qr.openFailed', { error: e.message }));
        return;
    }
    el.loginFirstCode.value = '';
    await adoptPairingLink(params);
    state.loginName = el.loginName.value.trim();
    el.loginError.hidden = true;
    el.login.hidden = true;
    if (state.ws) state.ws.close();
    connect();
}

// ================================================================ The signed-in device that approves

/** The device from a scanned code: id and key from the QR code; `asked` and `confirmed` say how far it got. */
let approving = null;

/**
 * Takes over a scanned code (`#approve=<id>&pk=<key>`, from the address the page was opened with or from the app's
 * scanner); true if the parameters are one.
 * @param {URLSearchParams} params
 */
export function takeApproval(params) {
    const id = params.get('approve');
    const pk = params.get('pk');
    if (!id || !pk) return false;
    approving = { id, pk, asked: false, confirmed: false };
    return true;
}

/** A code is waiting for this device to sign in first. */
export const approvalWaiting = () => !!approving && !state.signedIn;

/**
 * Signed in and the machines known (a backend mints the link): ask the relay who is behind the code; the
 * confirmation follows in receivePairRequest.
 */
export function startApproval() {
    if (!approving || approving.asked || !state.signedIn || !state.onlineKnown) return;
    approving.asked = true;
    send({ type: 'pair_request', id: approving.id });
}

/** The relay names the waiting device: the user confirms, then a backend mints its pairing link ("pair_link"). */
export function receivePairRequest(f) {
    if (!approving || approving.id !== f.id || approving.confirmed) return;
    if (!confirm(t('qr.approveConfirm', { name: f.name, ip: f.ip }))) {
        approving = null;
        return;
    }
    if (!state.online.length) {
        approving = null;
        alert(t('qr.noMachine'));
        return;
    }
    approving.confirmed = true;
    send({ type: 'pair_link' });
}

/** A pairing link a confirmed approval asked for: sealed and passed on instead of shown. True if it was one. */
export function approvalLink(f) {
    const a = approving;
    if (!a || !a.confirmed) return false;
    approving = null;
    const fragment = new URL(f.url).hash.replace(/^#/, '');
    sealForDevice(fragment, a.id, a.pk)
        .then((box) => send({ type: 'pair_approve', id: a.id, box }))
        .catch((e) => alert(t('qr.failed', { error: e.message })));
    return true;
}

export function receivePairApproved() {
    alert(t('qr.approved'));
    if (!el.devices.hidden) send({ type: 'devices' });
}

/** A refusal of the relay or the backend while approving; true if one was running. */
export function approvalError(message) {
    if (!approving) return false;
    approving = null;
    alert(t('qr.failed', { error: message }));
    return true;
}

// ================================================================ Scanning in the app

/** The app's scanner in the devices dialog: a new device's code to approve. */
export async function scanToApprove() {
    const text = await scanQrCode(t('qr.scanApproveHint'));
    if (!text) return;
    const link = parsePairingLink(text);
    if (!link || !takeApproval(link.params)) {
        alert(t('qr.notApproveCode'));
        return;
    }
    startApproval();
}

/** The app's scanner on the start page: a pairing link from a signed-in device goes into the address field. */
export async function scanToSignIn() {
    const text = await scanQrCode(t('qr.scanPairHint'));
    if (!text) return;
    const link = parsePairingLink(text);
    if (!link || !link.params.get('pair')) {
        showLogin(t('qr.notPairingCode'));
        return;
    }
    if (isNative) el.loginRelay.value = text.trim();
    else if (link.address === location.origin) await adoptPairingLink(link.params);
    else {
        // The browser and the desktop app are the relay's page: a code of another relay opens that relay's page
        location.assign(text.trim());
        return;
    }
    el.loginForm.requestSubmit();
}

/** Buttons for the scanner only where there is one (the mobile apps, a camera in the browser and the desktop app). */
export function showScanButtons() {
    const can = canScanQr();
    el.loginScan.hidden = !can;
    el.devicesScan.hidden = !can;
    el.devicesScanHint.textContent = t(can ? 'qr.devicesHintApp' : 'qr.devicesHint');
}
