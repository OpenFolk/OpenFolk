// Runs the handovers of a backend without a desktop (local/src/handover.ts): such a backend (a Windows task in
// session 0, a Linux service) cannot open a window and leaves the command line as a job in ~/.openfolk/handover. The
// app runs in the user's session, so the IDE or terminal it starts appears on their screen. The answer goes back as
// <id>.done or <id>.failed. Only the user's own processes can write to that folder.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JOBS = path.join(os.homedir(), '.openfolk', 'handover');
const POLL_MS = 1000;
/** The backend gives up after 45 seconds; an older job is left alone (its answer would reach nobody). */
const MAX_AGE_MS = 45_000;
/** A command still running after this long has opened its window and keeps running on its own. */
const SETTLE_MS = 10_000;

function answer(id, ext, data) {
    const file = path.join(JOBS, `${id}.${ext}`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
    fs.renameSync(`${file}.tmp`, file);
}

/** Resolves with null once the command has done its part, or with the error for the backend. */
function run(command, cwd) {
    return new Promise((resolve) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(command, { cwd, env, shell: true, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const collect = (d) => { output = (output + d.toString()).slice(-4000); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timer = setTimeout(() => {
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            resolve(null);
        }, SETTLE_MS);
        child.once('error', (e) => { clearTimeout(timer); resolve({ message: e.message }); });
        child.once('close', (code) => {
            clearTimeout(timer);
            if (code === 0) return resolve(null);
            const last = output.split(/\r?\n/).map((l) => l.trim()).findLast(Boolean);
            resolve(last ? { message: last } : { code });
        });
    });
}

let busy = false;

async function check() {
    if (busy || !fs.existsSync(JOBS)) return;
    busy = true;
    try {
        for (const name of fs.readdirSync(JOBS).filter((n) => n.endsWith('.json'))) {
            const file = path.join(JOBS, name);
            const id = name.slice(0, -5);
            // Renaming claims the job: a second instance of the app (another profile) does not run it again
            const mine = `${file}.${process.pid}`;
            try {
                if (Date.now() - fs.statSync(file).mtimeMs > MAX_AGE_MS) continue;
                fs.renameSync(file, mine);
            } catch {
                continue;
            }
            let job;
            try {
                job = JSON.parse(fs.readFileSync(mine, 'utf8'));
            } catch {
                job = null;
            }
            fs.rmSync(mine, { force: true });
            if (!job || typeof job.command !== 'string' || typeof job.cwd !== 'string') {
                answer(id, 'failed', { message: 'invalid job' });
                continue;
            }
            const error = await run(job.command, job.cwd);
            if (error) answer(id, 'failed', error);
            else answer(id, 'done', {});
        }
    } catch (e) {
        console.error('handover:', e);
    } finally {
        busy = false;
    }
}

/** Starts watching for jobs; returns the function that stops it. */
function watchHandovers() {
    const timer = setInterval(() => void check(), POLL_MS);
    void check();
    return () => clearInterval(timer);
}

module.exports = { watchHandovers };
