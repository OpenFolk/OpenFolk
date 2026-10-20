// Sync between machines: every machine keeps a full copy of bots, groups, routines, knowledge, push
// subscriptions, settings and history. Changes go via the relay to the other backends; when merging, the newer
// state (updatedAt) wins, tombstones prevent resurrection. The relay only passes the data through and stores nothing.

import { loadBots, loadGroups, saveBots, saveGroups } from './bots.ts';
import { allChats, deleteHistory, mergeHistory, readHistory } from './history.ts';
import { allFacts, mergeKnowledge } from './knowledge.ts';
import { migrateSnapshot } from './migrate.ts';
import { loadPinned, mergePinned } from './pinned.ts';
import { mergePushSettings, mergeSubscriptions, pushSettings, subscriptions } from './push.ts';
import { loadRoutines, saveRoutines } from './routines.ts';
import { applySeen, loadSeen } from './seen.ts';
import { keysForSync, loadSettings, mergeApiKeys, mergeSettings } from './settings.ts';
import { saveTombstones, tombstones } from './store.ts';
import { botIdOf, type Bot, type Group, type KnowledgeLocation, type Routine, type Snapshot } from '../../shared/protocol.ts';

/** This many entries per chat go along with the first sync. */
const HISTORY_PER_CHAT = 300;

export function snapshot(withHistory: boolean): Snapshot {
    const s: Snapshot = {
        bots: loadBots().map(({ sessionId: _s, ...b }) => b as Bot),
        groups: loadGroups(),
        routines: loadRoutines(),
        knowledge: allFacts(),
        deleted: tombstones(),
        push: subscriptions(),
        pushSettings: pushSettings(),
        settings: loadSettings(),
        apiKeys: keysForSync(),
        pinned: loadPinned(),
        seen: loadSeen(),
    };
    if (withHistory) {
        s.history = {};
        for (const chatId of allChats()) s.history[chatId] = readHistory(chatId, HISTORY_PER_CHAT);
    }
    return s;
}

export interface MergeResult {
    /** Bots, groups or routines have changed */
    config: boolean;
    /** Bots whose persona/folder/model changed (reload the session) */
    botsChanged: string[];
    /** Bots that changed machines, as they were before (their sessions may have to follow them) */
    botsMoved: Bot[];
    /** deleted bots (end the session) */
    botsDeleted: string[];
    /** conversations deleted on the other machine (end the session) */
    chatsDeleted: string[];
    /** scopes with changed knowledge */
    knowledge: KnowledgeLocation[];
    /** chats with new history entries */
    history: string[];
    /** push settings taken over from the other machine */
    pushSettings: boolean;
    /** shared settings or API keys taken over from the other machine */
    settings: boolean;
    /** pinned messages taken over from the other machine */
    pinned: boolean;
    /** read state taken over from the other machine */
    seen: boolean;
}

function newer(a: { updatedAt?: string } | undefined, b: { updatedAt?: string }): boolean {
    return !a || (b.updatedAt ?? '') > (a.updatedAt ?? '');
}

/** Merges items by id: the newer state wins, tombstones take precedence over older states. */
function mergeById<T extends { id: string; updatedAt?: string }>(
    own: T[], others: T[], kind: string, dead: Record<string, string>,
): { list: T[]; changed: T[]; removed: T[] } {
    const map = new Map(own.map((e) => [e.id, e]));
    const changed: T[] = [];
    for (const f of others) {
        const tomb = dead[`${kind}:${f.id}`];
        if (tomb && tomb >= (f.updatedAt ?? '')) continue;
        if (newer(map.get(f.id), f)) {
            map.set(f.id, f);
            changed.push(f);
        }
    }
    const removed: T[] = [];
    for (const [id, e] of map) {
        const tomb = dead[`${kind}:${id}`];
        if (tomb && tomb >= (e.updatedAt ?? '')) {
            map.delete(id);
            removed.push(e);
        }
    }
    return { list: [...map.values()], changed, removed };
}

/** Merges a snapshot of another machine; snapshots of backends with the old (German) data format are mapped first. */
export function merge(incoming: Snapshot): MergeResult {
    const s = migrateSnapshot(incoming);
    const result: MergeResult = {
        config: false, botsChanged: [], botsMoved: [], botsDeleted: [], chatsDeleted: [], knowledge: [], history: [], pushSettings: false, settings: false, pinned: false, seen: false,
    };

    // Unite tombstones (the later one wins)
    const dead = tombstones();
    let deadChanged = false;
    for (const [k, t] of Object.entries(s.deleted ?? {})) {
        if (!dead[k] || t > dead[k]) {
            // Conversation deleted on the other machine: delete its history here too
            if (!dead[k] && k.startsWith('chat:')) {
                deleteHistory(k.slice(5));
                result.chatsDeleted.push(k.slice(5));
            }
            dead[k] = t;
            deadChanged = true;
        }
    }
    if (deadChanged) saveTombstones(dead);

    const oldBots = loadBots();
    const bots = mergeById<Bot>(oldBots, (s.bots ?? []).map(({ sessionId: _s, ...b }) => b as Bot), 'bot', dead);
    if (bots.changed.length || bots.removed.length) {
        // Session ids stay local (loadBots takes them from sessions.json)
        saveBots(bots.list);
        result.config = true;
        for (const b of bots.changed) {
            const old = oldBots.find((x) => x.id === b.id);
            if (old && (old.folder !== b.folder || old.model !== b.model || old.tone !== b.tone || old.name !== b.name || old.area !== b.area || old.role !== b.role)) {
                result.botsChanged.push(b.id);
            }
            if (old && old.machine !== b.machine) result.botsMoved.push(old);
        }
        result.botsDeleted = bots.removed.map((b) => b.id);
        for (const b of bots.removed) {
            deleteHistory(b.id);
            for (const c of b.conversations ?? []) deleteHistory(`${b.id}~${c.id}`);
        }
    }

    const groups = mergeById<Group>(loadGroups(), s.groups ?? [], 'group', dead);
    if (groups.changed.length || groups.removed.length) {
        saveGroups(groups.list);
        result.config = true;
        for (const g of groups.removed) deleteHistory(`g:${g.id}`);
    }

    const routines = mergeById<Routine>(loadRoutines(), s.routines ?? [], 'routine', dead);
    if (routines.changed.length || routines.removed.length) {
        saveRoutines(routines.list);
        result.config = true;
    }

    // Even without knowledge in the snapshot: new tombstones can affect facts present here
    if (s.knowledge || deadChanged) result.knowledge = mergeKnowledge(s.knowledge ?? {}, dead);

    mergeSubscriptions(s.push ?? []);
    result.pushSettings = mergePushSettings(s.pushSettings);
    // The API keys count as settings: browsers see which are stored
    const keys = mergeApiKeys(s.apiKeys);
    result.settings = mergeSettings(s.settings) || keys;
    result.pinned = mergePinned(s.pinned).length > 0;
    result.seen = Object.keys(applySeen(s.seen)).length > 0;

    for (const [chatId, entries] of Object.entries(s.history ?? {})) {
        if (!/^(g:[a-z0-9-]+|[a-z0-9-]+(~[a-z0-9]+)?)$/.test(chatId)) continue;
        if (dead[`bot:${botIdOf(chatId)}`] || dead[`chat:${chatId}`] || (chatId.startsWith('g:') && dead[`group:${chatId.slice(2)}`])) continue;
        if (mergeHistory(chatId, entries) > 0) result.history.push(chatId);
    }
    return result;
}
