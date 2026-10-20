import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
    query,
    type McpServerConfig,
    type Options,
    type PermissionResult,
    type PermissionUpdate,
    type Query,
    type SDKMessage,
    type SDKRateLimitInfo,
    type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { checkSignIn, keyRejected, type AuthMode } from './auth.ts';
import { accountAuth, claudeEnv, claudeSettings, engineAvailable } from './engine-home.ts';
import { readSessionId, roleLine, setSessionId } from './bots.ts';
import { ACP_AGENTS, AcpRun, acpModels, type AcpAgent } from './acp.ts';
import { claudeInstructions, CodexRun, codexBinary, codexModels, type CodexLimits, type EngineStart, type EngineTool, type EngineTarget } from './codex.ts';
import { t } from './i18n.ts';
import { knowledgeIndex } from './knowledge.ts';
import { keyTurnCost } from './key-fallback.ts';
import { engineEnabled } from './machine-settings.ts';
import { secretRead } from './policy.ts';
import { transcriptStoreError, transcriptPath } from './vscode.ts';
import {
    ENGINE_NAMES, OTHER_ENGINES, engineModelId, engineOf, type Attachment, type Bot, type BotState, type Engine, type EngineStatus, type EngineStatuses, type LiveTurn, type ModelInfo,
    type ToolCall,
} from '../../shared/protocol.ts';

/** Engine of a stored session id: other engines carry their prefix ('codex:…', 'cursor:…'), Claude sessions none. */
function engineOfSession(id: string): Engine {
    return OTHER_ENGINES.find((m) => id.startsWith(`${m}:`)) ?? 'claude';
}

/** After this many minutes without a message the CLI process is stopped; the next message continues via `resume`. */
const IDLE_MINUTES = 15;
const MAX_RESULT = 4000;

/** A job for the bot: a message with its origin and target chat. */
export interface Turn {
    id: string;
    /** Chat in which the answer appears (bot id or 'g:<group>'). */
    chatId: string;
    /** Content for Claude: text or content blocks (text, images, PDF). */
    content: string | Record<string, unknown>[];
    /** Plain text of the message (logs, push, repetition). */
    text: string;
    /** 'me', bot id or 'routine:<name>' */
    from: string;
    /** Bot ids of the delegation chain, prevents cycles with bot-to-bot messages. */
    chain: string[];
    /** Forwards within a group. */
    hop: number;
    /** Round of a group conversation (one message of the user and everything passed on from it). */
    round?: string;
    /** Bots already prompted in this round (travels along when the round changes machines). */
    roundDone?: string[];
    routineId?: string;
    /** History entry of the message (for the blue ticks). */
    entryId?: string;
    onDone?: (e: TurnResult) => void;
}

export interface TurnResult {
    text: string;
    tools: ToolCall[];
    attachments: Attachment[];
    durationMs: number;
    costUsd: number;
    error?: string;
    /** Stopped by the user: no error in the chat; requesters (bots, routines) see it as not done via `error`. */
    stopped?: boolean;
}

export interface AccountInfo {
    subscription: string | null;
    model: string;
    version: string;
    apiKeySource: string;
    /** missing = Claude Code */
    engine?: Engine;
}

export type RateLimitInfo = SDKRateLimitInfo & {
    unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
};

/** Feedback of the session to the bot manager. */
export interface SessionHooks {
    /** Running background tasks changed (empty = none left). */
    background(s: BotSession, tasks: { id: string; description: string }[]): void;
    /** New context size of the session (0 after "New session"). */
    context(s: BotSession, tokens: number): void;
    /** The bot starts with the job (not for turns the CLI starts by itself). */
    started(s: BotSession, turn: Turn): void;
    /** Waiting jobs were discarded, the bot no longer gets them (abort, new session, sign-in error). */
    discarded(s: BotSession, turns: Turn[]): void;
    delta(s: BotSession, turn: Turn, text: string): void;
    tool(s: BotSession, turn: Turn, call: ToolCall): void;
    toolResult(s: BotSession, turn: Turn, call: ToolCall): void;
    done(s: BotSession, turn: Turn, e: TurnResult): void;
    state(s: BotSession, state: BotState, detail?: string): void;
    error(s: BotSession, turn: Turn | null, message: string): void;
    account(s: BotSession, info: AccountInfo): void;
    usage(info: RateLimitInfo): void;
    approval(s: BotSession, turn: Turn, tool: string, input: Record<string, unknown>, signal: AbortSignal, suggestions?: PermissionUpdate[]): Promise<PermissionResult>;
    tools(s: BotSession): McpServerConfig;
    /** The same tools for the other engines (Codex: dynamic tools, ACP: MCP over HTTP). */
    engineTools(s: BotSession): EngineTool[];
    codexLimits(l: CodexLimits): void;
}

/**
 * Models the CLIs offer, including what is behind 'default', and per engine whether it can run on this machine (the
 * setup checklist shows the engines that still need a sign-in). Starts the CLIs without a message (no tokens) and
 * stops them again. Engines switched off in the machine settings are not started and missing from both.
 */
export async function queryModels(): Promise<{ models: ModelInfo[]; engines: EngineStatuses }> {
    const on = (engine: Engine, status: () => Promise<EngineModels>) => (engineEnabled(engine) ? status() : Promise.resolve(null));
    const results = await Promise.all([
        on('claude', claudeModels),
        on('codex', codexStatus),
        // Engines another account cannot have a login of its own for are not even started for it (engine-home.ts)
        ...Object.values(ACP_AGENTS).map((a) => on(a.engine, () => (engineAvailable(a.engine) ? acpStatus(a) : Promise.resolve<EngineModels>({ engine: a.engine, models: [], status: 'missing' })))),
    ]);
    const all = results.filter((e): e is EngineModels => e !== null);
    return { models: all.flatMap((e) => e.models), engines: Object.fromEntries(all.map((e) => [e.engine, e.status])) };
}

type EngineModels = { engine: Engine; models: ModelInfo[]; status: EngineStatus };

/** Claude's models and whether the CLI is signed in: the subscription login, or the API key in the machine settings. */
export async function claudeModels(): Promise<EngineModels> {
    // A prompt that never arrives: the query only has to start the CLI so it reports its models
    // eslint-disable-next-line require-yield
    async function* noMessage(): AsyncGenerator<SDKUserMessage> {
        await new Promise<never>(() => undefined);
    }
    const q = query({ prompt: noMessage(), options: { settingSources: [], env: claudeEnv(), settings: claudeSettings() } });
    try {
        const [list, account] = await Promise.all([q.supportedModels(), q.accountInfo().catch(() => null)]);
        // Without a login the CLI reports no account; an unknown answer (older CLI) does not count as missing
        const signedIn = accountAuth() === 'apikey' || !account || !!account.email || !!account.subscriptionType
            || (account.apiProvider !== undefined && account.apiProvider !== 'firstParty');
        const models = list.map((m) => ({ value: m.value, resolvedModel: m.resolvedModel ?? m.value, displayName: m.displayName }));
        return { engine: 'claude', models, status: signedIn ? 'ready' : 'sign_in' };
    } finally {
        q.close();
    }
}

/** Without installation or login the engine is simply missing from the model list. */
async function codexStatus(): Promise<EngineModels> {
    try {
        codexBinary();
    } catch {
        return { engine: 'codex', models: [], status: 'missing' };
    }
    try {
        const models = await codexModels();
        return { engine: 'codex', models, status: models.length ? 'ready' : 'sign_in' };
    } catch (e) {
        console.log(`codex-models: ${(e as Error).message}`);
        return { engine: 'codex', models: [], status: 'missing' };
    }
}

async function acpStatus(a: AcpAgent): Promise<EngineModels> {
    try {
        a.command();
    } catch {
        return { engine: a.engine, models: [], status: 'missing' };
    }
    try {
        const models = await acpModels(a);
        return { engine: a.engine, models, status: models.length ? 'ready' : 'missing' };
    } catch (e) {
        console.log(`${a.engine}-models: ${(e as Error).message}`);
        return { engine: a.engine, models: [], status: (e as Error).message.startsWith(a.notSignedIn()) ? 'sign_in' : 'missing' };
    }
}

export function newTurn(part: Omit<Turn, 'id' | 'chain' | 'hop'> & Partial<Pick<Turn, 'chain' | 'hop'>>): Turn {
    return { id: randomUUID(), chain: [], hop: 0, ...part };
}

/**
 * A continuous Claude Code session for a bot.
 *
 * Streaming input mode: one `query()` call gets messages from a queue, so the context is kept. Jobs run one after
 * another: the next starts only when the previous one has a result. The session id is stored so `resume` can
 * continue after a restart.
 *
 * If the session runs on another engine (Codex, Cursor, …), the jobs go to a `CodexRun` or `AcpRun` instead;
 * queue, stop and feedback stay the same.
 */
export class BotSession {
    private running: Query | null = null;
    private other: CodexRun | AcpRun | null = null;
    private otherEngine: Engine | null = null;
    private inbox: SDKUserMessage[] = [];
    private wake: (() => void) | null = null;
    private generatorNr = 0;
    private pending: Turn[] = [];
    private active: Turn | null = null;
    private answerText = '';
    private tools: ToolCall[] = [];
    private toolStart = new Map<string, number>();
    private attachments: Attachment[] = [];
    private turnStart = 0;
    private initReceived = false;
    private retried = false;
    /** The sign-in the running CLI process was started with ('both' in the settings switches between processes). */
    private auth: AuthMode = 'subscription';
    private keyRetried = false;
    private idleTimer: NodeJS.Timeout | null = null;
    private reloadNeeded = false;
    /** Running background tasks of the CLI (subagents, shells); they end with the process. */
    private background = new Map<string, string>();
    /** The active turn came from the CLI itself (report of a background task), not from `inbox`. */
    private fromCli = false;
    /** The running job was interrupted by stop; the CLI then reports it as error_during_execution. */
    private stopped = false;
    private lastChat = '';
    /** Tokens in the context of the last model request (0 = unknown or new session). */
    private context = 0;
    state: BotState = 'idle';
    activity = '';

    /** key: bot id (main chat, also groups) or chatId of a conversation; the session id is stored under it. */
    bot: Bot;
    private hooks: SessionHooks;
    readonly key: string;
    constructor(bot: Bot, hooks: SessionHooks, key: string = bot.id) {
        this.bot = bot;
        this.hooks = hooks;
        this.key = key;
    }

    get currentTurn(): Turn | null {
        return this.active;
    }

    private get sessionId(): string | undefined {
        return this.key === this.bot.id ? this.bot.sessionId : readSessionId(this.key);
    }

    private set sessionId(id: string | undefined) {
        if (this.key === this.bot.id) this.bot.sessionId = id;
        setSessionId(this.key, id);
    }

    private get claudeSessionId(): string | undefined {
        const id = this.sessionId;
        return id && engineOfSession(id) === 'claude' ? id : undefined;
    }

    /** Thread or session id of another engine without the prefix. */
    private otherSessionId(engine: Engine): string | undefined {
        const id = this.sessionId;
        return id && engineOfSession(id) === engine ? id.slice(engine.length + 1) : undefined;
    }

    /** Running answer for browsers that open the chat right now. */
    live(chatId: string): LiveTurn | null {
        if (!this.active || this.active.chatId !== chatId) return null;
        return { botId: this.bot.id, text: this.answerText, tools: [...this.tools] };
    }

    waiting(): number {
        return this.pending.length;
    }

    /** Waiting jobs per chat (in groups they are in the members' sessions). */
    waitingPerChat(): Record<string, number> {
        const r: Record<string, number> = {};
        for (const x of this.pending) r[x.chatId] = (r[x.chatId] ?? 0) + 1;
        return r;
    }

    send(turn: Turn): void {
        this.pending.push(turn);
        this.stopIdle();
        if (!this.active) this.next();
        else this.hooks.state(this, this.state, t('session.queued', { count: this.pending.length }));
    }

    stillWaits(entryId: string): boolean {
        return this.pending.some((x) => x.entryId === entryId);
    }

    /** Takes a waiting job out of the queue (e.g. to start it in a conversation of its own). */
    fromQueue(entryId: string): Turn | undefined {
        const i = this.pending.findIndex((x) => x.entryId === entryId);
        if (i < 0) return undefined;
        const [turn] = this.pending.splice(i, 1);
        this.hooks.state(this, this.state, this.pending.length ? t('session.queued', { count: this.pending.length }) : undefined);
        return turn;
    }

    /** Attachment the bot sends with its answer via a tool. */
    addAttachment(a: Attachment): void {
        this.attachments.push(a);
    }

    async interrupt(): Promise<void> {
        if (this.active) this.stopped = true;
        this.discardQueue();
        await this.running?.interrupt();
        await this.other?.interrupt();
    }

    private discardQueue(): void {
        const gone = this.pending;
        this.pending = [];
        if (gone.length) this.hooks.discarded(this, gone);
    }

    /** Stops the CLI process; the session id stays. */
    close(): void {
        this.stopIdle();
        const q = this.running;
        this.running = null;
        this.generatorNr++;
        this.setBackground(new Map());
        this.wake?.();
        q?.close();
        this.other?.close();
    }

    /** Profile changed: restart the CLI process as soon as the running job is done. */
    reload(): void {
        if (this.active) this.reloadNeeded = true;
        else this.close();
    }

    /** Discards the context: the next message starts a new session. */
    restart(): void {
        this.close();
        this.discardQueue();
        this.active = null;
        this.sessionId = undefined;
        this.context = 0;
        this.hooks.context(this, 0);
        this.setState('idle', t('session.newSession'));
    }

    setState(state: BotState, detail?: string): void {
        this.state = state;
        if (state === 'idle' || state === 'error') this.activity = '';
        this.hooks.state(this, state, detail);
    }

    private next(): void {
        if (this.reloadNeeded) {
            this.reloadNeeded = false;
            this.close();
        }
        const turn = this.pending.shift();
        if (!turn) {
            this.active = null;
            this.planIdle();
            return;
        }
        this.beginTurn(turn);
        this.hooks.started(this, turn);
        const engine = this.engine;
        if (!engineAvailable(engine)) {
            this.finishTurn({ error: t('engine.notForAccount', { name: ENGINE_NAMES[engine] }) });
            return;
        }
        if (engine !== 'claude') {
            if (this.running) this.close();
            if (this.otherEngine !== engine) {
                this.other?.close();
                this.other = engine === 'codex' ? new CodexRun(this.engineTarget(engine)) : new AcpRun(ACP_AGENTS[engine], this.engineTarget(engine));
                this.otherEngine = engine;
            }
            void this.other!.send(turn.content, this.engineStart(engine));
            return;
        }
        if (this.other?.running) this.other.close();
        this.inbox.push(this.message(turn));
        if (this.running) this.wake?.();
        else this.start();
    }

    private beginTurn(turn: Turn, fromCli = false): void {
        this.active = turn;
        this.fromCli = fromCli;
        this.lastChat = turn.chatId;
        this.answerText = '';
        this.tools = [];
        this.toolStart.clear();
        this.attachments = [];
        this.turnStart = Date.now();
        this.retried = false;
        this.keyRetried = false;
        this.stopped = false;
        this.activity = t('session.thinking');
        this.setState('thinking');
    }

    /** The turn id goes along as uuid; the CLI names it in the result, so the result can be matched. */
    private message(turn: Turn): SDKUserMessage {
        return { type: 'user', message: { role: 'user', content: turn.content as never }, parent_tool_use_id: null, uuid: turn.id as SDKUserMessage['uuid'] };
    }

    /**
     * When a background task reports its end, the CLI starts a turn by itself. Without a user turn it gets one of its
     * own, so the answer appears in the chat instead of getting lost.
     */
    private cliTurn(): Turn | null {
        if (this.active) return this.active;
        if (!this.running) return null;
        const turn = newTurn({ chatId: this.lastChat || this.key, from: 'me', text: '', content: '' });
        this.stopIdle();
        this.beginTurn(turn, true);
        return turn;
    }

    private async *input(nr: number): AsyncGenerator<SDKUserMessage> {
        while (this.generatorNr === nr) {
            const msg = this.inbox.shift();
            if (msg) {
                yield msg;
                continue;
            }
            await new Promise<void>((resolve) => { this.wake = resolve; });
            this.wake = null;
        }
    }

    /** Model of this session: the conversation's, otherwise the bot's; undefined = the CLI's default. */
    get model(): string | undefined {
        const m = this.modelChoice;
        return m === 'default' ? undefined : m;
    }

    private get modelChoice(): string {
        const c = this.key === this.bot.id ? undefined : this.bot.conversations?.find((x) => `${this.bot.id}~${x.id}` === this.key);
        return c?.model ?? this.bot.model;
    }

    get engine(): Engine {
        return engineOf(this.modelChoice);
    }

    /**
     * Switch the model in the running process (applies from the next request); without a process it applies at the
     * next start. A change of engine (Claude, Codex, Cursor) stops the process; the next message starts a new session.
     * Returns true if the engine changed.
     */
    async switchModel(): Promise<boolean> {
        const before: Engine | null = this.running ? 'claude' : this.other?.running ? this.otherEngine : this.sessionId ? engineOfSession(this.sessionId) : null;
        if (before && before !== this.engine) {
            this.reload();
            this.context = 0;
            this.hooks.context(this, 0);
            return true;
        }
        // The other engines get the model with every job
        if (this.engine === 'claude') await this.running?.setModel(this.model);
        return false;
    }

    private options(): Options {
        const auth = accountAuth();
        this.auth = auth;
        return {
            cwd: this.bot.folder,
            model: this.model,
            resume: this.claudeSessionId,
            // canUseTool decides approvals according to the bot's setting
            permissionMode: 'default',
            canUseTool: async (tool, input, opt) => {
                const turn = this.active;
                if (!turn) return { behavior: 'allow', updatedInput: input };
                return this.hooks.approval(this, turn, tool, input, opt.signal, opt.suggestions);
            },
            // Reads never reach canUseTool; secrets are refused here (policy.ts)
            hooks: {
                PreToolUse: [{
                    matcher: 'Read|Grep|Glob|NotebookRead',
                    hooks: [async (input) => {
                        if (input.hook_event_name !== 'PreToolUse') return {};
                        const reason = secretRead(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
                        return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : {};
                    }],
                }],
            },
            mcpServers: { 'openfolk': this.hooks.tools(this) },
            includePartialMessages: true,
            settingSources: ['user', 'project', 'local'],
            systemPrompt: { type: 'preset', preset: 'claude_code', append: persona(this.bot, knowledgeIndex(this.bot)), snapshot: false },
            env: claudeEnv(auth),
            settings: claudeSettings(auth),
            stderr: (line) => {
                if (process.env.OPENFOLK_DEBUG) process.stderr.write(`[cli ${this.bot.id}] ${line}`);
            },
        };
    }

    private engineStart(engine: Engine): EngineStart {
        const instructions = claudeInstructions(this.bot.folder);
        return {
            folder: this.bot.folder,
            model: engineModelId(this.modelChoice),
            threadId: this.otherSessionId(engine),
            instructions: [persona(this.bot, knowledgeIndex(this.bot), engine), instructions].filter(Boolean).join('\n\n'),
            tools: this.hooks.engineTools(this),
        };
    }

    private engineTarget(engine: Engine): EngineTarget {
        return {
            threadId: (id) => {
                if (this.sessionId !== `${engine}:${id}`) this.sessionId = `${engine}:${id}`;
            },
            account: (k) => this.hooks.account(this, { subscription: k.plan, model: k.model, version: k.version, apiKeySource: 'none', engine }),
            limits: (l) => this.hooks.codexLimits(l),
            notice: (text) => this.hooks.state(this, this.state, text),
            textStarts: () => {
                if (!this.active || !this.answerText || this.answerText.endsWith('\n')) return;
                this.answerText += '\n\n';
                this.hooks.delta(this, this.active, '\n\n');
            },
            delta: (text) => {
                if (!this.active) return;
                this.answerText += text;
                this.hooks.delta(this, this.active, text);
            },
            tool: (call) => {
                if (!this.active) return;
                this.tools.push(call);
                this.toolStart.set(call.id, Date.now());
                this.activity = `${displayName(call.name)}: ${call.summary}`;
                this.hooks.tool(this, this.active, call);
                this.hooks.state(this, this.state);
            },
            toolResult: (id, ok, result, durationMs) => {
                const call = this.tools.find((x) => x.id === id);
                if (!call || !this.active) return;
                call.ok = ok;
                call.result = result;
                call.durationMs = durationMs ?? Date.now() - (this.toolStart.get(id) ?? Date.now());
                this.hooks.toolResult(this, this.active, call);
            },
            context: (tokens) => {
                if (tokens === this.context) return;
                this.context = tokens;
                this.hooks.context(this, tokens);
            },
            done: (error) => this.finishTurn({ error }),
            approval: (tool, input, signal, suggestions) => {
                const turn = this.active;
                if (!turn) return Promise.resolve({ behavior: 'allow', updatedInput: input });
                return this.hooks.approval(this, turn, tool, input, signal, suggestions);
            },
        };
    }

    private start(): void {
        this.initReceived = false;
        this.newInput();
    }

    private newInput(): void {
        const q = query({ prompt: this.input(++this.generatorNr), options: this.options() });
        this.running = q;
        void this.run(q);
    }

    private async run(q: Query): Promise<void> {
        let error: string | null = null;
        try {
            for await (const msg of q) {
                await this.handle(q, msg);
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            if (this.running === q) {
                this.running = null;
                this.generatorNr++;
                this.setBackground(new Map());
            }
        }
        if (error && this.retryWithoutSession(error)) return;
        if (this.active && this.running === null) {
            // Process ended in the middle of a job
            this.finishTurn({ error: error ?? t('engine.processEnded', { name: 'Claude' }) });
        } else if (error) {
            this.hooks.error(this, null, error);
        }
    }

    /**
     * The stored session could not be continued (transcript deleted, other machine, store not reachable): drop the
     * session id and ask the running job again in a new session.
     */
    private retryWithoutSession(error: string): boolean {
        if (this.initReceived || !this.claudeSessionId || !this.active || this.retried || this.stopped) return false;
        const reason = this.resumeFailure(this.claudeSessionId);
        console.log(`${this.key}: session ${this.claudeSessionId} cannot be resumed (${reason}): ${error.split('\n')[0].slice(0, 300)}`);
        this.retried = true;
        this.sessionId = undefined;
        const q = this.running;
        this.running = null;
        this.generatorNr++;
        this.wake?.();
        q?.close();
        this.hooks.state(this, 'thinking', t('session.retryNew', { reason: `${reason[0].toUpperCase()}${reason.slice(1)}` }));
        this.inbox = [this.message(this.active)];
        this.start();
        return true;
    }

    /**
     * The subscription reached its limit in this turn and the rules ('both') moved Claude to the key since: ask the same
     * again on the key, in the same session. The limit comes as rate_limit_event before the turn's error.
     */
    private retryOnKey(): boolean {
        if (this.auth !== 'subscription' || accountAuth() !== 'apikey' || !this.active || this.keyRetried || this.stopped) return false;
        console.log(`${this.key}: subscription at its limit, the turn runs again on the API key`);
        this.keyRetried = true;
        const q = this.running;
        this.running = null;
        this.generatorNr++;
        this.wake?.();
        q?.close();
        this.hooks.state(this, 'thinking', t('session.keyFallback'));
        this.inbox = [this.message(this.active)];
        this.start();
        return true;
    }

    /** Short reason for the display why `resume` failed before the CLI started. */
    private resumeFailure(sessionId: string): string {
        const store = transcriptStoreError();
        if (store) return t('session.oldUnreachable', { reason: store });
        try {
            if (!fs.existsSync(transcriptPath(this.bot.folder, sessionId))) return t('session.oldNotFound');
        } catch {
            return t('session.oldNotFound');
        }
        return t('session.oldNotResumable');
    }

    private finishTurn(extra: { error?: string; costUsd?: number; resultText?: string }): void {
        const turn = this.active;
        if (!turn) return;
        // after a stop the CLI's error (error_during_execution, process end) is only its consequence
        const stopped = this.stopped && !!extra.error;
        this.stopped = false;
        const result: TurnResult = {
            text: this.answerText || extra.resultText || '',
            tools: this.tools,
            attachments: this.attachments,
            durationMs: Date.now() - this.turnStart,
            costUsd: extra.costUsd ?? 0,
            error: stopped ? t('session.stoppedByUser') : extra.error,
            stopped: stopped || undefined,
        };
        this.active = null;
        if (this.auth === 'apikey') keyTurnCost(result.costUsd);
        if (extra.error && !stopped) this.setState('error', extra.error);
        else this.setState('idle');
        this.hooks.done(this, turn, result);
        try {
            turn.onDone?.(result);
        } catch {
            // the callback must not disturb the session
        }
        this.next();
    }

    private async handle(q: Query, m: SDKMessage): Promise<void> {
        const turn = (m.type === 'stream_event' || m.type === 'assistant') && !m.parent_tool_use_id ? this.cliTurn() : this.active;
        switch (m.type) {
            case 'system':
                if (m.subtype === 'background_tasks_changed') {
                    this.setBackground(new Map(m.tasks.filter((x) => !x.ambient).map((x) => [x.task_id, x.description])));
                } else if (m.subtype === 'task_notification') {
                    const rest = new Map(this.background);
                    rest.delete(m.task_id);
                    this.setBackground(rest);
                } else if (m.subtype === 'init' && !this.initReceived) {
                    this.initReceived = true;
                    if (m.session_id !== this.sessionId) this.sessionId = m.session_id;
                    let subscription: string | null = null;
                    try {
                        const account = (await q.accountInfo()) as { subscriptionType?: string };
                        subscription = account.subscriptionType ?? null;
                    } catch {
                        // account info is display only
                    }
                    this.hooks.account(this, { subscription, model: m.model, version: m.claude_code_version, apiKeySource: m.apiKeySource });
                    const wrong = checkSignIn(this.auth, m.apiKeySource);
                    if (wrong) {
                        this.hooks.error(this, turn, wrong);
                        this.discardQueue();
                        this.close();
                        this.finishTurn({ error: this.auth === 'subscription' ? t('session.noSubscriptionLogin') : t('session.apiKeyInactive') });
                    }
                } else if (m.subtype === 'api_retry') {
                    const rejected = keyRejected(this.auth, m.error_status, m.error);
                    if (rejected) {
                        this.hooks.error(this, turn, rejected);
                        this.discardQueue();
                        this.close();
                        this.finishTurn({ error: t('session.apiKeyRejected') });
                    }
                }
                break;

            case 'rate_limit_event':
                this.hooks.usage(m.rate_limit_info as RateLimitInfo);
                break;

            case 'stream_event':
                if (!turn || m.parent_tool_use_id) break; // do not pass on text of subagents
                if (m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
                    this.answerText += m.event.delta.text;
                    this.hooks.delta(this, turn, m.event.delta.text);
                } else if (m.event.type === 'content_block_start' && m.event.content_block.type === 'text' && this.answerText && !this.answerText.endsWith('\n')) {
                    // new text block after a tool: insert a paragraph
                    this.answerText += '\n\n';
                    this.hooks.delta(this, turn, '\n\n');
                }
                break;

            case 'assistant':
                if (!turn || m.parent_tool_use_id) break;
                if (m.error) this.hooks.error(this, turn, t('session.answerError', { error: m.error }));
                this.contextFrom(m.message.usage);
                for (const block of m.message.content) {
                    if (block.type === 'tool_use') {
                        const call: ToolCall = { id: block.id, name: block.name, summary: toolSummary(block.name, block.input) };
                        this.tools.push(call);
                        this.toolStart.set(block.id, Date.now());
                        this.activity = `${displayName(block.name)}: ${call.summary}`;
                        this.hooks.tool(this, turn, call);
                        this.hooks.state(this, this.state);
                    }
                }
                break;

            case 'user': {
                if (!turn || m.parent_tool_use_id) break;
                const content = m.message.content;
                if (!Array.isArray(content)) break;
                for (const block of content as unknown as Record<string, unknown>[]) {
                    if (block.type !== 'tool_result') continue;
                    const call = this.tools.find((x) => x.id === block.tool_use_id);
                    if (!call) continue;
                    call.ok = block.is_error !== true;
                    call.result = resultText(block.content);
                    call.durationMs = Date.now() - (this.toolStart.get(call.id) ?? Date.now());
                    this.hooks.toolResult(this, turn, call);
                }
                break;
            }

            case 'result': {
                // Result of a turn the CLI started by itself (report of a background task) while the user's job is
                // still running: it must not end that job.
                const echo = m.user_message_uuids ?? (m.user_message_uuid ? [m.user_message_uuid] : undefined);
                if (turn && !this.fromCli && echo && !echo.includes(turn.id)) {
                    console.log(`${this.bot.id}: result of another turn skipped (${echo.join(', ') || 'without message'})`);
                    break;
                }
                const resultText = m.subtype === 'success' ? m.result : '';
                const error = m.is_error ? (resultText || m.subtype) : undefined;
                if (error && this.retryOnKey()) break;
                if (error && this.retryWithoutSession(m.subtype === 'success' ? error : [m.subtype, ...(m.errors ?? [])].join(': '))) break;
                this.finishTurn({ error, costUsd: m.total_cost_usd, resultText });
                break;
            }

            default:
                break;
        }
    }

    /** Running background tasks (subagents, shells), for the display and the restart protection. */
    get backgroundTasks(): { id: string; description: string }[] {
        return [...this.background].map(([id, description]) => ({ id, description }));
    }

    private setBackground(fresh: Map<string, string>): void {
        const same = fresh.size === this.background.size && [...fresh].every(([id, b]) => this.background.get(id) === b);
        this.background = fresh;
        if (!same) this.hooks.background(this, this.backgroundTasks);
    }

    /** Context size of the last model request: input plus cache read and newly written cache. */
    private contextFrom(u: { input_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined): void {
        if (!u) return;
        const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        if (tokens > 0 && tokens !== this.context) {
            this.context = tokens;
            this.hooks.context(this, tokens);
        }
    }

    private planIdle(): void {
        this.stopIdle();
        this.idleTimer = setTimeout(() => {
            // Background agents would die with the process; close only once they are done
            if (this.background.size > 0) this.planIdle();
            else if (!this.active) this.close();
        }, IDLE_MINUTES * 60_000);
    }

    private stopIdle(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }
}

/**
 * The part of the system prompt with the bot's persona, its tools and knowledge, in the language chosen in the app;
 * the bot is told to answer in that language.
 */
export function persona(bot: Bot, knowledge: string, engine: Engine = 'claude'): string {
    const lines = [
        t('persona.intro', { name: bot.name, role: roleLine(bot) ? ` (${roleLine(bot)})` : '', folder: bot.folder }),
        t('persona.language'),
        t('persona.style'),
        engine === 'cursor'
            ? t('persona.decisionCursor')
            : engine === 'copilot' || engine === 'antigravity' || engine === 'opencode'
                ? t('persona.decisionText')
                : t('persona.decisionAsk'),
        engine === 'codex' ? t('persona.toolsCodex') : t('persona.toolsServer'),
        t('persona.toolsMore'),
        t('persona.history'),
        '',
        t('persona.knowledge'),
    ];
    if (bot.tone.trim()) lines.push('', bot.tone.trim());
    if (knowledge.trim()) lines.push('', knowledge.trim());
    return lines.join('\n');
}

function displayName(name: string): string {
    return name.startsWith('mcp__') ? name.split('__').slice(1).join(' › ') : name;
}

function shorten(s: string, max = 90): string {
    const line = s.replace(/\s+/g, ' ').trim();
    return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

function resultText(content: unknown): string {
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
        text = content.map((c: Record<string, unknown>) => (c.type === 'text' ? String(c.text) : c.type === 'image' ? '[Image]' : '')).join('\n');
    }
    return text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + '\n…' : text;
}

export function toolSummary(name: string, input: unknown): string {
    const i = (input ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
    switch (name) {
        case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
            return shorten(s('file_path') || s('notebook_path'));
        case 'Bash': case 'PowerShell':
            return shorten(s('description') || s('command'));
        case 'Grep': case 'Glob':
            return shorten(s('pattern') + (s('path') ? ` in ${s('path')}` : ''));
        case 'WebFetch': case 'WebSearch':
            return shorten(s('url') || s('query'));
        case 'Agent': case 'Task':
            return shorten(s('description') || s('prompt'));
        case 'TodoWrite':
            return t('tools.todoUpdated');
        case 'Skill':
            return shorten(s('skill') || s('command'));
        case 'AskUserQuestion':
            return t('tools.questionToYou');
        case 'mcp__openfolk__message_bot':
            return shorten(t('tools.toBot', { bot: s('bot'), text: s('text') }));
        case 'mcp__openfolk__send_file':
            return shorten(s('path'));
        case 'mcp__openfolk__remember_note':
            return shorten(s('note'));
        case 'mcp__openfolk__remember_fact':
            return shorten(`${s('scope') && s('scope') !== 'bot' ? `[${s('scope')}] ` : ''}${s('name')}: ${s('description') || s('text')}`);
        case 'mcp__openfolk__read_knowledge': case 'mcp__openfolk__forget_fact':
            return shorten(s('name') || t('tools.overview'));
        case 'mcp__openfolk__search_history':
            return shorten(`${s('query')}${s('chat') ? ` · ${s('chat')}` : ''}${s('since') ? ` · ${s('since')}` : ''}`);
        case 'mcp__openfolk__read_history':
            return shorten(s('chat'));
        default:
            return shorten(JSON.stringify(i));
    }
}
