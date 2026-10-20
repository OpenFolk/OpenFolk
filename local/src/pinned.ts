// Pinned messages per chat (pinned at the top as in a messenger). A copy of text and sender is stored so the
// bar can also show messages that are no longer in the loaded history.
// Sync between machines per chat: the newer state wins.

import { readJson, writeJson } from './store.ts';
import type { PinnedEntry } from '../../shared/protocol.ts';

/** As in a messenger: at most three per chat, the most recently pinned first. */
export const MAX_PINNED = 3;
const MAX_TEXT = 300;

export type PinnedState = Record<string, { entries: PinnedEntry[]; updatedAt: string }>;

export function loadPinned(): PinnedState {
    return readJson<PinnedState>('pinned.json', {});
}

/** Only the entries per chat, for the browsers. */
export function pinnedForBrowser(): Record<string, PinnedEntry[]> {
    const r: Record<string, PinnedEntry[]> = {};
    for (const [chatId, s] of Object.entries(loadPinned())) if (s.entries.length) r[chatId] = s.entries;
    return r;
}

/** Pins or unpins a message and returns the chat's list. */
export function pin(chatId: string, entry: PinnedEntry, on: boolean): PinnedEntry[] {
    const all = loadPinned();
    let list = (all[chatId]?.entries ?? []).filter((e) => e.id !== entry.id);
    if (on) list = [{ ...entry, text: entry.text.slice(0, MAX_TEXT) }, ...list].slice(0, MAX_PINNED);
    all[chatId] = { entries: list, updatedAt: new Date().toISOString() };
    writeJson('pinned.json', all);
    return list;
}

/** Take over the state of another machine; returns the changed chats. */
export function mergePinned(other: PinnedState | undefined): string[] {
    if (!other) return [];
    const all = loadPinned();
    const changed: string[] = [];
    for (const [chatId, s] of Object.entries(other)) {
        if (!Array.isArray(s?.entries) || typeof s.updatedAt !== 'string') continue;
        if (all[chatId] && all[chatId].updatedAt >= s.updatedAt) continue;
        all[chatId] = { entries: s.entries.slice(0, MAX_PINNED), updatedAt: s.updatedAt };
        changed.push(chatId);
    }
    if (changed.length) writeJson('pinned.json', all);
    return changed;
}
