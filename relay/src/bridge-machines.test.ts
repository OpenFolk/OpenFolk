// The machines an account runs on (bridge.ts, Accounts.runsOn): an admin ticks which of the relay's own machines serve
// an account. A machine not ticked is not told of the account and its browsers do not see it; a change reaches the
// machines as account_added and account_released and the browsers as a new machine list. Stand-ins for both sides.
//   node relay/src/bridge-machines.test.ts
import { Bridge } from './bridge.ts';
import type { AgentInbound, Person, ServerFrame } from '../../shared/protocol.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failed++;
};

function fakeSocket<T>() {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const received: T[] = [];
    const ws = {
        OPEN: 1, readyState: 1, bufferedAmount: 0,
        on: (event: string, fn: (...args: unknown[]) => void) => { (handlers[event] = handlers[event] ?? []).push(fn); },
        once: () => undefined, off: () => undefined,
        send: (raw: string) => { received.push(JSON.parse(raw) as T); },
        close: () => undefined, terminate: () => undefined, ping: () => undefined,
    };
    const send = (data: unknown) => (handlers.message ?? []).forEach((fn) => fn(Buffer.from(JSON.stringify(data))));
    return { ws, received, send };
}

const people: Person[] = [
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'erik', name: 'Erik', admin: false, reach: 'all' },
    { id: 'kunde', name: 'Kunde', admin: false, reach: 'admins' },
];
/** As in accounts.json: Erik on desk only, the customer set up on a computer of its own and on server too. */
const machinesOf: Record<string, string[] | undefined> = { erik: ['desk'], kunde: ['server'] };
const bridge = new Bridge(() => undefined);
bridge.accountList = () => ({ ids: people.map((p) => p.id), deleted: [], people });
bridge.setupBy = (id) => (id === 'kunde' ? 'main' : undefined);
bridge.runsOn = (id, machine) => id === 'main' || (machinesOf[id] ? machinesOf[id]!.includes(machine) : true);
bridge.boundMachines = () => new Map([['laptop', 'kunde']]);

const of = <T extends string>(list: AgentInbound[], type: T) => list.filter((m): m is Extract<AgentInbound, { type: T }> => 'type' in m && m.type === type);
const agentsOf = (list: ServerFrame[]) => list.findLast((f): f is Extract<ServerFrame, { type: 'agents' }> => f.type === 'agents');

const desk = fakeSocket<AgentInbound>();
await bridge.connectAgent(desk.ws as never, '203.0.113.9', 'desk', true);
const server = fakeSocket<AgentInbound>();
await bridge.connectAgent(server.ws as never, '203.0.113.10', 'server', true);
const laptop = fakeSocket<AgentInbound>();
await bridge.connectAgent(laptop.ws as never, '198.51.100.7', 'laptop', true, 'kunde');

check('a ticked machine serves the account', of(desk.received, 'relay_hello')[0]?.accounts?.join() === 'main,erik', of(desk.received, 'relay_hello')[0]?.accounts);
check('one not ticked is not told of it', of(server.received, 'relay_hello')[0]?.accounts?.join() === 'main,kunde', of(server.received, 'relay_hello')[0]?.accounts);
check('the bound machine serves its account only, whatever else the account runs on', of(laptop.received, 'relay_hello')[0]?.accounts?.join() === 'kunde');

const erik = fakeSocket<ServerFrame>();
const erikCid = bridge.connectClient(erik.ws as never, '203.0.113.30', 'dev-erik', 'erik');
const kunde = fakeSocket<ServerFrame>();
bridge.connectClient(kunde.ws as never, '198.51.100.30', 'dev-kunde', 'kunde');
const main = fakeSocket<ServerFrame>();
bridge.connectClient(main.ws as never, '203.0.113.20', 'dev-main', 'main');
check('the account\'s browsers see the ticked machines only', agentsOf(erik.received)?.online.join() === 'desk', agentsOf(erik.received));
check('an account set up sees its own computer and the machines ticked for it', agentsOf(kunde.received)?.online.join() === 'laptop,server', agentsOf(kunde.received));
check('main sees every machine of the relay, none bound', agentsOf(main.received)?.online.join() === 'desk,server', agentsOf(main.received));
check('only the ticked machine hears of the account\'s browser',
    desk.received.some((m) => 'type' in m && m.type === 'client_open' && m.cid === erikCid) && !server.received.some((m) => 'cid' in m && m.cid === erikCid));

erik.send({ type: 'ping', machine: 'server' });
check('a frame to a machine not ticked is refused like a missing one',
    erik.received.some((f) => f.type === 'error' && 'code' in f && f.code === 'machine_not_connected') && !server.received.some((m) => 'frame' in m));
server.send({ peer: { type: 'sync' }, account: 'erik' });
server.send({ frame: { type: 'pong' }, account: 'erik' });
check('a machine not ticked cannot sync into the account or speak for it',
    !desk.received.some((m) => 'type' in m && m.type === 'peer') && !erik.received.some((f) => f.type === 'pong'));

// The admin moves Erik from desk to server
const before = bridge.servedBy('erik');
check('servedBy names the machines awake that serve it', [...before].join() === 'desk');
machinesOf.erik = ['server'];
bridge.accountMachinesChanged('erik', before);
check('the machine no longer ticked lets go of the account', of(desk.received, 'account_released').some((m) => m.account === 'erik'));
check('the machine ticked now starts serving it', of(server.received, 'account_added').some((m) => m.account === 'erik'));
check('the bound machine hears nothing of it', !laptop.received.some((m) => 'type' in m && (m.type === 'account_added' || m.type === 'account_released')));
check('the account\'s browsers get the new machine list', agentsOf(erik.received)?.online.join() === 'server', agentsOf(erik.received));

// Back to every machine (no choice): desk serves it again, server keeps it
const again = bridge.servedBy('erik');
machinesOf.erik = undefined;
bridge.accountMachinesChanged('erik', again);
check('every machine again: the one without it is added, none released',
    of(desk.received, 'account_added').some((m) => m.account === 'erik') && of(server.received, 'account_released').length === 0);
check('… and the browsers see both', agentsOf(erik.received)?.online.join() === 'desk,server', agentsOf(erik.received));

// A new account follows its choice too
machinesOf.neu = ['server'];
bridge.accountAdded('neu');
check('a new account is offered to the ticked machines only',
    of(server.received, 'account_added').some((m) => m.account === 'neu') && !of(desk.received, 'account_added').some((m) => m.account === 'neu'));

console.log(failed ? `${failed} test(s) FAILED` : 'all machine choice tests passed');
process.exit(failed ? 1 : 0);
