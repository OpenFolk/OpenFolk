// Connects the browsers with the backends of the user's machines (one per machine).
// Stores no messages; each one is only passed through. The only thing recorded permanently is when a backend
// was last connected (machines-seen.ts).
//
// Browser -> backend: to the machine in `machine`, otherwise to the alphabetically first machine awake.
// Backend -> browser: the relay inserts the machine's name into the frame (`machine`).
// Backend -> backend: `{ peer, to? }` goes to one or all other machines (sync, jobs).
// With end-to-end encryption, frames and sync are of type 'e2e'; the relay then only sees the routing.
//
// Every browser belongs to an account (accounts.ts) and sees only that account's frames. A backend serves every
// account if it signs in with X-Accounts: 1; an older one does not know the field and would take everything for its
// own data, so it gets the traffic of 'main' only.

import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { MAIN } from './accounts.ts';
import type { MachinesSeen } from './machines-seen.ts';
import type {
    AgentInbound, AgentOutbound, ClientFrame, ClientMessage, E2eFrame, NativePushChannel, NativePushMessage, NativePushSubscription, PairBox,
    RelayRequest, ServerFrame, WakeEntry,
} from '../../shared/protocol.ts';

/** After this many minutes a woken machine that connects no longer counts as "just woken". */
const WAKE_WINDOW_MIN = 15;
/** How long an existing connection may take to answer a ping before it counts as dead. */
const DUPLICATE_CHECK_MS = 5_000;
/** The same security warning at most this often as a push. */
const WARNING_INTERVAL_MS = 10 * 60_000;

const RELAY_REQUESTS = new Set<string>(['wake_status', 'wake', 'devices', 'device_logout', 'accounts', 'account_create', 'account_update', 'account_delete', 'account_invite', 'pair_request', 'pair_approve', 'totp_status', 'totp_begin', 'totp_confirm', 'totp_off', 'machine_tokens', 'machine_token_remove']);

export type WarningCode = Extract<AgentInbound, { type: 'warning' }>['code'];

export interface ClientContext {
    device: string;
    account: string;
}

export type RelayRequestHandler = (request: RelayRequest, reply: (f: ServerFrame) => void, context: ClientContext) => void;

interface Client {
    ws: WebSocket;
    device: string;
    account: string;
}

interface Agent {
    ws: WebSocket;
    /** Signed in with X-Accounts: 1, so it keeps accounts apart. */
    accounts: boolean;
}

/** Bytes waiting for a client before the relay gives up on it: a few file downloads (20 MB each, base64). */
const MAX_BUFFERED = 96 * 1024 * 1024;

export class Bridge {
    private clients = new Map<string, Client>();
    private agents = new Map<string, Agent>();
    /** Machines just woken: since when and for which routines (empty = woken from the app). */
    private woken = new Map<string, { since: number; routines: { id: string; at: string }[] }>();
    /** Wake schedule of a backend (routines with `wake`), see wake-schedule.ts. */
    onWakeSchedule: (schedule: WakeEntry[]) => void = () => undefined;
    /**
     * Push to the apps on behalf of a backend without APNs/FCM credentials (server.ts wires push-native.ts in).
     * `pushChannels` is what the relay tells every backend on connect; empty = the relay cannot deliver.
     */
    pushChannels: NativePushChannel[] = [];
    onPush: (subscriptions: NativePushSubscription[], message: NativePushMessage) => Promise<NativePushSubscription[]> = async () => [];
    /** A backend's answer to "first_device" (relay.ts passes the box to the waiting device). */
    onFirstDevice: (id: string, box: PairBox | undefined, error: string | undefined) => void = () => undefined;
    /** The accounts there are and the deleted ones, for the hello of a backend that knows accounts. */
    accountList: () => { ids: string[]; deleted: string[] } = () => ({ ids: [MAIN], deleted: [] });
    private lastWarning = new Map<string, number>();
    private relayRequest: RelayRequestHandler;
    private seen?: MachinesSeen;
    constructor(relayRequest: RelayRequestHandler, seen?: MachinesSeen) {
        this.relayRequest = relayRequest;
        this.seen = seen;
    }

    /** Records the connected machines as seen (the relay calls this every minute). */
    recordSeen(): void {
        this.seen?.record(this.online());
    }

    online(): string[] {
        return [...this.agents.keys()].sort();
    }

    /** Asks one backend of the main account to sign in a first device; false when none is connected. */
    firstDevice(id: string, pk: string): boolean {
        const agent = [...this.agents.values()][0];
        if (!agent) return false;
        this.toAgent(agent.ws, { type: 'first_device', id, pk });
        return true;
    }

    get agentOnline(): boolean {
        return this.agents.size > 0;
    }

    /** Remembers that a machine was just woken; if it connects soon, its backend is told. */
    markWoken(host: string, routines: { id: string; at: string }[] = []): void {
        // If the backend was already connected, the machine was running already; nothing to report then
        if (this.agents.has(host)) return;
        const old = this.woken.get(host);
        this.woken.set(host, { since: Date.now(), routines: [...(old?.routines ?? []), ...routines] });
    }

    /**
     * Security warning to a machine (as push), by default the first one awake that serves the account. The backend
     * renders it in the user's language. `throttleKey` limits the same kind of warning to one push every 10 minutes.
     */
    warn(code: WarningCode, params: Record<string, string>, to?: string, throttleKey = `${code}:${JSON.stringify(params)}`, account = MAIN): void {
        this.log(`Warning ${code} ${JSON.stringify(params)}${account === MAIN ? '' : ` (account ${account})`}`);
        const last = this.lastWarning.get(throttleKey) ?? 0;
        if (Date.now() - last < WARNING_INTERVAL_MS) return;
        this.lastWarning.set(throttleKey, Date.now());
        const target = to ?? this.online().find((m) => serves(this.agents.get(m)!, account));
        const agent = target ? this.agents.get(target) : undefined;
        if (agent && serves(agent, account)) this.toAgent(agent.ws, { type: 'warning', code, params, ...(account === MAIN ? {} : { account }) });
    }

    /** Disconnects the backend of a machine whose token was removed. */
    disconnectAgent(machine: string): boolean {
        const agent = this.agents.get(machine);
        if (!agent) return false;
        agent.ws.close(4004, 'Machine logged out');
        return true;
    }

    /** Disconnects all browsers of a logged-out device immediately. */
    disconnectDevice(device: string): number {
        let n = 0;
        for (const c of this.clients.values()) {
            if (c.device === device) {
                c.ws.close(4004, 'Device logged out');
                n++;
            }
        }
        return n;
    }

    /** A new account: the backends start serving it. */
    accountAdded(account: string): void {
        for (const a of this.agents.values()) if (a.accounts) this.toAgent(a.ws, { type: 'account_added', account });
    }

    /** A deleted account: its browsers are disconnected, the backends remove its data. */
    accountDeleted(account: string): void {
        for (const c of this.clients.values()) if (c.account === account) c.ws.close(4004, 'Account deleted');
        for (const a of this.agents.values()) if (a.accounts) this.toAgent(a.ws, { type: 'account_deleted', account });
    }

    private log(text: string): void {
        console.log(`${new Date().toISOString()} ${text}`);
    }

    /** Push for the apps from a backend: only to channels the relay has credentials for, at most 100 devices. */
    private forwardPush(ws: WebSocket, machine: string, push: unknown): void {
        const p = push as { subscriptions?: unknown; message?: Partial<NativePushMessage> } | null;
        const m = p?.message;
        if (!p || !Array.isArray(p.subscriptions) || !m || typeof m.title !== 'string' || typeof m.url !== 'string') return;
        const subscriptions = p.subscriptions.filter((s): s is NativePushSubscription =>
            !!s && typeof s === 'object' && this.pushChannels.includes((s as NativePushSubscription).channel)
            && typeof (s as NativePushSubscription).token === 'string').slice(0, 100);
        if (!subscriptions.length) return;
        const priority = m.priority === 'quiet' || m.priority === 'high' ? m.priority : 'normal';
        const message: NativePushMessage = {
            title: m.title.slice(0, 200), body: typeof m.body === 'string' ? m.body.slice(0, 500) : '', url: m.url.slice(0, 500),
            ...(typeof m.tag === 'string' ? { tag: m.tag.slice(0, 64) } : {}), priority,
            ttlSeconds: typeof m.ttlSeconds === 'number' ? Math.min(Math.max(60, m.ttlSeconds), 7 * 24 * 3600) : 3600,
        };
        this.onPush(subscriptions, message).then(
            (gone) => { if (gone.length) this.toAgent(ws, { type: 'push_result', gone }); },
            (e: Error) => this.log(`Push for ${machine} failed: ${e.message}`),
        );
    }

    private toClient(ws: WebSocket, frame: ServerFrame): void {
        if (ws.readyState !== ws.OPEN) return;
        // A client that does not read (phone in a dead spot) would let the send buffer grow without end; it reconnects
        // and gets the current state again
        if (ws.bufferedAmount > MAX_BUFFERED) {
            this.log(`client not reading (${Math.round(ws.bufferedAmount / 1048576)} MB waiting), connection dropped`);
            ws.terminate();
            return;
        }
        ws.send(JSON.stringify(frame));
    }

    private toAgent(ws: WebSocket | undefined, data: AgentInbound): void {
        if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
    }

    private toAllClients(frame: ServerFrame, account?: string): void {
        for (const c of this.clients.values()) if (account === undefined || c.account === account) this.toClient(c.ws, frame);
    }

    /** To every other backend that serves the account; without one to all. */
    private toAllAgents(data: AgentInbound, except?: string, account?: string): void {
        for (const [name, a] of this.agents) if (name !== except && (account === undefined || serves(a, account))) this.toAgent(a.ws, data);
    }

    private announceOnline(): void {
        const online = this.online();
        this.toAllClients(this.agentsFrame());
        this.toAllAgents({ type: 'agents', online });
    }

    private agentsFrame(): ServerFrame {
        const online = this.online();
        return { type: 'agents', online, gone: this.seen?.gone(online) ?? {} };
    }

    /** Does the connection answer a ping within a short time? */
    private isAlive(ws: WebSocket): Promise<boolean> {
        if (ws.readyState !== ws.OPEN) return Promise.resolve(false);
        return new Promise((resolve) => {
            const timer = setTimeout(() => { ws.off('pong', pong); resolve(false); }, DUPLICATE_CHECK_MS);
            const pong = () => { clearTimeout(timer); resolve(true); };
            ws.once('pong', pong);
            ws.ping();
        });
    }

    /**
     * A machine name may be connected only once. If the existing connection is still alive, the new one is
     * rejected and the real machine is warned – otherwise anyone with AGENT_TOKEN could pose as that machine and
     * intercept its messages. A dead connection (network loss) is replaced.
     */
    async connectAgent(ws: WebSocket, ip: string, machine: string, accounts = false): Promise<void> {
        const old = this.agents.get(machine);
        if (old) {
            if (await this.isAlive(old.ws)) {
                this.log(`Agent ${machine}: second sign-in from ${ip} rejected, the connected machine answers`);
                ws.close(4009, 'Machine name is already connected');
                this.warn('duplicate_agent', { machine, ip }, machine, `duplicate:${machine}`);
                return;
            }
            this.log(`Agent ${machine}: old connection no longer answers, replacing it`);
            this.agents.delete(machine);
            old.ws.terminate();
        }
        if (ws.readyState !== ws.OPEN) return;
        const agent: Agent = { ws, accounts };
        this.agents.set(machine, agent);
        this.seen?.record([machine]);
        this.log(`Agent ${machine} connected from ${ip}${accounts ? '' : ' (without accounts, serves main only)'} (${this.online().join(', ')})`);
        const list = this.accountList();
        this.toAgent(ws, accounts
            ? { type: 'relay_hello', pushChannels: this.pushChannels, accounts: list.ids, deletedAccounts: list.deleted }
            : { type: 'relay_hello', pushChannels: this.pushChannels });
        this.announceOnline();
        for (const [cid, c] of this.clients) if (serves(agent, c.account)) this.toAgent(ws, { type: 'client_open', cid, account: c.account });
        const w = this.woken.get(machine);
        if (w && Date.now() - w.since < WAKE_WINDOW_MIN * 60_000) {
            this.toAgent(ws, w.routines.length ? { type: 'woken', routines: w.routines } : { type: 'woken' });
        }
        this.woken.delete(machine);

        ws.on('message', (raw) => {
            let a: AgentOutbound | LegacyAgentOutbound;
            try {
                a = JSON.parse(raw.toString()) as AgentOutbound | LegacyAgentOutbound;
            } catch {
                return;
            }
            if ('wakeSchedule' in a) {
                this.onWakeSchedule(a.wakeSchedule);
                return;
            }
            // Backends before the English protocol send `weckplan` (mapped in wake-schedule.ts)
            if ('weckplan' in a) {
                this.onWakeSchedule(a.weckplan as WakeEntry[]);
                return;
            }
            // A backend without accounts speaks for 'main' whatever it sends
            const account = accounts && 'account' in a && typeof a.account === 'string' ? a.account : MAIN;
            if ('peer' in a) {
                const inbound: AgentInbound = { type: 'peer', from: machine, data: a.peer, ...(account === MAIN ? {} : { account }) };
                const to = 'to' in a ? a.to : 'an' in a ? a.an : undefined;
                if (to) {
                    const target = this.agents.get(to);
                    if (target && serves(target, account)) this.toAgent(target.ws, inbound);
                } else this.toAllAgents(inbound, machine, account);
                return;
            }
            if ('push' in a) {
                this.forwardPush(ws, machine, a.push);
                return;
            }
            if ('firstDevice' in a) {
                // Only for the main account: its first device is the one this answers
                if (account === MAIN && a.firstDevice && typeof a.firstDevice.id === 'string') this.onFirstDevice(a.firstDevice.id, a.firstDevice.box, a.firstDevice.error);
                return;
            }
            if (!('frame' in a) || !a.frame) return;
            const frame = { ...a.frame, machine } as ServerFrame;
            if (a.cid) {
                const target = this.clients.get(a.cid);
                if (target && target.account === account) this.toClient(target.ws, frame);
            } else {
                this.toAllClients(frame, account);
            }
        });
        ws.on('close', () => {
            if (this.agents.get(machine) !== agent) return;
            this.agents.delete(machine);
            this.seen?.record([machine]);
            this.log(`Agent ${machine} disconnected`);
            this.announceOnline();
        });
    }

    connectClient(ws: WebSocket, ip: string, device: string, account = MAIN): string {
        const cid = randomUUID();
        this.clients.set(cid, { ws, device, account });
        this.log(`Browser ${cid.slice(0, 8)} (device ${device}${account === MAIN ? '' : `, account ${account}`}) signed in from ${ip} (${this.clients.size} connected)`);
        this.toClient(ws, this.agentsFrame());
        this.toAllAgents({ type: 'client_open', cid, account }, undefined, account);

        ws.on('message', (raw) => {
            let n: ClientMessage | RelayRequest;
            try {
                n = JSON.parse(raw.toString()) as ClientMessage | RelayRequest;
            } catch {
                return;
            }
            if (RELAY_REQUESTS.has(n.type)) {
                this.relayRequest(n as RelayRequest, (f) => this.toClient(ws, f), { device, account });
                return;
            }
            // `rechner`: web apps still cached from before the English protocol
            const { machine: m, rechner, ...frame } = n as ClientMessage & { rechner?: string };
            const machine = m ?? rechner;
            const name = machine ?? this.online().find((x) => serves(this.agents.get(x)!, account)) ?? this.online()[0] ?? '';
            const target = this.agents.get(name);
            if (!target) {
                this.toClient(ws, machine
                    // `machine` names the missing machine, so the web app can render the code with it
                    ? { type: 'error', code: 'machine_not_connected', message: `${machine.toUpperCase()} is not connected.`, machine }
                    : { type: 'error', code: 'no_machine_connected', message: 'No machine is connected.' });
                return;
            }
            if (!serves(target, account)) {
                this.toClient(ws, { type: 'error', code: 'machine_outdated', message: `${name.toUpperCase()} runs an OpenFolk without accounts.`, machine: name });
                return;
            }
            this.toAgent(target.ws, { cid, frame: frame as ClientFrame | E2eFrame, account });
        });
        ws.on('close', () => {
            this.clients.delete(cid);
            this.toAllAgents({ type: 'client_close', cid, account }, undefined, account);
        });
        return cid;
    }
}

function serves(agent: Agent, account: string): boolean {
    return account === MAIN || agent.accounts;
}

/** Outbound messages of backends from before the English protocol (still accepted during the transition). */
type LegacyAgentOutbound =
    | { weckplan: unknown }
    | { peer: Extract<AgentOutbound, { peer: unknown }>['peer']; an?: string };
