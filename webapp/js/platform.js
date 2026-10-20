/* OpenFolk web app: platform layer. Everything that differs between the browser (PWA), the desktop apps (Electron)
   and the mobile apps (Capacitor, mobile/) goes through here; the rest of the app does not ask where it runs.
   Imports only i18n.js, so every module may use it. */
import { readSetting, t, writeSetting } from './i18n.js';

/** Capacitor's bridge, injected by the iOS and Android apps before the page loads. */
const cap = /** @type {any} */ (window).Capacitor;
/** true in the iOS and Android apps. */
export const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
/** 'web' | 'desktop' | 'ios' | 'android' */
export const platformKind = isNative ? cap.getPlatform() : /\bElectron\//.test(navigator.userAgent) ? 'desktop' : 'web';
// For CSS, e.g. the desktop apps fill the whole window instead of capping the layout width
document.documentElement.dataset.platform = platformKind;

/** A native plugin of the mobile app, or null (browser, desktop, plugin not built into the app). */
function plugin(name) {
    if (!isNative || !cap.isPluginAvailable(name)) return null;
    return cap.registerPlugin(name);
}

// ================================================================ Relay address

const RELAY_KEY = 'openfolk-relay';

/**
 * Base address of the relay (https://…). The browser and the desktop app load the web app from the relay, so it is
 * the page's own origin; the mobile apps bring the web app along and ask for the address once.
 */
export function relayAddress() {
    return isNative ? readSetting(RELAY_KEY) : location.origin;
}

/** The mobile app has no relay address yet; the login form asks for it. */
export const needsRelayAddress = () => isNative && !relayAddress();

/**
 * https, and http only in the browser (a relay on this computer): iOS (App Transport Security) and Android (no
 * cleartext traffic) refuse plain http, the app would only fail to connect.
 * @param {URL} url
 */
function usableProtocol(url) {
    return url.protocol === 'https:' || (url.protocol === 'http:' && !isNative);
}

/**
 * Normalizes and stores the address typed into the login form; returns it, or '' if it is no http(s) address.
 * "relay.example.com" becomes "https://relay.example.com".
 * @param {string} text
 */
export function setRelayAddress(text) {
    const value = text.trim();
    let url;
    try { url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`); } catch { return ''; }
    if (!usableProtocol(url)) return '';
    const address = url.origin;
    writeSetting(RELAY_KEY, address);
    return address;
}

/**
 * Splits a pasted pairing link (`https://relay/#pair=…&e2e=…`) into the relay address and what is behind '#'. A
 * plain address gives empty params. Null if it is no http(s) address.
 * @param {string} text
 * @returns {{ address: string, params: URLSearchParams } | null}
 */
export function parsePairingLink(text) {
    const value = text.trim();
    let url;
    try { url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
    if (!usableProtocol(url)) return null;
    return { address: url.origin, params: new URLSearchParams(url.hash.replace(/^#/, '')) };
}

// ================================================================ QR codes

const scannerPlugin = () => plugin('CapacitorBarcodeScanner');

/** getUserMedia exists only in secure contexts (https, localhost) and only with camera=(self) in the relay's policy. */
const webCamera = () => !isNative && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/** The apps have a native scanner; the browser and the desktop app read the camera themselves (webScan). */
export const canScanQr = () => !!scannerPlugin() || webCamera();

/**
 * Scans one QR code with the camera; its text, or '' when cancelled or refused.
 * @param {string} instructions
 */
export async function scanQrCode(instructions) {
    const scanner = scannerPlugin();
    if (!scanner) return webCamera() ? webScan(instructions) : '';
    try {
        // hint 0 = QR_CODE (Html5QrcodeSupportedFormats)
        const r = await scanner.scanBarcode({ hint: 0, scanInstructions: instructions, scanButton: false });
        return String((r && r.ScanResult) || '');
    } catch (e) {
        console.warn('QR scan:', e);
        return '';
    }
}

/** jsQR (vendor/jsQR.js, about 250 KB) only once somebody scans: most page loads never need it. */
let jsQrLoaded = null;
function loadJsQr() {
    jsQrLoaded ??= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/jsQR.js';
        s.onload = () => resolve(/** @type {any} */ (window).jsQR);
        s.onerror = () => { jsQrLoaded = null; reject(new Error('vendor/jsQR.js')); };
        document.head.appendChild(s);
    });
    return jsQrLoaded;
}

/** The camera in an overlay until a QR code is read, the user cancels (button, Escape) or the camera fails. */
async function webScan(instructions) {
    let stream;
    let decode;
    try {
        // the decoder first: a camera opened before a failed load would stay on
        decode = await loadJsQr();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
        console.warn('QR scan:', e);
        alert(t(e && e.name === 'NotAllowedError' ? 'qr.cameraDenied' : 'qr.cameraFailed'));
        return '';
    }
    const overlay = document.createElement('div');
    overlay.className = 'overlay qr-scan';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const hint = document.createElement('p');
    hint.textContent = instructions;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = t('common.cancel');
    overlay.append(video, hint, cancel);
    document.body.appendChild(overlay);
    void video.play().catch(() => undefined);
    const canvas = document.createElement('canvas');
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
    return new Promise((resolve) => {
        let timer = 0;
        const done = (text) => {
            clearTimeout(timer);
            document.removeEventListener('keydown', onKey, true);
            for (const track of stream.getTracks()) track.stop();
            overlay.remove();
            resolve(text);
        };
        const onKey = (ev) => {
            if (ev.key !== 'Escape') return;
            ev.stopPropagation();
            done('');
        };
        document.addEventListener('keydown', onKey, true);
        cancel.addEventListener('click', () => done(''));
        // a few frames a second at most 640 pixels wide: enough for a code held up to the camera, light on a phone
        const tick = () => {
            if (video.videoWidth) {
                const scale = Math.min(1, 640 / video.videoWidth);
                canvas.width = Math.round(video.videoWidth * scale);
                canvas.height = Math.round(video.videoHeight * scale);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const code = decode(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
                if (code && code.data) return done(code.data);
            }
            timer = setTimeout(tick, 150);
        };
        tick();
    });
}

/** WebSocket address of a relay path, e.g. '/ws/client'. */
export function socketUrl(path) {
    const url = new URL(path, relayAddress());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
}

// ================================================================ Push notifications

const pushPlugin = () => plugin('PushNotifications');

/** Web Push needs a service worker, the Push API and a secure page (on iPhone only the installed PWA has those). */
const webPushPossible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

/** How this device receives push: 'web' (Web Push/VAPID), 'apns' (iOS app), 'fcm' (Android app) or '' (not at all). */
export function pushChannel() {
    if (isNative) return pushPlugin() ? (platformKind === 'ios' ? 'apns' : 'fcm') : '';
    return webPushPossible() ? 'web' : '';
}

/** @returns {Promise<'granted' | 'denied' | 'default' | 'impossible'>} */
export async function pushPermission() {
    const channel = pushChannel();
    if (!channel) return 'impossible';
    if (channel === 'web') return /** @type {any} */ (Notification.permission);
    const { receive } = await pushPlugin().checkPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'default';
}

/** Asks the user (system dialog); returns the new state. */
export async function requestPushPermission() {
    const channel = pushChannel();
    if (!channel) return 'impossible';
    if (channel === 'web') return /** @type {any} */ (await Notification.requestPermission());
    const { receive } = await pushPlugin().requestPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'default';
}

function base64ToBytes(text) {
    const pad = '='.repeat((4 - (text.length % 4)) % 4);
    const raw = atob((text + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Device token of the native push service (promise); registering again returns the current one. */
let nativeToken = null;
/** Waiting registration: settled by the next 'registration' or 'registrationError' event. */
let nativeWaiting = null;
let nativeListening = false;

function nativeRegister() {
    if (nativeToken) return nativeToken;
    const push = pushPlugin();
    if (!nativeListening) {
        nativeListening = true;
        // The system may hand out a new token while the app runs; the next push_subscribe then carries it
        push.addListener('registration', (t) => {
            nativeToken = Promise.resolve(t.value);
            if (nativeWaiting) nativeWaiting.resolve(t.value);
            nativeWaiting = null;
        });
        push.addListener('registrationError', (e) => {
            if (nativeWaiting) nativeWaiting.reject(new Error(e.error || 'push registration failed'));
            nativeWaiting = null;
        });
    }
    let entry;
    const waiting = new Promise((resolve, reject) => { entry = { resolve, reject }; });
    nativeWaiting = entry;
    nativeToken = waiting;
    const fail = (e) => {
        if (nativeWaiting !== entry) return;
        nativeWaiting = null;
        entry.reject(e);
    };
    push.register().catch(fail);
    setTimeout(() => fail(new Error('push registration timed out')), 20000);
    waiting.catch(() => { if (nativeToken === waiting) nativeToken = null; });
    return waiting;
}

/**
 * Registers this device for push after permission was granted; returns what goes into the 'push_subscribe' frame.
 * Web Push: the browser subscription (endpoint and keys), needs the backends' VAPID key.
 * Apps: { channel: 'apns' | 'fcm', token, app }.
 * @param {string} vapidKey
 */
export async function pushSubscription(vapidKey) {
    const channel = pushChannel();
    if (channel === 'web') {
        if (!vapidKey) return null;
        const reg = await navigator.serviceWorker.register('sw.js');
        await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(vapidKey) });
        return sub.toJSON();
    }
    if (channel === 'apns' || channel === 'fcm') {
        const token = await nativeRegister();
        const app = plugin('App');
        const info = app ? await app.getInfo().catch(() => null) : null;
        return { channel, token, app: info ? info.id : '' };
    }
    return null;
}

/**
 * Tapping a notification: `open(url)` with its relative link (e.g. /?chat=cloud). Web: message of the service worker;
 * apps: the push plugin.
 * @param {(url: string) => void} open
 */
export function onNotificationOpen(open) {
    if (isNative) {
        const push = pushPlugin();
        if (push) push.addListener('pushNotificationActionPerformed', (a) => {
            const data = (a && a.notification && a.notification.data) || {};
            if (data.url) open(String(data.url));
        });
        return;
    }
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (ev) => {
            if (ev.data && ev.data.type === 'open') open(ev.data.url);
        });
    }
}

/** The apps' own plugin (mobile/native/): Keychain/Keystore and the icon badge. */
const ownPlugin = () => plugin('OpenFolk');

let lastBadge = -1;

/** Number on the app icon (unread chats); 0 removes it. Not every platform has one (Android: launcher decides). */
export function setBadge(count) {
    if (count === lastBadge) return;
    lastBadge = count;
    const own = ownPlugin();
    if (own) {
        own.setBadge({ count }).catch(() => undefined);
        return;
    }
    const nav = /** @type {any} */ (navigator);
    if (typeof nav.setAppBadge !== 'function') return;
    (count ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
}

// ================================================================ Secure storage

/**
 * The apps keep the end-to-end key in the iOS Keychain or the Android Keystore, because the system may clear a web
 * view's storage when space runs low. Null in the browser: there e2e.js keeps a non-extractable key in IndexedDB.
 */
export const secureStore = (() => {
    const own = ownPlugin();
    if (!own) return null;
    return {
        /** @param {string} key */
        async get(key) {
            try { return (await own.secureGet({ key })).value || ''; } catch { return ''; }
        },
        /** @param {string} key @param {string} value ('' removes it) */
        async set(key, value) {
            if (value) await own.secureSet({ key, value });
            else await own.secureRemove({ key }).catch(() => undefined);
        },
    };
})();

// ================================================================ Files

/**
 * Hands a file to the user: download in the browser, the share sheet in the apps (save to Files, send, open in …).
 * @param {{ name: string, mime: string, data: string }} f data as Base64
 */
export async function saveFile(f) {
    const fs = plugin('Filesystem');
    const share = plugin('Share');
    if (fs && share) {
        const name = f.name.replace(/[\\/:*?"<>|]+/g, '_') || 'file';
        const { uri } = await fs.writeFile({ path: name, data: f.data, directory: 'CACHE' });
        await share.share({ title: name, files: [uri] });
        return;
    }
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
