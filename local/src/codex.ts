// Connection to OpenAI Codex via `codex app-server` (JSON-RPC over stdio), as a second engine next to Claude Code.
// A bot runs with Codex if its model is 'codex' or 'codex:<model>'. Sign-in through the ChatGPT subscription (login
// of the Codex CLI or app in ~/.codex), or, if the machine settings say so, the OpenAI API key stored there. Keys from
// the environment are never used.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { claudeConfigDir, engineEnv, engineKeyFor } from './engine-home.ts';
import { t } from './i18n.ts';
import { dataPath } from './store.ts';
import type { ModelInfo, ToolCall } from '../../shared/protocol.ts';
import { RpcProcess, type Params } from './rpc.ts';
import { toolSummary } from './session.ts';

const MAX_RESULT = 4000;

/** Variables through which Codex would bill via an API key the machine settings do not know of. */
const API_KEYS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'];

const PACKAGES: Record<string, [string, string]> = {
    'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
    'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
    'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
    'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
    'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
    'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
};

/** Path to the Codex CLI: CODEX_BIN, otherwise the binary from the npm dependency @openai/codex. */
export function codexBinary(): string {
    if (process.env.CODEX_BIN?.trim()) return process.env.CODEX_BIN.trim();
    const pkg = PACKAGES[`${process.platform}-${process.arch}`];
    if (!pkg) throw new Error(`Codex is not available for ${process.platform}-${process.arch}`);
    const require = createRequire(import.meta.url);
    let root: string;
    try {
        root = path.dirname(require.resolve(`${pkg[0]}/package.json`));
    } catch {
        // optional dependency, left out with `npm install --omit=optional`
        throw new Error('The Codex CLI is not installed: run npm install without --omit=optional, or set CODEX_BIN');
    }
    return path.join(root, 'vendor', pkg[1], 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
}

/**
 * Without API keys and with the account's CODEX_HOME (engine-home.ts). The app-server ignores keys in the environment
 * and keeps a key login in place of the ChatGPT one, so a key gets a folder of its own (CodexConnection.start signs in
 * there): ~/.codex keeps the subscription login for switching back. Threads stay in the folder they were started in.
 */
export function codexEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = engineEnv({ ...base, CODEX_MANAGED_BY_NPM: '1' });
    for (const k of API_KEYS) delete env[k];
    if (engineKeyFor('codex')) {
        env.CODEX_HOME = dataPath('codex-apikey');
        fs.mkdirSync(env.CODEX_HOME, { recursive: true });
    }
    return env;
}

// ------------------------------------------------------------------ JSON-RPC

/** A `codex app-server` process with requests in both directions. */
export class CodexConnection extends RpcProcess {
    version = '';

    /** The OpenAI API key this connection signs in with, '' = the ChatGPT subscription. */
    readonly key: string;

    constructor(env: NodeJS.ProcessEnv = codexEnv(), key = engineKeyFor('codex')) {
        super('Codex', codexBinary(), ['app-server'], env);
        this.key = key;
    }

    /** The account type a session needs: the key's, or the ChatGPT subscription. */
    get account(): string {
        return this.key ? 'apiKey' : 'chatgpt';
    }

    async start(): Promise<void> {
        const r = await this.call<{ userAgent: string }>('initialize', {
            clientInfo: { name: 'openfolk', title: 'OpenFolk', version: '0.1.0' },
            // dynamic tools (thread/start.dynamicTools) are still experimental
            capabilities: { experimentalApi: true },
        });
        this.version = /\/(\d[^\s(]*)/.exec(r.userAgent)?.[1] ?? r.userAgent;
        this.notify('initialized');
        if (this.key) await this.call('account/login/start', { type: 'apiKey', apiKey: this.key });
    }
}

// ------------------------------------------------------------------ Models

/** Models Codex offers; 'codex' stands for Codex's default. None without the login the machine settings ask for. */
export async function codexModels(): Promise<ModelInfo[]> {
    const v = new CodexConnection();
    try {
        await v.start();
        const account = await v.call<{ account: { type: string } | null }>('account/read', { refreshToken: false });
        if (account.account?.type !== v.account) return [];
        const r = await v.call<{ data: { id: string; displayName: string; hidden: boolean; isDefault: boolean }[] }>('model/list', {});
        const visible = r.data.filter((m) => !m.hidden);
        const fallback = visible.find((m) => m.isDefault) ?? visible[0];
        const list: ModelInfo[] = visible.map((m) => ({ value: `codex:${m.id}`, resolvedModel: `codex:${m.id}`, displayName: `${m.displayName} (Codex)` }));
        if (fallback) list.unshift({ value: 'codex', resolvedModel: `codex:${fallback.id}`, displayName: 'Codex' });
        return list;
    } finally {
        v.stop();
    }
}

// ------------------------------------------------------------------ Instructions

/**
 * Codex does not read CLAUDE.md. So a Codex bot follows the same rules as Claude Code, the CLAUDE.md files are
 * added the way Claude Code loads them: the global one from ~/.claude, then per folder from the root down to the
 * working folder, with included @ files.
 */
export function claudeInstructions(folder: string, claudeDir = claudeConfigDir()): string {
    const files = [path.join(claudeDir, 'CLAUDE.md')];
    const parts = path.resolve(folder).split(path.sep);
    for (let i = 1; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join(path.sep) || path.sep;
        const d = /^[A-Za-z]:$/.test(dir) ? dir + path.sep : dir;
        files.push(path.join(d, 'CLAUDE.md'), path.join(d, '.claude', 'CLAUDE.md'), path.join(d, 'CLAUDE.local.md'));
    }
    const seen = new Set<string>();
    const blocks: string[] = [];
    for (const file of files) {
        const content = withImports(file, os.homedir(), seen, 0);
        if (content?.trim()) blocks.push(`Content of ${file}:\n\n${content.trim()}`);
    }
    return blocks.join('\n\n');
}

function withImports(file: string, home: string, seen: Set<string>, depth: number): string | null {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key) || depth > 4) return null;
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
    seen.add(key);
    let inCode = false;
    return text.split('\n').map((line) => {
        if (/^\s*```/.test(line)) inCode = !inCode;
        const m = inCode ? null : /^\s*@(\S+)\s*$/.exec(line);
        if (!m) return line;
        const target = m[1].startsWith('~/') ? path.join(home, m[1].slice(2)) : path.resolve(path.dirname(file), m[1]);
        return withImports(target, home, seen, depth + 1) ?? line;
    }).join('\n');
}

// ------------------------------------------------------------------ Run of a bot session

export interface EngineAccount {
    plan: string | null;
    version: string;
    model: string;
}

export interface CodexLimit {
    usedPercent: number;
    windowDurationMins: number | null;
    resetsAt: number | null;
}

export interface CodexLimits {
    primary: CodexLimit | null;
    secondary: CodexLimit | null;
    rateLimitReachedType: string | null;
}

/** A tool of the backend that another engine can call (for Codex a dynamic tool, for ACP via MCP). */
export interface EngineTool {
    name: string;
    description: string;
    schema: Record<string, unknown>;
    run(args: Record<string, unknown>): Promise<{ text: string; error?: boolean }>;
}

/** Feedback of another engine (Codex, ACP) to the BotSession. */
export interface EngineTarget {
    threadId(id: string): void;
    account(k: EngineAccount): void;
    limits(l: CodexLimits): void;
    notice(text: string): void;
    textStarts(): void;
    delta(text: string): void;
    tool(call: ToolCall): void;
    toolResult(id: string, ok: boolean, result: string, durationMs?: number): void;
    context(tokens: number): void;
    done(error?: string): void;
    approval(tool: string, input: Record<string, unknown>, signal: AbortSignal, suggestions?: PermissionUpdate[]): Promise<PermissionResult>;
}

export interface EngineStart {
    folder: string;
    /** Model id without the engine prefix; undefined = its default */
    model?: string;
    /** Stored thread or session id to continue */
    threadId?: string;
    instructions: string;
    tools: EngineTool[];
}

/** Approval "always for this session": Codex remembers it itself (acceptForSession). */
const SESSION_ALWAYS: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'codex' }], behavior: 'allow', destination: 'session' }];

const QUESTION_SCHEMA = {
    type: 'object',
    properties: {
        questions: {
            type: 'array',
            description: '1 to 4 questions',
            items: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question, fully phrased' },
                    header: { type: 'string', description: 'Short label, at most 12 characters' },
                    options: {
                        type: 'array',
                        description: '2 to 4 possible answers',
                        items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label', 'description'] },
                    },
                    multiSelect: { type: 'boolean' },
                },
                required: ['question', 'header', 'options'],
            },
        },
    },
    required: ['questions'],
};

/**
 * Holds the app-server process and the thread of a bot session. Jobs come one after another (the BotSession
 * waits for `done`); approvals for commands and file changes go to the bot's approval rules.
 */
export class CodexRun {
    private v: CodexConnection | null = null;
    private starting: Promise<void> | null = null;
    private thread: string | null = null;
    private turnId: string | null = null;
    private errorMessage: string | null = null;
    private changes = new Map<string, { path: string; diff: string }[]>();
    private toolStart = new Map<string, number>();
    private requests = new Map<string, AbortController>();
    private tools = new Map<string, EngineTool>();
    private lastLimits: CodexLimits | null = null;

    private z: EngineTarget;
    constructor(z: EngineTarget) {
        this.z = z;
    }

    get running(): boolean {
        return !!this.v?.running;
    }

    async send(content: string | Record<string, unknown>[], s: EngineStart): Promise<void> {
        try {
            await this.ready(s);
            this.errorMessage = null;
            const r = await this.v!.call<{ turn: { id: string } }>('turn/start', {
                threadId: this.thread,
                input: codexInput(content),
                model: s.model ?? null,
            });
            this.turnId = r.turn.id;
        } catch (e) {
            this.z.done((e as Error).message);
        }
    }

    async interrupt(): Promise<void> {
        if (!this.v || !this.thread || !this.turnId) return;
        await this.v.call('turn/interrupt', { threadId: this.thread, turnId: this.turnId }).catch(() => undefined);
    }

    close(): void {
        const v = this.v;
        this.v = null;
        this.starting = null;
        this.thread = null;
        this.turnId = null;
        for (const a of this.requests.values()) a.abort();
        this.requests.clear();
        v?.stop();
    }

    private ready(s: EngineStart): Promise<void> {
        if (this.v?.running && this.starting) return this.starting;
        this.close();
        const v = new CodexConnection();
        this.v = v;
        v.onNotification = (m, p) => this.notification(m, p);
        v.onRequest = (m, p, id) => this.request(m, p, id);
        v.onEnd = (error) => {
            if (this.v !== v) return;
            this.v = null;
            this.starting = null;
            this.thread = null;
            for (const a of this.requests.values()) a.abort();
            this.requests.clear();
            if (this.turnId) {
                this.turnId = null;
                this.z.done(error ?? t('engine.processEnded', { name: 'Codex' }));
            }
        };
        this.starting = this.open(v, s).catch((e: Error) => {
            this.close();
            throw e;
        });
        return this.starting;
    }

    private async open(v: CodexConnection, s: EngineStart): Promise<void> {
        await v.start();
        const account = await v.call<{ account: { type: string; planType?: string } | null }>('account/read', { refreshToken: false });
        if (account.account?.type !== v.account) {
            throw new Error(account.account
                ? t('codex.wrongAccount', { type: account.account.type })
                : t('codex.notSignedIn'));
        }
        if (!v.key) void v.call<{ rateLimits: CodexLimits }>('account/rateLimits/read').then((r) => this.reportLimits(r.rateLimits), () => undefined);

        this.tools = new Map(s.tools.map((w) => [w.name, w]));
        const thread = {
            cwd: s.folder,
            model: s.model ?? null,
            // No sandbox, as with Claude Code: what a bot may do is decided by the approvals in the app
            // ('untrusted' asks for everything except harmless read commands). workspace-write was tried on Windows
            // on 2026-10-15 (Codex 0.162.1): no command starts at all ("helper_unknown_error: setup refresh had
            // errors"), not even one inside the folder.
            approvalPolicy: 'untrusted',
            sandbox: 'danger-full-access',
            developerInstructions: s.instructions,
        };
        type Answer = { thread: { id: string }; model: string };
        let r: Answer | null = null;
        if (s.threadId) {
            try {
                r = await v.call<Answer>('thread/resume', { ...thread, threadId: s.threadId, excludeTurns: true });
            } catch (e) {
                console.log(`codex: thread ${s.threadId} cannot be resumed: ${(e as Error).message}`);
                this.z.notice(t('engine.resumeFailed', { name: 'Codex' }));
            }
        }
        // Tools only exist when creating; a resumed thread keeps the ones from back then
        if (!r) r = await v.call<Answer>('thread/start', {
            ...thread,
            dynamicTools: [
                ...s.tools.map((w) => ({ type: 'function', name: w.name, description: w.description, inputSchema: w.schema })),
                { type: 'function', name: 'AskUserQuestion', description: 'Asks the user a question with possible answers and waits for the choice.', inputSchema: QUESTION_SCHEMA },
            ],
        });
        this.thread = r.thread.id;
        this.z.threadId(r.thread.id);
        this.z.account({ plan: account.account.planType ?? null, version: v.version, model: r.model });
    }

    private reportLimits(l: CodexLimits | undefined): void {
        if (!l) return;
        this.lastLimits = l;
        this.z.limits(l);
    }

    // ---------------------------------------------------------------- Notifications

    private notification(method: string, p: Params): void {
        if (p.threadId && p.threadId !== this.thread) return;
        switch (method) {
            case 'turn/started':
                this.turnId = (p.turn as { id: string }).id;
                break;
            case 'item/agentMessage/delta':
                this.z.delta(String(p.delta ?? ''));
                break;
            case 'item/started':
                this.itemStarts(p.item as Item);
                break;
            case 'item/completed':
                this.itemDone(p.item as Item);
                break;
            case 'thread/tokenUsage/updated': {
                const last = (p.tokenUsage as { last?: { inputTokens?: number } }).last;
                if (last?.inputTokens) this.z.context(last.inputTokens);
                break;
            }
            case 'account/rateLimits/updated':
                this.reportLimits(p.rateLimits as CodexLimits);
                break;
            case 'error': {
                const e = p as { error?: { message?: string }; willRetry?: boolean };
                if (!e.willRetry && e.error?.message) this.errorMessage = e.error.message;
                break;
            }
            case 'serverRequest/resolved':
                this.requests.get(String(p.requestId))?.abort();
                break;
            case 'turn/completed': {
                const x = p.turn as { id: string; status: string; error: { message: string } | null };
                if (this.turnId && x.id !== this.turnId) break;
                this.turnId = null;
                this.changes.clear();
                this.toolStart.clear();
                if (x.status === 'completed') this.z.done();
                else if (x.status === 'interrupted') this.z.done(t('engine.interrupted'));
                else this.z.done(x.error?.message ?? this.errorMessage ?? `Codex turn ${x.status}`);
                if (this.lastLimits?.rateLimitReachedType) this.reportLimits(this.lastLimits);
                break;
            }
            default:
                break;
        }
    }

    private itemStarts(item: Item): void {
        if (item.type === 'agentMessage') {
            this.z.textStarts();
            return;
        }
        if (item.type === 'fileChange') this.changes.set(item.id, (item.changes ?? []).map((c) => ({ path: c.path, diff: c.diff })));
        const call = toolFrom(item);
        if (!call) return;
        this.toolStart.set(item.id, Date.now());
        this.z.tool(call);
    }

    private itemDone(item: Item): void {
        if (!this.toolStart.has(item.id)) return;
        const duration = Date.now() - (this.toolStart.get(item.id) ?? Date.now());
        this.toolStart.delete(item.id);
        const { ok, text } = resultFrom(item);
        this.z.toolResult(item.id, ok, truncate(text), item.durationMs ?? duration);
    }

    // ---------------------------------------------------------------- Requests of the server

    private async request(method: string, p: Params, id: number | string): Promise<unknown> {
        const abort = new AbortController();
        this.requests.set(String(id), abort);
        try {
            switch (method) {
                case 'item/commandExecution/requestApproval': {
                    const command = withoutShell(String(p.command ?? ''));
                    const r = await this.z.approval(shellName(String(p.command ?? '')), { command, description: p.reason ? String(p.reason) : '' }, abort.signal, SESSION_ALWAYS);
                    return { decision: decision(r) };
                }
                case 'item/fileChange/requestApproval': {
                    const changes = this.changes.get(String(p.itemId)) ?? [];
                    const files = changes.map((a) => a.path);
                    const r = await this.z.approval('Write', {
                        file_path: files.join(', ') || String(p.grantRoot ?? ''),
                        files,
                        content: changes.map((a) => `${a.path}\n${a.diff}`).join('\n\n'),
                    }, abort.signal, SESSION_ALWAYS);
                    return { decision: decision(r) };
                }
                case 'item/tool/call':
                    return await this.toolCall(String(p.tool), (p.arguments ?? {}) as Record<string, unknown>, abort.signal);
                case 'item/tool/requestUserInput':
                    return await this.userInput(p.questions as InputQuestion[], abort.signal);
                case 'mcpServer/elicitation/request':
                    return { action: 'decline', content: null, _meta: null };
                default:
                    throw new Error(`${method} is not supported by OpenFolk`);
            }
        } finally {
            this.requests.delete(String(id));
        }
    }

    private async toolCall(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
        const answer = (text: string, ok = true) => ({ success: ok, contentItems: [{ type: 'inputText', text }] });
        if (name === 'AskUserQuestion') {
            const r = await this.z.approval('AskUserQuestion', args, signal);
            if (r.behavior !== 'allow') return answer(r.message || 'The user did not answer.', false);
            const answers = (r.updatedInput?.answers ?? {}) as Record<string, string>;
            return answer(Object.entries(answers).map(([q, a]) => `"${q}": ${a}`).join('\n') || 'No answer');
        }
        const w = this.tools.get(name);
        if (!w) return answer(`Tool ${name} does not exist.`, false);
        try {
            const r = await w.run(args);
            return answer(r.text, !r.error);
        } catch (e) {
            return answer((e as Error).message, false);
        }
    }

    /** request_user_input of Codex (e.g. in plan mode) via the same question card as AskUserQuestion. */
    private async userInput(questions: InputQuestion[], signal: AbortSignal): Promise<unknown> {
        const list = questions.map((f) => ({ question: f.question, header: f.header, options: f.options ?? [], multiSelect: false }));
        const r = await this.z.approval('AskUserQuestion', { questions: list }, signal);
        const answers = r.behavior === 'allow' ? (r.updatedInput?.answers ?? {}) as Record<string, string> : {};
        return { answers: Object.fromEntries(questions.map((f) => [f.id, { answers: answers[f.question] ? [answers[f.question]] : [] }])) };
    }
}

// ------------------------------------------------------------------ Mapping the items

interface Item {
    type: string;
    id: string;
    command?: string;
    aggregatedOutput?: string | null;
    exitCode?: number | null;
    status?: string;
    durationMs?: number | null;
    changes?: { path: string; diff: string }[];
    server?: string;
    tool?: string;
    arguments?: unknown;
    result?: { content?: unknown[] } | null;
    error?: { message: string } | null;
    contentItems?: { type: string; text?: string }[] | null;
    success?: boolean | null;
    query?: string;
    path?: string;
    prompt?: string | null;
}

interface InputQuestion {
    id: string;
    header: string;
    question: string;
    options: { label: string; description: string }[] | null;
}

/** Program path, also in quotes with spaces (e.g. "C:\Program Files\Git\usr\bin\bash.exe"). */
const program = (names: string) => `(?:"[^"]*?(?:${names})(?:\\.exe)?"|\\S*?(?:${names})(?:\\.exe)?)`;
const POWERSHELL = new RegExp(`^${program('powershell|pwsh')}\\s+(?:-NoProfile\\s+|-NoLogo\\s+|-NonInteractive\\s+)*-Command\\s+"([\\s\\S]*)"\\s*$`, 'i');
const BASH = new RegExp(`^${program('bash|zsh|sh')}\\s+-l?c\\s+'([\\s\\S]*)'\\s*$`, 'i');

/** Codex starts commands as `"…\powershell.exe" -Command "…"` or `bash -lc '…'`; only the command is shown. */
export function withoutShell(command: string): string {
    return (POWERSHELL.exec(command) ?? BASH.exec(command))?.[1] ?? command;
}

/** Tool name as in Claude Code, so display and approval rules apply the same way. */
export function shellName(command: string): string {
    if (BASH.test(command)) return 'Bash';
    return POWERSHELL.test(command) || process.platform === 'win32' ? 'PowerShell' : 'Bash';
}

function toolFrom(item: Item): ToolCall | null {
    const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: item.id, name, summary: toolSummary(name, input) });
    switch (item.type) {
        case 'commandExecution':
            return call(shellName(item.command ?? ''), { command: withoutShell(item.command ?? '') });
        case 'fileChange': {
            const paths = (item.changes ?? []).map((c) => c.path);
            return { id: item.id, name: 'Edit', summary: toolSummary('Edit', { file_path: paths.join(', ') }) };
        }
        case 'mcpToolCall':
            return call(`mcp__${item.server}__${item.tool}`, (item.arguments ?? {}) as Record<string, unknown>);
        case 'dynamicToolCall':
            return call(item.tool === 'AskUserQuestion' ? 'AskUserQuestion' : `mcp__openfolk__${item.tool}`, (item.arguments ?? {}) as Record<string, unknown>);
        case 'webSearch':
            return call('WebSearch', { query: item.query ?? '' });
        case 'imageView':
            return call('Read', { file_path: item.path ?? '' });
        case 'collabAgentToolCall':
            return call('Agent', { prompt: item.prompt ?? '' });
        default:
            return null;
    }
}

function resultFrom(item: Item): { ok: boolean; text: string } {
    switch (item.type) {
        case 'commandExecution':
            return { ok: item.status === 'completed' && (item.exitCode ?? 0) === 0, text: item.status === 'declined' ? t('engine.declined') : item.aggregatedOutput ?? '' };
        case 'fileChange':
            return { ok: item.status === 'completed', text: item.status === 'declined' ? t('engine.declined') : (item.changes ?? []).map((c) => `${c.path}\n${c.diff}`).join('\n\n') };
        case 'mcpToolCall':
            return {
                ok: !item.error,
                text: item.error?.message ?? (item.result?.content ?? []).map((c) => {
                    const b = c as { type?: string; text?: string };
                    return b.type === 'text' ? b.text ?? '' : b.type === 'image' ? '[Image]' : '';
                }).join('\n'),
            };
        case 'dynamicToolCall':
            return { ok: item.success !== false, text: (item.contentItems ?? []).map((c) => c.text ?? '').join('\n') };
        default:
            return { ok: item.status !== 'failed', text: '' };
    }
}

function decision(r: PermissionResult): string {
    if (r.behavior !== 'allow') return 'decline';
    return r.updatedPermissions?.length ? 'acceptForSession' : 'accept';
}

/** Content of a job (text or Claude content blocks) as input for Codex; PDFs are available as a file. */
export function codexInput(content: string | Record<string, unknown>[]): Record<string, unknown>[] {
    const text = (x: string) => ({ type: 'text', text: x, text_elements: [] });
    if (typeof content === 'string') return [text(content)];
    const r: Record<string, unknown>[] = [];
    for (const b of content) {
        const source = b.source as { type?: string; media_type?: string; data?: string } | undefined;
        if (b.type === 'text') r.push(text(String(b.text ?? '')));
        else if (b.type === 'image' && source?.type === 'base64') r.push({ type: 'image', url: `data:${source.media_type};base64,${source.data}` });
    }
    return r.length ? r : [text('')];
}

function truncate(text: string): string {
    return text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + '\n…' : text;
}
