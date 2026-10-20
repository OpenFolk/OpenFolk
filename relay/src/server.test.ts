// The relay as a process: caching of the web app, which origins and how much data an unsigned connection may use,
// and that the global login limit leaves pairing alone.  node relay/src/server.test.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const port = 20000 + Math.floor(Math.random() * 20000);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-relay-server-'));
const relay = spawn(process.execPath, [path.join(import.meta.dirname, 'server.ts')], {
    env: {
        ...process.env, RELAY_PORT: String(port), RELAY_DATA: data, USER_PASSWORD: 'client-password-1', CLIENT_TOKEN: '', AGENT_TOKEN: 'agent-token-0123456789',
        TOTP_SECRET: '', AGENT_ALLOWED_FROM: '', TRUST_PROXY: '', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', WAKE_MACHINES: '', NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
relay.stdout.on('data', (c) => { output += c; });
relay.stderr.on('data', (c) => { output += c; });
const stop = () => { relay.kill(); fs.rmSync(data, { recursive: true, force: true }); };

try {
    for (let i = 0; i < 100 && !output.includes('Relay listening'); i++) await new Promise((r) => setTimeout(r, 100));
    if (!output.includes('Relay listening')) throw new Error(`relay did not start: ${output}`);
    const base = `http://127.0.0.1:${port}`;

    // ---- web app with ETag: a second request without changes is answered with 304 and no body
    const first = await fetch(`${base}/js/main.js`);
    const etag = first.headers.get('etag') ?? '';
    check('web app file with ETag and no-cache', first.status === 200 && etag.startsWith('W/"') && first.headers.get('cache-control') === 'no-cache', [first.status, etag]);
    const again = await fetch(`${base}/js/main.js`, { headers: { 'if-none-match': etag } });
    check('unchanged: 304 without body', again.status === 304 && (await again.text()) === '', again.status);
    const other = await fetch(`${base}/js/main.js`, { headers: { 'if-none-match': 'W/"other"' } });
    check('other ETag: the file', other.status === 200 && (await other.text()).length > 0);
    const outside = await Promise.all([`${base}/..%2F.env.sample`, `${base}/%2e%2e/package.json`, `${base}/js/..%2F..%2Fpackage.json`].map((u) => fetch(u)));
    check('nothing outside the web app', outside.every((r) => r.status === 403 || r.status === 404), outside.map((r) => r.status));

    // ---- WebSocket helpers
    type Result = { status?: number; open: boolean; closed?: number; frames: { type?: string; code?: string }[] };
    const connect = (headers: Record<string, string> = {}, origin?: string, send?: string, waitMs = 400) => new Promise<Result>((resolve) => {
        const r: Result = { open: false, frames: [] };
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/client`, { headers, origin });
        ws.on('unexpected-response', (_req, res) => { r.status = res.statusCode; resolve(r); });
        ws.on('error', () => resolve(r));
        ws.on('open', () => { r.open = true; if (send !== undefined) ws.send(send); });
        ws.on('message', (m) => r.frames.push(JSON.parse(m.toString())));
        ws.on('close', (code) => { r.closed = code; resolve(r); });
        setTimeout(() => { ws.terminate(); resolve(r); }, waitMs);
    });
    const login = (body: object, ip: string) => connect({ 'x-forwarded-for': ip }, undefined, JSON.stringify({ type: 'auth', ...body }));

    // ---- origins
    check('foreign web page refused', (await connect({}, 'https://evil.example')).status === 403);
    check('own address allowed', (await connect({}, `http://127.0.0.1:${port}`)).open);
    check('iOS app (capacitor://localhost) allowed', (await connect({}, 'capacitor://localhost')).open);
    check('Android app (https://localhost) allowed', (await connect({}, 'https://localhost')).open);
    check('no Origin (not a browser) allowed', (await connect()).open);

    // ---- before the sign-in only a few KB
    const big = await connect({ 'x-forwarded-for': '198.51.100.1' }, undefined, JSON.stringify({ type: 'auth', token: 'x'.repeat(40_000) }));
    check('large first message: connection dropped without an answer', big.open && big.frames.length === 0 && big.closed !== undefined, big);
    const small = await login({ token: 'client-password-1' }, '198.51.100.2');
    check('normal sign-in still works', small.frames[0]?.type === 'auth' && (small.frames[0] as { ok?: boolean }).ok === true, small.frames);

    // ---- unsigned connections per address are limited
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 10; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/client`, { headers: { 'x-forwarded-for': '198.51.100.3' } });
        await new Promise((r) => { ws.on('open', r); ws.on('error', r); });
        sockets.push(ws);
    }
    const eleventh = await connect({ 'x-forwarded-for': '198.51.100.3' });
    check('eleventh unsigned connection of one address refused', eleventh.status === 429, eleventh);
    check('other addresses unaffected', (await connect({ 'x-forwarded-for': '198.51.100.4' })).open);
    for (const ws of sockets) ws.terminate();
    await new Promise((r) => setTimeout(r, 300));
    check('closed connections free the slots again', (await connect({ 'x-forwarded-for': '198.51.100.3' })).open);

    // ---- the global limit (30 failures an hour from anywhere) blocks the password, not pairing
    for (let i = 0; i < 30; i++) await login({ token: 'wrong' }, `203.0.113.${i + 1}`);
    const blocked = await login({ token: 'client-password-1' }, '192.0.2.200');
    check('after 30 failures: password refused as too many attempts', blocked.frames[0]?.code === 'too_many_attempts', blocked.frames);
    const pairing = await login({ pair: 'not-a-real-token' }, '192.0.2.201');
    check('pairing is still checked (invalid link, not "too many")', pairing.frames[0]?.code === 'pairing_invalid', pairing.frames);
} catch (e) {
    check(`relay test ran (${(e as Error).message})`, false);
} finally {
    stop();
}

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
