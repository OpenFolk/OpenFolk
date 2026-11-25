// Demo accounts for the app stores' reviewers (DEMO_ACCOUNTS) and the sign-in limit per account.
//   node relay/src/demo-accounts.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { Accounts } from './accounts.ts';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-demo-'));
const CLIENT = 'client-token-0123456789';
const AGENT = 'agent-token-0123456789ab';
const DEMO = 'demo-password-for-the-review';
type Msg = Record<string, unknown> & { type?: string };

// ---------------------------------------------------------------- accounts.ts on its own
const store = new Accounts(tmp());
const made = store.ensureDemo(['Apple Review'], DEMO);
check('a demo account is created', made.length === 1 && made[0] === 'apple-review');
const a = store.get('apple-review');
check('… as a customer, no admin, marked demo', a?.demo === true && a.admin === false && a.reach === 'admins');
check('… with the demo password', store.passwordMatches('apple-review', DEMO));
check('… and is a demo person for the backends', store.people().find((p) => p.id === 'apple-review')?.demo === true);
check('its password cannot be changed', store.update('apple-review', { password: 'another-long-password' }) === 'invalid' && store.passwordMatches('apple-review', DEMO));
check('nor its name', store.update('apple-review', { name: 'Someone' }) === 'invalid' && store.get('apple-review')?.name === 'Apple Review');
check('its picture can', store.update('apple-review', { avatar: null }) === 'ok');
check('a second start creates nothing', store.ensureDemo(['Apple Review'], DEMO).length === 0);
store.ensureDemo(['Apple Review'], 'a-new-demo-password-xyz');
check('a new DEMO_PASSWORD replaces the old one', store.passwordMatches('apple-review', 'a-new-demo-password-xyz') && !store.passwordMatches('apple-review', DEMO));
store.remove('apple-review');
const again = store.ensureDemo(['Apple Review'], DEMO);
check('after deletion it comes back under a new id', again[0] === 'apple-review-2' && store.find('apple review')?.id === 'apple-review-2');
check('other accounts are no demo', store.create('Kunde') !== 'invalid' && !store.isDemo('kunde'));

// ---------------------------------------------------------------- the relay
let threw = '';
try {
    await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir: tmp(), wake: parseWakeConfig({}), demoAccounts: ['Review'], demoPassword: 'short', log: () => undefined });
} catch (e) {
    threw = (e as Error).message;
}
check('a short DEMO_PASSWORD stops the relay', threw.includes('DEMO_PASSWORD'));

// trustProxy 1: each sign-in comes from the address in X-Forwarded-For, so the limit per address does not interfere
const relay = await startRelay({
    port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir: tmp(), wake: parseWakeConfig({}), trustProxy: 1,
    demoAccounts: ['Apple Review', 'Google Review'], demoPassword: DEMO, log: () => undefined,
});
const port = relay.port;
const origin = `http://127.0.0.1:${port}`;

function connect(url: string, headers: Record<string, string>) {
    const ws = new WebSocket(url, { headers, origin });
    const got: Msg[] = [];
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString()) as Msg));
    ws.on('error', () => undefined);
    const next = (test: (m: Msg) => boolean, ms = 2000) => new Promise<Msg | null>((resolve) => {
        const started = Date.now();
        const look = () => {
            const hit = got.find(test);
            if (hit) return resolve(hit);
            if (Date.now() - started > ms) return resolve(null);
            setTimeout(look, 20);
        };
        look();
    });
    // A refused upgrade never opens: the test then fails on the missing reply instead of hanging
    const opened = new Promise<void>((resolve) => { ws.on('open', () => resolve()); ws.on('unexpected-response', () => resolve()); ws.on('close', () => resolve()); });
    return { ws, got, next, opened, send: (m: object) => ws.send(JSON.stringify(m)) };
}
let address = 0;
const client = async (auth: object) => {
    address++;
    const c = connect(`ws://127.0.0.1:${port}/ws/client`, { 'x-forwarded-for': `198.51.100.${Math.floor(address / 250)}, 203.0.113.${address % 250}` });
    await c.opened;
    if (c.ws.readyState === WebSocket.OPEN) c.send({ type: 'auth', ...auth });
    const reply = await c.next((m) => m.type === 'auth');
    return { ...c, reply };
};

const desk = connect(`ws://127.0.0.1:${port}/ws/agent`, { authorization: `Bearer ${AGENT}`, 'x-machine': 'demo', 'x-accounts': '1' });
await desk.opened;
const hello = await desk.next((m) => m.type === 'relay_hello');
check('backends hear of the demo accounts on connect', ((hello?.accounts ?? []) as string[]).join() === 'main,apple-review,google-review');

const reviewer = await client({ token: DEMO, account: 'Apple Review', name: 'iPhone' });
check('a reviewer signs in with name and password', reviewer.reply?.ok === true && (reviewer.reply.account as { id: string }).id === 'apple-review');
const second = await client({ token: DEMO, account: 'apple-review', name: 'iPad' });
check('… again on another device', second.reply?.ok === true);

reviewer.send({ type: 'account_update', id: 'apple-review', password: 'my-own-password-123456' });
check('the reviewer cannot change the password', !!(await reviewer.next((m) => m.type === 'error' && m.request === 'account_update')));

reviewer.send({ type: 'account_delete', id: 'apple-review' });
const added = await desk.next((m) => m.type === 'account_added' && m.account === 'apple-review-2');
check('a deleted demo account comes back under a new id', !!(await desk.next((m) => m.type === 'account_deleted' && m.account === 'apple-review')) && !!added);
const people = await desk.next((m) => m.type === 'people' && (m.list as { id: string }[]).some((p) => p.id === 'apple-review-2'));
check('… marked demo for the backends', !!(people?.list as { id: string; demo?: boolean }[] | undefined)?.find((p) => p.id === 'apple-review-2')?.demo);
const next = await client({ token: DEMO, account: 'Apple Review', name: 'iPhone' });
check('the next reviewer signs in with the same name and password', next.reply?.ok === true && (next.reply.account as { id: string }).id === 'apple-review-2');

// The limit: 30 failures within the hour lock the password sign-in of that account only
const owner = await client({ token: CLIENT });
owner.send({ type: 'account_create', name: 'Kunde' });
await owner.next((m) => m.type === 'account_created');
owner.send({ type: 'account_invite', id: 'kunde' });
const kunde = await client({ pair: ((await owner.next((m) => m.type === 'account_invite'))!.pair as { token: string }).token, name: 'Phone' });
kunde.send({ type: 'account_update', id: 'kunde', password: 'kunde-password-0123456' });
await kunde.next((m) => m.type === 'accounts');
for (let i = 0; i < 30; i++) (await client({ token: 'wrong-password-0000000', account: 'kunde' })).ws.close();
const locked = await client({ token: 'kunde-password-0123456', account: 'kunde' });
check('30 failures lock the account they named', locked.reply?.ok === false && locked.reply.code === 'too_many_attempts');
check('… but not the owner', (await client({ token: CLIENT })).reply?.ok === true);
for (let i = 0; i < 30; i++) (await client({ token: 'wrong-password-0000000', account: 'google review' })).ws.close();
check('a demo account is never locked that way', (await client({ token: DEMO, account: 'Google Review' })).reply?.ok === true);
for (let i = 0; i < 30; i++) (await client({ token: 'wrong-password-0000000', account: 'nobody' })).ws.close();
check('failures for names that are no account do not lock the owner', (await client({ token: CLIENT })).reply?.ok === true);

desk.ws.close();
await relay.close();

if (failed) process.exit(1);
console.log('all tests passed');
