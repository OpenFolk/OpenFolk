// Machines bound to an account by a setup link (bridge.ts): such a machine is someone else's. It serves its account
// only, nobody else's traffic or machine names reach it, what it sends for other accounts is dropped, and person
// chats and setups cross the line only through the person route. Backends and browsers are stand-ins.
//   node relay/src/bridge-bound.test.ts
import { Bridge } from './bridge.ts';
import { reaches, type AgentInbound, type Person, type ServerFrame } from '../../shared/protocol.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failed++;
};

function fakeSocket<T>() {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const received: T[] = [];
    let closed = 0;
    const ws = {
        OPEN: 1, readyState: 1, bufferedAmount: 0,
        on: (event: string, fn: (...args: unknown[]) => void) => { (handlers[event] = handlers[event] ?? []).push(fn); },
        once: () => undefined, off: () => undefined,
        send: (raw: string) => { received.push(JSON.parse(raw) as T); },
        close: () => { closed++; }, terminate: () => undefined, ping: () => undefined,
    };
    const send = (data: unknown) => (handlers.message ?? []).forEach((fn) => fn(Buffer.from(JSON.stringify(data))));
    return { ws, received, send, closed: () => closed };
}

const people: Person[] = [
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'anna', name: 'Anna', admin: false, reach: 'all' },
    { id: 'kunde', name: 'Kunde', admin: false, reach: 'listed', contacts: ['main'] },
    { id: 'other', name: 'Other', admin: false, reach: 'all' },
];
const setupBy: Record<string, string> = { kunde: 'main' };
const bridge = new Bridge(() => undefined);
bridge.accountList = () => ({ ids: people.map((p) => p.id), deleted: [], people });
bridge.setupBy = (id) => setupBy[id];
bridge.mayRoute = (from, to) => {
    const a = people.find((p) => p.id === from)!;
    const b = people.find((p) => p.id === to)!;
    return reaches(a, b) || setupBy[to] === from || setupBy[from] === to;
};
bridge.boundMachines = () => new Map([['laptop', 'kunde']]);

const desk = fakeSocket<AgentInbound>();
await bridge.connectAgent(desk.ws as never, '203.0.113.9', 'desk', true);
const laptop = fakeSocket<AgentInbound>();
await bridge.connectAgent(laptop.ws as never, '198.51.100.7', 'laptop', true, 'kunde');

const of = <T extends string>(list: AgentInbound[], type: T) => list.filter((m): m is Extract<AgentInbound, { type: T }> => 'type' in m && m.type === type);

const deskHello = of(desk.received, 'relay_hello')[0];
check('an unbound machine is not told of the account set up', !!deskHello && !deskHello.accounts?.includes('kunde') && deskHello.accounts?.includes('anna') === true, deskHello);
const hello = of(laptop.received, 'relay_hello')[0];
check('the bound machine serves its account only and knows its admin', hello?.accounts?.join() === 'kunde' && hello.bound === 'kunde' && hello.setupBy === 'main', hello);
check('the bound machine hears only of the people its account reaches, without their contacts',
    hello?.people?.map((p) => p.id).sort().join() === 'kunde,main' && hello.people.every((p) => p.id === 'kunde' || !p.contacts), hello?.people);
check('each machine sees only machines of its own kind',
    of(desk.received, 'agents').at(-1)?.online.join() === 'desk' && of(laptop.received, 'agents').at(-1)?.online.join() === 'laptop',
    [of(desk.received, 'agents').at(-1), of(laptop.received, 'agents').at(-1)]);

// Browsers: one of 'main', one of the customer
const mainBrowser = fakeSocket<ServerFrame>();
bridge.connectClient(mainBrowser.ws as never, '203.0.113.20', 'dev-main', 'main');
const kundeBrowser = fakeSocket<ServerFrame>();
const kundeCid = bridge.connectClient(kundeBrowser.ws as never, '198.51.100.20', 'dev-kunde', 'kunde');
const agentsOf = (list: ServerFrame[]) => list.findLast((f): f is Extract<ServerFrame, { type: 'agents' }> => f.type === 'agents');
check('the customer\'s browser sees only the bound machine', agentsOf(kundeBrowser.received)?.online.join() === 'laptop', agentsOf(kundeBrowser.received));
check('the owner\'s browser does not see the bound machine', agentsOf(mainBrowser.received)?.online.join() === 'desk', agentsOf(mainBrowser.received));
check('only the bound machine hears of the customer\'s browser',
    !desk.received.some((m) => 'cid' in m && m.cid === kundeCid) && laptop.received.some((m) => 'type' in m && m.type === 'client_open' && m.cid === kundeCid));

// Frames of the customer's browser go to the bound machine, never to another one, even when named
kundeBrowser.send({ type: 'ping', machine: 'desk' });
check('a frame of the customer naming another machine is refused like a missing one',
    kundeBrowser.received.some((f) => f.type === 'error' && 'code' in f && f.code === 'machine_not_connected') && !desk.received.some((m) => 'frame' in m));
kundeBrowser.send({ type: 'ping' });
check('a frame of the customer without a machine goes to the bound machine', laptop.received.some((m) => 'frame' in m && m.account === 'kunde'));
mainBrowser.send({ type: 'ping', machine: 'laptop' });
check('the owner cannot reach the bound machine', !laptop.received.some((m) => 'frame' in m && m.account !== 'kunde'));

// What the bound machine sends for other accounts is dropped
const mainBefore = mainBrowser.received.length;
laptop.send({ frame: { type: 'pong' } });
laptop.send({ frame: { type: 'pong' }, account: 'anna' });
laptop.send({ peer: { kind: 'keys_request' } });
check('frames and sync of the bound machine for other accounts go nowhere',
    mainBrowser.received.length === mainBefore && !desk.received.some((m) => 'type' in m && m.type === 'peer'));
laptop.send({ frame: { type: 'pong' }, account: 'kunde' });
check('its own account\'s frames reach that account\'s browsers', kundeBrowser.received.some((f) => f.type === 'pong' && f.machine === 'laptop'));
desk.send({ peer: { kind: 'keys_request' }, account: 'kunde' });
check('an unbound machine cannot sync into the account set up', !laptop.received.some((m) => 'type' in m && m.type === 'peer'));

// Person route
desk.send({ person: { kind: 'setup_request' }, from: 'main', to: 'kunde', id: 'p1' });
check('person route: the admin reaches the customer\'s machine',
    of(laptop.received, 'person').some((m) => m.from === 'main' && m.to === 'kunde') && of(desk.received, 'person_result').at(-1)?.ok === true);
laptop.send({ person: { kind: 'setup_request' }, from: 'kunde', to: 'main', id: 'p2' });
check('person route: the customer reaches the admin', of(desk.received, 'person').some((m) => m.from === 'kunde') && of(laptop.received, 'person_result').at(-1)?.ok === true);
laptop.send({ person: { kind: 'setup_request' }, from: 'kunde', to: 'anna', id: 'p3' });
check('person route: not to an account the customer does not list', !of(desk.received, 'person').some((m) => m.to === 'anna') && of(laptop.received, 'person_result').at(-1)?.ok === false);
laptop.send({ person: { kind: 'setup_request' }, from: 'main', to: 'anna', id: 'p4' });
check('person route: the bound machine cannot speak for another account', !of(desk.received, 'person').some((m) => m.from === 'main'));

// Deleting the account reaches its machine; a new account is not offered to it
bridge.accountAdded('neu');
check('a new account is not offered to the bound machine', !of(laptop.received, 'account_added').length && of(desk.received, 'account_added').length === 1);
bridge.accountDeleted('kunde');
check('the bound machine hears its account was deleted', of(laptop.received, 'account_deleted').some((m) => m.account === 'kunde'));

// An old backend bound to an account is turned away: it would take the account for 'main'
const old = fakeSocket<AgentInbound>();
await bridge.connectAgent(old.ws as never, '198.51.100.8', 'old', false, 'kunde');
check('a bound machine without accounts is rejected', old.closed() === 1 && !old.received.length);

if (failed) process.exit(1);
console.log('all bound machine tests passed');
