// The backend inside the desktop app ("on this computer"): the same local/ that `npm start` runs, started with
// Electron's own Node (ELECTRON_RUN_AS_NODE), with its data and its .env in the app's profile. Without RELAY_URL there
// the relay is embedded on 127.0.0.1; with it (joined by invitation, or a relay claimed from the app) the backend talks
// to that relay and the window loads the web app from there. The app restarts the backend when it ends (a restart
// request from a bot, a crash) and stops it gently on quit.
'use strict';

const { app } = require('electron');
const { runningBackend } = require('./task.js');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/** local/, relay/, shared/, webapp/ and their node_modules: bundled in the installed app, the repository in development. */
const root = () => (app.isPackaged ? path.join(process.resourcesPath, 'openfolk') : path.resolve(__dirname, '..'));
const dataDir = () => path.join(app.getPath('userData'), 'data');
const envFile = () => path.join(app.getPath('userData'), '.env');
const LOG_MAX = 10 * 1024 * 1024;

/** The profile's .env as KEY=value pairs; the backend reads the same file (OPENFOLK_ENV_FILE). */
function profileEnv() {
    const values = {};
    let text = '';
    try { text = fs.readFileSync(envFile(), 'utf8'); } catch { return values; }
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
}

/** The relay of RELAY_URL in the profile's .env as an http(s) address ending with "/"; '' for the embedded one. */
function remoteUrl() {
    const raw = (profileEnv().RELAY_URL || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw);
        u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
        return `${u.origin}/`;
    } catch { return ''; }
}

/**
 * Joins this computer to a relay with the invitation from "Add machine" (local/tools/join.mjs into the profile's .env
 * and data folder). Resolves with {ok, machine} or {ok: false, error, message}.
 */
function joinServer(link) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(root(), 'local', 'tools', 'join.mjs'), String(link || '')], {
            cwd: root(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENFOLK_ENV_FILE: envFile(), DATA_DIR: dataDir(), OPENFOLK_JSON: '1' },
        });
        let out = '';
        child.stdout.on('data', (c) => { out += c; });
        child.stderr.on('data', (c) => { out += c; });
        child.on('error', (e) => resolve({ ok: false, error: 'start', message: e.message }));
        child.on('close', () => {
            const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
            try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: 'start', message: out.trim().split(/\r?\n/).pop() || 'no answer' }); }
        });
    });
}

/** A free port on 127.0.0.1. Chosen once and kept: the web app's sign-in belongs to its origin. */
function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

class Backend {
    constructor(port) {
        this.port = port;
        this.child = null;
        this.stopping = false;
        this.starts = [];
        /** Why the backend does not run, for the setup page; '' while it runs. */
        this.failure = '';
        this.exited = null;
        /** The scheduled task runs the backend ("Run without signing in", task.js): never start one of our own. */
        this.useTask = false;
    }

    /** Where the web app comes from: the relay of RELAY_URL, or the embedded one. Read anew, a claim changes it. */
    get url() {
        return remoteUrl() || `http://127.0.0.1:${this.port}/`;
    }

    get log() {
        return path.join(dataDir(), 'local.log');
    }

    start() {
        if (this.useTask) return;
        const data = dataDir();
        fs.mkdirSync(data, { recursive: true });
        try {
            if (fs.statSync(this.log).size > LOG_MAX) fs.renameSync(this.log, `${this.log}.1`);
        } catch { /* no log yet */ }
        const log = fs.openSync(this.log, 'a');
        fs.writeSync(log, `\n${new Date().toISOString()} Start backend (desktop app ${app.getVersion()})\n`);
        // Settings in the profile's .env (OPENFOLK_ENV_FILE), never a checkout's: RELAY_URL there decides the relay, not
        // one from the user's environment
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENFOLK_ENV_FILE: envFile(), DATA_DIR: data, RELAY_PORT: String(this.port), RELAY_LISTEN: '', OPEN_BROWSER: '0' };
        delete env.RELAY_URL;
        this.child = spawn(process.execPath, [path.join(root(), 'local', 'src', 'index.ts')], {
            cwd: root(),
            windowsHide: true,
            stdio: ['ignore', log, log],
            env,
        });
        fs.closeSync(log);
        this.failure = '';
        this.starts = [...this.starts.filter((t) => Date.now() - t < 60_000), Date.now()];
        const child = this.child;
        this.exited = new Promise((resolve) => child.once('exit', resolve));
        child.once('exit', (code) => {
            this.child = null;
            if (this.stopping) return;
            // Five starts in a minute: something is broken, the setup page shows the log instead of a loop
            if (this.starts.length >= 5) {
                this.failure = `exit code ${code}`;
                return;
            }
            setTimeout(() => this.start(), code === 0 ? 500 : 3000);
        });
    }

    /** Resolves once the relay answers (the embedded one, or the one of RELAY_URL); false after `ms` or when the backend gave up. */
    async ready(ms = 60_000) {
        // The task's backend starts 30 s after boot and again 30 s after it ended: wait for its PID first
        if (this.useTask) {
            const until = Date.now() + 90_000;
            while (!runningBackend(dataDir()) && Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
            if (!runningBackend(dataDir())) {
                this.failure = 'the scheduled task does not run the backend';
                return false;
            }
        }
        for (const until = Date.now() + ms; Date.now() < until && !this.failure; ) {
            try {
                const r = await fetch(`${this.url}health`, { signal: AbortSignal.timeout(2000) });
                if (r.ok) return true;
            } catch { /* not up yet */ }
            await new Promise((r) => setTimeout(r, 300));
        }
        return false;
    }

    /**
     * A pairing link for this window: one-time sign-in from the relay plus the end-to-end key (local/src/pairing.ts).
     * Token and key as the backend uses them: from the profile's .env (joined machines), else generated in its data.
     */
    async pairingUrl() {
        const read = (name) => { try { return fs.readFileSync(path.join(dataDir(), name), 'utf8').trim(); } catch { return ''; } };
        const env = profileEnv();
        const token = env.AGENT_TOKEN || read('agent-token');
        const key = (env.E2E_KEY || '').toLowerCase() === 'off' ? '' : (env.E2E_KEY || read('e2e-key')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const base = this.url;
        const r = await fetch(`${base}pair`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`relay answered ${r.status}`);
        const { token: pair } = await r.json();
        return `${base}#pair=${pair}${key ? `&e2e=${key}` : ''}`;
    }

    /**
     * Asks the backend to end once no bot is working (local/src/restart.ts, the same request as `npm run restart`);
     * resolves when it has ended.
     */
    stop() {
        this.stopping = true;
        if (!this.child) return Promise.resolve();
        fs.writeFileSync(path.join(dataDir(), 'restart.request'), JSON.stringify({ reason: 'desktop app quits', since: new Date().toISOString() }));
        return this.exited;
    }

    /** Ends the backend and the sessions it started at once. */
    kill() {
        this.stopping = true;
        const child = this.child;
        if (!child) return Promise.resolve();
        if (process.platform === 'win32') execFile('taskkill.exe', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, () => undefined);
        else child.kill('SIGTERM');
        return this.exited;
    }
}

/**
 * Quitting the app ends the backend first. The backend waits until no bot is working; when that takes longer than a
 * moment, `ask` decides between waiting (the app quits by itself afterwards) and quitting now.
 */
function guardQuit(getBackend, ask) {
    let done = false;
    let pending = false;
    app.on('before-quit', (e) => {
        const backend = getBackend();
        if (done || !backend?.child) return;
        e.preventDefault();
        if (pending) return;
        pending = true;
        const quit = () => {
            done = true;
            app.quit();
        };
        backend.stop().then(quit);
        // An idle backend needs up to about eight seconds (restart.ts checks every 2 s, then waits for five quiet ones)
        // plus closing down; asking earlier showed "bots still working" on a slower machine where none was
        setTimeout(async () => {
            if (!done && (await ask())) backend.kill().then(quit);
        }, 12_000);
    });
}

module.exports = { Backend, freePort, guardQuit, dataDir, joinServer, remoteUrl, root };
