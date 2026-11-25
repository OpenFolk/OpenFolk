// The vault: credentials for the bots' work (API tokens, passwords of services), kept per account and managed by
// admins only. A bot sees the entries it may use as environment variables of its engine process; the system prompt
// names them. The values never go to a browser (write-only, like the API keys), and whatever a bot or a tool prints
// passes `redact()` before it reaches the history, the app, a push text or another machine.
//
// On disk the entries are encrypted (AES-256-GCM) with a key of this machine, data/vault-key, generated on the first
// write like the end-to-end key: a copy of an account's folder alone shows nothing. Between the machines the vault
// travels only inside the encrypted sync (E2E), as api-keys.json does; the receiving machine encrypts it with its own key.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { e2eEnabled, parseKey } from './e2e.ts';
import { t } from './i18n.ts';
import { accountPath, currentAccount, dataPath, PRIVATE, readJson, secureDataDir, setTombstone, writeJson } from './store.ts';
import { VAULT_ENTRIES_MAX, VAULT_NAME, VAULT_NOTE_MAX, VAULT_VALUE_MAX, VAULT_VALUE_MIN, type Snapshot, type VaultEntryInput, type VaultEntryView } from '../../shared/protocol.ts';

export type VaultEntry = VaultEntryView & { value: string };
type Stored = NonNullable<Snapshot['vault']>;
/** The file: the entries as one encrypted blob. */
interface VaultFile {
    v: 1;
    updatedAt: string;
    iv: string;
    data: string;
}

const FILE = 'vault.json';
const KEY_FILE = 'vault-key';

/**
 * Names the engines sign in or bill with, and those that steer a process: a vault entry must never change how an
 * engine runs (an OPENAI_API_KEY would let Codex and OpenCode bill through it, a GH_TOKEN would sign Copilot in).
 */
const RESERVED_PREFIXES = ['ANTHROPIC_', 'CLAUDE_', 'CODEX_', 'OPENAI_', 'CURSOR_', 'COPILOT_', 'OPENCODE_', 'OPENFOLK_', 'GEMINI_', 'NODE_', 'ELECTRON_', 'LD_', 'DYLD_'];
const RESERVED_NAMES = new Set([
    'GH_TOKEN', 'GITHUB_TOKEN', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'SHELL', 'COMSPEC',
    'SYSTEMROOT', 'WINDIR', 'DATA_DIR', 'E2E_KEY', 'AGENT_TOKEN', 'USER_PASSWORD', 'CLIENT_TOKEN', 'RELAY_URL', 'ALLOWED_ROOTS', 'MACHINE_NAME',
]);

/** Why a name is not allowed: reserved for the engines' sign-in or the system, or not shaped like a variable. */
export function nameProblem(name: string): 'shape' | 'reserved' | null {
    if (!VAULT_NAME.test(name)) return 'shape';
    if (RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p))) return 'reserved';
    return null;
}

// ---- The key of this machine

let KEY: Buffer | null = null;

function key(): Buffer {
    if (KEY) return KEY;
    const file = dataPath(KEY_FILE);
    try {
        KEY = parseKey(fs.readFileSync(file, 'utf8'), file);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        secureDataDir();
        const fresh = randomBytes(32);
        try {
            fs.writeFileSync(file, fresh.toString('base64url') + '\n', { mode: PRIVATE, flag: 'wx' });
            KEY = fresh;
        } catch (e2) {
            // a second process was faster: take its key
            if ((e2 as NodeJS.ErrnoException).code !== 'EEXIST') throw e2;
            KEY = parseKey(fs.readFileSync(file, 'utf8'), file);
        }
    }
    return KEY;
}

/** Binds the blob to the account: the file of one account does not open as another's. */
const aad = (account: string) => Buffer.from(`openfolk:vault:${account}`);

function seal(entries: VaultEntry[], updatedAt: string): VaultFile {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key(), iv);
    c.setAAD(aad(currentAccount()));
    const data = Buffer.concat([c.update(JSON.stringify(entries), 'utf8'), c.final(), c.getAuthTag()]);
    return { v: 1, updatedAt, iv: iv.toString('base64'), data: data.toString('base64') };
}

function open(f: VaultFile): VaultEntry[] {
    const data = Buffer.from(f.data, 'base64');
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(f.iv, 'base64'));
    d.setAAD(aad(currentAccount()));
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return (JSON.parse(plain.toString('utf8')) as VaultEntry[]).filter(isEntry);
}

function isEntry(e: unknown): e is VaultEntry {
    const r = e as Partial<VaultEntry>;
    return typeof r?.id === 'string' && typeof r.name === 'string' && typeof r.value === 'string' && (r.bots === null || Array.isArray(r.bots));
}

// ---- Reading and writing

/** Per account, decrypted once; invalidated by every write. */
const cache = new Map<string, Stored>();
/** Counts the changes, so a redactor built earlier knows it is stale. */
let version = 0;

function stored(): Stored {
    const account = currentAccount();
    const hit = cache.get(account);
    if (hit) return hit;
    const f = readJson<Partial<VaultFile> | null>(FILE, null);
    let s: Stored = { entries: [], updatedAt: '' };
    if (f && f.v === 1 && typeof f.iv === 'string' && typeof f.data === 'string') {
        try {
            s = { entries: open(f as VaultFile), updatedAt: typeof f.updatedAt === 'string' ? f.updatedAt : '' };
        } catch (e) {
            // another machine's key, or a damaged file: the vault counts as empty until the sync brings it again
            console.log(`vault: ${accountPath(FILE)} does not open (${(e as Error).message})`);
        }
    }
    cache.set(account, s);
    return s;
}

function store(entries: VaultEntry[], updatedAt: string): void {
    if (!entries.length && !fs.existsSync(accountPath(FILE))) {
        cache.set(currentAccount(), { entries, updatedAt });
        return;
    }
    writeJson(FILE, seal(entries, updatedAt));
    cache.set(currentAccount(), { entries, updatedAt });
    version++;
}

/** The entries with their values, in the order they were made. */
export function vaultEntries(): VaultEntry[] {
    return stored().entries;
}

/** What a browser gets: everything but the values. */
export function vaultViews(): VaultEntryView[] {
    return vaultEntries().map(({ value: _v, ...view }) => view);
}

export class VaultError extends Error {
    readonly code: 'name' | 'reserved' | 'taken' | 'value' | 'note' | 'full' | 'missing';
    constructor(code: VaultError['code']) {
        super(`vault: ${code}`);
        this.code = code;
    }
}

/** The reason for the app, in its language. */
export function vaultErrorText(e: VaultError): string {
    return e.code === 'value' ? t('vault.value', { min: String(VAULT_VALUE_MIN), max: String(VAULT_VALUE_MAX) }) : t(`vault.${e.code}`);
}

/** Creates or changes an entry; throws a VaultError with the reason when the input is not acceptable. */
export function saveVaultEntry(input: VaultEntryInput): VaultEntry {
    const name = input.name.trim().toUpperCase();
    const problem = nameProblem(name);
    if (problem) throw new VaultError(problem === 'shape' ? 'name' : 'reserved');
    const note = input.note.trim();
    if (note.length > VAULT_NOTE_MAX) throw new VaultError('note');
    const entries = [...vaultEntries()];
    const at = input.id ? entries.findIndex((e) => e.id === input.id) : -1;
    if (input.id && at < 0) throw new VaultError('missing');
    if (entries.some((e, i) => i !== at && e.name === name)) throw new VaultError('taken');
    const value = input.value === undefined ? entries[at]?.value : input.value;
    if (value === undefined || value.length < VAULT_VALUE_MIN || value.length > VAULT_VALUE_MAX) throw new VaultError('value');
    if (at < 0 && entries.length >= VAULT_ENTRIES_MAX) throw new VaultError('full');
    const now = new Date().toISOString();
    const bots = input.bots === null ? null : [...new Set(input.bots.filter((b) => typeof b === 'string' && b))];
    const entry: VaultEntry = { id: at < 0 ? randomUUID().slice(0, 12) : entries[at].id, name, note, bots, value, createdAt: at < 0 ? now : entries[at].createdAt, updatedAt: now };
    if (at < 0) entries.push(entry);
    else entries[at] = entry;
    store(entries, now);
    return entry;
}

/** Deletes an entry; a tombstone keeps another machine from bringing it back. True = there was one. */
export function deleteVaultEntry(id: string): boolean {
    const entries = vaultEntries();
    if (!entries.some((e) => e.id === id)) return false;
    setTombstone(`vault:${id}`);
    store(entries.filter((e) => e.id !== id), new Date().toISOString());
    return true;
}

// ---- For the bots

/** The entries a bot may use: those for every bot, and those naming it. */
export function vaultFor(botId: string): VaultEntry[] {
    return vaultEntries().filter((e) => e.bots === null || e.bots.includes(botId));
}

/** The environment a bot's engine process gets on top of its own. */
export function vaultEnv(botId: string): Record<string, string> {
    return Object.fromEntries(vaultFor(botId).map((e) => [e.name, e.value]));
}

/** The names for the system prompt, sorted. */
export function vaultNames(botId: string): string[] {
    return vaultFor(botId).map((e) => e.name).sort();
}

type Redactor = (text: string) => string;
const same: Redactor = (text) => text;
const redactors = new Map<string, { version: number; redact: Redactor }>();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces every value of the account's vault by `[vault:NAME]`, longest first so a value that contains another is
 * taken whole. Every entry counts, not only the bot's: a value must not appear in any chat, whoever leaked it.
 */
export function redact(text: string): string {
    return redactor()(text);
}

/** The redactor of the current account, rebuilt after a change. */
export function redactor(): Redactor {
    const account = currentAccount();
    const hit = redactors.get(account);
    if (hit && hit.version === version) return hit.redact;
    const entries = [...vaultEntries()].sort((a, b) => b.value.length - a.value.length);
    let fn = same;
    if (entries.length) {
        const re = new RegExp(entries.map((e) => escapeRegExp(e.value)).join('|'), 'g');
        const byValue = new Map(entries.map((e) => [e.value, e.name]));
        fn = (text) => (text ? text.replace(re, (v) => `[vault:${byValue.get(v) ?? '?'}]`) : text);
    }
    redactors.set(account, { version, redact: fn });
    return fn;
}

// ---- Sync

/** The vault for the snapshot: only when the sync is encrypted, otherwise the relay could read it. */
export function vaultForSync(): Stored | undefined {
    if (!e2eEnabled) return undefined;
    const s = stored();
    return s.updatedAt ? s : undefined;
}

/**
 * Takes over another machine's vault entry by entry: the newer state of an entry wins, a tombstone at least as new
 * removes it (also without a vault in the snapshot: a deletion elsewhere must take effect here). Only in encrypted
 * sync. True = something changed here.
 */
export function mergeVault(other: Stored | undefined, dead: Record<string, string>): boolean {
    if (!e2eEnabled) return false;
    const own = stored();
    const map = new Map(own.entries.map((e) => [e.id, e]));
    let changed = false;
    for (const f of Array.isArray(other?.entries) ? other.entries : []) {
        if (!isEntry(f) || nameProblem(f.name)) continue;
        const tomb = dead[`vault:${f.id}`];
        if (tomb && tomb >= (f.updatedAt ?? '')) continue;
        const mine = map.get(f.id);
        if (mine && (f.updatedAt ?? '') <= (mine.updatedAt ?? '')) continue;
        map.set(f.id, f);
        changed = true;
    }
    for (const [id, e] of map) {
        const tomb = dead[`vault:${id}`];
        if (tomb && tomb >= (e.updatedAt ?? '')) {
            map.delete(id);
            changed = true;
        }
    }
    if (!changed) return false;
    const updatedAt = [own.updatedAt, typeof other?.updatedAt === 'string' ? other.updatedAt : '', new Date().toISOString()].sort().at(-1) ?? '';
    store([...map.values()], updatedAt);
    return true;
}

/** Forget the cached state (tests that switch DATA_DIR). */
export function resetVaultCache(): void {
    cache.clear();
    redactors.clear();
    KEY = null;
    version++;
}
