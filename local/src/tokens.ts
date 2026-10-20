// The two tokens between backend and relay. Like the end-to-end key (e2e.ts) they are born on the backend's first
// start, so a new setup needs no .env: AGENT_TOKEN signs the backend in at the relay, USER_PASSWORD is the web app's
// password, needed only when no pairing link is at hand. A value in the environment always wins; further machines
// get the same values through the .env (`npm run env` writes them there).

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { dataPath, PRIVATE, secureDataDir } from './store.ts';

export type TokenName = 'AGENT_TOKEN' | 'USER_PASSWORD';
// The password's file keeps the name from when the variable was CLIENT_TOKEN, so existing data folders stay valid
const FILES: Record<TokenName, string> = { AGENT_TOKEN: 'agent-token', USER_PASSWORD: 'client-token' };
/** Former names that still count when the current one is not set. */
const LEGACY: Partial<Record<TokenName, string>> = { USER_PASSWORD: 'CLIENT_TOKEN' };

const fromEnv = (name: TokenName): string => process.env[name]?.trim() || (LEGACY[name] ? process.env[LEGACY[name]]?.trim() : '') || '';

const known = new Map<TokenName, string>();

/** Where a token comes from: the environment, or the file this backend generated. */
export function tokenSource(name: TokenName): 'env' | 'file' {
    return fromEnv(name) ? 'env' : 'file';
}

/** The token from the environment, otherwise from the data folder, generated there on first use (32 bytes, hex). */
export function token(name: TokenName): string {
    const own = fromEnv(name);
    if (own) return own;
    const cached = known.get(name);
    if (cached) return cached;
    const file = dataPath(FILES[name]);
    let value = '';
    try {
        value = fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (!value) {
        secureDataDir();
        value = randomBytes(32).toString('hex');
        try {
            fs.writeFileSync(file, value + '\n', { mode: PRIVATE, flag: 'wx' });
        } catch (e) {
            // A second process (a tool next to the running backend) was faster: take its value
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            value = fs.readFileSync(file, 'utf8').trim();
        }
    }
    known.set(name, value);
    return value;
}

export const agentToken = (): string => token('AGENT_TOKEN');
export const clientToken = (): string => token('USER_PASSWORD');
