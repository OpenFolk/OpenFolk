// Codex sessions from VS Code and the terminal, next to Claude Code's (vscode.ts): list, read, follow live and
// branch off. Codex keeps them compressed in ~/.codex/sessions, in a format of its own; the app-server lists, reads and
// forks them, so it is asked rather than the files read.
//
// Every app-server client counts as source 'vscode', the bots too. `originator` tells them apart: the Codex extension
// for VS Code writes 'codex_vscode', the CLI 'codex_cli_rs', OpenFolk its own name (and earlier names of the app).

import fs from 'node:fs';
import path from 'node:path';
import { CodexConnection, codexEnv, resultFrom, toolFrom, truncate, type Item } from './codex.ts';
import { engineKeyFor } from './engine-home.ts';
import { t } from './i18n.ts';
import { clean, type HistoryPart } from './vscode.ts';
import type { HistoryEntry, VscodeSession } from '../../shared/protocol.ts';

/** At most this many threads are asked for; bots and other programs are filtered out afterwards. */
const LIST_LIMIT = 120;
/** The connection for listing and reading ends after this long without a request. */
const IDLE_MS = 60_000;
/** While a browser watches, the thread is read again this often. */
const POLL_MS = 2_000;
/** Without a change for this long a turn still "in progress" counts as abandoned (VS Code closed mid-turn). */
const WORKING_MAX_MS = 3 * 60_000;

export interface CodexThread {
    id: string;
    preview: string;
    name: string | null;
    cwd: string;
    originator: string;
    source: string | Record<string, unknown>;
    updatedAt: number;
    path: string | null;
    gitInfo: { branch?: string | null } | null;
    turns?: CodexTurn[];
}

export interface CodexTurn {
    id: string;
    status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
    startedAt?: number | null;
    items: CodexItem[];
}

type CodexItem = Item & { text?: string; content?: { type: string; text?: string }[] };

/** Where a thread comes from: a person in VS Code or the terminal, or null (a bot, `codex exec`, a subagent). */
export function codexOrigin(x: Pick<CodexThread, 'originator' | 'source'>): VscodeSession['origin'] | null {
    if (x.originator === 'codex_cli_rs' || x.source === 'cli') return 'terminal';
    if (x.originator === 'codex_vscode') return 'vscode';
    return null;
}

/** The request of a message from VS Code without the IDE context Codex puts before it. */
export function codexText(text: string): string {
    const request = /^## My request(?: for Codex)?:\s*$/m.exec(text);
    const own = request && /^# Context from my IDE setup:/m.test(text) ? text.slice(request.index + request[0].length) : text;
    return clean(own);
}

/** History entries from the turns of a thread, as the bots' chats show them; `working` while a turn runs. */
export function codexEntries(turns: CodexTurn[], updatedAt: number): { entries: HistoryEntry[]; working: boolean } {
    const entries: HistoryEntry[] = [];
    for (const turn of turns) {
        const ts = new Date((turn.startedAt ?? updatedAt) * 1000).toISOString();
        let answer: HistoryEntry | null = null;
        for (const item of turn.items) {
            if (item.type === 'userMessage') {
                const text = codexText((item.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n\n'));
                const images = (item.content ?? []).filter((c) => c.type === 'image' || c.type === 'localImage').length;
                const all = text + (images ? `${text ? '\n\n' : ''}🖼 ${images === 1 ? t('vscode.oneImage') : t('vscode.images', { count: images })}` : '');
                if (all) entries.push({ id: item.id, role: 'user', from: 'me', text: all, ts });
                answer = null;
                continue;
            }
            if (item.type === 'contextCompaction') {
                entries.push({ id: item.id, role: 'event', text: t('vscode.compacted'), ts });
                answer = null;
                continue;
            }
            const text = item.type === 'agentMessage' ? (item.text ?? '').trim() : '';
            const call = text ? null : toolFrom(item);
            if (!text && !call) continue;
            if (!answer) {
                answer = { id: item.id, role: 'assistant', text: '', ts };
                entries.push(answer);
            }
            if (text) answer.text += (answer.text ? '\n\n' : '') + text;
            else if (call) {
                if (item.status && item.status !== 'inProgress') {
                    const r = resultFrom(item);
                    call.ok = r.ok;
                    call.result = truncate(r.text);
                }
                (answer.tools ??= []).push(call);
            }
        }
        if (turn.status === 'interrupted') entries.push({ role: 'event', text: t('vscode.interrupted'), ts });
    }
    const last = turns.at(-1);
    const working = last?.status === 'inProgress' && Date.now() - updatedAt * 1000 < WORKING_MAX_MS;
    return { entries, working };
}

// ------------------------------------------------------------------ The app-server

let shared: { v: CodexConnection; ready: Promise<void>; timer?: NodeJS.Timeout } | null = null;

/**
 * Runs a request on a connection kept for a minute. It uses the machine's Codex folder (or the account's), not the
 * one of an API key: VS Code and the terminal write there.
 */
async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!shared || !shared.v.running) {
        shared?.v.stop();
        const v = new CodexConnection(codexEnv(process.env, false), '');
        shared = { v, ready: v.start() };
        v.onEnd = () => { if (shared?.v === v) shared = null; };
    }
    const s = shared;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { s.v.stop(); if (shared === s) shared = null; }, IDLE_MS);
    s.timer.unref?.();
    try {
        await s.ready;
    } catch (e) {
        s.v.stop();
        if (shared === s) shared = null;
        throw e;
    }
    return s.v.call<T>(method, params);
}

export function stopCodexSessions(): void {
    clearTimeout(shared?.timer);
    shared?.v.stop();
    shared = null;
}

/** Codex sessions of people on the machine, newest first; `exclude` holds the bots' sessions ('codex:<id>'). */
export async function listCodexSessions(exclude: Set<string>, inFolder?: (cwd: string) => boolean): Promise<VscodeSession[]> {
    const r = await call<{ data: CodexThread[] }>('thread/list', { limit: LIST_LIMIT, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: ['cli', 'vscode'] });
    const list: VscodeSession[] = [];
    for (const x of r.data) {
        const origin = codexOrigin(x);
        if (!origin || !x.cwd || exclude.has(`codex:${x.id}`) || (inFolder && !inFolder(x.cwd))) continue;
        // Codex compresses a finished thread and keeps the old name in the list
        let size = 0;
        for (const file of x.path ? [x.path, `${x.path}.zst`] : []) {
            try {
                size = fs.statSync(file).size;
                break;
            } catch {
                // the other name
            }
        }
        const first = codexText(x.preview ?? '');
        list.push({
            id: x.id,
            engine: 'codex',
            title: oneLine(x.name || first || t('vscode.untitled'), 80),
            firstPrompt: oneLine(first, 140),
            lastModified: new Date(x.updatedAt * 1000).toISOString(),
            size,
            origin,
            open: false,
            working: false,
            branch: x.gitInfo?.branch || undefined,
            folder: path.resolve(x.cwd).replace(/\\/g, '/'),
        });
    }
    return list;
}

async function read(threadId: string): Promise<CodexThread> {
    return (await call<{ thread: CodexThread }>('thread/read', { threadId, includeTurns: true })).thread;
}

/** The last entries of a thread (for the history of an adopted session). */
export async function lastCodexEntries(threadId: string, count: number): Promise<HistoryEntry[]> {
    const x = await read(threadId);
    return codexEntries(x.turns ?? [], x.updatedAt).entries.slice(-count);
}

/** Title for a conversation made from the thread. */
export async function codexTitle(threadId: string): Promise<string> {
    const x = (await call<{ thread: CodexThread }>('thread/read', { threadId, includeTurns: false })).thread;
    return x.name || codexText(x.preview ?? '');
}

/**
 * A branch of the thread for a bot: a new thread with the whole history, the original stays as it is. With an API
 * key the bots' threads live in a Codex folder of their own, where the branch would not be found.
 */
export async function forkCodexThread(threadId: string): Promise<string> {
    if (engineKeyFor('codex')) throw new Error(t('vscode.codexKeyMode'));
    const r = await call<{ thread: { id: string } }>('thread/fork', { threadId, excludeTurns: true });
    return r.thread.id;
}

// ------------------------------------------------------------------ Following live

interface Watch {
    entries: HistoryEntry[];
    working: boolean;
    updatedAt: number;
    cids: Set<string>;
    timer: NodeJS.Timeout;
    busy: boolean;
}

/** Like vscode.ts' Watcher, for Codex threads: reads the thread again while a browser looks at it. */
export class CodexWatcher {
    private open = new Map<string, Watch>();

    private report: (part: HistoryPart, cid: string) => void;
    constructor(report: (part: HistoryPart, cid: string) => void) {
        this.report = report;
    }

    async openFor(cid: string, threadId: string, max: number): Promise<void> {
        let w = this.open.get(threadId);
        if (!w) {
            const x = await read(threadId);
            const { entries, working } = codexEntries(x.turns ?? [], x.updatedAt);
            w = this.open.get(threadId) ?? { entries, working, updatedAt: x.updatedAt, cids: new Set(), busy: false, timer: setInterval(() => void this.poll(threadId), POLL_MS) };
            w.timer.unref?.();
            this.open.set(threadId, w);
        }
        w.cids.add(cid);
        const from = Math.max(0, w.entries.length - max);
        this.report({ sessionId: threadId, from, entries: w.entries.slice(from), working: w.working }, cid);
    }

    close(cid: string, threadId?: string): void {
        for (const [id, w] of this.open) {
            if (threadId && id !== threadId) continue;
            w.cids.delete(cid);
            if (w.cids.size === 0) {
                clearInterval(w.timer);
                this.open.delete(id);
            }
        }
    }

    stop(): void {
        for (const w of this.open.values()) clearInterval(w.timer);
        this.open.clear();
    }

    private async poll(threadId: string): Promise<void> {
        const w = this.open.get(threadId);
        if (!w || w.busy) return;
        w.busy = true;
        try {
            const head = (await call<{ thread: CodexThread }>('thread/read', { threadId, includeTurns: false })).thread;
            // A running turn may change without the time moving on; read it until it is done
            if (head.updatedAt === w.updatedAt && !w.working) return;
            const x = await read(threadId);
            const { entries, working } = codexEntries(x.turns ?? [], x.updatedAt);
            w.updatedAt = x.updatedAt;
            let from = 0;
            while (from < entries.length && from < w.entries.length && JSON.stringify(entries[from]) === JSON.stringify(w.entries[from])) from++;
            const changed = from < entries.length || entries.length !== w.entries.length || working !== w.working;
            w.entries = entries;
            w.working = working;
            if (!changed || !this.open.has(threadId)) return;
            for (const cid of w.cids) this.report({ sessionId: threadId, from, entries: entries.slice(from), working }, cid);
        } catch {
            // the app-server is gone for a moment; the next round tries again
        } finally {
            w.busy = false;
        }
    }
}

function oneLine(s: string, max: number): string {
    const x = s.replace(/\s+/g, ' ').trim();
    return x.length > max ? x.slice(0, max - 1) + '…' : x;
}
