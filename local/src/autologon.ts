// Query and toggle the automatic Windows sign-in of this machine through an optional companion script (PowerShell,
// AUTOLOGON_METHOD=script, path in AUTOLOGON_SCRIPT, default ../windows/scripts/autologon.ps1 next to this repo;
// see machine-config.ts). With autologon a woken machine shows the desktop in a remote desktop session instead of
// the sign-in screen. The script needs admin rights, which the backend has.
//
// The script's parameters (-Json, -An, -Aus) and its JSON answer (ok, an, kennwort, error) are its own interface.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { config } from './config.ts';
import { t } from './i18n.ts';

/** Can the automatic sign-in of this machine be switched from the app? */
export function canAutologon(): boolean {
    return config.power.autologon.method === 'script' && process.platform === 'win32';
}

export interface AutologonState {
    on: boolean;
    /** Password stored as an LSA secret; without it "on" does not work (once: autologon.ps1 -Kennwort). */
    password: boolean;
}

/** `on` undefined: only query. */
export function autologon(on?: boolean): Promise<AutologonState> {
    const script = config.power.autologon.script;
    if (config.power.autologon.method === 'none') return Promise.reject(new Error(t('machine.autologonOff')));
    if (process.platform !== 'win32') return Promise.reject(new Error(t('machine.autologonWindowsOnly')));
    if (!fs.existsSync(script)) return Promise.reject(new Error(t('machine.scriptMissing', { script })));
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Json'];
    if (on !== undefined) args.push(on ? '-An' : '-Aus');
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', args, { timeout: 30_000, windowsHide: true }, (error, stdout) => {
            let answer: { ok?: boolean; an?: boolean; kennwort?: boolean; error?: string } = {};
            try { answer = JSON.parse(String(stdout).trim() || '{}'); } catch { /* error below */ }
            if (answer.ok) resolve({ on: Boolean(answer.an), password: Boolean(answer.kennwort) });
            else reject(new Error(answer.error || (error ? error.message : 'unknown answer from autologon.ps1')));
        });
    });
}
