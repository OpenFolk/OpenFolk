// The accounts this machine serves: one BotManager per account, created and started in that account's context
// (store.ts), so its timers and sessions keep to its data. Which accounts there are comes from the relay; a relay
// without accounts (or before its hello) gets 'main' only, as it would take every other account for 'main'.
//
// A deleted account's folder is moved to deleted-accounts/ instead of being removed: the order comes from the relay,
// which must not be able to destroy what it cannot read.
//
// A machine joined by a setup link is bound to one account (store.ts machineBinding): it serves that account only, and
// a person chat with an account it does not serve goes through the relay (person-route.ts).

import fs from 'node:fs';
import path from 'node:path';
import { accountFolder, dataPath, DEFAULT_ACCOUNT, inAccount, isAccountId, isRetired, machineBinding, ownerAccount, retireAccount, setMachineBinding } from './store.ts';
import { accountHandler, type AccountRouter, type RelayHandler } from './relay-client.ts';
import { setPeople } from './people.ts';
import type { PersonRoute } from './person-route.ts';
import type { HistoryEntry, PeerData, Person } from '../../shared/protocol.ts';

/** What a person chat needs of the other account's manager: its half of a message (people.ts). */
export interface PersonInbox {
    fromPerson(from: string, entry: HistoryEntry, kind?: 'message' | 'handover'): void;
}

/** What the router needs of a BotManager; agent.ts implements it. */
export interface AccountManager extends RelayHandler {
    start(): void;
    close(): void;
    busy(): boolean;
    inUse(): boolean;
    othersInUse: () => boolean;
    /** Runs `fn` with another account's manager, in that account's context; false if this machine does not serve it. */
    otherAccount: (account: string, fn: (m: PersonInbox) => void) => boolean;
    /** To an account this machine does not serve, through the relay; `replace` drops an older one of the same kind. */
    toAccount: (account: string, data: PeerData, replace?: boolean) => void;
    /** Person route: data from account `from` on another machine. */
    personInbound(from: string, data: PeerData): void;
    /** This machine is bound to the manager's account, set up by `setupBy` (on every connect). */
    boundTo(setupBy: string | undefined): void;
    /** The relay's list of people changed. */
    peopleChanged(): void;
    fromPerson(from: string, entry: HistoryEntry, kind?: 'message' | 'handover'): void;
}

export class Accounts implements AccountRouter {
    private managers = new Map<string, { manager: AccountManager; handler: RelayHandler }>();
    /** The relay knows accounts; until then only 'main' is served. */
    private multi = false;
    private create: (account: string) => AccountManager;
    private log: (text: string) => void;
    /** Messages to accounts on other machines (index.ts sets it once the relay client exists). */
    route: PersonRoute | null = null;

    /** `create` is called in the account's context. */
    constructor(create: (account: string) => AccountManager, log: (text: string) => void = (text) => console.log(`accounts: ${text}`)) {
        this.create = create;
        this.log = log;
    }

    /** Serves the machine's owner ('main', or the account it is bound to) from the start, before the relay is reached. */
    start(): void {
        this.serve(ownerAccount());
    }

    private serve(account: string): { manager: AccountManager; handler: RelayHandler } {
        const known = this.managers.get(account);
        if (known) return known;
        const manager = inAccount(account, () => this.create(account));
        manager.othersInUse = () => [...this.managers].some(([id, m]) => id !== account && m.manager.inUse());
        manager.otherAccount = (id, fn) => {
            const other = this.managers.get(id);
            if (!other || id === account) return false;
            inAccount(id, () => fn(other.manager));
            return true;
        };
        manager.toAccount = (id, data, replace) => this.route?.send(account, id, data, replace);
        const entry = { manager, handler: accountHandler(account, manager) };
        this.managers.set(account, entry);
        inAccount(account, () => manager.start());
        if (account !== DEFAULT_ACCOUNT) this.log(`serving account ${account}`);
        return entry;
    }

    private stop(account: string): void {
        const m = this.managers.get(account);
        if (!m) return;
        this.managers.delete(account);
        inAccount(account, () => m.manager.close());
    }

    handler(account: string): RelayHandler | null {
        // A deleted account's traffic still on its way (its browsers closing) finds nobody
        if (!isAccountId(account) || isRetired(account)) return null;
        if (account !== ownerAccount() && !this.multi) return null;
        // A bound machine serves its account and nothing else, whatever arrives
        const bound = machineBinding()?.account;
        if (bound && account !== bound) return null;
        // Traffic of an account whose "account_added" is still on its way
        return this.serve(account).handler;
    }

    all(): RelayHandler[] {
        return [...this.managers.values()].map((m) => m.handler);
    }

    served(): string[] {
        return [...this.managers.keys()].sort();
    }

    hello(accounts: string[] | null, deleted: string[], bound?: { account: string; setupBy?: string }): void {
        // The relay is the one that knows: bound by a setup link, or (again) a machine of the relay's owner
        const binding = bound && isAccountId(bound.account) ? { account: bound.account, ...(isAccountId(bound.setupBy) ? { setupBy: bound.setupBy } : {}) } : null;
        if (accounts) {
            const before = machineBinding()?.account;
            setMachineBinding(binding);
            if (binding && before !== binding.account) this.log(`this machine serves account ${binding.account} only (setup link)`);
            if (!binding && before) this.log(`this machine is no longer bound to account ${before}`);
        }
        if (!accounts) {
            this.multi = false;
            for (const id of this.served()) if (id !== ownerAccount()) this.stop(id);
            return;
        }
        this.multi = true;
        if (binding) {
            for (const id of this.served()) if (id !== binding.account) this.stop(id);
            const m = this.serve(binding.account);
            inAccount(binding.account, () => m.manager.boundTo(binding.setupBy));
            return;
        }
        for (const id of deleted) this.deleted(id);
        // Accounts this relay does not have (the one a machine was bound to, before it was disconnected) rest; their data stays
        for (const id of this.served()) if (id !== DEFAULT_ACCOUNT && !accounts.includes(id)) this.stop(id);
        for (const id of accounts) if (isAccountId(id) && !deleted.includes(id)) this.serve(id);
        // 'main' is served from the start; a machine that was bound before serves it again now
        this.serve(DEFAULT_ACCOUNT);
    }

    /** The account runs on machines bound to it now: stop serving it, its data stays where it is. */
    released(account: string): void {
        if (account === ownerAccount() || !this.managers.has(account)) return;
        this.stop(account);
        this.log(`account ${account} runs on machines of its own now`);
    }

    /** Person route: to the receiving account's manager, if this machine serves it; a copy that came before is dropped. */
    person(from: string, to: string, data: PeerData, id?: string): void {
        const m = this.managers.get(to);
        if (!m || !isAccountId(from)) {
            this.log(`person message for account ${to}, which this machine does not serve: dropped`);
            return;
        }
        if (id && this.route?.repeated(id)) return;
        inAccount(to, () => m.manager.personInbound(from, data));
    }

    /** The relay's accounts with names and reach (person chats); every account's browsers get their contacts again. */
    people(list: Person[]): void {
        setPeople(list);
        for (const [id, m] of this.managers) inAccount(id, () => m.manager.peopleChanged());
    }

    added(account: string): void {
        if (this.multi && isAccountId(account) && !machineBinding()) this.serve(account);
    }

    deleted(account: string): void {
        if (!isAccountId(account) || account === DEFAULT_ACCOUNT) return;
        this.route?.forget(account);
        this.stop(account);
        // The account this machine was bound to is gone, and with it the machine's place on that relay
        if (machineBinding()?.account === account) setMachineBinding(null);
        retireAccount(account);
        const folder = accountFolder(account);
        if (!fs.existsSync(folder)) return;
        const target = dataPath('deleted-accounts', `${account}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(folder, target);
        this.log(`account ${account} deleted, its data moved to ${target}`);
    }

    busy(): boolean {
        return [...this.managers.values()].some((m) => m.manager.busy());
    }

    close(): void {
        for (const id of this.served()) this.stop(id);
    }
}
