// "Connect this computer" by QR code: the setup page shows a code, a signed-in device (the phone) scans it, the user
// confirms there, a backend of that account mints the invitation from "Add machine" and the device sends it back
// sealed for this app's key. Same request as the web app's QR sign-in (webapp/js/qr-login.js, "pair_wait"), marked
// `kind=machine` in the code so the approving device asks for "machine_join_link" instead of "pair_link". The relay
// passes the box on without being able to open it; the key only travels in the QR code.
'use strict';

const os = require('node:os');
const path = require('node:path');

const { subtle } = globalThis.crypto;
const textEnc = new TextEncoder();
const SEAL_INFO = textEnc.encode('openfolk:pair-qr');
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64url = (text) => new Uint8Array(Buffer.from(String(text), 'base64url'));

/** The AES key of the box, as sealForDevice in webapp/js/qr-login.js derives it. */
async function boxKey(privateKey, publicRaw, id) {
    const pub = await subtle.importKey('raw', publicRaw, CURVE, false, []);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256);
    const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: textEnc.encode(id), info: SEAL_INFO }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function openBox(privateKey, id, box) {
    const key = await boxKey(privateKey, unb64url(box.pk), id);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64url(box.iv), additionalData: textEnc.encode(id) }, key, unb64url(box.data));
    return new TextDecoder().decode(plain);
}

/** The code as SVG markup, drawn with the bundled qrcode-generator (error correction M, four modules of quiet zone). */
function qrSvg(root, text) {
    const qrcode = require(path.join(root, 'node_modules', 'qrcode-generator'));
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><path d="${d}"/></svg>`;
}

/** The open request; one at a time. */
let current = null;

/**
 * Asks the relay at `relay` (http(s) origin) for a request and reports through `emit`:
 * {state: 'code', svg, link, expiresAt}, {state: 'joining'}, {state: 'error', reason, message?}.
 * `onLink` gets the invitation (`https://relay/#join=…&e2e=…`) once a device approved and resolves with an error
 * text or ''. An expired code is replaced by a fresh one while the page waits.
 */
async function startQrJoin({ relay, root, emit, onLink }) {
    stopQrJoin();
    const me = { ws: null, stopped: false };
    current = me;
    const keys = await subtle.generateKey(CURVE, false, ['deriveBits']);
    const pk = b64url(await subtle.exportKey('raw', keys.publicKey));
    if (me.stopped) return;
    const origin = new URL(relay).origin;
    const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws/client`);
    me.ws = ws;
    let id = '';
    let answered = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'pair_wait', name: `${os.hostname()} (OpenFolk desktop)` }));
    ws.onmessage = async (ev) => {
        let f;
        try { f = JSON.parse(String(ev.data)); } catch { return; }
        if (f.type === 'pair_wait' && f.id) {
            id = f.id;
            const link = `${origin}/#approve=${id}&pk=${pk}&kind=machine`;
            emit({ state: 'code', svg: qrSvg(root, link), link, expiresAt: f.expiresAt || '' });
        } else if (f.type === 'pair_wait' && f.box) {
            answered = true;
            let params;
            try {
                params = new URLSearchParams(await openBox(keys.privateKey, id, f.box));
            } catch (e) {
                emit({ state: 'error', reason: 'open', message: e.message });
                return;
            }
            // A device with a web app from before this feature approves a device sign-in: it sends a pairing link
            if (!params.get('join')) {
                emit({ state: 'error', reason: params.get('pair') ? 'old_app' : 'open', message: 'no invitation' });
                return;
            }
            emit({ state: 'joining' });
            const error = await onLink(`${origin}/#${params.toString()}`);
            if (error) emit({ state: 'error', reason: 'join', message: error });
        } else if (f.type === 'auth' && !f.ok) {
            answered = true;
            emit({ state: 'error', reason: 'refused', message: f.message || f.code || '' });
        }
    };
    ws.onerror = () => undefined;
    ws.onclose = (ev) => {
        if (me.stopped || current !== me || answered) return;
        current = null;
        // Expired (4005): a fresh code while the page still waits; anything else the page says
        if (ev.code === 4005) void startQrJoin({ relay, root, emit, onLink });
        else emit({ state: 'error', reason: id ? 'closed' : 'unreachable', message: ev.reason || String(ev.code) });
    };
}

/** The page left or the user cancelled: the relay drops the request with the connection. */
function stopQrJoin() {
    const w = current;
    current = null;
    if (!w) return;
    w.stopped = true;
    if (w.ws && w.ws.readyState <= 1) w.ws.close();
}

module.exports = { startQrJoin, stopQrJoin };
