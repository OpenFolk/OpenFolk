// The backend's settings as its tools see them (e2e.mjs, claim.mjs): relay/.env, the .env, the environment, and
// what the backend generated in its data folder on its first start. Never prints a value.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const envFile = process.env.OPENFOLK_ENV_FILE || fileURLToPath(new URL('../../.env', import.meta.url));
export const relayEnvFile = fileURLToPath(new URL('../../relay/.env', import.meta.url));

export function parse(file) {
    try {
        return dotenv.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}

export const dataDir = (v) => v.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));

/** A value the backend generated on its first start (local/data/<name>); '' if it has not started yet. */
export function generated(v, name) {
    try {
        return fs.readFileSync(path.join(dataDir(v), name), 'utf8').trim();
    } catch {
        return '';
    }
}

/**
 * Values as the backend sees them: relay/.env, the .env, the environment (in the container there is no .env file),
 * and for E2E_KEY, AGENT_TOKEN and USER_PASSWORD (formerly CLIENT_TOKEN) what the backend generated in its data folder.
 */
export function values() {
    const v = { ...parse(relayEnvFile), ...parse(envFile), ...process.env };
    if (!v.E2E_KEY) v.E2E_KEY = generated(v, 'e2e-key');
    else if (v.E2E_KEY.trim().toLowerCase() === 'off') v.E2E_KEY = '';
    v.AGENT_TOKEN ||= generated(v, 'agent-token');
    v.USER_PASSWORD ||= v.CLIENT_TOKEN || generated(v, 'client-token');
    return v;
}

/**
 * AGENT_TOKEN or USER_PASSWORD as the backend will use it: from the environment or the .env, otherwise generated in
 * the data folder as on the backend's first start (local/src/tokens.ts), so a relay can be claimed before that.
 */
export function ensureToken(name) {
    const v = values();
    if (v[name]) return v[name];
    const dir = dataDir(v);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name === 'AGENT_TOKEN' ? 'agent-token' : 'client-token');
    try {
        fs.writeFileSync(file, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }
    return fs.readFileSync(file, 'utf8').trim();
}

/** HTTP address of the relay: from RELAY_URL, or the one embedded in the backend (no RELAY_URL). */
export function relayOrigin(v = values()) {
    if (!v.RELAY_URL) return `http://127.0.0.1:${Number(v.RELAY_PORT) || 8787}`;
    const u = new URL(v.RELAY_URL);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.origin;
}

/**
 * Sets values in a .env file: replaces empty placeholders (KEY=), otherwise appends – no duplicate entries. With
 * `replace`, a line that already has a value is replaced too. Lines only, never comments (the .env holds KEY=value).
 */
export function set(pairs, file = envFile, replace = false) {
    let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    for (const [k, value] of Object.entries(pairs)) {
        const re = new RegExp(`^${k}=${replace ? '.*' : '[ \t]*'}$`, 'm');
        if (re.test(content)) content = content.replace(re, `${k}=${value}`);
        else content += `${content && !content.endsWith('\n') ? '\n' : ''}${k}=${value}\n`;
    }
    fs.writeFileSync(file, content);
}
