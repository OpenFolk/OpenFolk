// Settings of this machine that the app changes (settings page, main account only): the engines and their sign-in, shutting down,
// handing chats over, voice messages, the git token for pushing. Stored in machine-settings.json at the root of the
// data folder and not synced: each machine has its own. The engines' keys and the git token live apart
// (anthropic-key, engine-key-<engine>, git-push-token) and never leave this machine. What runs commands or draws a security line (scripts,
// commands, allowed folders) stays in the .env, so a paired device cannot change it.

import fs from 'node:fs';
import { gitPushCredentials } from './git.ts';
import { dataPath, PRIVATE, readMachineJson, secureDataDir, writeMachineJson } from './store.ts';
import {
    AFTER_WAKE, CLAUDE_AUTH_MODES, CLAUDE_FALLBACK, ENGINE_AUTH_MODES, KEY_ENGINES, MACHINE_SETTINGS_DEFAULT, MACHINE_SETTINGS_MAX, OTHER_ENGINES, VOICE_DEVICES, VOICE_MODELS,
    type Engine, type KeyEngine, type MachineSettings,
} from '../../shared/protocol.ts';

const FILE = 'machine-settings.json';
const KEY_FILE = 'anthropic-key';
const GIT_TOKEN_FILE = 'git-push-token';

let cached: MachineSettings | null = null;

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

const ENGINES: readonly Engine[] = ['claude', ...OTHER_ENGINES];

/** Known engines once each; all of them switched off is a new installation before the user picks. */
function cleanDisabled(v: unknown): Engine[] {
    if (!Array.isArray(v)) return [];
    return ENGINES.filter((e) => v.includes(e));
}

function cleanEngineAuth(v: unknown): MachineSettings['engineAuth'] {
    if (!v || typeof v !== 'object') return {};
    const r = v as Record<string, unknown>;
    return Object.fromEntries(KEY_ENGINES.filter((e) => oneOf(ENGINE_AUTH_MODES, r[e])).map((e) => [e, r[e]]));
}

/** Only known fields with valid values; anything else is the default. */
export function cleanMachineSettings(s: Partial<Record<keyof MachineSettings, unknown>>): MachineSettings {
    const d = MACHINE_SETTINGS_DEFAULT;
    const bool = (k: keyof MachineSettings) => (typeof s[k] === 'boolean' ? s[k] : d[k]) as boolean;
    const num = (k: keyof typeof MACHINE_SETTINGS_MAX) => {
        const v = s[k];
        return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MACHINE_SETTINGS_MAX[k] ? v : d[k];
    };
    return {
        claudeAuth: oneOf(CLAUDE_AUTH_MODES, s.claudeAuth) ? s.claudeAuth : d.claudeAuth,
        claudeFallback: oneOf(CLAUDE_FALLBACK, s.claudeFallback) ? s.claudeFallback : d.claudeFallback,
        claudeKeyBudgetUsd: num('claudeKeyBudgetUsd'),
        engineAuth: cleanEngineAuth(s.engineAuth),
        disabledEngines: cleanDisabled(s.disabledEngines),
        shutdown: bool('shutdown'),
        shutdownDelaySeconds: num('shutdownDelaySeconds'),
        afterWake: oneOf(AFTER_WAKE, s.afterWake) ? s.afterWake : d.afterWake,
        afterWakeSeconds: num('afterWakeSeconds'),
        afterWakeWaitMinutes: num('afterWakeWaitMinutes'),
        idleMinutes: num('idleMinutes'),
        handoverIde: bool('handoverIde'),
        handoverTerminal: bool('handoverTerminal'),
        voiceModel: oneOf(VOICE_MODELS, s.voiceModel) ? s.voiceModel : d.voiceModel,
        voiceDevice: oneOf(VOICE_DEVICES, s.voiceDevice) ? s.voiceDevice : d.voiceDevice,
        voicePreload: bool('voicePreload'),
        gitPushUser: typeof s.gitPushUser === 'string' ? s.gitPushUser.trim() : d.gitPushUser,
        gitPushHost: typeof s.gitPushHost === 'string' && /^[a-z0-9.:-]*$/i.test(s.gitPushHost.trim()) ? s.gitPushHost.trim().toLowerCase() : d.gitPushHost,
    };
}

export function machineSettings(): MachineSettings {
    cached ??= cleanMachineSettings(readMachineJson<Partial<MachineSettings>>(FILE, {}));
    return cached;
}

/** Takes over the fields given (checked by frames.ts). */
export function saveMachineSettings(input: Partial<MachineSettings>): MachineSettings {
    const s = cleanMachineSettings({ ...machineSettings(), ...input });
    writeMachineJson(FILE, s);
    cached = s;
    return s;
}

function readSecret(file: string): string {
    try {
        return fs.readFileSync(dataPath(file), 'utf8').trim();
    } catch {
        return '';
    }
}

function saveSecret(file: string, value: string): void {
    const v = value.trim();
    if (!v) {
        fs.rmSync(dataPath(file), { force: true });
        return;
    }
    secureDataDir();
    fs.writeFileSync(dataPath(file), v, { mode: PRIVATE });
}

/** The API key for the Claude sessions ('' = none). */
export const anthropicKey = (): string => readSecret(KEY_FILE);
/** Stores a new key, '' removes it. */
export const saveAnthropicKey = (key: string): void => saveSecret(KEY_FILE, key);

/** The key an engine besides Claude runs on in 'apikey' mode ('' = none). */
export const engineKey = (engine: KeyEngine): string => readSecret(`engine-key-${engine}`);
export const saveEngineKey = (engine: KeyEngine, key: string): void => saveSecret(`engine-key-${engine}`, key);

export const engineEnabled = (engine: Engine): boolean => !machineSettings().disabledEngines.includes(engine);
/** Every engine switched off: the machine waits for the user's choice. */
export const noEngine = (): boolean => machineSettings().disabledEngines.length === ENGINES.length;

/**
 * A new data folder starts with every engine off, so the user switches on only their own. The default stays "all on":
 * machines from before the choice have no machine-settings.json and must not lose their engines.
 */
export function startWithoutEngines(): void {
    if (!fs.existsSync(dataPath(FILE))) saveMachineSettings({ disabledEngines: [...ENGINES] });
}

/** The token for pushing to gitPushHost ('' = none). */
export const gitPushToken = (): string => readSecret(GIT_TOKEN_FILE);
export const saveGitPushToken = (token: string): void => saveSecret(GIT_TOKEN_FILE, token);

/** Puts the git token into this process's environment (at start and after a change); sessions started later inherit it. */
export function applyGitPush(): boolean {
    const s = machineSettings();
    return gitPushCredentials(process.env, { user: s.gitPushUser, host: s.gitPushHost, token: gitPushToken() });
}

/** Forget the cached state (tests that switch DATA_DIR). */
export function resetMachineSettingsCache(): void {
    cached = null;
}
