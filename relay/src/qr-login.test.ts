// Sign-in by QR code on the relay: a device that is not signed in waits, a signed-in one looks it up and passes it
// a sealed box, which the relay forwards untouched.  node relay/src/qr-login.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const CLIENT = 'client-token-0123456789';
const AGENT = 'agent-token-0123456789ab';
type Msg = Record<string, unknown> & { type?: string };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-qr-'));
const relay = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
const origin = `http://127.0.0.1:${relay.port}`;

/** A browser connection with every message it received; `next` waits for the first one matching. */
async function browser(first: object) {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/client`, { origin, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' } });
    const got: Msg[] = [];
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    ws.send(JSON.stringify(first));
    const next = async (test: (m: Msg) => boolean, ms = 2000) => {
        for (let t = 0; t < ms; t += 20) {
            const hit = got.find(test);
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 20));
        }
        return null;
    };
    return { ws, got, closed, next, send: (m: object) => ws.send(JSON.stringify(m)) };
}
const within = (p: Promise<number>, ms = 2000) => Promise.race([p, new Promise<number>((r) => setTimeout(() => r(-1), ms))]);

// ---- the waiting device gets an id, and nothing else
const fresh = await browser({ type: 'pair_wait' });
const wait = await fresh.next((m) => m.type === 'pair_wait');
const id = String(wait?.id ?? '');
check('waiting device gets a long random id and an expiry', id.length >= 20 && Date.parse(String(wait?.expiresAt)) > Date.now() + 5 * 60_000, wait);
fresh.send({ type: 'devices' });
check('… but is not signed in: no answer to relay requests', (await fresh.next((m) => m.type === 'devices', 300)) === null);

// ---- the signed-in device looks it up
const owner = await browser({ type: 'auth', token: CLIENT, name: 'Phone' });
check('owner signs in', (await owner.next((m) => m.type === 'auth'))?.ok === true);
owner.send({ type: 'pair_request', id });
const request = await owner.next((m) => m.type === 'pair_request');
check('lookup names the waiting device and its address', request?.id === id && typeof request?.name === 'string' && (request.name as string).length > 0 && request?.ip === '127.0.0.1', request);
/** How many refusals of this request type the owner got so far. */
const refusals = (request: string) => owner.got.filter((m) => m.type === 'error' && m.request === request).length;
owner.send({ type: 'pair_request', id: 'not-a-request' });
check('unknown id: pairing_invalid', !!(await owner.next((m) => m.type === 'error' && m.code === 'pairing_invalid' && m.request === 'pair_request')));
owner.send({ type: 'pair_approve', id, box: { pk: 'x'.repeat(5000), iv: 'a', data: 'b' } });
check('oversized box refused', !!(await owner.next((m) => m.type === 'error' && m.code === 'not_allowed' && m.request === 'pair_approve')));
owner.send({ type: 'pair_approve', id, box: { pk: 1 } });
check('malformed box refused', !!(await owner.next(() => refusals('pair_approve') === 2)));

// ---- approval: a real pairing token in the box (the relay cannot tell), forwarded untouched
const pairing = (await (await fetch(`${origin}/pair`, { method: 'POST', headers: { authorization: `Bearer ${AGENT}` } })).json()) as { token: string };
const box = { pk: 'public-key-of-the-approver', iv: 'iv-bytes', data: `sealed:${pairing.token}` };
owner.send({ type: 'pair_approve', id, box });
check('approver hears it went through', !!(await owner.next((m) => m.type === 'pair_approved' && m.id === id)));
const delivered = await fresh.next((m) => m.type === 'pair_wait' && !!m.box);
check('waiting device gets the box exactly as sent', JSON.stringify(delivered?.box) === JSON.stringify(box), delivered);
check('… and its waiting connection ends', await within(fresh.closed) === 1000);
owner.send({ type: 'pair_approve', id, box });
check('a request is approved once', !!(await owner.next((m) => m.type === 'error' && m.code === 'pairing_invalid' && m.request === 'pair_approve')));
const signedIn = await browser({ type: 'auth', pair: pairing.token, name: 'Laptop' });
check('the token from the box signs the new device in', (await signedIn.next((m) => m.type === 'auth'))?.ok === true);

// ---- a device that gives up takes its request along
const gone = await browser({ type: 'pair_wait' });
const goneId = String((await gone.next((m) => m.type === 'pair_wait'))?.id ?? '');
gone.ws.close();
await gone.closed;
await new Promise((r) => setTimeout(r, 100));
owner.send({ type: 'pair_request', id: goneId });
check('closed waiting connection: its id is no longer valid', !!(await owner.next(() => refusals('pair_request') === 2)) && owner.got.at(-1)?.code === 'pairing_invalid');

for (const s of [owner, signedIn]) s.ws.close();
await relay.close();
fs.rmSync(dataDir, { recursive: true, force: true });

if (failed) process.exit(1);
console.log('all tests passed');
