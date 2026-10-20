// Accounts on the relay: people or roles that share it, each with its own devices, bots and chats. The relay only
// routes by account; the data of an account lives on the backends. 'main' is the owner: its password is the
// relay's (USER_PASSWORD or the claim, owner.ts), and it is always an admin. Further accounts keep their password
// here as a scrypt hash; their first device comes through a pairing link.
//
// A deleted account leaves a tombstone, which the relay hands every backend on connect so a machine that was asleep
// removes its data too. Its id is never given out again: a backend would take the new account's data for the old one.

import fs from 'node:fs';
import path from 'node:path';
import { checkPassword, hashPassword } from './auth.ts';
import { MIN_TOKEN_LENGTH } from './owner.ts';
import type { RelayAccount } from '../../shared/protocol.ts';

export const ACCOUNTS_FILE = 'accounts.json';
export const MAIN = 'main';
const MAX_ACCOUNTS = 50;
const MAX_NAME = 60;

interface StoredAccount extends RelayAccount {
    hash?: string;
}

export type AccountChange = { name?: string; password?: string; admin?: boolean };
export type AccountResult = 'ok' | 'name_taken' | 'invalid';

/** a-z0-9 and hyphen, as the backends use it as a folder name. */
function slug(text: string): string {
    return text.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'account';
}

export class Accounts {
    private file: string;
    private list: StoredAccount[] = [];
    private deleted: Record<string, string> = {};

    constructor(dir: string) {
        fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, ACCOUNTS_FILE);
        try {
            const v = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { accounts?: StoredAccount[]; deleted?: Record<string, string> };
            this.list = (v.accounts ?? []).filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string');
            this.deleted = v.deleted && typeof v.deleted === 'object' ? v.deleted : {};
        } catch {
            // no accounts besides 'main' yet
        }
        if (!this.list.some((a) => a.id === MAIN)) this.list.unshift({ id: MAIN, name: 'Main', admin: true, created: '' });
    }

    private save(): void {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ accounts: this.list, deleted: this.deleted }, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    all(): RelayAccount[] {
        return this.list.map(toPublic);
    }

    ids(): string[] {
        return this.list.map((a) => a.id);
    }

    deletedIds(): string[] {
        return Object.keys(this.deleted);
    }

    get(id: string): RelayAccount | undefined {
        const a = this.list.find((x) => x.id === id);
        return a && toPublic(a);
    }

    /** By id or by name, ignoring case. */
    find(idOrName: string): RelayAccount | undefined {
        const k = idOrName.trim().toLowerCase();
        const a = this.list.find((x) => x.id === k) ?? this.list.find((x) => x.name.toLowerCase() === k);
        return a && toPublic(a);
    }

    isAdmin(id: string): boolean {
        return id === MAIN || !!this.list.find((x) => x.id === id)?.admin;
    }

    private nameFree(name: string, except?: string): boolean {
        return !this.list.some((x) => x.id !== except && x.name.toLowerCase() === name.toLowerCase());
    }

    create(name: string, admin = false): RelayAccount | 'name_taken' | 'invalid' {
        const n = name.trim().slice(0, MAX_NAME);
        if (!n || this.list.length >= MAX_ACCOUNTS) return 'invalid';
        if (!this.nameFree(n)) return 'name_taken';
        const base = slug(n);
        let id = base;
        for (let i = 2; this.list.some((x) => x.id === id) || id in this.deleted; i++) id = `${base}-${i}`;
        const a: StoredAccount = { id, name: n, admin, created: new Date().toISOString() };
        this.list.push(a);
        this.save();
        return toPublic(a);
    }

    update(id: string, change: AccountChange): AccountResult {
        const a = this.list.find((x) => x.id === id);
        if (!a) return 'invalid';
        if (change.name !== undefined) {
            const n = change.name.trim().slice(0, MAX_NAME);
            if (!n) return 'invalid';
            if (!this.nameFree(n, id)) return 'name_taken';
            a.name = n;
        }
        if (change.password !== undefined) {
            // The owner's password belongs to the relay's setup (owner.ts), not to this file
            if (id === MAIN || change.password.length < MIN_TOKEN_LENGTH || change.password.length > 256) return 'invalid';
            a.hash = hashPassword(change.password);
        }
        if (change.admin !== undefined && id !== MAIN) a.admin = change.admin;
        this.save();
        return 'ok';
    }

    remove(id: string): boolean {
        if (id === MAIN || !this.list.some((x) => x.id === id)) return false;
        this.list = this.list.filter((x) => x.id !== id);
        this.deleted[id] = new Date().toISOString();
        this.save();
        return true;
    }

    /**
     * The password of an account other than 'main'; one without a password set cannot sign in with one, nor one
     * whose SHA-256 hash dates from before 0.1.2 (an admin sets it again).
     */
    passwordMatches(id: string, password: string): boolean {
        const hash = this.list.find((x) => x.id === id)?.hash;
        return !!hash && checkPassword(hash, password);
    }
}

function toPublic(a: StoredAccount): RelayAccount {
    return { id: a.id, name: a.name, admin: a.id === MAIN || a.admin, created: a.created };
}
