// The first device end to end, as in a container: a real relay and a real backend process (OPENFOLK_CONTAINER=1),
// the code read from the backend's log, a waiting device that sends only its key and opens the sealed link with the
// code, then signs in at the relay with the token inside. The code never crosses the relay.
//   node local/src/first-device-e2e.test.ts
import { spawn, type ChildProcess } from 'node:child_process';
import crypto, { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { openFirstDevice } from './first-device.ts';
import { removeTree } from './remove-tree.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failures++;
};

const here = import.meta.dirname;
const root = path.join(here, '..', '..');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const relayData = tmp('openfolk-first-relay-');
const backendData = tmp('openfolk-first-data-');
const port = 20000 + Math.floor(Math.random() * 20000);
const AGENT_TOKEN = crypto.randomBytes(24).toString('hex');
const USER_PASSWORD = crypto.randomBytes(24).toString('hex');
const blank = { CLIENT_TOKEN: '', APP_URL: '', TOTP_SECRET: '', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', WAKE_MACHINES: '', AGENT_ALLOWED_FROM: '', TRUST_PROXY: '', RELAY_SETUP_CODE: '' };

const procs: ChildProcess[] = [];
function run(file: string, env: NodeJS.ProcessEnv): { out: () => string } {
    const p = spawn(process.execPath, [file], { env: { ...process.env, ...blank, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    p.stdout!.on('data', (c) => { out += c; });
    p.stderr!.on('data', (c) => { out += c; });
    return { out: () => out };
}
const until = async (f: () => boolean, ms = 30_000) => {
    for (let i = 0; i < ms / 100 && !f(); i++) await new Promise((r) => setTimeout(r, 100));
    return f();
};

try {
    const relay = run(path.join(root, 'relay', 'src', 'server.ts'), { RELAY_PORT: String(port), RELAY_DATA: relayData, AGENT_TOKEN, USER_PASSWORD });
    check('relay up', await until(() => relay.out().includes('Relay listening')), relay.out());
    fs.writeFileSync(path.join(backendData, 'machine-settings.json'), JSON.stringify({ shutdown: false, voicePreload: false }));
    const backend = run(path.join(here, 'index.ts'), {
        DATA_DIR: backendData, RELAY_URL: `ws://127.0.0.1:${port}/ws/agent`, AGENT_TOKEN, USER_PASSWORD, E2E_KEY: crypto.randomBytes(32).toString('base64'),
        MACHINE_NAME: 'first-e2e', OPEN_BROWSER: '0', AUTOLOGON_METHOD: 'none', ALLOWED_ROOTS: backendData, OPENFOLK_CONTAINER: '1',
        OPENFOLK_ENV_FILE: path.join(backendData, '.env'),
    });
    check('backend connected', await until(() => relay.out().includes('Agent first-e2e connected')), backend.out().slice(-1500));
    check('the code in the backend log', await until(() => /enter [0-9A-Z]{4}(-[0-9A-Z]{4}){3}\./.test(backend.out())), backend.out().slice(-800));
    const code = /enter ([0-9A-Z]{4}(?:-[0-9A-Z]{4}){3})\./.exec(backend.out())?.[1] ?? '';

    // The waiting device: its key pair, pair_wait, then pair_first with the public key only
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as webcrypto.CryptoKeyPair;
    const pk = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');
    const origin = `http://127.0.0.1:${port}`;
    const got: Record<string, unknown>[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/client`, { origin });
    const sent: string[] = [];
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    await new Promise<void>((r) => ws.on('open', () => r()));
    const send = (m: object) => { sent.push(JSON.stringify(m)); ws.send(JSON.stringify(m)); };
    send({ type: 'pair_wait' });
    await until(() => got.some((m) => m.type === 'pair_wait' && m.id), 5000);
    const wait = got.find((m) => m.type === 'pair_wait' && m.id)!;
    check('the relay offers the first device', wait.first === true, wait);
    send({ type: 'pair_first', pk });
    check('a sealed box comes back', await until(() => got.some((m) => m.type === 'pair_wait' && m.box), 15_000), got);
    check('the code never went to the relay', !sent.join('').includes(code.replace(/-/g, '')) && !sent.join('').includes(code));
    const box = got.find((m) => m.type === 'pair_wait' && m.box)!.box as { pk: string; iv: string; data: string };
    const params = new URLSearchParams(await openFirstDevice(keys.privateKey, String(wait.id), box, code));
    check('the box holds a pairing token and the end-to-end key', !!params.get('pair') && !!params.get('e2e'), [...params.keys()]);

    const auth = await new Promise<Record<string, unknown>>((resolve) => {
        const c = new WebSocket(`ws://127.0.0.1:${port}/ws/client`, { origin });
        c.on('open', () => c.send(JSON.stringify({ type: 'auth', pair: params.get('pair'), name: 'first' })));
        c.on('message', (raw) => { resolve(JSON.parse(raw.toString()) as Record<string, unknown>); c.close(); });
        c.on('error', () => resolve({}));
    });
    check('the token signs the device in at the relay', auth.ok === true, auth);
    ws.close();
} finally {
    for (const p of procs) p.kill();
    await new Promise((r) => setTimeout(r, 500));
    removeTree(relayData);
    removeTree(backendData);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exitCode = failures ? 1 : 0;
