// The person route between accounts that do not share a machine: an account set up with a setup link runs only on
// machines bound to it, so its person chats with the admin and its setup travel from one machine to the other through
// the relay (AgentOutbound `person`). The relay keeps nothing and delivers only to a machine that is awake, so what did
// not get through stays here, in person-outbox.json, and goes out again whenever the machines awake change, for a week.
// So a message may arrive twice (sent again while the relay's answer to the first was on its way, or after a restart
// in between): the receiver keeps the ids it took in person-seen.json and drops a second copy.

import { randomUUID } from 'node:crypto';
import { readMachineJson, writeMachineJson } from './store.ts';
import type { PeerData } from '../../shared/protocol.ts';

const FILE = 'person-outbox.json';
const SEEN_FILE = 'person-seen.json';
const KEEP_MS = 7 * 24 * 60 * 60_000;
const MAX = 500;
/** Ids remembered on the receiving side: more than an outbox holds. */
const MAX_SEEN = 2000;
/** A message sent this recently waits for the relay's answer instead of going out again. */
const ANSWER_MS = 15_000;

interface Pending {
    id: string;
    from: string;
    to: string;
    data: PeerData;
    since: string;
}

export class PersonRoute {
    private pending: Pending[];
    /** Hands a message to the relay; false while not connected. */
    private transmitOne: (data: PeerData, from: string, to: string, id: string) => boolean;
    /** Messages handed to the relay whose answer has not come yet, with the time. */
    private inFlight = new Map<string, number>();
    /** Ids of messages taken in, oldest first. */
    private seen: string[];
    private seenSet: Set<string>;

    constructor(transmit: (data: PeerData, from: string, to: string, id: string) => boolean) {
        this.transmitOne = transmit;
        this.pending = readMachineJson<Pending[]>(FILE, []).filter((p) => p && typeof p.id === 'string' && typeof p.to === 'string');
        this.seen = readMachineJson<string[]>(SEEN_FILE, []).filter((id) => typeof id === 'string');
        this.seenSet = new Set(this.seen);
    }

    private transmit(p: Pending, now = Date.now()): void {
        if (this.transmitOne(p.data, p.from, p.to, p.id)) this.inFlight.set(p.id, now);
    }

    private save(): void {
        writeMachineJson(FILE, this.pending);
    }

    /**
     * Sends `data` from account `from` to account `to`; it stays in the outbox until the relay reports it delivered.
     * `replace`: an older message of the same kind between the same accounts is dropped (a setup: only the newest counts).
     */
    send(from: string, to: string, data: PeerData, replace = false): void {
        if (replace) this.pending = this.pending.filter((p) => !(p.from === from && p.to === to && p.data.kind === data.kind));
        const p: Pending = { id: randomUUID(), from, to, data, since: new Date().toISOString() };
        this.pending.push(p);
        if (this.pending.length > MAX) this.pending.shift();
        this.save();
        this.transmit(p);
    }

    /** The relay's answer: delivered (gone from the outbox) or no machine of the account awake (stays). */
    result(id: string, ok: boolean): void {
        this.inFlight.delete(id);
        if (!ok) return;
        const before = this.pending.length;
        this.pending = this.pending.filter((p) => p.id !== id);
        if (this.pending.length !== before) this.save();
    }

    /** Machines came or went: whatever waits goes out again; older than a week is dropped. */
    retry(now = Date.now()): void {
        const before = this.pending.length;
        this.pending = this.pending.filter((p) => now - Date.parse(p.since) < KEEP_MS);
        if (this.pending.length !== before) this.save();
        for (const p of this.pending) {
            const sent = this.inFlight.get(p.id);
            if (sent === undefined || now - sent >= ANSWER_MS) this.transmit(p, now);
        }
    }

    /** On the receiving side: whether the message with this id came before (then it is dropped); remembers it. */
    repeated(id: string): boolean {
        if (this.seenSet.has(id)) return true;
        this.seen.push(id);
        this.seenSet.add(id);
        while (this.seen.length > MAX_SEEN) this.seenSet.delete(this.seen.shift()!);
        writeMachineJson(SEEN_FILE, this.seen);
        return false;
    }

    /** Messages from or to a deleted account wait for nobody. */
    forget(account: string): void {
        const before = this.pending.length;
        this.pending = this.pending.filter((p) => p.from !== account && p.to !== account);
        if (this.pending.length !== before) this.save();
    }

    get waiting(): number {
        return this.pending.length;
    }
}
