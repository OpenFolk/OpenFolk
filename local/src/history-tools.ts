// The bots' tools over the history (search_history, read_history in agent.ts): which chat a name means, what a time
// like "7d" means, and the answers as the bot reads them. Every chat on this machine belongs to the same user, so a
// bot searches all of them; a decision is usually asked about in another chat than the one it was made in.

import { findConversation, loadBots, loadGroups } from './bots.ts';
import { allChats } from './history.ts';
import { entriesAround, searchEntries } from './history-index.ts';

/** At most this many entries before and after a hit in read_history. */
export const AROUND_MAX = 10;
const ENTRY_CHARS = 2000;

/** A chat as the bot reads it: the bot's name, "Anna, conversation …" or "group …". */
export function chatName(chatId: string): string {
    if (chatId.startsWith('g:')) {
        const g = loadGroups().find((x) => x.id === chatId.slice(2));
        return g ? `group ${g.name}` : chatId;
    }
    const c = findConversation(chatId);
    if (c) return `${c.bot.name}, conversation "${c.title}"`;
    return loadBots().find((b) => b.id === chatId)?.name ?? chatId;
}

/** Who wrote: "user", a bot's name or "routine …". */
function senderName(from: string): string {
    if (from === 'me') return 'user';
    if (from.startsWith('routine:')) return `routine ${from.slice(8)}`;
    return loadBots().find((b) => b.id === from)?.name ?? from;
}

/** A chat id from what the bot passes: "this", a chat id, a bot's or a group's id or name; null if unknown. */
export function resolveChat(name: string, current: string): string | null {
    const n = name.trim();
    if (!n) return null;
    if (n === 'this') return current;
    if (allChats().includes(n)) return n;
    const lower = n.toLowerCase();
    const bot = loadBots().find((b) => b.id === lower || b.name.toLowerCase() === lower);
    if (bot) return bot.id;
    const group = loadGroups().find((g) => g.id === lower || g.name.toLowerCase() === lower);
    return group ? `g:${group.id}` : null;
}

/** A sender filter from "user"/"me", a bot's id or name; null if unknown. */
function resolveSender(name: string): string | null {
    const lower = name.trim().toLowerCase();
    if (lower === 'me' || lower === 'user') return 'me';
    if (lower.startsWith('routine:')) return lower;
    return loadBots().find((b) => b.id === lower || b.name.toLowerCase() === lower)?.id ?? null;
}

const UNIT_MS: Record<string, number> = { h: 3600_000, d: 86_400_000, w: 7 * 86_400_000, m: 30 * 86_400_000 };

/** "7d", "2w", "3m", "12h" back from now, or a date or time; null if it is neither. */
export function parseTime(value: string, now = Date.now()): string | null {
    const v = value.trim().toLowerCase();
    const rel = /^(\d+)\s*([hdwm])$/.exec(v);
    if (rel) return new Date(now - Number(rel[1]) * UNIT_MS[rel[2]]).toISOString();
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const minute = (ts: string) => ts.slice(0, 16).replace('T', ' ');

export interface SearchArgs { query: string; chat?: string; from?: string; since?: string; until?: string; max?: number }

/**
 * The answer to search_history. `elsewhere`: bots running on another machine right now, whose latest chats are
 * there and not searched here.
 */
export function searchHistoryText(a: SearchArgs, current: string, elsewhere: string[], now = Date.now()): { text: string; error?: boolean } {
    const chats = a.chat ? resolveChat(a.chat, current) : undefined;
    if (chats === null) return { text: `There is no chat "${a.chat}". Use a bot's or group's name, a chat id or "this".`, error: true };
    const from = a.from ? resolveSender(a.from) : undefined;
    if (from === null) return { text: `Unknown sender "${a.from}". Use "user", a bot's name or "routine:<name>".`, error: true };
    const since = a.since ? parseTime(a.since, now) : undefined;
    const until = a.until ? parseTime(a.until, now) : undefined;
    if (since === null || until === null) return { text: 'since and until take a date (2026-10-01), a time or a span back from now (12h, 7d, 2w, 3m).', error: true };
    const max = Math.min(Math.max(a.max ?? 20, 1), 50);
    const hits = searchEntries(a.query, { chats: chats ? [chats] : undefined, from, since, until, max });
    const note = elsewhere.length ? `\nNot searched: the chats of ${elsewhere.join(', ')} run on another machine right now; ask that bot with message_bot if it matters.` : '';
    if (!hits.length) return { text: `No hits for "${a.query}". Every word has to occur; try fewer or other words.${note}` };
    const lines = hits.map((h) => `- ${minute(h.ts)} · ${chatName(h.chatId)} [chat ${h.chatId}] · ${senderName(h.from)}: ${h.excerpt} [entry ${h.id}]`);
    return { text: `${hits.length} hit(s), best first. read_history shows an entry with what was said around it.\n${lines.join('\n')}${note}` };
}

export interface ReadArgs { chat: string; entry_id: string; before?: number; after?: number }

/** The answer to read_history: the entries around one, without the tools' output. */
export function readHistoryText(a: ReadArgs, current: string): { text: string; error?: boolean } {
    const chat = resolveChat(a.chat, current);
    if (!chat) return { text: `There is no chat "${a.chat}".`, error: true };
    const clamp = (n: number | undefined) => Math.min(Math.max(n ?? 3, 0), AROUND_MAX);
    const entries = entriesAround(chat, a.entry_id, clamp(a.before), clamp(a.after));
    if (!entries.length) return { text: `No entry "${a.entry_id}" in ${chatName(chat)}.`, error: true };
    const lines = entries.map((e) => {
        const text = e.text.length > ENTRY_CHARS ? `${e.text.slice(0, ENTRY_CHARS)} …[shortened]` : e.text;
        return `## ${minute(e.ts)} · ${senderName(e.from)}${e.id === a.entry_id ? ' (the hit)' : ''}\n${text}`;
    });
    return { text: `${chatName(chat)}:\n\n${lines.join('\n\n')}` };
}
