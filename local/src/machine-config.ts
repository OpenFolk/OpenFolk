// How this machine shuts down and signs in automatically. Two sources: the .env says what the machine can do (scripts
// and commands, which a paired device must not be able to change), the machine settings (machine-settings.ts, set
// in the app) say whether and when the app uses it.
//
// Shutting down, from the .env:
//   script   a companion script (SHUTDOWN_SCRIPT, PHP via PHP_BIN) with its own interface (see shutdown.ts)
//   command  own commands: SHUTDOWN_COMMAND with {seconds} and {minutes}, SHUTDOWN_CANCEL_COMMAND, and for restarting
//            SHUTDOWN_RESTART_COMMAND with the same placeholders (without it the app offers no restart)
//   builtin  otherwise the operating system's shutdown command (Windows: shutdown /s, macOS and Linux: shutdown -h;
//            there it needs the right to shut down, e.g. root or a sudoers rule); not in a container
// The setting "shutdown" off turns it into none: the app cannot shut this machine down.
//
// Automatic sign-in (AUTOLOGON_METHOD): script (AUTOLOGON_SCRIPT, PowerShell, Windows only) or none. Without a value:
// script if AUTOLOGON_SCRIPT is set on Windows, otherwise none. Companion scripts are never searched for: a path
// next to the checkout means something different on every machine and after every move of the folder.

import path from 'node:path';
import { MACHINE_SETTINGS_DEFAULT, type AfterWake, type MachineSettings } from '../../shared/protocol.ts';

export type { AfterWake } from '../../shared/protocol.ts';
export type ShutdownMethod = 'builtin' | 'script' | 'command' | 'none';
export type AutologonMethod = 'script' | 'none';

export interface MachineConfig {
    shutdown: {
        /** What the app uses: `available`, or none when the setting turned it off. */
        method: ShutdownMethod;
        /** What the .env makes possible. */
        available: ShutdownMethod;
        script: string;
        php: string;
        command: string;
        cancelCommand: string;
        restartCommand: string;
        /** Delay of a shutdown from the app (seconds). */
        delaySeconds: number;
        /** Command that answers "nobody uses this machine" with exit code 0; overrides the built-in check. */
        idleCommand: string;
        /** Built-in check: a signed-in session counts as free after this many minutes without input. */
        idleMinutes: number;
    };
    afterWake: {
        mode: AfterWake;
        /** Delay of the shutdown after the routines (seconds, cancellable in the app). */
        delaySeconds: number;
        /** Wait at most this long for "nobody watching, no bot working" before giving up (minutes). */
        waitMinutes: number;
    };
    autologon: {
        method: AutologonMethod;
        script: string;
    };
    /** Wrong values, for the start log. */
    problems: string[];
}

function choice<T extends string>(env: NodeJS.ProcessEnv, name: string, allowed: readonly T[], problems: string[]): T | undefined {
    const raw = (env[name] ?? '').trim();
    if (!raw) return undefined;
    const found = allowed.find((a) => a.toLowerCase() === raw.toLowerCase());
    if (!found) problems.push(`${name}: unknown value "${raw}" (${allowed.join(', ')})`);
    return found;
}

export function parseMachineConfig(
    env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, settings: MachineSettings = MACHINE_SETTINGS_DEFAULT,
): MachineConfig {
    const problems: string[] = [];
    const shutdownScript = (env.SHUTDOWN_SCRIPT ?? '').trim() ? path.resolve((env.SHUTDOWN_SCRIPT ?? '').trim()) : '';
    const autologonScript = (env.AUTOLOGON_SCRIPT ?? '').trim() ? path.resolve((env.AUTOLOGON_SCRIPT ?? '').trim()) : '';
    const command = (env.SHUTDOWN_COMMAND ?? '').trim();
    const available: ShutdownMethod = shutdownScript ? 'script' : command ? 'command' : env.OPENFOLK_CONTAINER === '1' ? 'none' : 'builtin';

    let autologonMethod = choice(env, 'AUTOLOGON_METHOD', ['script', 'none'] as const, problems);
    autologonMethod ??= autologonScript && platform === 'win32' ? 'script' : 'none';
    if (autologonMethod === 'script' && !autologonScript) {
        problems.push('AUTOLOGON_METHOD=script needs AUTOLOGON_SCRIPT');
        autologonMethod = 'none';
    }

    return {
        shutdown: {
            method: settings.shutdown ? available : 'none',
            available,
            script: shutdownScript,
            php: (env.PHP_BIN ?? '').trim() || 'php',
            command,
            cancelCommand: (env.SHUTDOWN_CANCEL_COMMAND ?? '').trim(),
            restartCommand: (env.SHUTDOWN_RESTART_COMMAND ?? '').trim(),
            delaySeconds: settings.shutdownDelaySeconds,
            idleCommand: (env.MACHINE_IDLE_COMMAND ?? '').trim(),
            idleMinutes: settings.idleMinutes,
        },
        afterWake: { mode: settings.afterWake, delaySeconds: settings.afterWakeSeconds, waitMinutes: settings.afterWakeWaitMinutes },
        autologon: { method: autologonMethod, script: autologonScript },
        problems,
    };
}

/** One line for the start log. */
export function machineSummary(c: MachineConfig): string {
    const after = c.shutdown.method === 'none' || c.afterWake.mode === 'never' ? 'stays on after wake routines' : `after wake routines ${c.afterWake.mode === 'ifIdle' ? 'off if idle' : 'off'}`;
    const how = c.shutdown.method === 'none' && c.shutdown.available !== 'none' ? `none (${c.shutdown.available} switched off)` : c.shutdown.method;
    return `shutdown via ${how}, ${after}, autologon via ${c.autologon.method}`
        + (c.problems.length ? ` (${c.problems.join('; ')})` : '');
}
