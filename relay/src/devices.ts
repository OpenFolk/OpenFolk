// Login per device: the password (USER_PASSWORD) is entered only once per device; afterwards the browser signs in
// with its own device key. The relay stores only its SHA-256 hash, and every device can be logged out on its own.
// Optional TOTP (RFC 6238) as a second factor on the first login. Every device belongs to one account
// (accounts.ts); devices stored before accounts belong to 'main'.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAIN } from './accounts.ts';
import type { DeviceInfo } from '../../shared/protocol.ts';

export const DEVICES_FILE = 'devices.json';

export interface Device extends DeviceInfo {
    hash: string;
    /** The key was used at least once after it was created */
    used?: boolean;
    /** Missing = 'main'. */
    account?: string;
}

const accountOf = (d: Device) => d.account ?? MAIN;

/** Per account. */
const MAX_DEVICES = 50;
/** A device key unused for this long expires (and with it the stored address of the device). */
export const DEVICE_IDLE_MS = 90 * 24 * 60 * 60_000;
/** A pairing link can be redeemed this long after it was created. */
export const PAIRING_TTL_MS = 15 * 60_000;
const MAX_PAIRINGS = 20;

export class Devices {
    private file: string;
    private list: Device[];
    /**
     * One-time pairing tokens (hash -> expiry), minted by a backend for a new device. Only in memory: a relay
     * restart invalidates open links, which is fine for something valid for 15 minutes.
     */
    private pairings = new Map<string, { expires: number; account: string }>();

    constructor(dir: string) {
        fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, DEVICES_FILE);
        try {
            this.list = toDevices(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        } catch {
            this.list = [];
        }
        if (this.dropIdle()) this.save();
    }

    /** Drops devices unused for DEVICE_IDLE_MS; true if any. */
    private dropIdle(now = Date.now()): boolean {
        const before = this.list.length;
        this.list = this.list.filter((d) => !(now - Date.parse(d.lastSeen) > DEVICE_IDLE_MS));
        return this.list.length !== before;
    }

    private save(): void {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.list, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    /** Creates a new device; returns its key once (`<id>.<secret>`). */
    create(name: string, ip: string, account = MAIN): { device: DeviceInfo; token: string; account: string } {
        const id = randomBytes(6).toString('hex');
        const secret = randomBytes(32).toString('base64url');
        const now = new Date().toISOString();
        const d: Device = { id, name: name.slice(0, 80) || 'Device', hash: hashOf(secret), created: now, lastSeen: now, ip };
        if (account !== MAIN) d.account = account;
        // Replace devices with the same name and address that never used their key: an old browser tab (from
        // before device login) sends the password on every reconnect and would otherwise add a device each time
        this.list = this.list.filter((x) => !(x.name === d.name && x.ip === ip && !x.used && accountOf(x) === account));
        this.list.push(d);
        // When an account has too many, its device unused for the longest time drops out
        const own = this.list.filter((x) => accountOf(x) === account).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
        if (own.length > MAX_DEVICES) {
            const drop = new Set(own.slice(MAX_DEVICES));
            this.list = this.list.filter((x) => !drop.has(x));
        }
        this.save();
        return { device: toPublic(d), token: `${id}.${secret}`, account };
    }

    /** Checks a device key; on success `lastSeen` is updated. A key unused for DEVICE_IDLE_MS no longer counts. */
    verify(token: string, ip: string, now = Date.now()): (DeviceInfo & { account: string }) | null {
        const [id, secret] = token.split('.');
        if (!id || !secret) return null;
        if (this.dropIdle(now)) this.save();
        const d = this.list.find((x) => x.id === id);
        if (!d) return null;
        const a = Buffer.from(d.hash, 'hex');
        const b = Buffer.from(hashOf(secret), 'hex');
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
        d.lastSeen = new Date(now).toISOString();
        d.ip = ip;
        d.used = true;
        this.save();
        return { ...toPublic(d), account: accountOf(d) };
    }

    /** The devices of an account; without one all of them. */
    all(account?: string): DeviceInfo[] {
        return this.list.filter((d) => account === undefined || accountOf(d) === account).map(toPublic)
            .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    }

    /** Logs a device out; with `account` only one of that account. */
    remove(id: string, account?: string): boolean {
        const before = this.list.length;
        this.list = this.list.filter((d) => !(d.id === id && (account === undefined || accountOf(d) === account)));
        if (this.list.length !== before) this.save();
        return this.list.length !== before;
    }

    /** Logs out every device of an account (account deleted); returns their ids. */
    removeAccount(account: string): string[] {
        const gone = this.list.filter((d) => accountOf(d) === account).map((d) => d.id);
        if (!gone.length) return gone;
        this.list = this.list.filter((d) => accountOf(d) !== account);
        for (const [key, p] of this.pairings) if (p.account === account) this.pairings.delete(key);
        this.save();
        return gone;
    }

    /**
     * Mints a one-time pairing token for a new device (the backend puts it into a link). Expired tokens are
     * dropped; the oldest open one gives way when there are too many.
     */
    createPairing(now = Date.now(), account = MAIN): { token: string; expiresAt: string } {
        this.prunePairings(now);
        if (this.pairings.size >= MAX_PAIRINGS) this.pairings.delete(this.pairings.keys().next().value!);
        const token = randomBytes(24).toString('base64url');
        const expires = now + PAIRING_TTL_MS;
        this.pairings.set(hashOf(token), { expires, account });
        return { token, expiresAt: new Date(expires).toISOString() };
    }

    /**
     * Redeems a pairing token (once) and creates the device in the account the token was minted for; null for an
     * unknown, used or expired token.
     */
    redeemPairing(token: string, name: string, ip: string, now = Date.now()): { device: DeviceInfo; token: string; account: string } | null {
        this.prunePairings(now);
        const key = hashOf(token);
        const p = this.pairings.get(key);
        if (!p) return null;
        this.pairings.delete(key);
        return this.create(name, ip, p.account);
    }

    private prunePairings(now: number): void {
        for (const [key, p] of this.pairings) if (p.expires <= now) this.pairings.delete(key);
    }
}

/**
 * Maps stored devices to the current format. Accepts the old German field names (`erstellt`, `zuletzt`,
 * `benutzt`) from relays before data version 2; the hash is kept byte for byte so device keys stay valid.
 */
export function toDevices(data: unknown): Device[] {
    if (!Array.isArray(data)) return [];
    const out: Device[] = [];
    for (const raw of data) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.hash !== 'string') continue;
        const created = String(r.created ?? r.erstellt ?? '');
        const d: Device = {
            id: r.id,
            name: String(r.name ?? ''),
            hash: r.hash,
            created,
            lastSeen: String(r.lastSeen ?? r.zuletzt ?? created),
            ip: String(r.ip ?? ''),
        };
        if (r.used === true || r.benutzt === true) d.used = true;
        if (typeof r.account === 'string' && r.account !== MAIN) d.account = r.account;
        out.push(d);
    }
    return out;
}

function hashOf(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function toPublic(d: Device): DeviceInfo {
    const { hash: _h, used: _u, account: _a, ...rest } = d;
    return rest;
}

// ---------------------------------------------------------------- TOTP

function base32(text: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of text.replace(/[\s=]/g, '').toUpperCase()) {
        const i = alphabet.indexOf(c);
        if (i < 0) throw new Error('TOTP_SECRET is not Base32');
        bits += i.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
}

export function totpCode(secret: string, time = Date.now(), step = 0): string {
    const counter = Math.floor(time / 1000 / 30) + step;
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const h = createHmac('sha1', base32(secret)).update(buf).digest();
    const o = h[h.length - 1] & 0x0f;
    const num = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(num % 1_000_000).padStart(6, '0');
}

/** A code is valid in the current 30 s window and one before and after it (clock drift). */
export function totpVerify(secret: string, code: string, time = Date.now()): boolean {
    return totpStep(secret, code, time) !== null;
}

/** The 30 s window a valid code belongs to, null for an invalid code. */
function totpStep(secret: string, code: string, time: number): number | null {
    const c = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return null;
    for (const s of [-1, 0, 1]) {
        if (timingSafeEqual(Buffer.from(totpCode(secret, time, s)), Buffer.from(c))) return Math.floor(time / 1000 / 30) + s;
    }
    return null;
}

/** A new secret for an authenticator app: 20 random bytes in Base32 (32 characters). */
export function newTotpSecret(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, '0');
    let s = '';
    for (let i = 0; i < bits.length; i += 5) s += alphabet[parseInt(bits.slice(i, i + 5), 2)];
    return s;
}

/** The address an authenticator app takes from the QR code; `label` names the relay there. */
export function totpUri(secret: string, label: string): string {
    return `otpauth://totp/OpenFolk:${encodeURIComponent(label)}?secret=${secret}&issuer=OpenFolk&algorithm=SHA1&digits=6&period=30`;
}

/**
 * The owner's second factor, kept by the relay (totp.json in its data folder) and set up in the app. A TOTP_SECRET
 * from the environment is taken over once into the file, so a relay that had one keeps it; afterwards only the file
 * counts.
 */
export class TotpStore {
    private file: string;
    secret: string;

    constructor(dataDir: string, fromEnv: string, log: (text: string) => void) {
        this.file = path.join(dataDir, 'totp.json');
        let stored = '';
        try {
            stored = String((JSON.parse(fs.readFileSync(this.file, 'utf8')) as { secret?: unknown }).secret ?? '');
        } catch { /* none yet */ }
        const env = fromEnv.replace(/\s/g, '').toUpperCase();
        if (env && !stored) {
            base32(env);
            this.save(env);
            stored = env;
            log('TOTP_SECRET taken over into totp.json; remove it from the environment, the app manages the second factor now');
        } else if (env && env !== stored) {
            log('TOTP_SECRET in the environment is ignored: the second factor is managed in the app (totp.json)');
        }
        this.secret = stored;
    }

    save(secret: string): void {
        this.secret = secret;
        if (!secret) {
            fs.rmSync(this.file, { force: true });
            return;
        }
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify({ secret }), { mode: 0o600 });
    }
}

/** Last window a code was accepted for, per secret: a code (or an older one) counts only once. */
const usedTotpSteps = new Map<string, number>();

/** Like totpVerify, but a code that was accepted once is refused afterwards, also within its validity. */
export function totpVerifyOnce(secret: string, code: string, time = Date.now()): boolean {
    const step = totpStep(secret, code, time);
    if (step === null || step <= (usedTotpSteps.get(secret) ?? -1)) return false;
    usedTotpSteps.set(secret, step);
    return true;
}
