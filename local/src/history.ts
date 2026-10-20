import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { searchEntries } from './history-index.ts';
import { accountPath, PRIVATE } from './store.ts';
import type { HistoryEntry, SearchHit } from '../../shared/protocol.ts';

/** Group chats ('g:<id>') are stored as group-<id>.jsonl next to the bot chats; conversations keep their '~'. */
export function historyFile(chatId: string): string {
    const name = chatId.startsWith('g:') ? `group-${chatId.slice(2)}` : chatId;
    return accountPath('history', `${name.replace(/[^a-z0-9~-]/gi, '_')}.jsonl`);
}
const file = historyFile;

function chatIdFromFile(name: string): string {
    const base = name.replace(/\.jsonl$/, '');
    return base.startsWith('group-') ? `g:${base.slice(6)}` : base;
}

/**
 * Entries from before ids existed get a fixed id derived from their content. The prefix 'alt-' and the hashed
 * fields stay as they are, otherwise machines would derive different ids for the same old entry.
 */
export function withId(e: HistoryEntry): HistoryEntry {
    if (e.id) return e;
    const h = createHash('sha1').update(`${e.ts}|${e.role}|${e.from ?? ''}|${e.botId ?? ''}|${e.text}`).digest('hex').slice(0, 16);
    return { ...e, id: `alt-${h}` };
}

/** Appends an entry; assigns an id if it has none. Returns the stored entry. */
export function appendEntry(chatId: string, entry: HistoryEntry): HistoryEntry {
    const e = entry.id ? entry : { id: randomUUID(), ...entry };
    const p = file(chatId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(e) + '\n', { mode: PRIVATE });
    return e;
}

function readAll(chatId: string): HistoryEntry[] {
    let content: string;
    try {
        content = fs.readFileSync(file(chatId), 'utf8');
    } catch {
        return [];
    }
    const entries: HistoryEntry[] = [];
    for (const line of content.split('\n')) {
        if (!line) continue;
        try {
            entries.push(withId(JSON.parse(line) as HistoryEntry));
        } catch {
            // skip a broken line (e.g. crash while writing)
        }
    }
    return entries;
}

/**
 * The web app's search over all chats or one (history-index.ts): every word must occur, case-insensitive; newest
 * first, with an excerpt around the hit.
 */
export function searchHistory(query: string, max = 50, onlyChat?: string): SearchHit[] {
    return searchEntries(query, { max, chats: onlyChat ? [onlyChat] : undefined, order: 'time' });
}

export function readHistory(chatId: string, limit = 200): HistoryEntry[] {
    return readAll(chatId).slice(-limit);
}

export function countEntries(chatId: string): number {
    return readAll(chatId).length;
}

export function deleteHistory(chatId: string): void {
    fs.rmSync(file(chatId), { force: true });
}

/** All chats with history on this machine. */
export function allChats(): string[] {
    try {
        return fs.readdirSync(accountPath('history')).filter((n) => n.endsWith('.jsonl')).map(chatIdFromFile);
    } catch {
        return [];
    }
}

/** Changes an entry (the file is rewritten); `change` returns false if there is nothing to do. */
function changeEntry(chatId: string, id: string, change: (e: HistoryEntry) => boolean): HistoryEntry | undefined {
    const all = readAll(chatId);
    const e = all.find((x) => x.id === id);
    if (!e || !change(e)) return undefined;
    const p = file(chatId);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, all.map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: PRIVATE });
    fs.renameSync(tmp, p);
    return e;
}

/** Sets `readAt` on an entry (only the first time). Returns false if there was nothing to do. */
export function markRead(chatId: string, id: string, ts: string): boolean {
    return !!changeEntry(chatId, id, (e) => {
        if (e.readAt) return false;
        e.readAt = ts;
        return true;
    });
}

/** Notes that the message was moved into another conversation; returns the entry. */
export function markMoved(chatId: string, id: string, to: string): HistoryEntry | undefined {
    return changeEntry(chatId, id, (e) => {
        if (e.movedTo) return false;
        e.movedTo = to;
        return true;
    });
}

/** Notes that the waiting message was deleted; returns false if there was nothing to do. */
export function markDeleted(chatId: string, id: string, ts: string): boolean {
    return !!changeEntry(chatId, id, (e) => {
        if (e.deletedAt) return false;
        e.deletedAt = ts;
        return true;
    });
}

/** Notes that the waiting message was discarded (only while the bot has not read it). */
export function markDiscarded(chatId: string, id: string, ts: string): boolean {
    return !!changeEntry(chatId, id, (e) => {
        if (e.readAt || e.deletedAt || e.discardedAt) return false;
        e.discardedAt = ts;
        return true;
    });
}

/** Read an entry for checks, e.g. whether a message has been read already. */
export function readEntry(chatId: string, id: string): HistoryEntry | undefined {
    return readAll(chatId).find((e) => e.id === id);
}

/** History for display: without deleted messages (syncing between machines keeps them as markers). */
export function readVisible(chatId: string, limit = 200): HistoryEntry[] {
    return readAll(chatId).filter((e) => !e.deletedAt).slice(-limit);
}

/**
 * History for the browser: without the tools' output, which makes up most of the data and mostly stays
 * collapsed (tablet and phone froze briefly when switching chats). The browser fetches it via tool_output.
 */
export function withoutToolOutput(entries: HistoryEntry[]): HistoryEntry[] {
    return entries.map((e) => !e.tools?.some((t) => t.result) ? e : {
        ...e,
        tools: e.tools.map(({ result, ...t }) => (result ? { ...t, deferred: true } : t)),
    });
}

export function toolOutput(chatId: string, entryId: string, toolId: string): string | undefined {
    return readAll(chatId).find((e) => e.id === entryId)?.tools?.find((t) => t.id === toolId)?.result;
}

/**
 * Inserts entries of another machine: adds missing ones by id, sorted by time.
 * Returns the number of new entries.
 */
export function mergeHistory(chatId: string, others: HistoryEntry[]): number {
    const own = readAll(chatId);
    const known = new Set(own.map((e) => e.id));
    const fresh = others.map(withId).filter((e) => !known.has(e.id));
    if (fresh.length === 0) return 0;
    const all = [...own, ...fresh].sort((a, b) => a.ts.localeCompare(b.ts));
    const p = file(chatId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, all.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: PRIVATE });
    fs.renameSync(tmp, p);
    return fresh.length;
}
