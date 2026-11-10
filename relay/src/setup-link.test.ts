// Setup links: an admin's backend mints one for an account, a machine redeems it for a token bound to that account,
// survives a relay restart, keeps its name apart from the owner's machines, pairs devices of its account only and is
// logged out with the account.   node relay/src/setup-link.test.ts
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-setup-'));
const start = () => startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
let relay = await start();
const base = () => `http://127.0.0.1:${relay.port}`;
const post = (p: string, body?: object, token?: string) => fetch(`${base()}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const agent = (token: string, machine: string) => new Promise<{ status: number; ws?: WebSocket; got: Record<string, unknown>[] }>((resolve) => {
    const got: Record<string, unknown>[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/agent`, { headers: { authorization: `Bearer ${token}`, 'x-machine': machine, 'x-accounts': '1' } });
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ status: 101, ws, got }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0, got }));
    ws.on('error', () => resolve({ status: 0, got }));
});
const settle = () => new Promise((r) => setTimeout(r, 100));

// The owner's browser creates the account
const browser = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/client`, { origin: base() });
const got: Record<string, unknown>[] = [];
browser.on('message', (raw) => got.push(JSON.parse(raw.toString())));
await new Promise((r) => browser.on('open', r));
browser.send(JSON.stringify({ type: 'auth', token: CLIENT }));
const wait = async (type: string, from: number) => {
    for (let i = 0; i < 40; i++) {
        const hit = got.slice(from).find((m) => m.type === type);
        if (hit) return hit as Record<string, unknown> & { list?: Record<string, unknown>[]; account?: { id: string } };
        await new Promise((r) => setTimeout(r, 50));
    }
    return null;
};
await wait('auth', 0);
let from = got.length;
browser.send(JSON.stringify({ type: 'account_create', name: 'Kunde Müller', reach: 'listed' }));
const created = await wait('account_created', from);
const id = created?.account?.id ?? '';
check('an account to set up', id === 'kunde-mueller', created);
from = got.length;
browser.send(JSON.stringify({ type: 'account_update', id, contacts: ['main', 'nobody'] }));
const updated = await wait('accounts', from);
const kunde = updated?.list?.find((a) => a.id === id);
check('its contacts: only accounts that exist', JSON.stringify(kunde?.contacts) === '["main"]' && kunde?.reach === 'listed', kunde);

// The owner's machine is connected; it serves the account until the link is minted
const desk = await agent(AGENT, 'desk');
await settle();
check('before the link, the owner\'s machine serves the new account', (desk.got.find((m) => m.type === 'relay_hello')?.accounts as string[])?.includes(id));

check('no setup link without a backend token', (await post('/setup-invite', { account: id, by: 'main' }, 'wrong-token-0123456789')).status === 401);
check('no setup link for main', (await post('/setup-invite', { account: 'main', by: 'main' }, AGENT)).status === 403);
check('no setup link by a non-admin', (await post('/setup-invite', { account: id, by: id }, AGENT)).status === 403);
const first = (await (await post('/setup-invite', { account: id, by: 'main' }, AGENT)).json()) as { token: string; expiresAt: string };
check('a setup link, valid 7 days', typeof first.token === 'string' && Math.abs(Date.parse(first.expiresAt) - Date.now() - 7 * 24 * 3600_000) < 5000, first);
await settle();
check('the owner\'s machine lets go of the account', desk.got.some((m) => m.type === 'account_released' && m.account === id));
const invite = (await (await post('/setup-invite', { account: id, by: 'main' }, AGENT)).json()) as { token: string };
check('a new link replaces the old one', (await post('/setup', { token: first.token, machine: 'laptop' })).status === 403);
check('only a hash is kept', !fs.readFileSync(path.join(dataDir, 'setup-invites.json'), 'utf8').includes(invite.token));

// Survives a restart of the relay (deploys)
desk.ws?.close();
browser.close();
await relay.close();
relay = await start();
const joined = await post('/setup', { token: invite.token, machine: 'desk' });
const answer = (await joined.json()) as { agentToken: string; machine: string; account: { id: string; name: string } };
check('redeemed after a restart: a token bound to the account', joined.status === 200 && /^[0-9a-f]{64}$/.test(answer.agentToken) && answer.account.id === id && answer.account.name === 'Kunde Müller', answer);
check('the name of a machine the relay knows is not taken over', answer.machine === 'desk-2', answer.machine);
check('a setup link works once', (await post('/setup', { token: invite.token, machine: 'other' })).status === 403);

const bound = await agent(answer.agentToken, answer.machine);
await settle();
const hello = bound.got.find((m) => m.type === 'relay_hello');
check('the bound machine connects and serves its account only', bound.status === 101 && (hello?.accounts as string[])?.join() === id && hello?.bound === id && hello?.setupBy === 'main', hello);
const pair = await post('/pair', { account: 'main' }, answer.agentToken);
check('it pairs devices, but of its own account only', pair.status === 200);
check('it brings no further machines in', (await post('/machine-invite', undefined, answer.agentToken)).status === 403);
check('nor mints setup links', (await post('/setup-invite', { account: id, by: 'main' }, answer.agentToken)).status === 401);
check('the owner\'s backend mints no devices for the account set up', (await post('/pair', { account: id }, AGENT)).status === 403);

// Deleting the account logs its machine out
const browser2 = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/client`, { origin: base() });
got.length = 0;
browser2.on('message', (raw) => got.push(JSON.parse(raw.toString())));
await new Promise((r) => browser2.on('open', r));
browser2.send(JSON.stringify({ type: 'auth', token: CLIENT }));
await wait('auth', 0);
from = got.length;
browser2.send(JSON.stringify({ type: 'machine_tokens' }));
const tokens = await wait('machine_tokens', from);
check('the owner sees the bound machine with its account', tokens?.list?.some((m) => m.machine === 'desk-2' && m.account === id) === true, tokens);
const closed = new Promise<number>((r) => bound.ws?.on('close', (code) => r(code)));
browser2.send(JSON.stringify({ type: 'account_delete', id }));
check('deleting the account disconnects its machine', await closed === 4004);
check('which heard of the deletion first', bound.got.some((m) => m.type === 'account_deleted' && m.account === id));
check('and cannot come back', (await agent(answer.agentToken, answer.machine)).status === 401);

browser2.close();
await relay.close();
if (failed) process.exit(1);
console.log('all tests passed');
