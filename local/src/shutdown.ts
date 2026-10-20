// Shut down or restart this machine (or cancel the planned shutdown or restart) the way the .env and the machine
// settings say (machine-config.ts). The frame machine_shutdown arrives via the relay at the backend of exactly the machine that
// should go off.
//
// The companion script (method script) keeps its own command line (--abbrechen, --in=, --neustart, --wenn-frei, --json)
// and JSON answer (ok, um, error).

import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import { config } from './config.ts';
import { t } from './i18n.ts';
import type { MachineConfig } from './machine-config.ts';

const MAX_SECONDS = 3600;

export interface ShutdownResult {
    /** Planned time (ISO) when the machine shuts down. */
    at?: string;
}

type Run = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const run: Run = (file, args) => new Promise((resolve) => {
    execFile(file, args, { timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (error && typeof error.code !== 'number' ? error.message : '') });
    });
});

const runShell = (command: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
    exec(command, { timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) || (error?.message ?? '') });
    });
});

/** Idle column of quser: "none"/"Kein"/"." = 0, otherwise minutes, "h:mm" or "d+hh:mm". */
export function idleMinutes(value: string): number {
    const m = /^(?:(\d+)\+)?(?:(\d+):)?(\d+)$/.exec(value);
    return m ? Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3]) : 0;
}

/**
 * Users of active sessions in the output of quser (state column in the system language; also locked ones) that had
 * input within the last `freeAfter` minutes. The first line is the header.
 */
export function activeUsers(quserOutput: string, freeAfter: number): string[] {
    const users: string[] = [];
    for (const line of quserOutput.trim().split(/\r?\n/).slice(1)) {
        const m = /^\s*>?(\S+).*\s(Active|Aktiv|Actif|Activo|Attivo|Actief|Ativo)\s+(\S+)/i.exec(line);
        if (m && idleMinutes(m[3]) < freeAfter) users.push(m[1]);
    }
    return users;
}

/** Who uses this machine right now; empty = free. Without a way to check it counts as free. */
async function usedBy(c: MachineConfig['shutdown'], exec_: Run): Promise<string[]> {
    if (c.idleCommand) return (await runShell(c.idleCommand)).code === 0 ? [] : ['?'];
    if (process.platform === 'win32') {
        // quser ends with code 1 if nobody is signed in
        const { stdout } = await exec_(`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\quser.exe`, []);
        return activeUsers(stdout, c.idleMinutes);
    }
    const { code, stdout } = await exec_('who', []);
    return code === 0 ? [...new Set(stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[0]))] : [];
}

/** The operating system's shutdown command; on macOS and Linux in whole minutes. */
export function builtinCommand(platform: NodeJS.Platform, cancel: boolean, seconds: number, now = Date.now(), restart = false): { file: string; args: string[]; at?: string } {
    if (platform === 'win32') {
        const file = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\shutdown.exe`;
        if (cancel) return { file, args: ['/a'] };
        const at = new Date(now + seconds * 1000);
        const what = restart ? 'restarting' : 'shutting down';
        return { file, args: [restart ? '/r' : '/s', '/t', String(seconds), '/d', 'p:0:0', '/c', `OpenFolk: ${what} at ${at.toLocaleTimeString()}. Cancel: shutdown /a`], at: at.toISOString() };
    }
    if (cancel) return platform === 'darwin' ? { file: 'killall', args: ['shutdown'] } : { file: 'shutdown', args: ['-c'] };
    const minutes = Math.ceil(seconds / 60);
    return { file: 'shutdown', args: [restart ? '-r' : '-h', minutes === 0 ? 'now' : `+${minutes}`], at: new Date(now + minutes * 60_000).toISOString() };
}

/** Command with {seconds} and {minutes} filled in. */
export function fillCommand(template: string, seconds: number): string {
    return template.replace(/\{seconds\}/g, String(seconds)).replace(/\{minutes\}/g, String(Math.ceil(seconds / 60)));
}

/** Can this machine be shut down from the app? */
export function canShutdown(c: MachineConfig['shutdown'] = config.power.shutdown): boolean {
    return c.method !== 'none';
}

/** Can this machine be restarted from the app? With method command only if SHUTDOWN_RESTART_COMMAND is set. */
export function canRestart(c: MachineConfig['shutdown'] = config.power.shutdown): boolean {
    return c.method === 'command' ? Boolean(c.restartCommand) : canShutdown(c);
}

/** `ifIdle`: only if nobody uses the machine (for the shutdown after a wake routine). `restart`: restart instead. */
export async function shutdown(cancel: boolean, inSeconds?: number, ifIdle = false, c: MachineConfig['shutdown'] = config.power.shutdown, restart = false): Promise<ShutdownResult> {
    restart &&= !cancel;
    const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.round(inSeconds ?? c.delaySeconds)));
    switch (c.method) {
        case 'none':
            throw new Error(t('machine.shutdownOff'));
        case 'script': {
            if (!fs.existsSync(c.script)) throw new Error(t('machine.scriptMissing', { script: c.script }));
            const args = [c.script, cancel ? '--abbrechen' : `--in=${seconds}`, '--json'];
            if (restart) args.push('--neustart');
            if (ifIdle && !cancel) args.push('--wenn-frei');
            const { stdout, stderr } = await run(c.php, args);
            let answer: { ok?: boolean; um?: string; error?: string } = {};
            try { answer = JSON.parse(stdout.trim() || '{}'); } catch { /* error below */ }
            if (!answer.ok) throw new Error(answer.error || stderr.trim() || 'unknown answer from the shutdown script');
            return { at: answer.um };
        }
        default: {
            if (ifIdle && !cancel) {
                const users = await usedBy(c, run);
                if (users.length) throw new Error(t('machine.inUse', { users: users.join(', ') }));
            }
            if (c.method === 'command') {
                if (cancel && !c.cancelCommand) throw new Error(t('machine.cancelOff'));
                if (restart && !c.restartCommand) throw new Error(t('machine.restartOff'));
                const { code, stderr } = await runShell(cancel ? c.cancelCommand : fillCommand(restart ? c.restartCommand : c.command, seconds));
                if (code !== 0) throw new Error(stderr.trim() || `exit code ${code}`);
                return cancel ? {} : { at: new Date(Date.now() + seconds * 1000).toISOString() };
            }
            const cmd = builtinCommand(process.platform, cancel, seconds, Date.now(), restart);
            const { code, stderr } = await run(cmd.file, cmd.args);
            if (code !== 0) throw new Error(stderr.trim() || `${cmd.file} ended with exit code ${code}`);
            return { at: cmd.at };
        }
    }
}
