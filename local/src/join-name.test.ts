// A machine whose name is cut to 32 characters right after a dash (long macOS host names): it joins with an invitation
// and then signs in to the relay under the name the backend uses. Joining sent the cut name with the dash, the backend
// signs in without it, and the relay, which binds the token to the name, rejected every sign-in.
//   node local/src/join-name.test.ts
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { machineName } from './machine-name.ts';
import { removeTree } from './remove-tree.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failures++;
};
const until = async (f: () => boolean, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end && !f();) await new Promise((r) => setTimeout(r, 100));
    return f();
};

const root = path.join(import.meta.dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-join-name-'));
const AGENT_TOKEN = crypto.randomBytes(24).toString('hex');
const port = 20000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
// 31 characters, then a dot: cut to 32 the name ends with a dash
const raw = `${'a'.repeat(31)}.local`;

// Settings of this computer's own OpenFolk must not reach the processes
const env: NodeJS.ProcessEnv = { ...process.env, TOTP_SECRET: '', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', AGENT_ALLOWED_FROM: '', RELAY_SETUP_CODE: '', CLIENT_TOKEN: '' };
for (const k of ['RELAY_URL', 'E2E_KEY', 'MACHINE_NAME', 'DATA_DIR', 'OPENFOLK_ENV_FILE', 'ELECTRON_RUN_AS_NODE']) delete env[k];

const procs: ChildProcess[] = [];
let relayOut = '';
try {
    const relay = spawn(process.execPath, [path.join(root, 'relay', 'src', 'server.ts')], {
        env: { ...env, RELAY_PORT: String(port), RELAY_DATA: path.join(home, 'relay'), AGENT_TOKEN, USER_PASSWORD: crypto.randomBytes(24).toString('hex') },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(relay);
    relay.stdout!.on('data', (c) => { relayOut += c; });
    relay.stderr!.on('data', (c) => { relayOut += c; });
    check('the relay starts', await until(() => relayOut.includes('Relay listening')), relayOut.slice(-800));

    const invite = await fetch(`${origin}/machine-invite`, { method: 'POST', headers: { authorization: `Bearer ${AGENT_TOKEN}` } }).then((r) => r.json()) as { token: string };
    const envFile = path.join(home, '.env');
    fs.writeFileSync(envFile, `MACHINE_NAME=${raw}\n`);
    const link = `${origin}/#join=${invite.token}&e2e=${crypto.randomBytes(32).toString('base64url')}`;
    const joined = await new Promise<string>((resolve) => {
        const p = spawn(process.execPath, [path.join(root, 'local', 'tools', 'join.mjs'), link], {
            env: { ...env, OPENFOLK_ENV_FILE: envFile, DATA_DIR: path.join(home, 'data'), OPENFOLK_JSON: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        p.stdout!.on('data', (c) => { out += c; });
        p.stderr!.on('data', (c) => { out += c; });
        p.on('close', () => resolve(out));
    });
    const answer = JSON.parse(joined.split(/\r?\n/).findLast((l) => l.trim().startsWith('{')) ?? '{}') as { ok?: boolean; machine?: string };
    const name = machineName(raw);
    check('joined under the name the backend uses, no dash at the end', answer.ok === true && answer.machine === name, joined);

    // Signed in as the backend does it (relay.ts): its own token and its machine name
    const token = /^AGENT_TOKEN=(.+)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim() ?? '';
    const signedIn = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`, { headers: { authorization: `Bearer ${token}`, 'x-machine': name } });
        ws.on('open', () => { ws.close(); resolve(true); });
        ws.on('error', () => resolve(false));
    });
    check('the machine signs in to the relay with its token', signedIn, relayOut.slice(-600));
} finally {
    await Promise.all(procs.map((p) => new Promise<void>((r) => {
        if (p.exitCode !== null || p.signalCode !== null) return r();
        p.once('exit', () => r());
        p.kill();
    })));
    removeTree(home, 5);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exitCode = failures ? 1 : 0;
