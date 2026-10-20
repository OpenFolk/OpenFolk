// Hands a chat's session over to its machine: an IDE window or a terminal opens it there, and the next message in the
// chat continues the same session with everything that was added at the machine. What runs is a command line from a
// template (HANDOVER_IDE, HANDOVER_TERMINAL) with the folder and the session id filled in. Whether a target is offered
// is a machine setting; the command itself stays in the .env, so a paired device cannot change what runs.
//
// A backend that runs without a desktop (a Windows task or service in session 0, a Linux service) cannot open a
// window: whatever it starts stays invisible. It leaves the command as a job in ~/.openfolk/handover instead, and the
// desktop app in the user's session runs it (desktop/handover.js) and answers <id>.done or <id>.failed. The folder is
// fixed because the desktop app cannot know the backend's settings; only the user's own processes can write to it.

import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from './i18n.ts';
import { machineSettings } from './machine-settings.ts';
import type { HandoverTarget } from '../../shared/protocol.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_TIMEOUT_MS = 45_000;
/** A command still running after this long has opened its window and keeps running on its own. */
const SETTLE_MS = 10_000;

const VSCODE_URI = 'vscode://anthropic.claude-code/open?session={session}';

/**
 * Defaults per system. `code <folder>` first: it opens the folder's window or brings it to the front, and the URI of
 * Claude Code for VS Code then reaches that window (VS Code routes it to the last active one).
 */
const DEFAULTS: Record<HandoverTarget, Partial<Record<NodeJS.Platform, string>>> = {
    ide: {
        win32: `code "{folder}" && start "" "${VSCODE_URI}"`,
        darwin: `code "{folder}" && open "${VSCODE_URI}"`,
        linux: `code "{folder}" && xdg-open "${VSCODE_URI}"`,
    },
    terminal: {
        win32: 'start "Claude Code" /D "{folder}" "{claude}" --resume {session}',
        darwin: `osascript -e 'tell application "Terminal" to do script "cd \\"{folder}\\" && \\"{claude}\\" --resume {session}"' -e 'tell application "Terminal" to activate'`,
        linux: 'x-terminal-emulator -e "{claude}" --resume {session}',
    },
};

const ENV: Record<HandoverTarget, string> = { ide: 'HANDOVER_IDE', terminal: 'HANDOVER_TERMINAL' };

/**
 * A terminal with Claude Code and nothing to resume, for the sign-in of the first steps. Its own defaults: an own
 * HANDOVER_TERMINAL carries a session id, and the desktop apps bring Claude Code without putting `claude` on the PATH.
 */
const SIGN_IN: Partial<Record<NodeJS.Platform, string>> = {
    win32: 'start "Claude Code" /D "{folder}" "{claude}"',
    darwin: `osascript -e 'tell application "Terminal" to do script "cd \\"{folder}\\" && \\"{claude}\\""' -e 'tell application "Terminal" to activate'`,
    linux: 'x-terminal-emulator -e "{claude}"',
};

/** The command template for a target, whatever the settings say; null when this setup has no desktop at all. */
export function availableTemplate(target: HandoverTarget): string | null {
    if (process.env.OPENFOLK_CONTAINER === '1') return null;
    // "off" was the old way to turn a target off; now a setting, and never a command to run
    const own = process.env[ENV[target]]?.trim();
    return (own && own.toLowerCase() !== 'off' ? own : '') || DEFAULTS[target][process.platform] || null;
}

/** The command template for a target; null when the machine settings turned it off or there is none. */
export function handoverTemplate(target: HandoverTarget): string | null {
    const s = machineSettings();
    return (target === 'ide' ? s.handoverIde : s.handoverTerminal) ? availableTemplate(target) : null;
}

export function handoverTargets(): HandoverTarget[] {
    return (['ide', 'terminal'] as const).filter((x) => handoverTemplate(x) !== null);
}

/** Claude Code as the backend runs it (the SDK's own binary), so it works without `claude` installed; else from PATH. */
function claudeBinary(): string {
    try {
        const dir = path.dirname(createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`));
        const bin = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
        if (fs.existsSync(bin)) return bin;
    } catch {
        // no binary package for this system
    }
    return 'claude';
}

export function handoverCommand(target: HandoverTarget, folder: string, sessionId: string): string {
    if (!UUID.test(sessionId)) throw new Error(t('vscode.invalidSessionId'));
    const template = handoverTemplate(target);
    if (!template) throw new Error(t('handover.unavailable'));
    const values: Record<string, string> = { folder: path.resolve(folder), session: sessionId, claude: claudeBinary() };
    return template.replace(/\{(folder|session|claude)\}/g, (_, k: string) => values[k]);
}

/** The command that opens the sign-in terminal in the home folder; null in a container or on a system without one. */
export function signInCommand(): string | null {
    const template = process.env.OPENFOLK_CONTAINER === '1' ? undefined : SIGN_IN[process.platform];
    if (!template) return null;
    const values: Record<string, string> = { folder: os.homedir(), claude: claudeBinary() };
    return template.replace(/\{(folder|claude)\}/g, (_, k: string) => values[k]);
}

let desktop: Promise<boolean> | null = null;

/** Whether a window this process opens appears on a desktop someone sees. */
export function hasDesktop(): Promise<boolean> {
    desktop ??= new Promise((resolve) => {
        if (process.platform === 'darwin') return resolve(true);
        if (process.platform !== 'win32') return resolve(Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));
        // Session 0 has no desktop; tasklist names the session of a process ("Image","PID","Session","Session#",…)
        execFile('tasklist.exe', ['/FI', `PID eq ${process.pid}`, '/FO', 'CSV', '/NH'], { timeout: 10_000, windowsHide: true }, (_e, stdout) => {
            const session = /^"[^"]*","\d+","[^"]*","(\d+)"/m.exec(String(stdout ?? ''))?.[1];
            resolve(session !== undefined && session !== '0');
        });
    });
    return desktop;
}

/**
 * Runs a handover command in `cwd` and resolves once it has done its part: ended without error, or still running
 * after SETTLE_MS (a terminal that stays open). Rejects with its last line of output when it fails.
 */
export function runHandover(command: string, cwd: string, settle = SETTLE_MS): Promise<void> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        // Inherited from the desktop app's backend; with it set, VS Code and other Electron apps start as plain Node
        delete env.ELECTRON_RUN_AS_NODE;
        // Detached keeps a terminal alive through a restart of the backend; on Windows `start` and `code` detach their
        // windows themselves, and a detached child there writes to a console of its own instead of the pipes
        const child = spawn(command, { cwd, env, shell: true, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const collect = (d: Buffer) => { output = (output + d.toString()).slice(-4000); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timer = setTimeout(() => {
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            resolve();
        }, settle);
        child.once('error', (e) => { clearTimeout(timer); reject(e); });
        // 'close', not 'exit': only then has all of its output arrived
        child.once('close', (code) => {
            clearTimeout(timer);
            if (code === 0) return resolve();
            const last = output.split(/\r?\n/).map((l) => l.trim()).findLast(Boolean);
            reject(new Error(last || t('handover.exitCode', { code: String(code) })));
        });
    });
}

export function handoverJobs(): string {
    return path.join(os.homedir(), '.openfolk', 'handover');
}

/** Leaves the command for the desktop app and waits for its answer. */
export async function handOverByJob(command: string, cwd: string, timeout = JOB_TIMEOUT_MS): Promise<void> {
    const dir = handoverJobs();
    fs.mkdirSync(dir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = (ext: string) => path.join(dir, `${id}.${ext}`);
    // write completely first, then rename: the desktop app never sees half a file
    fs.writeFileSync(file('tmp'), JSON.stringify({ command, cwd, time: new Date().toISOString() }));
    fs.renameSync(file('tmp'), file('json'));
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 500));
        for (const [ext, ok] of [['done', true], ['failed', false]] as const) {
            if (!fs.existsSync(file(ext))) continue;
            let answer: { message?: string; code?: number } = {};
            try { answer = JSON.parse(fs.readFileSync(file(ext), 'utf8')) as typeof answer; } catch { /* empty */ }
            fs.rmSync(file(ext), { force: true });
            if (!ok) throw new Error(answer.message || (answer.code !== undefined ? t('handover.exitCode', { code: String(answer.code) }) : t('handover.failed')));
            return;
        }
    }
    fs.rmSync(file('json'), { force: true });
    throw new Error(t('handover.noDesktopApp'));
}

/** Opens the session at the machine; resolves with the message for the chat. */
export async function handOver(target: HandoverTarget, folder: string, sessionId: string): Promise<string> {
    const command = handoverCommand(target, folder, sessionId);
    const cwd = path.resolve(folder);
    if (await hasDesktop()) await runHandover(command, cwd);
    else await handOverByJob(command, cwd);
    return t(target === 'ide' ? 'handover.openedIde' : 'handover.openedTerminal');
}

/** Opens a terminal with Claude Code on this machine, where the user signs in; the backend notices the sign-in itself. */
export async function openSignInTerminal(): Promise<void> {
    const command = signInCommand();
    if (!command) throw new Error(t('handover.unavailable'));
    if (await hasDesktop()) await runHandover(command, os.homedir());
    else await handOverByJob(command, os.homedir());
}
