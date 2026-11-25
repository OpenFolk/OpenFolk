// Person chats: a chat between two accounts on this relay. Each account sees it as 'p:<the other account>' and keeps
// its own half (history, read state, favorite, mute) like any other chat, so syncing, searching and deleting an
// account need nothing new. The backend that receives a message writes it into both halves with the same entry id
// (agent.ts); the relay routes it like every other frame and never learns who wrote to whom.
//
// Who may chat with whom is the relay's list of accounts with their reach (shared/protocol.ts `reaches`): a customer
// account reaches only the admins. The list lives in memory; the relay sends it on every connect.

import { readJson, writeJson } from './store.ts';
import { isAccountAvatar, reaches, type Person, type PersonChat } from '../../shared/protocol.ts';

const FILE = 'person-chats.json';

export function loadPersonChats(): PersonChat[] {
    return readJson<PersonChat[]>(FILE, []).filter((c) => c && typeof c.id === 'string');
}

function savePersonChats(list: PersonChat[]): void {
    writeJson(FILE, list);
}

export function personChat(id: string): PersonChat | undefined {
    return loadPersonChats().find((c) => c.id === id);
}

function change(id: string, fn: (c: PersonChat) => void): PersonChat {
    const list = loadPersonChats();
    let c = list.find((x) => x.id === id);
    if (!c) {
        c = { id, updatedAt: '' };
        list.push(c);
    }
    fn(c);
    c.updatedAt = new Date().toISOString();
    savePersonChats(list);
    return c;
}

export function setPersonFlag(id: string, field: 'favorite' | 'muted' | 'blocked', on: boolean): void {
    change(id, (c) => { c[field] = on || undefined; });
}

/** Puts a person chat into a folder of the chat list ('' takes it out). */
export function setPersonCategory(id: string, category: string): void {
    change(id, (c) => { c.category = category || undefined; });
}

/** A deleted folder: the person chats in it stay, without one. */
export function dropPersonCategory(category: string): void {
    for (const c of loadPersonChats().filter((x) => x.category === category)) change(c.id, (x) => { delete x.category; });
}

/** Deleted on this side: entries up to now stay away; favorite and mute go too. */
export function clearPersonChat(id: string): string {
    return change(id, (c) => {
        c.cleared = new Date().toISOString();
        delete c.favorite;
        delete c.muted;
    }).cleared!;
}

/** Whether this account blocked the person; deleting the chat keeps the block. */
export function isBlocked(id: string): boolean {
    return personChat(id)?.blocked === true;
}

/** Since when a person chat is empty here ('' = never deleted). */
export function clearedAt(id: string): string {
    return personChat(id)?.cleared ?? '';
}

/** Takes over newer states of another machine; returns the chats whose deletion is new here. */
export function mergePersonChats(others: PersonChat[] | undefined): { changed: boolean; cleared: string[] } {
    if (!Array.isArray(others) || !others.length) return { changed: false, cleared: [] };
    const list = loadPersonChats();
    const cleared: string[] = [];
    let changed = false;
    for (const o of others) {
        if (!o || typeof o.id !== 'string' || typeof o.updatedAt !== 'string') continue;
        const own = list.find((x) => x.id === o.id);
        if (own && own.updatedAt >= o.updatedAt) continue;
        if (o.cleared && o.cleared !== own?.cleared) cleared.push(o.id);
        if (own) Object.assign(own, { favorite: o.favorite, muted: o.muted, cleared: o.cleared, blocked: o.blocked, updatedAt: o.updatedAt });
        else list.push({ id: o.id, favorite: o.favorite, muted: o.muted, cleared: o.cleared, blocked: o.blocked, updatedAt: o.updatedAt });
        changed = true;
    }
    if (changed) savePersonChats(list);
    return { changed, cleared };
}

/** The relay's accounts, as it sent them last; empty until then and for a relay without person chats. */
let everyone: Person[] = [];

export function setPeople(list: Person[]): void {
    everyone = list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map((p) => {
            const reach = p.reach === 'admins' || p.reach === 'listed' ? p.reach : 'all';
            const contacts = reach === 'listed' && Array.isArray(p.contacts) ? p.contacts.filter((c) => typeof c === 'string') : undefined;
            return { id: p.id, name: p.name, admin: p.admin === true, reach, ...(contacts ? { contacts } : {}), ...(isAccountAvatar(p.avatar) ? { avatar: p.avatar } : {}), ...(p.demo === true ? { demo: true } : {}) };
        });
}

export function allPeople(): Person[] {
    return everyone;
}

/** The people account `me` can chat with. */
export function contactsOf(me: string): Person[] {
    const self = everyone.find((p) => p.id === me);
    return self ? everyone.filter((p) => reaches(self, p)) : [];
}

export function canReach(me: string, other: string): boolean {
    return contactsOf(me).some((p) => p.id === other);
}

export function personName(id: string): string {
    return everyone.find((p) => p.id === id)?.name ?? id;
}
