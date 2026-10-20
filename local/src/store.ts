import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

// The data folder holds what belongs to this machine (tokens, end-to-end key, VAPID keys, the embedded relay) at its
// root and everything that belongs to an account under accounts/<id>/: bots, groups, routines, history, knowledge,
// uploads, settings. Which account a read or write goes to comes from the async context: a BotManager runs in the
// context of its account, so its timers, sessions and frame handlers do as well.

export const DEFAULT_ACCOUNT = 'main';
const ACCOUNTS = 'accounts';

const current = new AsyncLocalStorage<string>();
/** Accounts deleted while this process runs: whatever still tries to touch their data fails instead of recreating it. */
const retired = new Set<string>();

/** Account ids come from the relay and become folder names: nothing else gets through. */
export function isAccountId(id: unknown): id is string {
    return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
}

/** Runs `fn` (and everything it starts asynchronously) in the context of an account. */
export function inAccount<T>(account: string, fn: () => T): T {
    if (!isAccountId(account)) throw new Error(`Invalid account id: ${JSON.stringify(account)}`);
    return current.run(account, fn);
}

/** After an account was deleted: its data must not be read or written any more. */
export function retireAccount(account: string): void {
    retired.add(account);
}

/** The accounts that have a folder on this machine. */
export function accountIds(): string[] {
    try {
        return fs.readdirSync(path.join(config.dataDir, ACCOUNTS), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
        return [];
    }
}

/**
 * The account of the current context. Outside of one only the single account of a machine with one is meant (the
 * command line tools, the tests); with several, a missing context is a defect that would mix accounts, so it fails.
 */
export function currentAccount(): string {
    const a = current.getStore();
    if (a) return a;
    const all = accountIds();
    if (all.length <= 1) return all[0] ?? DEFAULT_ACCOUNT;
    throw new Error('No account context: refusing to guess between several accounts');
}

/** Wraps a callback so it runs in the account that is current now, wherever it is called from later. */
export function bindAccount<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const account = currentAccount();
    return (...args: A) => inAccount(account, () => fn(...args));
}

/** A path in the current account's folder. */
export function accountPath(...parts: string[]): string {
    const account = currentAccount();
    if (retired.has(account)) throw new Error(`Account ${account} was deleted`);
    return path.join(config.dataDir, ACCOUNTS, account, ...parts);
}

/** The folder of an account, for moving it away when it is deleted. */
export function accountFolder(account: string): string {
    if (!isAccountId(account)) throw new Error(`Invalid account id: ${JSON.stringify(account)}`);
    return path.join(config.dataDir, ACCOUNTS, account);
}

/** A path in this machine's part of the data folder. */
export function dataPath(...parts: string[]): string {
    return path.join(config.dataDir, ...parts);
}

function readFile<T>(file: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return fallback;
    }
}

/** Reads a JSON file of the current account; if it is missing, the default comes back. */
export function readJson<T>(name: string, fallback: T): T {
    return readFile(accountPath(name), fallback);
}

/** Reads a JSON file of this machine. */
export function readMachineJson<T>(name: string, fallback: T): T {
    return readFile(dataPath(name), fallback);
}

/** Parsed files by path, valid while modification time and size stay the same. */
const parsed = new Map<string, { mtimeMs: number; size: number; data: unknown }>();

/**
 * Like readJson, but parses the file again only when it changed: bots.json holds the profile pictures and is read
 * on nearly every frame. The caller gets the cached value and must copy what it changes (bots.ts does).
 */
export function readJsonCached<T>(name: string, fallback: T): T {
    const file = accountPath(name);
    let st: fs.Stats;
    try {
        st = fs.statSync(file);
    } catch {
        parsed.delete(file);
        return fallback;
    }
    const hit = parsed.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data as T;
    const data = readFile<T>(file, fallback);
    parsed.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
    return data;
}

/** Writes atomically (temporary file, then rename). */
function writeFile(target: string, data: unknown): void {
    parsed.delete(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: PRIVATE });
    fs.renameSync(tmp, target);
}

/** Writes a JSON file of the current account. */
export function writeJson(name: string, data: unknown): void {
    writeFile(accountPath(name), data);
}

/** Writes a JSON file of this machine. */
export function writeMachineJson(name: string, data: unknown): void {
    writeFile(dataPath(name), data);
}

/**
 * Mode of the files in the data folder: push keys, device tokens, the whole history and the uploads, readable only
 * by the user who runs the backend. On Windows the folder's access rights apply instead.
 */
export const PRIVATE = 0o600;

/** Restricts the data folder to its owner (on start); in a Docker volume it would otherwise be readable for all. */
export function secureDataDir(): void {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(config.dataDir, 0o700);
}

// ---- Tombstones: so another machine does not bring deleted items back ----

export function tombstones(): Record<string, string> {
    return readJson<Record<string, string>>('deleted.json', {});
}

export function setTombstone(key: string): void {
    writeJson('deleted.json', { ...tombstones(), [key]: new Date().toISOString() });
}

export function saveTombstones(list: Record<string, string>): void {
    writeJson('deleted.json', list);
}

/** Make an id from names/folders: lower case, only a-z0-9 and hyphen (German umlauts transliterated). */
export function slug(text: string): string {
    return text.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot';
}
