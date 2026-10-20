// Outgoing WebSocket connection to the relay with reconnecting.
// The backend signs in with its machine name (header X-Machine) and X-Accounts: 1, so the relay sends it every
// account and not only 'main'. Inbound traffic goes to the handler of its account (accounts.ts).
//
// Relay -> backend:  AgentInbound (browser frames, client_open/close, machines awake, sync, woken, warnings)
// Backend -> relay:  AgentOutbound ({ frame, cid? } to browsers, { peer, to? } to other backends, { wakeSchedule })
// With E2E_KEY frames and sync are encrypted (e2e.ts); unencrypted browser frames are then not processed, the
// browser gets 'e2e_required'. Encrypted frames the relay delivers a second time are dropped (ReplayError).

import WebSocket from 'ws';
import { config } from './config.ts';
import { agentToken, clientToken } from './tokens.ts';
import { decrypt, e2eEnabled, encrypt, ReplayError } from './e2e.ts';
import { checkPeerData } from './frames.ts';
import { t } from './i18n.ts';
import { migratePeerData } from './migrate.ts';
import { DEFAULT_ACCOUNT, inAccount } from './store.ts';
import type {
    AgentFrame, AgentInbound, AgentOutbound, ClientFrame, E2eFrame, NativePushChannel, NativePushMessage, NativePushSubscription, PairBox, PeerData,
    WakeEntry,
} from '../../shared/protocol.ts';

export type WarningCode = Extract<AgentInbound, { type: 'warning' }>['code'];

export interface RelayHandler {
    handle(frame: ClientFrame, cid: string): void;
    greet(cid: string): void;
    leave(cid: string): void;
    /** `fromRelay` false: the connection is gone and the list holds only this machine. */
    updateAgents(online: string[], fromRelay?: boolean): void;
    peerInbound(from: string, data: PeerData): void;
    woken(routines?: { id: string; at: string }[]): void;
    warning(code: WarningCode, params: Record<string, string>): void;
    /** The relay reports app device tokens the push services no longer know. */
    pushGone(gone: NativePushSubscription[]): void;
}

/** The handler of one account: every call runs in that account's context (store.ts). */
export function accountHandler(account: string, h: RelayHandler): RelayHandler {
    return {
        handle: (frame, cid) => inAccount(account, () => h.handle(frame, cid)),
        greet: (cid) => inAccount(account, () => h.greet(cid)),
        leave: (cid) => inAccount(account, () => h.leave(cid)),
        updateAgents: (online, fromRelay) => inAccount(account, () => h.updateAgents(online, fromRelay)),
        peerInbound: (from, data) => inAccount(account, () => h.peerInbound(from, data)),
        woken: (routines) => inAccount(account, () => h.woken(routines)),
        warning: (code, params) => inAccount(account, () => h.warning(code, params)),
        pushGone: (gone) => inAccount(account, () => h.pushGone(gone)),
    };
}

/** The handlers of the accounts this machine serves (accounts.ts). */
export interface AccountRouter {
    /** The handler of an account; null when this machine does not serve it. */
    handler(account: string): RelayHandler | null;
    all(): RelayHandler[];
    /** The relay's accounts after connecting; null for a relay without accounts. */
    hello(accounts: string[] | null, deleted: string[]): void;
    added(account: string): void;
    deleted(account: string): void;
}

/** This long an answer to a browser is kept across a connection gap. */
const KEEP_MS = 3 * 60_000;
const PING_MS = 25_000;

export class RelayClient {
    private ws: WebSocket | null = null;
    private retryDelay = 1000;
    private stopped = false;
    private pingTimer: NodeJS.Timeout | null = null;
    private router: AccountRouter | null = null;
    /** Last reported wake schedule per account; the relay gets them together and again after every reconnect. */
    private schedules = new Map<string, WakeEntry[]>();
    /** Answers to browsers that came up during a connection gap. */
    private waiting: { data: AgentOutbound; until: number }[] = [];
    /** Browsers whose frames without a replay guard or with a wrong clock were reported already (`cid:reason`). */
    private reported = new Set<string>();
    /** App push channels the relay delivers to for us (from its hello); empty until connected or for old relays. */
    relayPushChannels: NativePushChannel[] = [];
    /** Called on every successful connection (index.ts: the first one prints the pairing link). */
    onConnected: () => void = () => undefined;
    /** A waiting device asks to be the main account's first device (first-device.ts); null: no code here. */
    onFirstDevice: (id: string, pk: string) => Promise<PairBox | null> = async () => null;
    /** The relay answered 503 once already: it is unclaimed, the hint went to the log. */
    private unclaimedReported = false;

    /** HTTP address of the relay (RELAY_URL points at its agent socket). */
    static origin(): string {
        const u = new URL(config.relayUrl);
        u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
        return u.origin;
    }

    /**
     * Mints a one-time pairing token for a device of the account at the relay (POST /pair with AGENT_TOKEN). `origin`:
     * another relay than the current one (one just claimed from the app, relay-switch.ts).
     */
    static async createPairing(account: string, origin = RelayClient.origin()): Promise<{ token: string; expiresAt: string }> {
        const r = await fetch(`${origin}/pair`, {
            method: 'POST', headers: { authorization: `Bearer ${agentToken()}`, 'content-type': 'application/json' },
            body: JSON.stringify({ account }), signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`relay answered ${r.status}${r.status === 404 ? ' (relay too old for pairing links)' : ''}`);
        const j = (await r.json()) as { token?: unknown; expiresAt?: unknown };
        if (typeof j.token !== 'string' || typeof j.expiresAt !== 'string') throw new Error('relay answered without a token');
        return { token: j.token, expiresAt: j.expiresAt };
    }

    /** Mints a one-time invitation for one more machine at the relay (POST /machine-invite with the agent token). */
    static async createMachineInvite(): Promise<{ token: string; expiresAt: string }> {
        const r = await fetch(`${RelayClient.origin()}/machine-invite`, {
            method: 'POST', headers: { authorization: `Bearer ${agentToken()}` }, signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`relay answered ${r.status}${r.status === 404 ? ' (relay too old for invitations)' : ''}`);
        const j = (await r.json()) as { token?: unknown; expiresAt?: unknown };
        if (typeof j.token !== 'string' || typeof j.expiresAt !== 'string') throw new Error('relay answered without a token');
        return { token: j.token, expiresAt: j.expiresAt };
    }

    /**
     * Claims an unclaimed relay with RELAY_SETUP_CODE (relay and backend started together, docker-compose.server.yml):
     * the same as `npm run claim`, without a step by hand. Returns the relay's answer for the log.
     */
    static async claim(code: string, origin = RelayClient.origin()): Promise<string> {
        const r = await fetch(`${origin}/claim`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({ code, agentToken: agentToken(), clientToken: clientToken() }),
        });
        if (r.ok) return 'ok';
        const j = (await r.json().catch(() => ({}))) as { error?: unknown };
        return typeof j.error === 'string' ? j.error : `status ${r.status}`;
    }

    /** Hands a notification for the apps to the relay; false if not connected. */
    pushViaRelay(subscriptions: NativePushSubscription[], message: NativePushMessage): boolean {
        if (this.ws?.readyState !== WebSocket.OPEN || !subscriptions.length) return false;
        this.transmit({ push: { subscriptions, message } });
        return true;
    }

    setRouter(router: AccountRouter): void {
        this.router = router;
    }

    start(): void {
        this.connect();
    }

    stop(): void {
        this.stopped = true;
        this.ws?.close();
    }

    /** Connects anew, to wherever config.relayUrl points now (the relay changed, relay-switch.ts). */
    reconnect(): void {
        this.retryDelay = 1000;
        // The close handler schedules the next attempt; between two attempts the pending one picks up the new address
        this.ws?.close(1000, 'Relay changed');
    }

    private transmit(data: AgentOutbound): void {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(data));
    }

    send(frame: AgentFrame, cid: string | undefined, account: string): void {
        const f: AgentFrame = e2eEnabled ? { type: 'e2e', ...encrypt(frame, 'b2c') } : frame;
        const data: AgentOutbound = { frame: f, ...(cid ? { cid } : {}), ...(account === DEFAULT_ACCOUNT ? {} : { account }) };
        if (cid && this.ws?.readyState !== WebSocket.OPEN) {
            // Answer to a specific browser (e.g. a finished suggestion) during a short connection gap: keep it and
            // send it after reconnecting; the cid stays valid as long as the browser is connected to the relay.
            // Frames to everyone (state) are sent again on greeting anyway.
            if (this.waiting.length >= 20) this.waiting.shift();
            this.waiting.push({ data, until: Date.now() + KEEP_MS });
            return;
        }
        this.transmit(data);
    }

    private sendWaiting(): void {
        const now = Date.now();
        const list = this.waiting.splice(0);
        for (const w of list) if (w.until > now) this.transmit(w.data);
        if (list.length) this.log(`${list.length} kept answer(s) sent`);
    }

    /** Unencrypted to a browser (only for 'e2e_required' and errors about the key). */
    private sendPlain(frame: AgentFrame, cid: string): void {
        this.transmit({ cid, frame });
    }

    /** Runs of routines with `wake` of an account; the relay gets those of all accounts (replacing its schedule). */
    wakeSchedule(schedule: WakeEntry[], account: string): void {
        this.schedules.set(account, schedule);
        this.transmit({ wakeSchedule: this.allSchedules() });
    }

    private allSchedules(): WakeEntry[] {
        return [...this.schedules.values()].flat();
    }

    peer(data: PeerData, to: string | undefined, account: string): void {
        const d: PeerData = e2eEnabled ? { kind: 'e2e', ...encrypt(data, 'peer') } : data;
        this.transmit({ peer: d, ...(to ? { to } : {}), ...(account === DEFAULT_ACCOUNT ? {} : { account }) });
    }

    /** Unpack a browser frame; null if it must not be processed. */
    private browserFrame(frame: ClientFrame | E2eFrame, cid: string): ClientFrame | null {
        if (frame.type === 'e2e') {
            if (!e2eEnabled) {
                this.sendPlain({ type: 'error', message: t('relay.noE2eKey', { machine: config.machine.toUpperCase() }) }, cid);
                return null;
            }
            try {
                return decrypt<ClientFrame>(frame, 'c2b');
            } catch (e) {
                if (e instanceof ReplayError) {
                    // An old app (no guard) or a wrong clock hits every frame: report that once per browser
                    const key = `${cid}:${e.reason}`;
                    if (e.reason === 'repeated' || !this.reported.has(key)) {
                        this.log(`browser frame ${e.message}${e.reason === 'missing' ? ', app from before protocol 2' : ''}`);
                        if (e.reason === 'stale') this.sendPlain({ type: 'error', message: t('relay.e2eStale', { machine: config.machine.toUpperCase() }) }, cid);
                    }
                    if (e.reason !== 'repeated') this.reported.add(key);
                    return null;
                }
                // wrong key in the browser
                this.sendPlain({ type: 'e2e_required' }, cid);
                return null;
            }
        }
        if (e2eEnabled) {
            this.sendPlain({ type: 'e2e_required' }, cid);
            return null;
        }
        return frame;
    }

    /** Peer data of another backend, checked against its schema (frames.ts); null if it must not be processed. */
    private peerData(input: PeerData, from: string): PeerData | null {
        const data = this.unpackPeer(input, from);
        if (!data) return null;
        const c = checkPeerData(data);
        if (c.ok) return c.data;
        this.log(`peer data from ${from} rejected (${c.kind || '?'}: ${c.problem})`);
        return null;
    }

    /** Decrypt and migrate; older backends send `art` instead of `kind` (see migrate.ts). */
    private unpackPeer(input: PeerData, from: string): PeerData | null {
        const data = migratePeerData(input);
        if (data.kind === 'e2e') {
            if (!e2eEnabled) {
                this.log(`sync from ${from} is encrypted, E2E_KEY is missing here – ignored`);
                return null;
            }
            try {
                return migratePeerData(decrypt<PeerData>(data, 'peer'));
            } catch (e) {
                if (e instanceof ReplayError) {
                    this.log(`sync from ${from} ${e.message}${e.reason === 'missing' ? ', backend there too old' : e.reason === 'stale' ? ', clocks differ?' : ''} – ignored`);
                    return null;
                }
                this.log(`sync from ${from} could not be decrypted (different E2E_KEY?) – ignored`);
                return null;
            }
        }
        if (e2eEnabled) {
            this.log(`sync from ${from} is unencrypted, E2E is active here – ignored`);
            return null;
        }
        return data;
    }

    private log(text: string): void {
        console.log(`${new Date().toLocaleTimeString('en-GB')} relay: ${text}`);
    }

    private connect(): void {
        if (this.stopped) return;
        const ws = new WebSocket(config.relayUrl, {
            headers: { authorization: `Bearer ${agentToken()}`, 'x-machine': config.machine, 'x-accounts': '1' },
            // After a deploy the first attempt otherwise hung for 10 s on a container that was not ready yet
            handshakeTimeout: 5_000,
            maxPayload: 64 * 1024 * 1024,
        });
        this.ws = ws;

        ws.on('open', () => {
            this.log(`connected to ${config.relayUrl} as ${config.machine}`);
            // Detect a dead line (network change, router): without a pong for two pings reconnect instead of
            // sending for minutes into a connection nobody reads any more
            let pongSince = Date.now();
            ws.on('pong', () => { pongSince = Date.now(); });
            this.pingTimer = setInterval(() => {
                if (Date.now() - pongSince > 2 * PING_MS + 5_000) {
                    this.log(`no pong for ${Math.round((Date.now() - pongSince) / 1000)} s, connection dead`);
                    ws.terminate();
                    return;
                }
                ws.ping();
            }, PING_MS);
            this.sendWaiting();
            if (this.schedules.size) this.transmit({ wakeSchedule: this.allSchedules() });
            this.unclaimedReported = false;
            this.onConnected();
        });
        ws.on('message', (raw) => {
            // Only the first message shows the relay accepted the sign-in; a backend rejected right away (4009)
            // should not knock again every second
            this.retryDelay = 1000;
            let e: AgentInbound;
            try {
                e = JSON.parse(raw.toString()) as AgentInbound;
            } catch {
                return;
            }
            const r = this.router;
            if (!r) return;
            const of = (account: unknown) => r.handler(typeof account === 'string' ? account : DEFAULT_ACCOUNT);
            if ('frame' in e) {
                const h = of(e.account);
                const f = h && this.browserFrame(e.frame, e.cid);
                if (h && f) h.handle(f, e.cid);
                return;
            }
            switch (e.type) {
                case 'client_open': of(e.account)?.greet(e.cid); break;
                case 'client_close':
                    this.reported.delete(`${e.cid}:missing`);
                    this.reported.delete(`${e.cid}:stale`);
                    of(e.account)?.leave(e.cid);
                    break;
                case 'agents': for (const h of r.all()) h.updateAgents(e.online); break;
                case 'peer': {
                    const h = of(e.account);
                    const d = h && this.peerData(e.data, e.from);
                    if (h && d) h.peerInbound(e.from, d);
                    break;
                }
                // Routine ids are unique across accounts; each account takes its own
                case 'woken': for (const h of r.all()) h.woken(e.routines); break;
                case 'warning': of(e.account)?.warning(e.code, e.params ?? {}); break;
                case 'relay_hello':
                    this.relayPushChannels = Array.isArray(e.pushChannels) ? e.pushChannels.filter((c) => c === 'apns' || c === 'fcm') : [];
                    if (this.relayPushChannels.length) this.log(`relay delivers app push over ${this.relayPushChannels.join(', ')}`);
                    r.hello(Array.isArray(e.accounts) ? e.accounts.filter((a) => typeof a === 'string') : null,
                        Array.isArray(e.deletedAccounts) ? e.deletedAccounts.filter((a) => typeof a === 'string') : []);
                    break;
                case 'account_added': if (typeof e.account === 'string') r.added(e.account); break;
                case 'account_deleted': if (typeof e.account === 'string') r.deleted(e.account); break;
                case 'push_result': if (Array.isArray(e.gone) && e.gone.length) for (const h of r.all()) h.pushGone(e.gone); break;
                case 'first_device': {
                    if (typeof e.id !== 'string' || typeof e.pk !== 'string') break;
                    const id = e.id;
                    this.onFirstDevice(id, e.pk).then(
                        (box) => {
                            this.log(box ? 'first device: sealed pairing link sent' : 'first device asked for, but this backend shows no code');
                            this.transmit({ firstDevice: box ? { id, box } : { id, error: 'off' } });
                        },
                        (err: Error) => {
                            this.log(`first device: ${err.message}`);
                            this.transmit({ firstDevice: { id, error: 'off' } });
                        },
                    );
                    break;
                }
            }
        });
        ws.on('error', (e: Error & { code?: string }) => {
            // A refused token (logged out, wrong AGENT_TOKEN): retrying every half minute would get this address blocked
            // at the relay, and with it every other machine behind the same router. Rarely, and say why.
            if (/\b401\b/.test(e.message)) {
                this.retryDelay = Math.max(this.retryDelay, 30 * 60_000);
                this.log(t('setup.agentRefused'));
                return;
            }
            // An unclaimed relay refuses every socket with 503 (relay/src/owner.ts): say how to claim it, once
            if (/\b503\b/.test(e.message)) {
                if (this.unclaimedReported) return;
                this.unclaimedReported = true;
                const code = process.env.RELAY_SETUP_CODE?.trim();
                if (!code) {
                    this.log(t('setup.unclaimed', { relay: RelayClient.origin() }));
                    return;
                }
                RelayClient.claim(code).then(
                    (result) => this.log(result === 'ok' ? 'relay claimed with RELAY_SETUP_CODE' : `claiming the relay with RELAY_SETUP_CODE failed: ${result}`),
                    (err: Error) => this.log(`claiming the relay failed: ${err.message}`),
                );
                return;
            }
            this.log(`error: ${e.code ?? e.message} (${new URL(config.relayUrl).host})`);
        });
        ws.on('close', (code) => {
            if (this.pingTimer) clearInterval(this.pingTimer);
            this.pingTimer = null;
            this.ws = null;
            // Without the relay this machine is alone; jobs to others would go nowhere
            for (const h of this.router?.all() ?? []) h.updateAgents([config.machine], false);
            if (this.stopped) return;
            if (code === 4009) {
                // Another backend is already connected as this machine: retry rarely
                this.retryDelay = Math.max(this.retryDelay, 5 * 60_000);
                this.log(`REJECTED: a backend is already connected to the relay as ${config.machine} (is it running twice, or is someone using AGENT_TOKEN?)`);
            }
            if (code === 4004) {
                // Logged out in the app: the token is gone, a new invitation is the way back
                this.log(t('setup.machineLoggedOut'));
                return;
            }
            if (code === 1012) this.retryDelay = 1000;
            this.log(`disconnected (${code}${code === 1012 ? ', relay is restarting' : ''}), next attempt in ${this.retryDelay / 1000} s`);
            setTimeout(() => this.connect(), this.retryDelay);
            this.retryDelay = Math.min(this.retryDelay * 2, this.retryDelay >= 30 * 60_000 || code === 4009 ? 30 * 60_000 : 30_000);
        });
    }
}
