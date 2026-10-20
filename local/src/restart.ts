// Restarting the backend without admin rights: `npm run restart -w local` (or the app) leaves a request; the
// backend exits by itself as soon as no bot is working, and the loop of the Windows task (install-task.ps1 -Run)
// starts it again after a short pause with the new code. Stopping it from outside would need an administrator,
// because the backend runs in session 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './store.ts';

const REQUEST = () => dataPath('restart.request');
/** For the loop in install-task.ps1: after this exit wait only briefly instead of 30 s. */
const FAST = () => dataPath('restart.fast');
const CHECK_MS = 2000;
/** Everything must be quiet this long so a job that follows right away is not cut off. */
const QUIET_MS = 5000;
/** At the latest then it restarts anyway (running jobs are aborted). */
const MAX_WAIT_MS = 60 * 60_000;

export function requestRestart(reason: string): void {
    fs.writeFileSync(REQUEST(), JSON.stringify({ reason, since: new Date().toISOString() }));
}

/** Root of the repo (local/src is two levels below). */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Files of the backend code (local/src and shared without tests, the package.json files) changed after `since`,
 * relative to the repo. Not empty means: the running backend does not know this state yet and needs a restart.
 */
export function changedSince(since: number, root = REPO): string[] {
    const r: string[] = [];
    const check = (rel: string) => {
        try {
            if (fs.statSync(path.join(root, rel)).mtimeMs > since) r.push(rel);
        } catch {
            // deleted or not readable
        }
    };
    for (const folder of ['local/src', 'shared']) {
        let names: string[] = [];
        try {
            names = fs.readdirSync(path.join(root, folder));
        } catch {
            continue;
        }
        for (const n of names) if (n.endsWith('.ts') && !n.endsWith('.test.ts')) check(`${folder}/${n}`);
    }
    check('package.json');
    check('local/package.json');
    return r.sort();
}

export function requested(): { reason: string; since: string } | null {
    try {
        return JSON.parse(fs.readFileSync(REQUEST(), 'utf8')) as { reason: string; since: string };
    } catch {
        return null;
    }
}

/**
 * Checks regularly for a request and calls `exit` as soon as `busy` has been false long enough
 * (or the maximum wait is over).
 */
export function watchRestart(busy: () => boolean, exit: (reason: string) => void): NodeJS.Timeout {
    let quietSince = 0;
    let reported = false;
    return setInterval(() => {
        const w = requested();
        if (!w) {
            quietSince = 0;
            reported = false;
            return;
        }
        const tooLong = Date.now() - Date.parse(w.since) > MAX_WAIT_MS;
        if (busy() && !tooLong) {
            quietSince = 0;
            if (!reported) console.log(`restart: requested (${w.reason}), waiting until no bot is working`);
            reported = true;
            return;
        }
        if (!quietSince) quietSince = Date.now();
        if (Date.now() - quietSince < QUIET_MS && !tooLong) return;
        fs.rmSync(REQUEST(), { force: true });
        fs.writeFileSync(FAST(), '');
        exit(tooLong ? `${w.reason}, forced after waiting ${MAX_WAIT_MS / 60_000} min` : w.reason);
    }, CHECK_MS);
}
