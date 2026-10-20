// The accounts this machine serves: one BotManager per account, created and started in that account's context
// (store.ts), so its timers and sessions keep to its data. Which accounts there are comes from the relay; a relay
// without accounts (or before its hello) gets 'main' only, as it would take every other account for 'main'.
//
// A deleted account's folder is moved to deleted-accounts/ instead of being removed: the order comes from the relay,
// which must not be able to destroy what it cannot read.

import fs from 'node:fs';
import path from 'node:path';
import { accountFolder, dataPath, DEFAULT_ACCOUNT, inAccount, isAccountId, retireAccount } from './store.ts';
import { accountHandler, type AccountRouter, type RelayHandler } from './relay-client.ts';

/** What the router needs of a BotManager; agent.ts implements it. */
export interface AccountManager extends RelayHandler {
    start(): void;
    close(): void;
    busy(): boolean;
    inUse(): boolean;
    othersInUse: () => boolean;
}

export class Accounts implements AccountRouter {
    private managers = new Map<string, { manager: AccountManager; handler: RelayHandler }>();
    /** The relay knows accounts; until then only 'main' is served. */
    private multi = false;
    private create: (account: string) => AccountManager;
    private log: (text: string) => void;

    /** `create` is called in the account's context. */
    constructor(create: (account: string) => AccountManager, log: (text: string) => void = (text) => console.log(`accounts: ${text}`)) {
        this.create = create;
        this.log = log;
    }

    /** Serves 'main' from the start, before the relay is reached. */
    start(): void {
        this.serve(DEFAULT_ACCOUNT);
    }

    private serve(account: string): { manager: AccountManager; handler: RelayHandler } {
        const known = this.managers.get(account);
        if (known) return known;
        const manager = inAccount(account, () => this.create(account));
        manager.othersInUse = () => [...this.managers].some(([id, m]) => id !== account && m.manager.inUse());
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
        if (!isAccountId(account)) return null;
        if (account !== DEFAULT_ACCOUNT && !this.multi) return null;
        // Traffic of an account whose "account_added" is still on its way
        return this.serve(account).handler;
    }

    all(): RelayHandler[] {
        return [...this.managers.values()].map((m) => m.handler);
    }

    served(): string[] {
        return [...this.managers.keys()].sort();
    }

    hello(accounts: string[] | null, deleted: string[]): void {
        if (!accounts) {
            this.multi = false;
            for (const id of this.served()) if (id !== DEFAULT_ACCOUNT) this.stop(id);
            return;
        }
        this.multi = true;
        for (const id of deleted) this.deleted(id);
        for (const id of accounts) if (isAccountId(id) && !deleted.includes(id)) this.serve(id);
    }

    added(account: string): void {
        if (this.multi && isAccountId(account)) this.serve(account);
    }

    deleted(account: string): void {
        if (!isAccountId(account) || account === DEFAULT_ACCOUNT) return;
        this.stop(account);
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
