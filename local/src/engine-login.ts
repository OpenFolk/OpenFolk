// Signs this machine in to Codex or Copilot from the web app: both CLIs know a device-code flow (a link and a code
// to enter there, on any device), which needs no terminal on this machine. That is what makes the sign-in possible
// for a backend in a container or on a computer out of reach. Claude Code has no such flow; the setup checklist
// shows its command instead.

import { spawn, type ChildProcess } from 'node:child_process';
import { copilotBinary } from './acp.ts';
import { codexBinary } from './codex.ts';
import { engineEnv } from './engine-home.ts';
import { currentAccount } from './store.ts';
import type { DeviceLoginEngine } from '../../shared/protocol.ts';

export type LoginReport = { state: 'code'; url: string; code: string } | { state: 'done' } | { state: 'failed'; message: string };

/** A device code is valid for 15 minutes at both providers; the CLI gives up then too, this is the backstop. */
const LOGIN_TIMEOUT_MS = 16 * 60_000;

/** The link and the code in the CLI's output (colors removed); null until both are there. */
export function parseDeviceCode(text: string): { url: string; code: string } | null {
    // eslint-disable-next-line no-control-regex
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    const url = /https:\/\/[^\s'"<>]+/.exec(plain)?.[0];
    const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/.exec(plain)?.[0];
    return url && code ? { url, code } : null;
}

function command(engine: DeviceLoginEngine): [string, string[]] {
    return engine === 'codex' ? [codexBinary(), ['login', '--device-auth']] : [copilotBinary(), ['login', '--device-code']];
}

/** By account and engine: two accounts sign in to Codex at the same time, each into its own folder. */
const running = new Map<string, { process: ChildProcess; prompt: { url: string; code: string } | null }>();

/**
 * Starts the sign-in, or reports the code of the one already running (a second click, a second device). `report`
 * gets the code once it is printed, then the outcome.
 */
export function startDeviceLogin(engine: DeviceLoginEngine, report: (r: LoginReport) => void, cmd = command): void {
    const key = `${currentAccount()}:${engine}`;
    const current = running.get(key);
    if (current) {
        if (current.prompt) report({ state: 'code', ...current.prompt });
        return;
    }
    let file: string;
    let args: string[];
    try {
        [file, args] = cmd(engine);
    } catch (e) {
        report({ state: 'failed', message: (e as Error).message });
        return;
    }
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: engineEnv({ ...process.env }) });
    const entry = { process: child, prompt: null as { url: string; code: string } | null };
    running.set(key, entry);
    let output = '';
    const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
        if (entry.prompt) return;
        entry.prompt = parseDeviceCode(output);
        if (entry.prompt) report({ state: 'code', ...entry.prompt });
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    const timer = setTimeout(() => child.kill(), LOGIN_TIMEOUT_MS);
    timer.unref();
    let ended = false;
    const end = (r: LoginReport) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        running.delete(key);
        report(r);
    };
    child.on('error', (e) => end({ state: 'failed', message: e.message }));
    child.on('close', (code) => {
        // eslint-disable-next-line no-control-regex
        const last = output.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').findLast((l) => l.trim()) ?? '';
        end(code === 0 ? { state: 'done' } : { state: 'failed', message: last || `exit code ${code}` });
    });
}

/** Ends running sign-ins (backend stops). */
export function stopDeviceLogins(): void {
    for (const { process } of running.values()) process.kill();
}
