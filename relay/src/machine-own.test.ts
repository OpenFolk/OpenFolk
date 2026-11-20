// "machine_own": a signed-in device asks for an invitation for the computer it sits at (the desktop app after its
// sign-in). 'main' gets a machine of the relay, another account a machine bound to it; an admin's open setup link
// stays valid next to it.   node relay/src/machine-own.test.ts
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-own-'));
const relay = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
const base = `http://127.0.0.1:${relay.port}`;
const post = (p: string, body?: object, token?: string) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
type Frame = Record<string, unknown> & { pair?: { token: string }; token?: string; kind?: string; expiresAt?: string };
/** A browser signed in with `auth`; `ask` sends a frame and waits for the answer of `type`. */
async function browser(auth: object) {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/client`, { origin: base });
    const got: Frame[] = [];
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    const wait = async (type: string, from: number) => {
        for (let i = 0; i < 40; i++) {
            const hit = got.slice(from).find((m) => m.type === type);
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 50));
        }
        return null;
    };
    ws.send(JSON.stringify({ type: 'auth', ...auth }));
    await wait('auth', 0);
    return { ws, ask: (frame: object, type: string) => { const from = got.length; ws.send(JSON.stringify(frame)); return wait(type, from); } };
}
const agent = (token: string, machine: string) => new Promise<{ status: number; ws?: WebSocket; got: Frame[] }>((resolve) => {
    const got: Frame[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/agent`, { headers: { authorization: `Bearer ${token}`, 'x-machine': machine, 'x-accounts': '1' } });
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ status: 101, ws, got }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0, got }));
    ws.on('error', () => resolve({ status: 0, got }));
});
const settle = () => new Promise((r) => setTimeout(r, 100));

// ---- the owner: a machine of the relay, as from "Add machine"
const owner = await browser({ token: CLIENT });
const mine = await owner.ask({ type: 'machine_own' }, 'machine_own');
check('main: an invitation to join, valid 15 minutes', mine?.kind === 'join' && typeof mine.token === 'string' && Math.abs(Date.parse(String(mine.expiresAt)) - Date.now() - 15 * 60_000) < 5000, mine);
const joined = await post('/join', { token: mine?.token, machine: 'tower' });
const tower = (await joined.json()) as { agentToken: string };
check('… redeemed like one from "Add machine"', joined.status === 200 && /^[0-9a-f]{64}$/.test(tower.agentToken));
const towerAgent = await agent(tower.agentToken, 'tower');
await settle();
check('… the machine is one of the relay, bound to nobody', towerAgent.status === 101 && towerAgent.got.find((m) => m.type === 'relay_hello')?.bound === undefined);

// ---- a person without admin rights: their own computer, bound to their account
const created = await owner.ask({ type: 'account_create', name: 'Erik' }, 'account_created');
const id = (created?.account as { id: string } | undefined)?.id ?? '';
const erik = await browser({ pair: created?.pair?.token });
const own = await erik.ask({ type: 'machine_own' }, 'machine_own');
check('an account: an invitation bound to it', id === 'erik' && own?.kind === 'setup' && typeof own.token === 'string', own);
check('… which does not join as a machine of the relay', (await post('/join', { token: own?.token, machine: 'laptop' })).status === 403);
const again = await erik.ask({ type: 'machine_own' }, 'machine_own');
check('asked again: the earlier invitation is void', (await post('/setup', { token: own?.token, machine: 'laptop' })).status === 403);
const setup = await post('/setup', { token: again?.token, machine: 'laptop' });
const laptop = (await setup.json()) as { agentToken: string; machine: string; account: { id: string } };
check('… redeemed: a token bound to the account', setup.status === 200 && laptop.account.id === id && laptop.machine === 'laptop', laptop);
check('… once', (await post('/setup', { token: again?.token, machine: 'other' })).status === 403);
const bound = await agent(laptop.agentToken, 'laptop');
await settle();
const hello = bound.got.find((m) => m.type === 'relay_hello');
check('the machine serves its account only, set up by nobody', bound.status === 101 && (hello?.accounts as string[])?.join() === id && hello?.bound === id && hello?.setupBy === undefined, hello);
check('it brings no further machines in', (await post('/machine-invite', undefined, laptop.agentToken)).status === 403);
check('the owner\'s machines keep serving the account', !towerAgent.got.some((m) => m.type === 'account_released' && m.account === id));

// ---- an admin's setup link stays valid next to it
const link = (await (await post('/setup-invite', { account: id, by: 'main' }, AGENT)).json()) as { token: string };
await erik.ask({ type: 'machine_own' }, 'machine_own');
check('an open setup link of an admin survives the account asking for itself', (await post('/setup', { token: link.token, machine: 'second' })).status === 200);

// ---- the account is deleted: its open invitation goes with it
const last = await erik.ask({ type: 'machine_own' }, 'machine_own');
await owner.ask({ type: 'account_delete', id }, 'accounts');
check('a deleted account: its invitation is void', (await post('/setup', { token: last?.token, machine: 'third' })).status === 403);

for (const ws of [owner.ws, erik.ws, towerAgent.ws, bound.ws]) ws?.close();
await relay.close();
if (failed) process.exit(1);
console.log('all tests passed');
