// The desktop app end to end, from source (desktop/) or as a built app, each run with a profile of its own:
// 1. "On this computer": the app starts its backend with the embedded relay, signs its window in with a pairing link,
//    and the web app shows the connected machine. Then the first steps move it to a relay on a server (claimed with
//    the setup code from that relay's log): the window follows, signed in there, and the backend connects there.
// 2. "Connect this computer to my server": the link from "Add machine" on the setup page joins the computer to a relay;
//    the backend runs in the app and the window comes from that relay.
// The relays are real relay processes on 127.0.0.1. The app is quit gently each time.
//   node scripts/desktop-smoke.mjs [--exe <packaged app>]   (--exe: the built app, e.g. win-unpacked/OpenFolk.exe)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const args = process.argv.slice(2);
const exeAt = args.indexOf('--exe');
const packaged = exeAt >= 0 ? path.resolve(args[exeAt + 1]) : '';
const repo = path.resolve(import.meta.dirname, '..');
const appDir = path.join(repo, 'desktop');

let failures = 0;
const check = (name, ok, info) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failures++;
};
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const until = async (f, ms = 60_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await f()) return true;
    return false;
};

/** A relay process on a free port; `env` gives it tokens or a setup code. */
async function startRelay(env) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-smoke-relay-'));
    const blank = { USER_PASSWORD: '', CLIENT_TOKEN: '', AGENT_TOKEN: '', RELAY_SETUP_CODE: '', TOTP_SECRET: '', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', AGENT_ALLOWED_FROM: '' };
    const child = spawn(process.execPath, [path.join(repo, 'relay', 'src', 'server.ts')], {
        env: { ...process.env, ...blank, RELAY_PORT: String(port), RELAY_DATA: data, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    await until(() => out.includes('Relay listening'), 20_000);
    return {
        origin: `http://127.0.0.1:${port}`, log: () => out,
        stop: () => { child.kill(); try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* still held */ } },
    };
}

/** The app with a fresh profile holding `config`. */
async function launch(config) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-desktop-'));
    fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config));
    // Started from an editor the variable may be set, and Electron would run as plain Node. A tested build never
    // downloads a real update (desktop/updater.js).
    const env = { ...process.env, OPENFOLK_USER_DATA: profile, OPENFOLK_NO_UPDATE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = packaged || (await import(`file://${path.join(appDir, 'node_modules', 'electron', 'index.js').replace(/\\/g, '/')}`)).default;
    const app = await electron.launch({ executablePath, args: packaged ? [] : [appDir], env });
    return { app, profile, config: () => readJson(path.join(profile, 'config.json')), env: () => { try { return fs.readFileSync(path.join(profile, '.env'), 'utf8'); } catch { return ''; } } };
}

/** Quits like the user: the app asks its backend to end and waits for it. */
async function quit(run) {
    await run.app.evaluate(({ app: a }) => a.quit()).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 15_000));
    // A native dialog nobody answers keeps the app open; end it so the run reports instead of hanging
    const closed = await Promise.race([run.app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 30_000))]);
    if (!closed) {
        check('the app quits by itself', false);
        run.app.process().kill('SIGKILL');
    }
}

const machineConnected = (win) => win.waitForFunction(() => document.querySelector('.welcome-steps li:nth-child(1)')?.classList.contains('done'), null, { timeout: 60_000 })
    .then(() => true, () => false);

function showLog(run) {
    try { console.log(fs.readFileSync(path.join(run.profile, 'data', 'local.log'), 'utf8').slice(-2500)); } catch { /* no log */ }
}

// ---- 1. On this computer, then moved to a relay on a server
{
    const run = await launch({ mode: 'local' });
    const server = await startRelay({ RELAY_SETUP_CODE: 'MNPQR-STUVW' });
    let port = 0;
    try {
        const win = await run.app.firstWindow();
        await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
        port = run.config().localPort;
        check('a port of its own, kept in the profile', Number.isInteger(port) && port > 0, run.config());
        check('the window comes from the embedded relay', win.url().startsWith(`http://127.0.0.1:${port}/`), win.url());
        await win.waitForSelector('#chat-list .welcome', { timeout: 60_000 });
        check('signed in without a password, the machine is connected', await machineConnected(win));
        check('the pairing link is gone from the address bar', !win.url().includes('e2e='), win.url());
        check('remembered as signed in at the embedded relay', run.config().paired === `http://127.0.0.1:${port}/`, run.config());
        const data = path.join(run.profile, 'data');
        check('backend data in the profile', ['agent-token', 'client-token', 'e2e-key'].every((f) => fs.existsSync(path.join(data, f))));
        check('backend log in the profile', fs.readFileSync(path.join(data, 'local.log'), 'utf8').includes('Start backend (desktop app'));

        // Move to the relay on a server from the first steps
        const form = '.welcome-steps li:nth-child(4) .relay-claim';
        await win.fill(`${form} input[name="address"]`, server.origin);
        await win.fill(`${form} input[name="code"]`, 'MNPQR-STUVW');
        await win.click(`${form} button`);
        const moved = await win.waitForURL((u) => u.href.startsWith(`${server.origin}/`), { timeout: 30_000 }).then(() => true, () => false);
        check('claimed from the app: the window follows to the relay on the server', moved, win.url());
        check('there signed in again and the machine is connected', moved && await machineConnected(win));
        check('the backend connected to that relay', await until(() => / connected from /.test(server.log()), 20_000), server.log().slice(-800));
        check('RELAY_URL in the profile\'s .env', run.env().includes(`RELAY_URL=${server.origin.replace('http', 'ws')}/ws/agent`), run.env());
        check('remembered as signed in at that relay', run.config().paired === `${server.origin}/`, run.config());
        check('the embedded relay is closed', !(await fetch(`http://127.0.0.1:${port}/health`).then(() => true, () => false)));
    } catch (e) {
        check(`desktop app ran (${e.message})`, false);
        showLog(run);
    } finally {
        await quit(run);
        check('quitting the app ends its backend', / disconnected/.test(server.log().split('connected from').pop() ?? ''), server.log().slice(-400));
        server.stop();
        try { fs.rmSync(run.profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a file still held */ }
    }
}

// ---- 2. Connect this computer to my server, with the link from "Add machine"
{
    const AGENT_TOKEN = crypto.randomBytes(24).toString('hex');
    const server = await startRelay({ AGENT_TOKEN, USER_PASSWORD: crypto.randomBytes(24).toString('hex') });
    const run = await launch({});
    try {
        const invite = await fetch(`${server.origin}/machine-invite`, { method: 'POST', headers: { authorization: `Bearer ${AGENT_TOKEN}` } }).then((r) => r.json());
        const key = crypto.randomBytes(32).toString('base64url');
        const win = await run.app.firstWindow();
        await win.waitForSelector('#join-form');
        await win.fill('#join', 'not a link');
        await win.click('#join-form button');
        check('setup page: a broken link is refused with a reason', (await win.waitForFunction(() => document.getElementById('join-error').textContent, null, { timeout: 15_000 }).then(() => true, () => false)));
        await win.fill('#join', `${server.origin}/#join=${invite.token}&e2e=${key}`);
        await win.click('#join-form button');
        const loaded = await win.waitForURL((u) => u.href.startsWith(`${server.origin}/`), { timeout: 90_000 }).then(() => true, () => false);
        check('joined: the window comes from the relay on the server', loaded, win.url());
        check('signed in there, the machine of this computer is connected', loaded && await machineConnected(win));
        check('the profile\'s .env has the relay, a token of its own and the key', /RELAY_URL=ws:\/\/127\.0\.0\.1/.test(run.env()) && /AGENT_TOKEN=\S+/.test(run.env())
            && run.env().includes(`E2E_KEY=${key}`) && !run.env().includes(AGENT_TOKEN));
        check('mode "on this computer", signed in at that relay', run.config().mode === 'local' && run.config().paired === `${server.origin}/`, run.config());
    } catch (e) {
        check(`desktop app joined (${e.message})`, false);
        showLog(run);
    } finally {
        await quit(run);
        server.stop();
        try { fs.rmSync(run.profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a file still held */ }
    }
}

// ---- 3. Run without signing in (Windows): the task's loop runs the app's backend; the app then starts none of its own
if (process.platform === 'win32') {
    const AGENT_TOKEN = crypto.randomBytes(24).toString('hex');
    const server = await startRelay({ AGENT_TOKEN, USER_PASSWORD: crypto.randomBytes(24).toString('hex') });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-desktop-task-'));
    const lines = [`RELAY_URL=${server.origin.replace('http', 'ws')}/ws/agent`, `AGENT_TOKEN=${AGENT_TOKEN}`, `E2E_KEY=${crypto.randomBytes(32).toString('base64url')}`, 'MACHINE_NAME=task-smoke'];
    fs.writeFileSync(path.join(profile, '.env'), lines.map((l) => `${l}\n`).join(''));
    const exe = packaged || (await import(`file://${path.join(appDir, 'node_modules', 'electron', 'index.js').replace(/\\/g, '/')}`)).default;
    const root = packaged ? path.join(path.dirname(packaged), 'resources', 'openfolk') : repo;
    const script = packaged ? path.join(path.dirname(packaged), 'resources', 'task.ps1') : path.join(appDir, 'task.ps1');
    // As the task runs it (desktop/task.ps1 -Run), only started here by hand instead of by the task scheduler
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const loop = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Run', '-Exe', exe, '-Root', root, '-UserData', profile],
        { env, stdio: 'ignore', windowsHide: true });
    const log = () => { try { return fs.readFileSync(path.join(profile, 'data', 'local.log'), 'utf8'); } catch { return ''; } };
    let run = null;
    try {
        check('task loop: the backend starts and connects to the relay', await until(() => / task-smoke connected/.test(server.log()), 90_000), log().slice(-1500));
        check('task loop: its start in the log of the profile', log().includes('Start backend (task, without sign-in)'));
        // The app on the task's profile, with the task switched on
        const env2 = { ...process.env, OPENFOLK_USER_DATA: profile, OPENFOLK_NO_UPDATE: '1' };
        delete env2.ELECTRON_RUN_AS_NODE;
        fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ mode: 'local', task: true, localPort: 1 }));
        const app = await electron.launch({ executablePath: exe, args: packaged ? [] : [appDir], env: env2 });
        run = { app, profile, config: () => readJson(path.join(profile, 'config.json')), env: () => '' };
        const win = await app.firstWindow();
        const loaded = await win.waitForURL((u) => u.href.startsWith(`${server.origin}/`), { timeout: 90_000 }).then(() => true, () => false);
        check('with the task on: the window comes from the relay, signed in', loaded && await machineConnected(win), win.url());
        check('with the task on: the app started no backend of its own', !log().includes('Start backend (desktop app'));
        await quit(run);
        run = null;
        check('quitting the app leaves the backend of the task running', !/ task-smoke disconnected/.test(server.log()));
    } catch (e) {
        check(`task loop ran (${e.message})`, false);
        console.log(log().slice(-2000));
    } finally {
        if (run) await quit(run);
        // End the loop first, then the backend it started (its PID file)
        spawn('taskkill.exe', ['/T', '/F', '/PID', String(loop.pid)], { stdio: 'ignore', windowsHide: true });
        try { spawn('taskkill.exe', ['/T', '/F', '/PID', fs.readFileSync(path.join(profile, 'data', 'backend.pid'), 'utf8').trim()], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
        await new Promise((r) => setTimeout(r, 3000));
        server.stop();
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a file still held */ }
    }
}

if (failures) process.exit(1);
console.log('desktop app ok');
process.exit(0);
