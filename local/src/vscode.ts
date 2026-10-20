// Sessions that run on the machine in VS Code (or in the terminal): list them, read them as history, follow them
// live and adopt them as a branch into a conversation. The transcripts live under ~/.claude/projects/<folder>/<id>.jsonl.
//
// The bots write into the same folder. `entrypoint` does not separate them: a backend started from a VS Code
// terminal inherits `claude-vscode`. Reliable is `turnOrigin` of the first message ('sdk' for the bots, 'human'
// in VS Code) together with the bots' session ids from sessions.json.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { claudeConfigDir } from './engine-home.ts';
import { t } from './i18n.ts';
import { toolSummary } from './session.ts';
import type { HistoryEntry, ToolCall, VscodeSession } from '../../shared/protocol.ts';

/** At most this many sessions are listed (the newest). */
const MAX_LIST = 30;
/** This many entries go to the browser on open. */
export const MAX_ENTRIES = 300;
const MAX_RESULT = 1500;
/** Without writing for this many minutes a session that is not open no longer counts as working. */
const WORKING_MAX_MIN = 3;
const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 256 * 1024;
const PROCESS_CACHE_MS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The current account's Claude Code folder (engine-home.ts). */
function claudeHome(): string {
    return claudeConfigDir();
}

/** Transcript folder of a project as Claude Code names it (everything except a-z0-9 becomes '-'). */
export function projectDir(folder: string): string {
    return path.join(claudeHome(), 'projects', path.resolve(folder).replace(/[^a-zA-Z0-9]/g, '-'));
}

/**
 * Why the CLI cannot store transcripts right now, or null. A real-world case: `projects` is a link to a cloud
 * drive that is not mounted (yet); the CLI then silently writes nothing, and every resume after a restart fails.
 */
export function transcriptStoreError(): string | null {
    const store = path.join(claudeHome(), 'projects');
    let link: fs.Stats;
    try {
        link = fs.lstatSync(store);
    } catch {
        return null; // missing entirely: the CLI creates it itself
    }
    if (!link.isSymbolicLink()) return link.isDirectory() ? null : t('vscode.storeNotFolder', { path: store });
    let target = '?';
    try {
        target = fs.readlinkSync(store);
        if (fs.statSync(store).isDirectory()) return null;
    } catch {
        // target not reachable
    }
    return t('vscode.storeUnreachable', { path: store, target });
}

export function transcriptPath(folder: string, sessionId: string): string {
    if (!UUID.test(sessionId)) throw new Error(t('vscode.invalidSessionId'));
    return path.join(projectDir(folder), `${sessionId}.jsonl`);
}

function readBytes(file: string, from: number, length: number): Buffer {
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(length);
        const n = fs.readSync(fd, buf, 0, length, from);
        return buf.subarray(0, n);
    } finally {
        fs.closeSync(fd);
    }
}

function linesFrom(buf: Buffer): Record<string, unknown>[] {
    const r: Record<string, unknown>[] = [];
    for (const l of buf.toString('utf8').split('\n')) {
        if (!l.trim()) continue;
        try {
            r.push(JSON.parse(l) as Record<string, unknown>);
        } catch {
            // cut line at the edge of the excerpt
        }
    }
    return r;
}

const originCache = new Map<string, VscodeSession['origin'] | null>();

/** Where the session comes from, according to the first real message; null = bot or another program. */
export function originFrom(lines: Record<string, unknown>[]): VscodeSession['origin'] | null | undefined {
    for (const r of lines) {
        if (r.type !== 'user' || r.isMeta || r.isSidechain) continue;
        // VS Code uses the SDK itself (promptSource 'sdk'); only turnOrigin separates human and program
        if (r.turnOrigin === 'sdk') return null;
        const ep = String(r.entrypoint ?? '');
        if (!r.turnOrigin && ep.startsWith('sdk')) return null;
        if (ep === 'claude-vscode') return 'vscode';
        if (ep === 'cli' || ep === '') return 'terminal';
        return null;
    }
    return undefined;
}

function origin(file: string): VscodeSession['origin'] | null {
    if (originCache.has(file)) return originCache.get(file)!;
    let h: VscodeSession['origin'] | null | undefined;
    try {
        h = originFrom(linesFrom(readBytes(file, 0, HEAD_BYTES)));
    } catch {
        h = null;
    }
    // No message yet (just created): do not remember, check again next time
    if (h !== undefined) originCache.set(file, h);
    return h ?? null;
}

let processes: { time: number; ids: Promise<Set<string>> } | null = null;

/**
 * Session ids a Claude process outside the bots has open right now (VS Code starts the CLI with
 * --resume=<id>). New sessions that were never resumed are not on the command line.
 */
function openSessions(): Promise<Set<string>> {
    if (processes && Date.now() - processes.time < PROCESS_CACHE_MS) return processes.ids;
    const ids = new Promise<Set<string>>((resolve) => {
        const [command, args] = process.platform === 'win32'
            ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object { $_.CommandLine }"]]
            : ['ps', ['-eo', 'args']];
        execFile(command, args, { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_e, stdout) => {
            const r = new Set<string>();
            for (const l of String(stdout ?? '').split(/\r?\n/)) {
                if (!l || l.includes('claude-agent-sdk')) continue;
                const m = /--(?:resume|session-id)[= ]"?([0-9a-f-]{36})/i.exec(l);
                if (m) r.add(m[1].toLowerCase());
            }
            resolve(r);
        });
    });
    processes = { time: Date.now(), ids };
    return ids;
}

/** Is Claude still working according to the last message (answer or tool open)? */
export function workingFrom(lines: Record<string, unknown>[]): boolean {
    for (let i = lines.length - 1; i >= 0; i--) {
        const r = lines[i];
        if (r.isSidechain || r.isMeta) continue;
        if (r.type === 'assistant') {
            const stop = (r.message as { stop_reason?: string | null } | undefined)?.stop_reason;
            if (stop === undefined || stop === null) continue;
            return stop === 'tool_use';
        }
        if (r.type === 'user') {
            const text = userText(r);
            return !text.startsWith('[Request interrupted');
        }
    }
    return false;
}

const cwdCache = new Map<string, string | null>();

/** Working folder for which Claude Code created a project folder (according to `cwd` in the newest transcript). */
function cwdOf(dir: string): string | null {
    if (cwdCache.has(dir)) return cwdCache.get(dir)!;
    let cwd: string | null = null;
    try {
        const files = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
            .map((n) => path.join(dir, n))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        for (const d of files.slice(0, 3)) {
            const z = linesFrom(readBytes(d, 0, 64 * 1024)).find((r) => typeof r.cwd === 'string');
            if (z) { cwd = path.resolve(String(z.cwd)); break; }
        }
    } catch {
        // not readable
    }
    // Without a transcript (yet) remember nothing
    if (cwd) cwdCache.set(dir, cwd);
    return cwd;
}

function isInside(p: string, folder: string): boolean {
    const rel = path.relative(path.resolve(folder), path.resolve(p));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Folders in which sessions of this bot can live: its own and all subfolders in which Claude Code was started
 * (`claude` in the terminal from `…/backend`). Subfolders covered more precisely by another bot belong to that one;
 * the names of the project folders cannot be reversed, so the `cwd` in the transcript counts.
 */
export function sessionFolders(folder: string, otherBots: string[]): string[] {
    const base = path.basename(projectDir(folder));
    const projects = path.dirname(projectDir(folder));
    const r = [path.resolve(folder)];
    let names: string[] = [];
    try {
        names = fs.readdirSync(projects).filter((n) => n.startsWith(base + '-'));
    } catch {
        return r;
    }
    const closer = otherBots.map((b) => path.resolve(b)).filter((b) => b !== path.resolve(folder) && isInside(b, folder));
    for (const n of names) {
        const cwd = cwdOf(path.join(projects, n));
        if (!cwd || !isInside(cwd, folder) || r.includes(cwd)) continue;
        if (closer.some((b) => isInside(cwd, b))) continue;
        if (projectDir(cwd) !== path.join(projects, n)) continue;
        r.push(cwd);
    }
    return r;
}

/** Sessions on the machine in the bot's folder and its subfolders, newest first; `exclude` are the bots' sessions. */
export async function listVscodeSessions(folder: string, exclude: Set<string>, otherBots: string[] = []): Promise<VscodeSession[]> {
    const folders = sessionFolders(folder, otherBots);
    const [lists, open] = await Promise.all([
        Promise.all(folders.map((o) => listSessions({ dir: o, includeProgrammatic: false, includeWorktrees: false, limit: MAX_LIST * 2 })
            .then((l) => l.map((s) => ({ s, o }))))),
        openSessions(),
    ]);
    const list = lists.flat().sort((a, b) => b.s.lastModified - a.s.lastModified);
    const r: VscodeSession[] = [];
    for (const { s, o } of list) {
        if (r.length >= MAX_LIST) break;
        if (exclude.has(s.sessionId)) continue;
        const file = transcriptPath(o, s.sessionId);
        const h = origin(file);
        if (!h) continue;
        let working = false;
        try {
            const size = fs.statSync(file).size;
            const tail = linesFrom(readBytes(file, Math.max(0, size - TAIL_BYTES), TAIL_BYTES));
            const isOpen = open.has(s.sessionId);
            working = workingFrom(tail) && (isOpen || Date.now() - s.lastModified < WORKING_MAX_MIN * 60_000);
        } catch {
            continue;
        }
        r.push({
            id: s.sessionId,
            title: oneLine(s.customTitle || s.summary || s.firstPrompt || t('vscode.untitled'), 80),
            firstPrompt: oneLine(s.firstPrompt ?? '', 140),
            lastModified: new Date(s.lastModified).toISOString(),
            size: s.fileSize ?? 0,
            origin: h,
            open: open.has(s.sessionId),
            working,
            branch: s.gitBranch || undefined,
            folder: o === path.resolve(folder) ? undefined : o.replace(/\\/g, '/'),
        });
    }
    return r;
}

function oneLine(s: string, max: number): string {
    const x = s.replace(/\s+/g, ' ').trim();
    return x.length > max ? x.slice(0, max - 1) + '…' : x;
}

// ------------------------------------------------------------------ Transcript to history entries

/** Text of a user message without the additions VS Code and the CLI send along. */
function userText(r: Record<string, unknown>): string {
    const content = (r.message as { content?: unknown } | undefined)?.content;
    let text = '';
    let images = 0;
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
        for (const b of content as Record<string, unknown>[]) {
            if (b.type === 'text') text += (text ? '\n\n' : '') + String(b.text ?? '');
            else if (b.type === 'image') images++;
        }
    }
    return clean(text) + (images ? `${text ? '\n\n' : ''}🖼 ${images === 1 ? t('vscode.oneImage') : t('vscode.images', { count: images })}` : '');
}

export function clean(text: string): string {
    // Output of local commands (/model, /cost …) and notes of the CLI are not a message
    if (/^\s*<(local-command-stdout|local-command-caveat|bash-stdout|bash-stderr)>/.test(text)) return '';
    const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
    if (command) {
        const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1].trim();
        return `${command[1].trim()}${args ? ' ' + args : ''}`;
    }
    const shell = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
    if (shell) return `! ${shell[1].trim()}`;
    return text
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
        .replace(/<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g, '')
        .replace(/<\/?pasted_content[^>]*>/g, '')
        .trim();
}

function resultText(content: unknown): string {
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
        text = content.map((c: Record<string, unknown>) => (c.type === 'text' ? String(c.text) : c.type === 'image' ? '[Image]' : '')).join('\n');
    }
    return text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + '\n…' : text;
}

/**
 * Builds history entries from the lines of a transcript: the user's messages, answers with their tools
 * (results are filled in later) and notes. Lines can be appended bit by bit.
 */
export class Transcript {
    entries: HistoryEntry[] = [];
    working = false;
    private answer: HistoryEntry | null = null;
    private tools = new Map<string, { call: ToolCall; index: number }>();

    /** Processes a line; returns the smallest changed index, -1 = nothing changed. */
    line(r: Record<string, unknown>): number {
        if (r.isSidechain) return -1;
        const ts = typeof r.timestamp === 'string' ? r.timestamp : new Date().toISOString();
        const id = typeof r.uuid === 'string' ? r.uuid : undefined;
        if (r.type === 'system') {
            if (r.subtype !== 'compact_boundary') return -1;
            return this.note(t('vscode.compacted'), ts, id);
        }
        if (r.type === 'user') {
            if (r.isCompactSummary) return -1;
            const content = (r.message as { content?: unknown } | undefined)?.content;
            if (Array.isArray(content) && (content as Record<string, unknown>[]).some((b) => b.type === 'tool_result')) {
                let min = -1;
                for (const b of content as Record<string, unknown>[]) {
                    if (b.type !== 'tool_result') continue;
                    const x = this.tools.get(String(b.tool_use_id));
                    if (!x) continue;
                    x.call.ok = b.is_error !== true;
                    x.call.result = resultText(b.content);
                    min = min < 0 ? x.index : Math.min(min, x.index);
                }
                this.working = true;
                return min;
            }
            if (r.isMeta) return -1;
            const text = userText(r);
            if (!text) return -1;
            if (text.startsWith('[Request interrupted')) {
                this.working = false;
                return this.note(t('vscode.interrupted'), ts, id);
            }
            this.answer = null;
            this.working = true;
            this.entries.push({ id, role: 'user', from: 'me', text, ts });
            return this.entries.length - 1;
        }
        if (r.type === 'assistant') {
            if (r.isApiErrorMessage) return -1;
            const m = r.message as { content?: Record<string, unknown>[]; stop_reason?: string | null } | undefined;
            if (m?.stop_reason) this.working = m.stop_reason === 'tool_use';
            let min = -1;
            for (const b of m?.content ?? []) {
                if (b.type !== 'text' && b.type !== 'tool_use') continue;
                if (b.type === 'text' && !String(b.text ?? '').trim()) continue;
                if (!this.answer) {
                    this.answer = { id, role: 'assistant', text: '', ts };
                    this.entries.push(this.answer);
                }
                const index = this.entries.length - 1;
                if (b.type === 'text') {
                    this.answer.text += (this.answer.text ? '\n\n' : '') + String(b.text);
                } else {
                    const call: ToolCall = { id: String(b.id), name: String(b.name), summary: toolSummary(String(b.name), b.input) };
                    (this.answer.tools ??= []).push(call);
                    this.tools.set(call.id, { call, index });
                }
                min = min < 0 ? index : min;
            }
            return min;
        }
        return -1;
    }

    private note(text: string, ts: string, id?: string): number {
        this.answer = null;
        this.entries.push({ id, role: 'event', text, ts });
        return this.entries.length - 1;
    }
}

// ------------------------------------------------------------------ Following live

export interface HistoryPart {
    sessionId: string;
    /** Index of the first entry in `entries`; from there the browser replaces its state. */
    from: number;
    entries: HistoryEntry[];
    working: boolean;
}

interface Watch {
    file: string;
    sessionId: string;
    transcript: Transcript;
    read: number;
    rest: Buffer;
    cids: Set<string>;
    listener: (cur: fs.Stats, prev: fs.Stats) => void;
}

/**
 * Keeps the opened transcripts and reports new lines to the browsers looking at them.
 * fs.watchFile polls the size once per second; fs.watch does not report every change on Windows.
 */
export class Watcher {
    private open = new Map<string, Watch>();

    private report: (part: HistoryPart, cid: string) => void;
    constructor(report: (part: HistoryPart, cid: string) => void) {
        this.report = report;
    }

    /** Opens a transcript for a browser and sends it the latest entries. */
    openFor(cid: string, file: string, sessionId: string): void {
        let b = this.open.get(file);
        if (!b) {
            if (!fs.existsSync(file)) throw new Error(t('vscode.sessionGone'));
            b = { file, sessionId, transcript: new Transcript(), read: 0, rest: Buffer.alloc(0), cids: new Set(), listener: () => this.reread(file) };
            this.open.set(file, b);
            this.readNew(b);
            fs.watchFile(file, { interval: 1000 }, b.listener);
        }
        b.cids.add(cid);
        const all = b.transcript.entries;
        const from = Math.max(0, all.length - MAX_ENTRIES);
        this.report({ sessionId, from, entries: all.slice(from), working: b.transcript.working }, cid);
    }

    close(cid: string, sessionId?: string): void {
        for (const [file, b] of this.open) {
            if (sessionId && b.sessionId !== sessionId) continue;
            b.cids.delete(cid);
            if (b.cids.size === 0) {
                fs.unwatchFile(file, b.listener);
                this.open.delete(file);
            }
        }
    }

    /** Reads new bytes from the last position; returns the smallest changed index (-1 = nothing). */
    private readNew(b: Watch): number {
        const size = fs.statSync(b.file).size;
        if (size <= b.read) return -1;
        const fresh = Buffer.concat([b.rest, readBytes(b.file, b.read, size - b.read)]);
        b.read = size;
        const end = fresh.lastIndexOf(0x0a);
        b.rest = end < 0 ? fresh : fresh.subarray(end + 1);
        if (end < 0) return -1;
        let min = -1;
        for (const l of fresh.subarray(0, end).toString('utf8').split('\n')) {
            if (!l.trim()) continue;
            let r: Record<string, unknown>;
            try {
                r = JSON.parse(l) as Record<string, unknown>;
            } catch {
                continue;
            }
            const i = b.transcript.line(r);
            if (i >= 0) min = min < 0 ? i : Math.min(min, i);
        }
        return min;
    }

    private reread(file: string): void {
        const b = this.open.get(file);
        if (!b) return;
        const before = b.transcript.working;
        let from: number;
        try {
            // Got shorter (rewritten): from the start
            if (fs.statSync(file).size < b.read) {
                b.transcript = new Transcript();
                b.read = 0;
                b.rest = Buffer.alloc(0);
                this.readNew(b);
                from = Math.max(0, b.transcript.entries.length - MAX_ENTRIES);
            } else {
                from = this.readNew(b);
            }
        } catch {
            return;
        }
        if (from < 0 && before === b.transcript.working) return;
        const all = b.transcript.entries;
        const start = from < 0 ? all.length : from;
        for (const cid of b.cids) this.report({ sessionId: b.sessionId, from: start, entries: all.slice(start), working: b.transcript.working }, cid);
    }

    /** The last entries of a transcript (for the history of an adopted session). */
    static last(file: string, count: number): HistoryEntry[] {
        const x = new Transcript();
        for (const r of linesFrom(fs.readFileSync(file))) x.line(r);
        return x.entries.slice(-count);
    }
}
