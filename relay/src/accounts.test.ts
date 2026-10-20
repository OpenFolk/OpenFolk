// Accounts on the relay: what each account's devices see, which backend gets what, managing accounts.
//   node relay/src/accounts.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { hashToken } from './auth.ts';
import { ACCOUNTS_FILE, Accounts } from './accounts.ts';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-accounts-'));
const CLIENT = 'client-token-0123456789';
const AGENT = 'agent-token-0123456789ab';
type Msg = Record<string, unknown> & { type?: string };

// ---------------------------------------------------------------- accounts.ts on its own
const store = new Accounts(tmp());
check('main exists and is an admin', store.get('main')?.admin === true && store.isAdmin('main'));
const kunde = store.create('Kunde Müller');
check('id from the name, umlauts spelled out', typeof kunde === 'object' && kunde.id === 'kunde-mueller' && !kunde.admin);
check('same name in other case: taken', store.create('kunde müller') === 'name_taken');
check('empty name: invalid', store.create('  ') === 'invalid');
check('found by id and by name', store.find('kunde-mueller')?.id === 'kunde-mueller' && store.find('KUNDE MÜLLER')?.id === 'kunde-mueller');
check('short password refused', store.update('kunde-mueller', { password: 'short' }) === 'invalid');
check('password set and checked', store.update('kunde-mueller', { password: 'a-long-enough-password' }) === 'ok'
    && store.passwordMatches('kunde-mueller', 'a-long-enough-password') && !store.passwordMatches('kunde-mueller', 'wrong-password-xyz'));
check('main has no password here (it is the relay\'s)', store.update('main', { password: 'a-long-enough-password' }) === 'invalid' && !store.passwordMatches('main', 'a-long-enough-password'));
const legacyDir = tmp();
fs.writeFileSync(path.join(legacyDir, ACCOUNTS_FILE), JSON.stringify({ accounts: [{ id: 'alt', name: 'Alt', admin: false, created: '', hash: hashToken('an-old-sha256-password') }] }));
const legacy = new Accounts(legacyDir);
const storedHash = () => (JSON.parse(fs.readFileSync(path.join(legacyDir, ACCOUNTS_FILE), 'utf8')) as { accounts: { id: string; hash?: string }[] }).accounts.find((a) => a.id === 'alt')?.hash ?? '';
check('password from before scrypt: wrong one refused, hash kept', !legacy.passwordMatches('alt', 'wrong-password-xyz') && storedHash() === hashToken('an-old-sha256-password'));
check('password from before scrypt: signs in, rewritten with scrypt', legacy.passwordMatches('alt', 'an-old-sha256-password') && storedHash().startsWith('scrypt$')
    && new Accounts(legacyDir).passwordMatches('alt', 'an-old-sha256-password'));
check('main cannot be deleted', !store.remove('main'));
check('deleted account leaves a tombstone', store.remove('kunde-mueller') && store.deletedIds().includes('kunde-mueller') && !store.get('kunde-mueller'));
const again = store.create('Kunde Müller');
check('a deleted id is never given out again', typeof again === 'object' && again.id === 'kunde-mueller-2');

// ---------------------------------------------------------------- the relay with two accounts
const dataDir = tmp();
const relay = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
const port = relay.port;
const origin = `http://127.0.0.1:${port}`;

/** A socket with every message it received; `next` waits for the first one matching. */
function connect(url: string, headers: Record<string, string>) {
    const ws = new WebSocket(url, { headers, origin });
    const got: Msg[] = [];
    const waiting: { test: (m: Msg) => boolean; resolve: (m: Msg | null) => void }[] = [];
    ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as Msg;
        got.push(m);
        for (const w of waiting.splice(0)) {
            if (w.test(m)) w.resolve(m);
            else waiting.push(w);
        }
    });
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    const next = (test: (m: Msg) => boolean, ms = 2000) => new Promise<Msg | null>((resolve) => {
        const hit = got.find(test);
        if (hit) return resolve(hit);
        const w = { test, resolve };
        waiting.push(w);
        setTimeout(() => { const i = waiting.indexOf(w); if (i >= 0) { waiting.splice(i, 1); resolve(null); } }, ms);
    });
    const opened = new Promise<void>((resolve) => ws.on('open', () => resolve()));
    return { ws, got, next, closed, opened, send: (m: object) => ws.send(JSON.stringify(m)) };
}
const agent = async (machine: string, accounts: boolean) => {
    const a = connect(`ws://127.0.0.1:${port}/ws/agent`, { authorization: `Bearer ${AGENT}`, 'x-machine': machine, ...(accounts ? { 'x-accounts': '1' } : {}) });
    await a.opened;
    await a.next((m) => m.type === 'relay_hello');
    return a;
};
const client = async (auth: object) => {
    const c = connect(`ws://127.0.0.1:${port}/ws/client`, {});
    await c.opened;
    c.send({ type: 'auth', ...auth });
    const reply = await c.next((m) => m.type === 'auth');
    return { ...c, reply };
};
/** Nothing matching arrives within a moment. */
const none = async (c: { next: (t: (m: Msg) => boolean, ms?: number) => Promise<Msg | null> }, test: (m: Msg) => boolean) => (await c.next(test, 300)) === null;

const desk = await agent('desk', true);
const server = await agent('server', true);
const old = await agent('old', false);
check('hello of a backend with accounts lists them', JSON.stringify(desk.got.find((m) => m.type === 'relay_hello')?.accounts) === '["main"]');
check('hello of an old backend without accounts', !('accounts' in old.got.find((m) => m.type === 'relay_hello')!));

const owner = await client({ token: CLIENT });
check('password without account: main', owner.reply?.ok === true && (owner.reply.account as { id: string }).id === 'main');
const ownerKey = (owner.reply!.device as { token: string }).token;

owner.send({ type: 'account_create', name: 'Kunde Müller' });
const created = await owner.next((m) => m.type === 'account_created');
const id = (created?.account as { id: string } | undefined)?.id;
check('main creates an account with a pairing token', id === 'kunde-mueller' && typeof (created?.pair as { token?: unknown })?.token === 'string');
check('backends with accounts hear of it, old ones not', !!(await desk.next((m) => m.type === 'account_added' && m.account === id)) && await none(old, (m) => m.type === 'account_added'));

const guest = await client({ pair: (created!.pair as { token: string }).token, name: 'Phone' });
check('pairing token signs in to the new account', guest.reply?.ok === true && (guest.reply.account as { id: string }).id === id);
const guestOpen = await desk.next((m) => m.type === 'client_open' && m.account === id);
check('client_open with the account to backends with accounts', !!guestOpen);
check('no client_open of another account to an old backend', await none(old, (m) => m.type === 'client_open' && m.account === id));
const guestCid = guestOpen?.cid as string;
const ownerCid = (await desk.next((m) => m.type === 'client_open' && m.account === 'main'))?.cid as string;

// Browser -> backend
guest.send({ type: 'e2e', iv: 'x', data: 'y', machine: 'desk' });
check('frame of the guest arrives with its account', !!(await desk.next((m) => m.cid === guestCid && m.account === id)));
guest.send({ type: 'e2e', iv: 'x', data: 'y', machine: 'old' });
check('to an old backend: refused as outdated', !!(await guest.next((m) => m.type === 'error' && m.code === 'machine_outdated')) && await none(old, (m) => m.cid === guestCid));
owner.send({ type: 'e2e', iv: 'x', data: 'y', machine: 'old' });
check('main still reaches the old backend', !!(await old.next((m) => !!m.cid)));

// Backend -> browsers
desk.send({ frame: { type: 'pong', tag: 'for-guest' }, account: id });
check('broadcast of an account reaches its devices', !!(await guest.next((m) => m.tag === 'for-guest')));
check('… and not the other account\'s', await none(owner, (m) => m.tag === 'for-guest'));
desk.send({ frame: { type: 'pong', tag: 'wrong-cid' }, cid: guestCid });
check('frame for a cid of another account is dropped', await none(guest, (m) => m.tag === 'wrong-cid'));
old.send({ frame: { type: 'pong', tag: 'from-old' }, account: id });
check('an old backend speaks for main only', !!(await owner.next((m) => m.tag === 'from-old')) && await none(guest, (m) => m.tag === 'from-old'));
desk.send({ frame: { type: 'pong', tag: 'main-cid' }, cid: ownerCid });
check('frame for a main cid without account arrives', !!(await owner.next((m) => m.tag === 'main-cid')));

// Backend -> backend
desk.send({ peer: { kind: 'e2e', iv: 'a', data: 'b' }, account: id });
check('sync of an account to backends with accounts', !!(await server.next((m) => m.type === 'peer' && m.account === id)));
check('… never to an old backend', await none(old, (m) => m.type === 'peer'));

// What the guest may do
guest.send({ type: 'devices' });
const devices = await guest.next((m) => m.type === 'devices');
check('devices: only those of the own account', ((devices?.list ?? []) as unknown[]).length === 1);
guest.send({ type: 'accounts' });
const own = await guest.next((m) => m.type === 'accounts');
check('accounts: only the own one', ((own?.list ?? []) as { id: string }[]).map((a) => a.id).join() === id && own?.current === id);
guest.send({ type: 'account_create', name: 'Sneaky' });
check('not an admin: cannot create accounts', !!(await guest.next((m) => m.type === 'error' && m.code === 'not_allowed' && m.request === 'account_create')));
guest.send({ type: 'account_update', id: 'main', name: 'Mine now' });
check('cannot rename another account', !!(await guest.next((m) => m.type === 'error' && m.request === 'account_update')));
guest.got.length = 0;
guest.send({ type: 'account_update', id, password: 'guest-password-0123' });
check('sets its own password', !!(await guest.next((m) => m.type === 'accounts')));
owner.send({ type: 'account_update', id, password: 'owner-sets-it-012345' }); // gitleaks:allow
check('an admin cannot set someone else\'s password', !!(await owner.next((m) => m.type === 'error' && m.request === 'account_update')));

// Password sign-in into an account
const byName = await client({ token: 'guest-password-0123', account: 'kunde müller' });
check('password with the account name: that account', byName.reply?.ok === true && (byName.reply.account as { id: string }).id === id);
const wrongAccount = await client({ token: 'guest-password-0123', account: 'nobody' });
check('unknown account: just a wrong password', wrongAccount.reply?.ok === false && wrongAccount.reply.code === 'wrong_password');
const mainWithGuest = await client({ token: 'guest-password-0123' });
check('the guest password does not open main', mainWithGuest.reply?.ok === false);
byName.ws.close();

// Pairing over HTTP for an account
const pair = (body?: object) => fetch(`${origin}/pair`, { method: 'POST', headers: { authorization: `Bearer ${AGENT}` }, body: body && JSON.stringify(body) });
check('pairing for an unknown account: 404', (await pair({ account: 'nobody' })).status === 404);
const pairGuest = (await (await pair({ account: id })).json()) as { token: string };
const second = await client({ pair: pairGuest.token, name: 'Laptop' });
check('pairing token of an account signs in there', (second.reply?.account as { id: string })?.id === id);
check('pairing without a body: main (older backends)', (await pair()).status === 200);

// New invitations, and main stays the owner's
guest.send({ type: 'account_invite', id });
check('not an admin: no invitations', !!(await guest.next((m) => m.type === 'error' && m.request === 'account_invite')));
owner.send({ type: 'account_invite', id });
const invite = await owner.next((m) => m.type === 'account_invite');
const third = await client({ pair: (invite?.pair as { token: string } | undefined)?.token ?? '', name: 'Tablet' });
check('a new invitation signs a device in to that account', (third.reply?.account as { id: string } | undefined)?.id === id);
third.ws.close();
owner.send({ type: 'account_invite', id: 'main' });
check('nobody gets an invitation into main', !!(await owner.next((m) => m.type === 'error' && m.request === 'account_invite')));
owner.send({ type: 'account_create', name: 'Boss', admin: true });
const bossCreated = await owner.next((m) => m.type === 'account_created' && (m.account as { id: string }).id === 'boss');
const boss = await client({ pair: (bossCreated?.pair as { token: string } | undefined)?.token ?? '' });
boss.send({ type: 'account_update', id: 'main', name: 'Taken over' });
check('another admin cannot change main', !!(await boss.next((m) => m.type === 'error' && m.request === 'account_update')));
boss.send({ type: 'account_invite', id: 'main' });
check('… nor invite into it', !!(await boss.next((m) => m.type === 'error' && m.request === 'account_invite')));
boss.send({ type: 'accounts' });
check('another admin sees all accounts', ((await boss.next((m) => m.type === 'accounts'))?.list as unknown[] ?? []).length === 3);
boss.ws.close();

// Deleting
owner.send({ type: 'account_delete', id: 'main' });
check('main cannot be deleted', !!(await owner.next((m) => m.type === 'error' && m.request === 'account_delete')));
owner.send({ type: 'account_delete', id });
check('admin deletes the account: its devices are disconnected', await Promise.race([guest.closed, new Promise<number>((r) => setTimeout(() => r(0), 2000))]) === 4004);
check('backends with accounts remove its data', !!(await desk.next((m) => m.type === 'account_deleted' && m.account === id)) && await none(old, (m) => m.type === 'account_deleted'));
const after = await client({ device: (guest.reply!.device as { token: string }).token });
check('the device key of a deleted account no longer works', after.reply?.ok === false && after.reply.loggedOut === true);
const ownerAgain = await client({ device: ownerKey });
check('main\'s device keeps working', ownerAgain.reply?.ok === true);

for (const s of [desk, server, old, owner, second, ownerAgain]) s.ws.close();
await relay.close();

// After a restart the tombstone reaches a backend that was asleep
const restarted = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
const late = connect(`ws://127.0.0.1:${restarted.port}/ws/agent`, { authorization: `Bearer ${AGENT}`, 'x-machine': 'late', 'x-accounts': '1' });
const hello = await late.next((m) => m.type === 'relay_hello');
check('hello after a restart names the deleted account', ((hello?.deletedAccounts ?? []) as string[]).includes(id!) && !((hello?.accounts ?? []) as string[]).includes(id!));
late.ws.close();
await restarted.close();

if (failed) process.exit(1);
console.log('all tests passed');
