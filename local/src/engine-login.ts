// Signs this machine in to an engine from the web app, without a terminal on this machine. Codex and Copilot know a
// device-code flow (a link and a code to enter there, on any device); that is what makes the sign-in possible for a
// backend in a container or on a computer out of reach.
//
// Claude Code has no device code. `claude auth login` opens the browser on this machine and waits on localhost for
// Anthropic's redirect, so the sign-in completes in Anthropic's own flow and nothing here sees a code or a token.
// That is on purpose: Anthropic does not allow third-party apps to offer the claude.ai login or to collect, store or
// pass on its codes and tokens (code.claude.com/docs/en/legal-and-compliance). Never show the CLI's fallback link
// with its pasted code, never write to its stdin, never run `claude setup-token` for the user.

import { spawn, type ChildProcess } from 'node:child_process';
import { copilotBinary } from './acp.ts';
import { codexBinary } from './codex.ts';
import { claudeEnv, engineEnv } from './engine-home.ts';
import { claudeBinary } from './handover.ts';
import { t } from './i18n.ts';
import { currentAccount } from './store.ts';
import type { DeviceLoginEngine } from '../../shared/protocol.ts';

type Outcome = { state: 'done' } | { state: 'failed'; message: string };
/** A device code to enter, then the outcome. */
export type LoginReport = { state: 'code'; url: string; code: string } | Outcome;
/** Claude's browser is open, then the outcome. */
export type ClaudeLoginReport = { state: 'browser' } | Outcome;

/** A device code is valid for 15 minutes at both providers; the CLI gives up then too, this is the backstop. */
const LOGIN_TIMEOUT_MS = 16 * 60_000;

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** The link and the code in the CLI's output (colors removed); null until both are there. */
export function parseDeviceCode(text: string): { url: string; code: string } | null {
    const url = /https:\/\/[^\s'"<>]+/.exec(plain(text))?.[0];
    const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/.exec(plain(text))?.[0];
    return url && code ? { url, code } : null;
}

type Command = [string, string[]];

function command(engine: DeviceLoginEngine): Command {
    return engine === 'codex' ? [codexBinary(), ['login', '--device-auth']] : [copilotBinary(), ['login', '--device-code']];
}

/** By account and engine: two accounts sign in to Codex at the same time, each into its own folder. */
const running = new Map<string, { process: ChildProcess; prompt: LoginReport | ClaudeLoginReport | null }>();

/**
 * Runs a sign-in CLI under `key`. `prompt` turns its output so far into what the user has to do (once); the outcome
 * follows. A process replaced under the same key ends silently.
 */
function run<P extends LoginReport | ClaudeLoginReport>(key: string, [file, args]: Command, env: NodeJS.ProcessEnv,
    report: (r: P | Outcome) => void, prompt: (output: string) => P | null): ChildProcess {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
    const entry = { process: child, prompt: null as P | null };
    running.set(key, entry);
    let output = '';
    const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
        if (entry.prompt) return;
        entry.prompt = prompt(output);
        if (entry.prompt) report(entry.prompt);
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, LOGIN_TIMEOUT_MS);
    timer.unref();
    let ended = false;
    const end = (r: Outcome) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        if (running.get(key) !== entry) return;
        running.delete(key);
        report(r);
    };
    child.on('error', (e) => end({ state: 'failed', message: e.message }));
    child.on('close', (code) => {
        // The last line that says something; Claude's "Paste code here if prompted >" says nothing to the user
        const last = plain(output).split(/\r?\n/).map((l) => l.trim()).findLast((l) => l && !l.endsWith('>')) ?? '';
        end(code === 0 ? { state: 'done' } : { state: 'failed', message: timedOut ? t('engine.loginTimeout') : last || `exit code ${code}` });
    });
    return child;
}

/**
 * Starts the sign-in, or reports the code of the one already running (a second click, a second device). `report`
 * gets the code once it is printed, then the outcome.
 */
export function startDeviceLogin(engine: DeviceLoginEngine, report: (r: LoginReport) => void, cmd = command): void {
    const key = `${currentAccount()}:${engine}`;
    const current = running.get(key);
    if (current) {
        if (current.prompt) report(current.prompt as LoginReport);
        return;
    }
    let line: Command;
    try {
        line = cmd(engine);
    } catch (e) {
        report({ state: 'failed', message: (e as Error).message });
        return;
    }
    run<LoginReport>(key, line, engineEnv({ ...process.env }), report, (output) => {
        const found = parseDeviceCode(output);
        return found && { state: 'code', ...found };
    });
}

/**
 * Signs the machine's owner in to Claude Code with the subscription: `browser` once the CLI runs (it has opened the
 * browser here), then the outcome. A second click starts over, for a browser tab closed too early.
 */
export function startClaudeLogin(report: (r: ClaudeLoginReport) => void, cmd = (): Command => [claudeBinary(), ['auth', 'login', '--claudeai']]): void {
    const key = `${currentAccount()}:claude`;
    const current = running.get(key);
    if (current) {
        running.delete(key);
        current.process.kill();
    }
    const child = run<ClaudeLoginReport>(key, cmd(), claudeEnv('subscription'), report, () => null);
    child.once('spawn', () => {
        if (running.get(key)?.process !== child) return;
        running.get(key)!.prompt = { state: 'browser' };
        report({ state: 'browser' });
    });
}

/** Ends running sign-ins (backend stops). */
export function stopDeviceLogins(): void {
    for (const { process } of running.values()) process.kill();
}
