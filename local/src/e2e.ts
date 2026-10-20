// End-to-end encryption between browser and backend and between the backends.
// AES-256-GCM with E2E_KEY (32 bytes, base64), known only to the backends and the paired browsers, not to
// the relay. The direction is bound as additional authenticated data so a frame cannot be replayed in the
// other direction; a sender id, a counter and a timestamp inside every frame keep a recording relay from delivering
// a frame a second time. Without E2E_KEY the backend generates a key on its first start (data/e2e-key);
// E2E_KEY=off switches the encryption off.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { dataPath } from './store.ts';
import type { ReplayGuard } from '../../shared/protocol.ts';

export type Direction = 'c2b' | 'b2c' | 'peer';

/**
 * Additional authenticated data of a direction. Must stay byte for byte: paired browsers and other backends
 * authenticate with exactly these bytes.
 */
function aad(direction: Direction): Buffer {
    return Buffer.from(`openfolk:${direction}`);
}

function parseKey(raw: string, source: string): Buffer {
    const key = Buffer.from(raw.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (key.length !== 32) throw new Error(`${source} must be 32 bytes long (base64), see local/tools/e2e.mjs`);
    return key;
}

const keyFile = () => dataPath('e2e-key');

/** E2E_KEY, otherwise the key this backend generated earlier; null when switched off or not generated yet. */
function readKey(): Buffer | null {
    const raw = (process.env.E2E_KEY ?? '').trim();
    if (raw.toLowerCase() === 'off') return null;
    if (raw) return parseKey(raw, 'E2E_KEY');
    try {
        return parseKey(fs.readFileSync(keyFile(), 'utf8'), keyFile());
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
    }
}

let KEY = readKey();

export let e2eEnabled = KEY !== null;

/**
 * On the backend's start: without E2E_KEY and without a key from an earlier start, generate one, so a new setup
 * never sends chats through the relay in plain text. Not on import, so tests and tools leave the data folder alone.
 */
export function setupE2eKey(): 'env' | 'file' | 'generated' | 'off' {
    const raw = (process.env.E2E_KEY ?? '').trim();
    if (raw.toLowerCase() === 'off') return 'off';
    if (raw) return 'env';
    if (KEY) return 'file';
    const key = randomBytes(32);
    fs.mkdirSync(dataPath(), { recursive: true });
    fs.writeFileSync(keyFile(), key.toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
    KEY = key;
    e2eEnabled = true;
    return 'generated';
}

/** The key as it goes into a pairing link (`#e2e=…`, base64url without padding); '' without a key. */
export function e2eKeyForLink(): string {
    return KEY ? KEY.toString('base64url') : '';
}

// ---- Replay protection

/** Frames older or newer than this (clock difference included) are not accepted. */
export const REPLAY_WINDOW_MS = 10 * 60_000;
const SENDER = randomBytes(8).toString('hex');
let counter = 0;
/** Highest counter seen per direction and sender, with the time it arrived. */
const seen = new Map<string, { n: number; at: number }>();

/** Why a frame that decrypted fine is still not accepted. */
export class ReplayError extends Error {
    readonly reason: 'missing' | 'stale' | 'repeated';
    constructor(reason: 'missing' | 'stale' | 'repeated') {
        super(`frame rejected (${reason})`);
        this.reason = reason;
    }
}

function checkReplay(r: ReplayGuard | undefined, direction: Direction): void {
    if (!r || typeof r.t !== 'number' || typeof r.s !== 'string' || typeof r.n !== 'number') throw new ReplayError('missing');
    const now = Date.now();
    if (Math.abs(now - r.t) > REPLAY_WINDOW_MS) throw new ReplayError('stale');
    const id = `${direction}:${r.s}`;
    const last = seen.get(id);
    if (last && r.n <= last.n) throw new ReplayError('repeated');
    seen.set(id, { n: r.n, at: now });
    // A sender silent for longer than the window can only resend stale frames: forget it
    if (seen.size > 200) for (const [k, v] of seen) if (now - v.at > REPLAY_WINDOW_MS) seen.delete(k);
}

export function encrypt(content: object, direction: Direction): { iv: string; data: string } {
    if (!KEY) throw new Error('E2E_KEY is missing');
    const guard: ReplayGuard = { t: Date.now(), s: SENDER, n: ++counter };
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', KEY, iv);
    c.setAAD(aad(direction));
    const data = Buffer.concat([c.update(JSON.stringify({ ...content, _r: guard }), 'utf8'), c.final(), c.getAuthTag()]);
    return { iv: iv.toString('base64'), data: data.toString('base64') };
}

/** Decrypts and checks authenticity and freshness; throws for a wrong key or altered data, ReplayError for a replay. */
export function decrypt<T>(frame: { iv: string; data: string }, direction: Direction): T {
    if (!KEY) throw new Error('E2E_KEY is missing');
    const data = Buffer.from(frame.data, 'base64');
    if (data.length < 17) throw new Error('Frame too short');
    const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(frame.iv, 'base64'));
    d.setAAD(aad(direction));
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    const { _r, ...content } = JSON.parse(plain.toString('utf8')) as { _r?: ReplayGuard };
    checkReplay(_r, direction);
    return content as T;
}
