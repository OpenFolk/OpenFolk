// The main account's first device without a terminal, for a backend in a container: on start it makes a code and
// prints it to its log (the container log only its host reads), or takes FIRST_DEVICE_CODE, which whoever set up the
// server handed to the user beforehand; either works once only. The sign-in page of a relay without devices offers to
// enter it; the waiting device sends its public key, the relay passes it here, and the pairing link goes back sealed
// with ECDH and the code (PBKDF2). The code itself never travels: a relay that swaps the key gets a box it cannot open
// without guessing the code, and with 80 bits and PBKDF2 that is out of reach. Not the relay's setup code: the relay
// knows that one. The web app opens the box in qr-login.js with the same derivation.

import { randomBytes, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import type { PairBox } from '../../shared/protocol.ts';
import { dataPath } from './store.ts';

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
/** Crockford's base32: no I, L, O, U, so what is read off a log is typed back the same. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FIRST_ITERATIONS = 210_000;

/** 16 characters (80 bits) in four groups: XXXX-XXXX-XXXX-XXXX. */
export function newFirstDeviceCode(): string {
    const bytes = randomBytes(16);
    const chars = [...bytes].map((b) => ALPHABET[b & 31]).join('');
    return chars.match(/.{4}/g)!.join('-');
}

/** As typed: case, spaces and dashes do not matter, O reads as 0 and I or L as 1. */
export function normalizeCode(code: string): string {
    return code.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');

/** The AES key of the box: ECDH bits and the stretched code, through HKDF bound to the request id. */
async function firstKey(privateKey: webcrypto.CryptoKey, publicRaw: Uint8Array, id: string, code: string): Promise<webcrypto.CryptoKey> {
    const pub = await subtle.importKey('raw', publicRaw, CURVE, false, []);
    const bits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256));
    const pass = await subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveBits']);
    const stretched = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`openfolk:pair-first:${id}`), iterations: FIRST_ITERATIONS }, pass, 256));
    const ikm = new Uint8Array(64);
    ikm.set(bits, 0);
    ikm.set(stretched, 32);
    const hkdf = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(id), info: enc.encode('openfolk:pair-first') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Seals `text` (`pair=…&e2e=…`) for the device with public key `pk` (base64url), request `id` and `code`. */
export async function sealFirstDevice(text: string, id: string, pk: string, code: string): Promise<PairBox> {
    const own = await subtle.generateKey(CURVE, true, ['deriveBits']) as webcrypto.CryptoKeyPair;
    const key = await firstKey(own.privateKey, Buffer.from(pk, 'base64url'), id, code);
    const iv = randomBytes(12);
    const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, key, enc.encode(text));
    return { pk: b64url(await subtle.exportKey('raw', own.publicKey)), iv: b64url(iv), data: b64url(data) };
}

/** The other side, for the tests (the web app has its own in qr-login.js). */
export async function openFirstDevice(privateKey: webcrypto.CryptoKey, id: string, box: PairBox, code: string): Promise<string> {
    const key = await firstKey(privateKey, Buffer.from(box.pk, 'base64url'), id, code);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(box.iv, 'base64url'), additionalData: enc.encode(id) }, key, Buffer.from(box.data, 'base64url'));
    return new TextDecoder().decode(plain);
}

/** As long as a code this backend makes itself; a shorter one would be guessable through the relay. */
const MIN_CODE_LENGTH = 16;

/**
 * Where the code of this run comes from: FIRST_DEVICE_CODE, set by whoever set up the server and handed on to the
 * user beforehand (a hoster, the cloud-init page), or a new one for the log. 'invalid' is a variable too short to use;
 * the run then falls back to a new code.
 */
export function chooseFirstDeviceCode(container: boolean, fromEnv: string | undefined): { code: string; source: 'env' | 'log' | 'invalid' | 'off' } {
    if (!container) return { code: '', source: 'off' };
    const given = (fromEnv ?? '').trim();
    if (given && normalizeCode(given).length >= MIN_CODE_LENGTH) return { code: given, source: 'env' };
    return { code: newFirstDeviceCode(), source: given ? 'invalid' : 'log' };
}

const chosen = chooseFirstDeviceCode(process.env.OPENFOLK_CONTAINER === '1', process.env.FIRST_DEVICE_CODE);
/**
 * The code of this run: in a container only (there the log is the way in); '' elsewhere, where the terminal of
 * `npm start` shows a pairing link anyway.
 */
export const firstDeviceCode = chosen.code;
export const firstDeviceSource = chosen.source;

/** Written once a device of the main account has talked to this backend: from then on the log keeps the code to itself. */
const SEEN_FILE = 'first-device-seen';
let seen: boolean | null = null;

/** A device of the main account has talked to this backend before (in this run or an earlier one). */
export function deviceSeen(): boolean {
    seen ??= fs.existsSync(dataPath(SEEN_FILE));
    return seen;
}

/** A frame from a device of the main account came in; only a backend that has a code notes it. */
export function noteDeviceSeen(): void {
    if (!firstDeviceCode || deviceSeen()) return;
    seen = true;
    try { fs.writeFileSync(dataPath(SEEN_FILE), new Date().toISOString()); } catch { /* the log shows the code once more */ }
}

let busy = false;

/**
 * Answers a first-device request: a pairing link from `mint` (`pair=…&e2e=…`), sealed for the device. One at a time, so
 * a flood of requests cannot mint a flood of tokens. Null without a code, and once a device of the main account was
 * here: a code from FIRST_DEVICE_CODE travelled in a message and must not open a second device later.
 */
export async function answerFirstDevice(id: string, pk: string, mint: () => Promise<string>, code = firstDeviceCode, used = deviceSeen): Promise<PairBox | null> {
    if (!code || busy || used()) return null;
    busy = true;
    try {
        return await sealFirstDevice(await mint(), id, pk, code);
    } finally {
        busy = false;
    }
}
