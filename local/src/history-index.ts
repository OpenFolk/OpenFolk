// Search over the history of all chats on this machine, for the web app's search and the bots' search_history.
// One index per chat in memory, built from its JSONL file and built again only when the file's size or time
// changed, so a long chat costs when it grows, not on every search. Indexed are what people and bots wrote:
// messages and answers, never events or the tools' output (file contents, diffs, logs would outrank every
// decision). Entries deleted from the queue stay out, and so do the ones moved to another conversation, which
// holds the copy.

import fs from 'node:fs';
import { allChats, historyFile, withId } from './history.ts';
import type { HistoryEntry, SearchHit } from '../../shared/protocol.ts';

interface IndexedEntry {
    id: string;
    ts: string;
    /** 'me', a bot id or 'routine:<name>' */
    from: string;
    text: string;
    lower: string;
}

/** By file, not by chat id: the same chat id can exist in two accounts. */
const indexes = new Map<string, { mtimeMs: number; size: number; entries: IndexedEntry[] }>();

function index(chatId: string): IndexedEntry[] {
    const file = historyFile(chatId);
    let st: fs.Stats;
    try {
        st = fs.statSync(file);
    } catch {
        indexes.delete(file);
        return [];
    }
    const hit = indexes.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entries;
    const entries: IndexedEntry[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        let e: HistoryEntry;
        try {
            e = withId(JSON.parse(line) as HistoryEntry);
        } catch {
            continue;
        }
        if (e.role === 'event' || !e.text || e.deletedAt || e.movedTo) continue;
        entries.push({ id: e.id!, ts: e.ts, from: e.role === 'assistant' ? (e.botId ?? '') : (e.from ?? 'me'), text: e.text, lower: e.text.toLowerCase() });
    }
    indexes.set(file, { mtimeMs: st.mtimeMs, size: st.size, entries });
    return entries;
}

/**
 * A light stem, so "deployen" finds "Deploy" and "Releases" finds "Release": common German and English endings
 * come off longer words. Matching is by substring, so the stem also finds every longer form.
 */
export function stem(word: string): string {
    if (word.length >= 6 && /(en|er|es|ed)$/.test(word)) return word.slice(0, -2);
    if (word.length >= 5 && /[enst]$/.test(word)) return word.slice(0, -1);
    return word;
}

export interface Query {
    /** Single words, stemmed; every one must occur. */
    terms: string[];
    /** Text in "quotes", which must occur as it is. */
    phrases: string[];
    /** The words in their order, to rank entries that contain them as written. */
    whole: string;
}

/** Words of at least two letters or digits, lower case; "…" keeps a phrase together. */
export function parseQuery(query: string): Query {
    const phrases: string[] = [];
    const rest = query.toLowerCase().replace(/"([^"]*)"/g, (_m, p: string) => {
        const t = p.trim().replace(/\s+/g, ' ');
        if (t.length >= 2) phrases.push(t);
        return ' ';
    });
    const words = rest.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    return { terms: words.map(stem), phrases, whole: words.join(' ') };
}

export interface SearchOptions {
    /** Only these chats; default all chats on this machine. */
    chats?: string[];
    /** Only from this sender: 'me', a bot id or 'routine:<name>'. */
    from?: string;
    /** ISO times, inclusive. */
    since?: string;
    until?: string;
    max?: number;
    /** rank (default): best match first; time: newest first, as the web app steps through hits in a chat. */
    order?: 'rank' | 'time';
}

/** Where a hit starts (for the excerpt): the first phrase or term found. */
function firstPosition(lower: string, q: Query): { at: number; length: number } {
    for (const p of q.phrases) {
        const at = lower.indexOf(p);
        if (at >= 0) return { at, length: p.length };
    }
    let best = { at: -1, length: 0 };
    for (const t of q.terms) {
        const at = lower.indexOf(t);
        if (at >= 0 && (best.at < 0 || at < best.at)) best = { at, length: t.length };
    }
    return best;
}

/**
 * 3: the words as written (or the only word or phrase), 2: all words within a sentence's reach of one another,
 * 1: all words somewhere in the entry.
 */
function rank(lower: string, q: Query): number {
    if (q.terms.length + q.phrases.length <= 1) return 3;
    if (q.whole && q.terms.length > 1 && lower.includes(q.whole)) return 3;
    const at = q.terms.map((t) => lower.indexOf(t));
    return Math.max(...at) - Math.min(...at) <= 80 ? 2 : 1;
}

function excerpt(text: string, at: number, length: number): string {
    const from = Math.max(0, at - 60);
    const to = Math.min(text.length, at + length + 80);
    return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
}

/**
 * Entries that contain every word and phrase of `query`, best match first and the newest among equals; at most
 * `max` (default 50). Fewer than two letters search nothing.
 */
export function searchEntries(query: string, o: SearchOptions = {}): SearchHit[] {
    const q = parseQuery(query);
    if (!q.terms.length && !q.phrases.length) return [];
    const ranked: { hit: SearchHit; rank: number }[] = [];
    for (const chatId of o.chats ?? allChats()) {
        for (const e of index(chatId)) {
            if (o.from && e.from !== o.from) continue;
            if (o.since && e.ts < o.since) continue;
            if (o.until && e.ts > o.until) continue;
            if (!q.terms.every((t) => e.lower.includes(t)) || !q.phrases.every((p) => e.lower.includes(p))) continue;
            const pos = firstPosition(e.lower, q);
            ranked.push({ hit: { chatId, id: e.id, ts: e.ts, from: e.from, excerpt: excerpt(e.text, pos.at, pos.length) }, rank: rank(e.lower, q) });
        }
    }
    const byRank = o.order !== 'time';
    ranked.sort((a, b) => (byRank ? b.rank - a.rank : 0) || b.hit.ts.localeCompare(a.hit.ts));
    return ranked.slice(0, o.max ?? 50).map((r) => r.hit);
}

/** The indexed entries around one entry (`before` earlier, `after` later); empty if the entry is not there. */
export function entriesAround(chatId: string, id: string, before = 3, after = 3): IndexedEntry[] {
    const all = index(chatId);
    const i = all.findIndex((e) => e.id === id);
    if (i < 0) return [];
    return all.slice(Math.max(0, i - before), i + after + 1);
}
