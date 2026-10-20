// Requests a restart of the running backend, without admin rights:  npm run restart -w local [-- [--wait] reason]
// The backend restarts as soon as no bot is working (see restart.ts); proof in the log local/data/local.log.
// --wait returns only once the Windows task logged "Start backend" (for callers like an editor button), exit code 1
// if that does not happen in time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestRestart } from './restart.ts';

/** Written by local/tools/install-task.ps1, independent of DATA_DIR. */
const LOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'local.log');
const POLL_MS = 2000;
/** The backend forces the restart after 60 minutes at the latest. */
const WAIT_MS = 65 * 60_000;

const args = process.argv.slice(2);
const wait = args.includes('--wait');
const reason = args.filter((a) => a !== '--wait').join(' ').trim() || 'Deploy';

const size = () => {
    try {
        return fs.statSync(LOG).size;
    } catch {
        return 0;
    }
};

/** Lines appended to the log after `offset` (all of it if the log was rotated meanwhile). */
function linesSince(offset: number): string[] {
    const end = size();
    const start = end < offset ? 0 : offset;
    if (end <= start) return [];
    const fd = fs.openSync(LOG, 'r');
    try {
        const buf = Buffer.alloc(end - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        return buf.toString('utf8').split(/\r?\n/);
    } finally {
        fs.closeSync(fd);
    }
}

const offset = size();
requestRestart(reason);
if (!wait) {
    console.log(`Restart requested (${reason}). It happens as soon as no bot is working; proof: "Start backend" in local/data/local.log.`);
} else {
    console.log(`Restart requested (${reason}), waiting until no bot is working and the backend is back ...`);
    const until = Date.now() + WAIT_MS;
    let started: string | undefined;
    while (!started && Date.now() < until) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        started = linesSince(offset).find((l) => l.includes('Start backend'));
    }
    if (started) {
        console.log(`Backend is running again: ${started.trim()}`);
    } else {
        console.error(`No "Start backend" in ${LOG} after ${WAIT_MS / 60_000} min. Is the task "openfolk local" running?`);
        process.exitCode = 1;
    }
}
