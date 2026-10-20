// Settings shared by all devices and machines of an account: the language of the UI and the bots' answers, the image
// model for profile pictures, the language of voice messages, the git fast-forward and what app notifications show.
// Stored in settings.json, synced in the snapshot; the newer `updatedAt` wins. The API keys for the image models
// live apart in api-keys.json: a browser only learns whether one is stored, and they travel to the other machines
// only in encrypted sync.

import { e2eEnabled } from './e2e.ts';
import { setLanguageSource } from './i18n.ts';
import { currentAccount, readJson, writeJson } from './store.ts';
import {
    AVATAR_MODELS, LANGUAGES, PUSH_PREVIEWS, SHARED_API_KEYS, type AvatarModel, type Language, type PushPreview, type SharedApiKey,
    type SharedSettings, type SharedSettingsInput, type Snapshot,
} from '../../shared/protocol.ts';

const FILE = 'settings.json';
const KEYS_FILE = 'api-keys.json';

type StoredKeys = NonNullable<Snapshot['apiKeys']>;

/** Per account; read on every translated text. */
const cache = new Map<string, SharedSettings>();

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

/** Only known fields with valid values; anything else falls back to the default (missing). */
function clean(s: Partial<SharedSettings>): SharedSettings {
    const r: SharedSettings = { language: isLanguage(s.language) ? s.language : 'en', updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '' };
    if (oneOf(AVATAR_MODELS, s.avatarModel)) r.avatarModel = s.avatarModel;
    if (s.voiceLanguage === '' || isLanguage(s.voiceLanguage)) r.voiceLanguage = s.voiceLanguage;
    if (typeof s.gitAutoPull === 'boolean') r.gitAutoPull = s.gitAutoPull;
    if (oneOf(PUSH_PREVIEWS, s.pushPreview)) r.pushPreview = s.pushPreview;
    return r;
}

export function loadSettings(): SharedSettings {
    const hit = cache.get(currentAccount());
    if (hit) return hit;
    const fresh = clean(readJson<Partial<SharedSettings>>(FILE, {}));
    cache.set(currentAccount(), fresh);
    return fresh;
}

function store(s: SharedSettings): void {
    writeJson(FILE, s);
    cache.set(currentAccount(), s);
}

export function isLanguage(l: unknown): l is Language {
    return oneOf(LANGUAGES, l);
}

export function saveLanguage(language: Language): SharedSettings {
    if (!isLanguage(language)) throw new Error(`Unknown language: ${String(language)}`);
    return saveSettings({ language });
}

/** Takes over the fields given (checked by frames.ts); the result has a new `updatedAt`. */
export function saveSettings(input: SharedSettingsInput): SharedSettings {
    const s = clean({ ...loadSettings(), ...input, updatedAt: new Date().toISOString() });
    store(s);
    return s;
}

/** Take over the settings of another machine if they are newer; true = changed. */
export function mergeSettings(other: SharedSettings | undefined): boolean {
    if (!other || typeof other.updatedAt !== 'string' || !other.updatedAt || other.updatedAt <= loadSettings().updatedAt) return false;
    if (!isLanguage(other.language)) return false;
    store(clean(other));
    return true;
}

/** What browsers get: the settings and which API keys are stored. */
export function settingsForBrowser(): SharedSettings {
    const keys = storedKeys().keys;
    return { ...loadSettings(), apiKeys: Object.fromEntries(SHARED_API_KEYS.map((k) => [k, Boolean(keys[k])])) };
}

export const avatarModel = (): AvatarModel => loadSettings().avatarModel ?? 'gemini-3.1-flash-image';
export const voiceLanguage = (): '' | Language => loadSettings().voiceLanguage ?? '';
export const gitAutoPull = (): boolean => loadSettings().gitAutoPull ?? true;
export const pushPreview = (): PushPreview => loadSettings().pushPreview ?? 'title';

// ------------------------------------------------------------------ API keys

function storedKeys(): StoredKeys {
    const k = readJson<Partial<StoredKeys>>(KEYS_FILE, {});
    const keys: StoredKeys['keys'] = {};
    for (const name of SHARED_API_KEYS) if (typeof k.keys?.[name] === 'string' && k.keys[name]) keys[name] = k.keys[name];
    return { keys, updatedAt: typeof k.updatedAt === 'string' ? k.updatedAt : '' };
}

export function apiKey(name: SharedApiKey): string {
    return storedKeys().keys[name] ?? '';
}

/** New keys ('' removes one); true = something changed. */
export function saveApiKeys(input: Partial<Record<SharedApiKey, string>>): boolean {
    const current = storedKeys();
    const keys = { ...current.keys };
    for (const name of SHARED_API_KEYS) {
        const v = input[name]?.trim();
        if (v === undefined) continue;
        if (v) keys[name] = v;
        else delete keys[name];
    }
    if (JSON.stringify(keys) === JSON.stringify(current.keys)) return false;
    writeJson(KEYS_FILE, { keys, updatedAt: new Date().toISOString() });
    return true;
}

/** The keys for the snapshot: only when the sync is encrypted, otherwise the relay could read them. */
export function keysForSync(): StoredKeys | undefined {
    if (!e2eEnabled) return undefined;
    const k = storedKeys();
    return k.updatedAt ? k : undefined;
}

/** Keys from another machine if they are newer; true = changed. */
export function mergeApiKeys(other: StoredKeys | undefined): boolean {
    if (!e2eEnabled || !other || typeof other.updatedAt !== 'string' || other.updatedAt <= storedKeys().updatedAt) return false;
    const keys: StoredKeys['keys'] = {};
    for (const name of SHARED_API_KEYS) if (typeof other.keys?.[name] === 'string' && other.keys[name]) keys[name] = other.keys[name];
    writeJson(KEYS_FILE, { keys, updatedAt: other.updatedAt });
    return true;
}

/** Forget the cached state (tests that switch DATA_DIR). */
export function resetSettingsCache(): void {
    cache.clear();
}

setLanguageSource(() => loadSettings().language);
