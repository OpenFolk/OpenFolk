// Where the engines of an account keep their sign-in, sessions and settings. 'main' uses the machine's own
// (~/.claude, ~/.codex, or what CLAUDE_CONFIG_DIR and CODEX_HOME say), so nothing changes for one person alone. Every
// other account gets folders of its own in its part of the data folder (accounts/<id>/engines/), which every setup
// keeps, the bots' file tools do not hand out, and which goes with the account when it is deleted.
//
// Only Claude Code (CLAUDE_CONFIG_DIR) and Codex (CODEX_HOME) are known to keep their login in such a folder. For
// Copilot, Cursor, Antigravity and OpenCode that is not certain (a system keychain, a fixed folder), and an account must never
// run on someone else's login without noticing, so these engines serve 'main' only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliEnv, cliSettings, type AuthMode } from './auth.ts';
import { config } from './config.ts';
import { claudeOnKey } from './key-fallback.ts';
import { anthropicKey, engineKey, machineSettings } from './machine-settings.ts';
import { accountPath, currentAccount, DEFAULT_ACCOUNT } from './store.ts';
import type { Engine, KeyEngine } from '../../shared/protocol.ts';

/** Engines an account other than 'main' can sign in to with a folder of its own. */
export const ACCOUNT_ENGINES: readonly Engine[] = ['claude', 'codex'];

type HomeEngine = 'claude' | 'codex';

/** The current account's own folder for an engine; null for 'main', which uses the machine's. */
export function engineHome(engine: HomeEngine): string | null {
    return currentAccount() === DEFAULT_ACCOUNT ? null : accountPath('engines', engine);
}

/** Whether the engine may run for the current account. */
export function engineAvailable(engine: Engine): boolean {
    return currentAccount() === DEFAULT_ACCOUNT || ACCOUNT_ENGINES.includes(engine);
}

/** The environment of a CLI with the account's folders; for 'main' unchanged. */
export function engineEnv<T extends Record<string, string | undefined>>(base: T): T {
    const claude = engineHome('claude');
    const codex = engineHome('codex');
    if (!claude || !codex) return base;
    fs.mkdirSync(claude, { recursive: true });
    fs.mkdirSync(codex, { recursive: true });
    return { ...base, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
}

/** Claude Code's folder for the account: transcripts, global CLAUDE.md, skills. */
export function claudeConfigDir(): string {
    return engineHome('claude') ?? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
}

/**
 * How Claude signs in for the account right now. The API key of the machine settings is the machine owner's key:
 * another account runs on a subscription login of its own, never on that key. 'both' resolves by the rules
 * (key-fallback.ts).
 */
export function accountAuth(): AuthMode {
    if (currentAccount() !== DEFAULT_ACCOUNT) return 'subscription';
    const mode = config.auth;
    if (mode === 'both') return claudeOnKey() ? 'apikey' : 'subscription';
    return mode;
}

/**
 * The key an engine besides Claude runs on for the account, '' = its subscription login. Like Claude's, the keys are
 * the machine owner's: another account never runs on them.
 */
export function engineKeyFor(engine: KeyEngine): string {
    if (currentAccount() !== DEFAULT_ACCOUNT || machineSettings().engineAuth[engine] !== 'apikey') return '';
    return engineKey(engine);
}

/** Environment and settings for a Claude Code process of the current account. */
export function claudeEnv(auth = accountAuth()): Record<string, string | undefined> {
    return engineEnv(cliEnv(auth, auth === 'apikey' ? anthropicKey() : ''));
}

export function claudeSettings(auth = accountAuth()): ReturnType<typeof cliSettings> {
    return cliSettings(auth);
}

/** The command that signs the account in to Claude Code on this machine (the setup checklist shows it). */
export function claudeSignInCommand(): string | undefined {
    const dir = engineHome('claude');
    if (!dir) return undefined;
    if (process.env.OPENFOLK_CONTAINER === '1') return `docker compose -f docker-compose.server.yml exec -u node -e CLAUDE_CONFIG_DIR=${dir} local claude`;
    return process.platform === 'win32' ? `$env:CLAUDE_CONFIG_DIR = "${dir}"; claude` : `CLAUDE_CONFIG_DIR="${dir}" claude`;
}
