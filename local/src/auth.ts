// How the sessions sign in with Anthropic: through the Claude subscription (login of the Claude Code CLI)
// or with an own API key from the Console. Switched in the machine settings (machine-settings.ts), where the key
// is stored too; ANTHROPIC_API_KEY from the environment is never passed on.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineAuth } from '../../shared/protocol.ts';

/** The sign-in a Claude process runs on; 'both' in the settings resolves to one of them (key-fallback.ts). */
export type AuthMode = EngineAuth;

const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'api-key.mjs');

/** Variables that would redirect the CLI to other sign-in methods or foreign endpoints. */
const FOREIGN_AUTH = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BASE_URL'];

/**
 * Environment for the CLI. In subscription mode without any API key, so nothing is billed through the
 * Console. In API key mode `key` (from the machine settings) goes in as ANTHROPIC_API_KEY for the helper; if it is
 * missing, this fails right away instead of silently falling back to the subscription. A key in the backend's own
 * environment never counts.
 */
export function cliEnv(mode: AuthMode, key = '', base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...base, CLAUDE_AGENT_SDK_CLIENT_APP: 'openfolk/0.2.0' };
    for (const k of FOREIGN_AUTH) delete env[k];
    delete env.ANTHROPIC_API_KEY;
    if (mode === 'apikey') {
        if (!key.trim()) throw new Error('Claude is set to the API key, but none is stored (settings of this machine)');
        env.ANTHROPIC_API_KEY = key.trim();
        // The key helper runs with process.execPath, which in the desktop app is Electron: only as Node with this
        if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    }
    return env;
}

/**
 * Settings for the CLI. With a subscription login the CLI ignores ANTHROPIC_API_KEY; an apiKeyHelper
 * takes precedence though. The helper reads the key from the environment so it does not appear on the
 * CLI's command line.
 */
export function cliSettings(mode: AuthMode, node = process.execPath): { apiKeyHelper: string } | undefined {
    if (mode === 'subscription') return undefined;
    const quote = (p: string) => `"${p.replace(/\\/g, '/')}"`;
    return { apiKeyHelper: `${quote(node)} ${quote(helper)}` };
}

/** Checks the sign-in the CLI reports at start; returns the error message for a wrong method. */
export function checkSignIn(mode: AuthMode, apiKeySource: string): string | null {
    if (mode === 'subscription' && apiKeySource !== 'none') {
        return `Aborted: the session would run through "${apiKeySource}" instead of the Claude subscription.`;
    }
    if (mode === 'apikey' && apiKeySource !== 'apiKeyHelper') {
        return `Aborted: the session would run through "${apiKeySource === 'none' ? 'the Claude subscription' : apiKeySource}" instead of the API key.`;
    }
    return null;
}

/**
 * If the API rejects the key, the CLI retries the request for minutes. In API key mode this returns the
 * message with which the session aborts right away.
 */
export function keyRejected(mode: AuthMode, status: number | null, error: string | undefined): string | null {
    if (mode !== 'apikey' || (status !== 401 && error !== 'authentication_failed')) return null;
    return 'Aborted: Anthropic rejects the API key (401). Check the key in the settings of this machine.';
}
