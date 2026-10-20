import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseMachineConfig, type MachineConfig } from './machine-config.ts';
import { machineSettings } from './machine-settings.ts';
import type { ClaudeAuth } from '../../shared/protocol.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..', '..');

// OPENFOLK_ENV_FILE: the desktop app keeps the settings of its backend in its profile, not in a checkout's .env
const envFile = process.env.OPENFOLK_ENV_FILE || path.join(projectRoot, '.env');
dotenv.config({ path: envFile, quiet: true });

/**
 * Writes KEY=value into the .env (replaces the line, otherwise appends), like local/tools/env.mjs. Lines only, never
 * comments: the .env holds KEY=value.
 */
export function setEnvValue(key: string, value: string, file = envFile): void {
    let content = '';
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const line = new RegExp(`^${key}=.*$`, 'm');
    content = line.test(content) ? content.replace(line, `${key}=${value}`) : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
    fs.writeFileSync(file, content);
}

/** Variables that became settings in the app; a value in the .env is ignored. */
const MOVED = [
    'CLAUDE_AUTH', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'AVATAR_IMAGE_MODEL', 'AVATAR_BILDMODELL', 'WHISPER_MODEL',
    'WHISPER_DEVICE', 'WHISPER_LANGUAGE', 'WHISPER_PRELOAD', 'GIT_AUTO_PULL', 'PUSH_NATIVE_PREVIEW', 'PUSH_SUBJECT', 'SHUTDOWN_METHOD',
    'SHUTDOWN_DELAY_SECONDS', 'SHUTDOWN_AFTER_WAKE', 'SHUTDOWN_AFTER_WAKE_SECONDS', 'SHUTDOWN_AFTER_WAKE_WAIT_MINUTES', 'SHUTDOWN_IDLE_MINUTES',
    'GIT_PUSH_USER', 'GIT_PUSH_TOKEN', 'GIT_PUSH_HOST',
];

/**
 * Lines of the .env that no longer count, for the start log. Only the file: the same names in the environment of
 * the user (an API key for other tools) are none of OpenFolk's business.
 */
export function movedToSettings(): string[] {
    let lines: Record<string, string> = {};
    try {
        lines = dotenv.parse(fs.readFileSync(envFile));
    } catch {
        return [];
    }
    const moved = MOVED.filter((k) => lines[k]?.trim());
    for (const k of ['HANDOVER_IDE', 'HANDOVER_TERMINAL']) if (lines[k]?.trim().toLowerCase() === 'off') moved.push(`${k}=off`);
    return moved;
}

/** Value of an environment variable; `legacy` is the old (German) name, still read as a fallback. */
export function envVar(name: string, legacy?: string): string | undefined {
    return process.env[name] || (legacy ? process.env[legacy] : undefined) || undefined;
}

/** The relay takes 1 to 32 characters of a-z, 0-9 and '-'; longer host names (macOS CI runners, some Macs) are cut. */
export function machineName(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32).replace(/-+$/, '') || 'home';
}

/** Port of the relay embedded in this backend (no RELAY_URL). */
const embeddedPort = Number(process.env.RELAY_PORT) || 8787;

export const config = {
    dataDir: process.env.DATA_DIR ?? path.join(projectRoot, 'local', 'data'),
    /** Name of this machine as the relay and the wake service know it (e.g. 'workstation'). */
    machine: machineName(envVar('MACHINE_NAME', 'RECHNER') || process.env.COMPUTERNAME || os.hostname()),
    /** Folders in which bots may be created; default is the user's home directory. */
    allowedRoots: (process.env.ALLOWED_ROOTS || os.homedir()).split(';').filter(Boolean).map((p) => path.resolve(p)),
    /** Sign-in of the sessions: the Claude Code login, or the API key stored on this machine (machine settings). */
    get auth(): ClaudeAuth { return machineSettings().claudeAuth; },
    /** Shutting down and automatic sign-in of this machine: the .env and the machine settings (machine-config.ts). */
    get power(): MachineConfig { return parseMachineConfig(process.env, process.platform, machineSettings()); },
    /**
     * The relay: with RELAY_URL the one there (a container, a server); without, one embedded in this process that
     * listens on 127.0.0.1 only (RELAY_LISTEN to open it, e.g. for a container).
     */
    relay: (process.env.RELAY_URL?.trim()
        ? { mode: 'remote', url: process.env.RELAY_URL.trim(), port: 0 }
        : { mode: 'embedded', url: `ws://127.0.0.1:${embeddedPort}/ws/agent`, port: embeddedPort }) as { mode: 'remote' | 'embedded'; url: string; port: number },
    get relayUrl(): string { return this.relay.url; },
};
