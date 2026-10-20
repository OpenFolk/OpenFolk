// One more machine by invitation: a backend mints it, the new machine redeems it for a token of its own, which counts
// for its name only and goes away when the machine is logged out.   node relay/src/join.test.ts
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-join-'));
const relay = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
const base = `http://127.0.0.1:${relay.port}`;
const post = (p: string, body?: object, token?: string) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
/** Status of the WebSocket upgrade of a backend; with the socket when it got through. */
const agent = (token: string, machine: string) => new Promise<{ status: number; ws?: WebSocket }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/agent`, { headers: { authorization: `Bearer ${token}`, 'x-machine': machine } });
    ws.on('open', () => resolve({ status: 101, ws }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.on('error', () => resolve({ status: 0 }));
});

check('no invitation without a backend token', (await post('/machine-invite', undefined, 'wrong-token-0123456789')).status === 401);
const invite = (await (await post('/machine-invite', undefined, AGENT)).json()) as { token: string; expiresAt: string };
check('a backend mints an invitation, valid 15 minutes', typeof invite.token === 'string' && Math.abs(Date.parse(invite.expiresAt) - Date.now() - 15 * 60_000) < 5000, invite);
check('a wrong invitation: refused', (await post('/join', { token: 'nope', machine: 'laptop' })).status === 403);
const joined = await post('/join', { token: invite.token, machine: 'Laptop' });
const { agentToken } = (await joined.json()) as { agentToken: string };
check('redeemed: a token of its own', joined.status === 200 && /^[0-9a-f]{64}$/.test(agentToken) && agentToken !== AGENT);
check('an invitation works once', (await post('/join', { token: invite.token, machine: 'other' })).status === 403);
check('only a hash is kept', !fs.readFileSync(path.join(dataDir, 'machine-tokens.json'), 'utf8').includes(agentToken));

const own = await agent(agentToken, 'laptop');
check('the joined machine connects with its token', own.status === 101, own.status);
check('the same token for another machine name: refused', (await agent(agentToken, 'desk')).status === 401);
check('the shared AGENT_TOKEN still works', ((await agent(AGENT, 'desk')).status) === 101);
check('a joined machine mints pairing links too', (await post('/pair', {}, agentToken)).status === 200);

// The owner sees and logs out joined machines
const browser = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/client`, { origin: base });
const got: Record<string, unknown>[] = [];
browser.on('message', (raw) => got.push(JSON.parse(raw.toString())));
await new Promise((r) => browser.on('open', r));
browser.send(JSON.stringify({ type: 'auth', token: CLIENT }));
const wait = async (type: string, from: number) => {
    for (let i = 0; i < 40; i++) {
        const hit = got.slice(from).find((m) => m.type === type);
        if (hit) return hit as Record<string, unknown> & { list?: { machine: string }[] };
        await new Promise((r) => setTimeout(r, 50));
    }
    return null;
};
await wait('auth', 0);
let from = got.length;
browser.send(JSON.stringify({ type: 'machine_tokens' }));
const list = await wait('machine_tokens', from);
check('the owner sees the joined machine', list?.list?.map((m) => m.machine).join() === 'laptop', list);
const closed = new Promise<number>((r) => own.ws?.on('close', (code) => r(code)));
from = got.length;
browser.send(JSON.stringify({ type: 'machine_token_remove', machine: 'laptop' }));
const after = await wait('machine_tokens', from);
check('logged out: gone from the list', after?.list?.length === 0, after);
check('its backend is disconnected at once', await closed === 4004);
check('and cannot come back', (await agent(agentToken, 'laptop')).status === 401);

browser.close();
await relay.close();
if (failed) process.exit(1);
console.log('all tests passed');
