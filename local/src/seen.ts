// Up to when a chat has been read, shared by all devices: every device reports "seen until" or "marked unread by
// hand", the backend stores it and passes it on to the other machines and all browsers.
// Sync per chat: the newer state (`updatedAt`) wins.

import { readJson, writeJson } from './store.ts';
import type { SeenEntry } from '../../shared/protocol.ts';

export type SeenState = Record<string, SeenEntry>;

const CHAT_ID = /^(g:[a-z0-9-]+|[a-z0-9-]+(~[a-z0-9]+)?)$/;
const ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;

export function loadSeen(): SeenState {
    return readJson<SeenState>('seen.json', {});
}

/** Takes over newer states (from a device or machine); returns only the chats that actually changed. */
export function applySeen(other: unknown): SeenState {
    const changed: SeenState = {};
    if (!other || typeof other !== 'object') return changed;
    const all = loadSeen();
    for (const [chatId, e] of Object.entries(other as Record<string, Partial<SeenEntry>>)) {
        if (!CHAT_ID.test(chatId) || !e || typeof e.updatedAt !== 'string' || !ISO.test(e.updatedAt)) continue;
        if (e.until !== undefined && (typeof e.until !== 'string' || !ISO.test(e.until))) continue;
        if (all[chatId] && all[chatId].updatedAt >= e.updatedAt) continue;
        const fresh: SeenEntry = { updatedAt: e.updatedAt };
        if (e.until) fresh.until = e.until;
        if (e.unread === true) fresh.unread = true;
        all[chatId] = changed[chatId] = fresh;
    }
    if (Object.keys(changed).length) writeJson('seen.json', all);
    return changed;
}
