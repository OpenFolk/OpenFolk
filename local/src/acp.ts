// Connection to agents via the Agent Client Protocol (ACP, JSON-RPC over stdio): Cursor (`agent acp`), GitHub
// Copilot (`copilot --acp`), Google Antigravity and OpenCode (`opencode acp`). A bot runs with one of them if its
// model is 'cursor', 'copilot', 'antigravity', 'opencode' or '<engine>:<model>'. Sign-in via the respective CLI's login
// (subscription; OpenCode's free models need none) or, where the machine settings say so, the key stored there
// (Cursor, Copilot, Antigravity). Keys from the environment and own providers (BYOK) are never passed on.
//
// ACP has no system prompt: persona and CLAUDE.md rules go along with the first message of a new session.
// The agent gets the app's tools as an MCP server over HTTP (mcp-http.ts).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, ToolCall } from '../../shared/protocol.ts';
import { shellName, withoutShell, type EngineStart, type EngineTarget } from './codex.ts';
import { engineKeyFor } from './engine-home.ts';
import { t } from './i18n.ts';
import { toolAccess, type ToolAccess } from './mcp-http.ts';
import { removeTree } from './remove-tree.ts';
import { RpcProcess, type Params } from './rpc.ts';
import { toolSummary } from './session.ts';

const MAX_RESULT = 4000;

/** What differs per ACP agent. */
export interface AcpAgent {
    engine: 'cursor' | 'copilot' | 'antigravity' | 'opencode';
    name: string;
    /** Program, arguments and environment for ACP mode */
    command(): { command: string; args: string[]; env: NodeJS.ProcessEnv };
    /** authMethods id that takes over the CLI's existing login; without it the agent takes it by itself */
    signIn?: string;
    /** Message for a missing login. */
    notSignedIn(): string;
    /** Checks the login beforehand: `authenticate` without a login would otherwise wait forever for a browser sign-in. */
    signedIn?(): Promise<boolean>;
    /** Display name of a model in the list (default: "<name> (<agent>)"). */
    modelLabel?(name: string, value: string): string;
}

/** This long `authenticate` may take when the login is there. */
const SIGN_IN_MS = 30_000;
/** This long `initialize` may take (Antigravity unpacks a Python bundle at start, about 25 s). */
const START_MS = 90_000;

/** Variables through which Cursor would bill via a key the machine settings do not know of. */
const CURSOR_KEYS = ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'CURSOR_API_ENDPOINT'];

/**
 * The Cursor CLI lives under %LOCALAPPDATA%\cursor-agent (Windows) or ~/.local/share/cursor-agent; agent.cmd
 * starts `node.exe index.js` of the newest version via PowerShell. We call that directly, otherwise the node
 * process behind the wrapper would stay when stopping. CURSOR_AGENT_DIR overrides the folder.
 */
export function cursorDir(): string {
    if (process.env.CURSOR_AGENT_DIR?.trim()) return process.env.CURSOR_AGENT_DIR.trim();
    return process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'cursor-agent')
        : path.join(os.homedir(), '.local', 'share', 'cursor-agent');
}

/** Newest installed version (folders like 2026.10.01-e373342 or 2026.10.01-12-30-00-e373342). */
export function cursorVersion(dir = cursorDir()): { name: string; folder: string } | null {
    let names: string[];
    try {
        names = fs.readdirSync(path.join(dir, 'versions'));
    } catch {
        return null;
    }
    const number = (n: string) => {
        const [y, m, d] = n.split('-')[0].split('.');
        return Number(`${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`);
    };
    const name = names.filter((n) => /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(n)).sort((a, b) => number(b) - number(a) || b.localeCompare(a))[0];
    return name ? { name, folder: path.join(dir, 'versions', name) } : null;
}

export const CURSOR: AcpAgent = {
    engine: 'cursor',
    name: 'Cursor',
    signIn: 'cursor_login',
    notSignedIn: () => t('acp.cursorNotSignedIn'),
    command() {
        const v = cursorVersion();
        if (!v) throw new Error(t('acp.cursorMissing', { dir: cursorDir() }));
        // NO_OPEN_BROWSER: a missing login must not open a browser window on the machine
        const env: NodeJS.ProcessEnv = { ...process.env, CURSOR_INVOKED_AS: 'agent', NO_OPEN_BROWSER: '1' };
        for (const k of CURSOR_KEYS) delete env[k];
        const key = engineKeyFor('cursor');
        if (key) env.CURSOR_API_KEY = key;
        env.NODE_COMPILE_CACHE ??= path.join(path.dirname(cursorDir()), 'cursor-compile-cache');
        const node = path.join(v.folder, process.platform === 'win32' ? 'node.exe' : 'node');
        return { command: node, args: [path.join(v.folder, 'index.js'), 'acp'], env };
    },
    async signedIn() {
        // `status` knows the stored login only; a wrong key shows when signing in
        if (engineKeyFor('cursor')) return true;
        const b = this.command();
        const { stdout } = await new Promise<{ stdout: string }>((ok, fail) => {
            execFile(b.command, [b.args[0], 'status', '--format', 'json'], { env: b.env, timeout: 20_000, windowsHide: true }, (e, out) => (e && !out ? fail(e) : ok({ stdout: out })));
        });
        return (JSON.parse(stdout) as { isAuthenticated?: boolean }).isAuthenticated === true;
    },
};

/**
 * Variables through which Copilot would work with an own provider (BYOK) or without questions, or with a token the
 * machine settings do not know of (they take precedence over the stored login).
 */
const COPILOT_FOREIGN = /^(COPILOT_(PROVIDER_|OFFLINE$|ALLOW_ALL$|GITHUB_TOKEN$)|GH_TOKEN$|GITHUB_TOKEN$)/;

/** Path to the Copilot CLI: COPILOT_BIN, otherwise the binary from the npm dependency @github/copilot. */
export function copilotBinary(): string {
    if (process.env.COPILOT_BIN?.trim()) return process.env.COPILOT_BIN.trim();
    // The platform package exports the binary itself ("." → copilot.exe), as npm-loader.js of @github/copilot finds it
    const require = createRequire(import.meta.url);
    const platforms = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
    for (const p of platforms) {
        try {
            return require.resolve(`@github/copilot-${p}-${process.arch}`);
        } catch {
            // next variant
        }
    }
    throw new Error(t('acp.copilotMissing', { platform: `${process.platform}-${process.arch}` }));
}

export const COPILOT: AcpAgent = {
    engine: 'copilot',
    name: 'Copilot',
    // Copilot takes the stored login itself; without one session/new reports "Authentication required"
    notSignedIn: () => t('acp.copilotNotSignedIn'),
    command() {
        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const k of Object.keys(env)) if (COPILOT_FOREIGN.test(k)) delete env[k];
        const key = engineKeyFor('copilot');
        if (key) env.COPILOT_GITHUB_TOKEN = key;
        // --no-auto-update: the version pinned in package.json runs, nothing downloaded later
        return { command: copilotBinary(), args: ['--acp', '--stdio', '--no-auto-update'], env };
    },
};

/** Missing login as a clear message (Copilot: "Authentication required" on session/new). */
function signInError(agent: AcpAgent, e: Error): Error {
    return /auth/i.test(e.message) ? new Error(`${agent.notSignedIn()} (${e.message})`) : e;
}

/**
 * Google Antigravity: the ACP server `agy_acp_server` comes as an archive from the ACP registry, installed by
 * `local/tools/acp-install.mjs antigravity-acp` into %LOCALAPPDATA%\antigravity-acp\<version>. It is a bundled
 * Python program and needs about 25 s to start. Sign-in with the Google account (oauth-personal, which is also the
 * way for Google AI Pro/Ultra; the credentials live in ~/.gemini/antigravity-acp) or with the Gemini API key of the
 * machine settings (gemini-api-key). Without a login `authenticate` would open a browser, so the credentials file is
 * checked beforehand. GEMINI_API_KEY and the like from the environment are removed so nothing is billed through them.
 */
export function antigravityDir(): string {
    if (process.env.ANTIGRAVITY_ACP_DIR?.trim()) return process.env.ANTIGRAVITY_ACP_DIR.trim();
    return process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'antigravity-acp')
        : path.join(os.homedir(), '.local', 'share', 'antigravity-acp');
}

/** Newest installed version (folders like 1.3.0). */
export function antigravityVersion(dir = antigravityDir()): { name: string; folder: string } | null {
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return null;
    }
    const parts = (n: string) => n.split('.').map(Number);
    const name = names.filter((n) => /^\d+(\.\d+)*$/.test(n)).sort((a, b) => {
        const x = parts(a), y = parts(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
        return 0;
    })[0];
    return name ? { name, folder: path.join(dir, name) } : null;
}

/** Folder of the Antigravity ACP server's credentials (GEMINI_HOME, otherwise ~/.gemini). */
export function antigravityHome(): string {
    return path.join(process.env.GEMINI_HOME?.trim() || path.join(os.homedir(), '.gemini'), 'antigravity-acp');
}

const GEMINI_KEYS = /^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_CLOUD_PROJECT|GOOGLE_CLOUD_LOCATION|GOOGLE_APPLICATION_CREDENTIALS|AGY_LLM_GATEWAY_URL|AGY_ACP_ENABLE_OAUTH)$/;

export const ANTIGRAVITY: AcpAgent = {
    engine: 'antigravity',
    name: 'Antigravity',
    get signIn() {
        return engineKeyFor('antigravity') ? 'gemini-api-key' : 'oauth-personal';
    },
    notSignedIn: () => t('acp.antigravityNotSignedIn'),
    command() {
        const v = antigravityVersion();
        if (!v) throw new Error(t('acp.antigravityMissing', { dir: antigravityDir() }));
        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const k of Object.keys(env)) if (GEMINI_KEYS.test(k)) delete env[k];
        const key = engineKeyFor('antigravity');
        if (key) env.GEMINI_API_KEY = key;
        return { command: path.join(v.folder, process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par'), args: [], env };
    },
    async signedIn() {
        if (engineKeyFor('antigravity')) return true;
        // After the login, the file with the OAuth credentials lies next to settings.json (auth.type)
        const home = antigravityHome();
        try {
            const s = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')) as { auth?: { type?: string } };
            if (s.auth?.type && s.auth.type !== 'oauth-personal') return false;
        } catch {
            return false;
        }
        return fs.readdirSync(home).some((n) => /oauth|cred|token/i.test(n) && n !== 'settings.json');
    },
};

/**
 * Variables through which OpenCode would pick a provider on its own: it reads every provider's API key from the
 * environment (GEMINI_API_KEY, ANTHROPIC_API_KEY, AWS_*, …) and would bill through it. Providers come only from its
 * own login (`opencode auth login`, ~/.local/share/opencode/auth.json) or its config. The backend's own secrets
 * (AGENT_TOKEN, E2E_KEY, …) go with them.
 */
const OPENCODE_FOREIGN = /(_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD)$|^(AWS_|AZURE_|GOOGLE_|VERTEX|OPENROUTER_|OPENCODE_(CONFIG|API|SERVER))/i;

/**
 * OpenCode's permissions: every tool asks, so session/request_permission reaches the bot's approval rules (policy.ts)
 * like with the other engines; by default OpenCode would run everything without asking.
 */
const OPENCODE_PERMISSIONS = JSON.stringify({ permission: { edit: 'ask', bash: 'ask', webfetch: 'ask', external_directory: 'ask' } });

/** Path to OpenCode: OPENCODE_BIN, otherwise the binary from the npm dependency opencode-ai. */
export function opencodeBinary(): string {
    if (process.env.OPENCODE_BIN?.trim()) return process.env.OPENCODE_BIN.trim();
    const os_ = process.platform === 'win32' ? 'windows' : process.platform;
    const exe = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
    const require = createRequire(import.meta.url);
    // baseline: builds for CPUs without AVX2; musl for Alpine. The plain build first, as npm-loader of opencode-ai does
    for (const variant of ['', '-baseline', '-musl', '-baseline-musl']) {
        try {
            return path.join(path.dirname(require.resolve(`opencode-${os_}-${process.arch}${variant}/package.json`)), 'bin', exe);
        } catch {
            // next variant
        }
    }
    throw new Error(t('acp.opencodeMissing', { platform: `${process.platform}-${process.arch}` }));
}

/**
 * OpenCode: open source, its free models (OpenCode Zen, "… Free") need no login at all; the user decided on
 * 2026-10-17 that bots may use them, though the providers may train on what they receive. Other providers come from
 * `opencode auth login` (ChatGPT subscription, Copilot, local Ollama via its config). Never through API keys from
 * the environment.
 */
export const OPENCODE: AcpAgent = {
    engine: 'opencode',
    name: 'OpenCode',
    notSignedIn: () => t('acp.opencodeNotSignedIn'),
    command() {
        const env: NodeJS.ProcessEnv = {};
        for (const [k, v] of Object.entries(process.env)) if (!OPENCODE_FOREIGN.test(k)) env[k] = v;
        env.OPENCODE_CONFIG_CONTENT = OPENCODE_PERMISSIONS;
        return { command: opencodeBinary(), args: ['acp'], env };
    },
    modelLabel: (name, value) => {
        // "OpenCode/Big Pickle" → "Big Pickle"; free Zen models carry a warning about training
        const short = name.replace(/^OpenCode\//, '');
        return value.startsWith('opencode/') ? t('acp.opencodeFree', { name: short }) : short;
    },
};

/** ACP agents per engine. */
export const ACP_AGENTS: Record<AcpAgent['engine'], AcpAgent> = { cursor: CURSOR, copilot: COPILOT, antigravity: ANTIGRAVITY, opencode: OPENCODE };

// ------------------------------------------------------------------ Connection

interface Capabilities {
    loadSession?: boolean;
    mcpCapabilities?: { http?: boolean };
    promptCapabilities?: { image?: boolean };
}

/** An ACP agent in the background: initialize, then sign-in via the CLI's login. */
export class AcpConnection extends RpcProcess {
    version = '';
    capable: Capabilities = {};

    private agent: AcpAgent;
    constructor(agent: AcpAgent, cwd?: string) {
        const b = agent.command();
        super(agent.name, b.command, b.args, b.env, true, cwd);
        this.agent = agent;
    }

    async start(): Promise<void> {
        const r = await Promise.race([
            this.call<{ agentCapabilities?: Capabilities; agentInfo?: { version?: string }; authMethods?: { id: string }[] }>('initialize', {
                protocolVersion: 1,
                // The agent handles files and terminals itself
                clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
                clientInfo: { name: 'openfolk', title: 'OpenFolk', version: '0.1.0' },
            }),
            new Promise<never>((_, fail) => setTimeout(() => fail(new Error(t('acp.noAnswer', { name: this.agent.name, seconds: START_MS / 1000 }))), START_MS).unref()),
        ]);
        this.capable = r.agentCapabilities ?? {};
        this.version = r.agentInfo?.version ?? (this.agent.engine === 'cursor' ? cursorVersion()?.name.split('-')[0] ?? '' : '');
        if (!this.agent.signIn || !r.authMethods?.some((m) => m.id === this.agent.signIn)) return;
        if (this.agent.signedIn && !(await this.agent.signedIn())) throw new Error(this.agent.notSignedIn());
        try {
            await Promise.race([
                this.call('authenticate', { methodId: this.agent.signIn }),
                new Promise((_, fail) => setTimeout(() => fail(new Error(`no answer after ${SIGN_IN_MS / 1000} s`)), SIGN_IN_MS).unref()),
            ]);
        } catch (e) {
            throw new Error(`${this.agent.notSignedIn()} (${(e as Error).message})`, { cause: e });
        }
    }
}

// ------------------------------------------------------------------ Models

interface ConfigOption {
    id: string;
    name: string;
    category?: string | null;
    type: string;
    currentValue?: string | boolean;
    options?: ({ value: string; name: string } | { group: string; name: string; options: { value: string; name: string }[] })[];
}

function modelOption(options: ConfigOption[] | null | undefined): ConfigOption | undefined {
    return options?.find((o) => o.category === 'model' && o.type === 'select');
}

function choices(o: ConfigOption): { value: string; name: string }[] {
    return (o.options ?? []).flatMap((x) => ('group' in x ? x.options : [x]));
}

/**
 * Models of the agent from the model option of a fresh session (in an empty temp folder, without a message, so
 * without usage). None without installation or login.
 */
export async function acpModels(agent: AcpAgent): Promise<ModelInfo[]> {
    try {
        agent.command();
    } catch {
        return [];
    }
    // Without a login do not even start a process (Antigravity alone would need 25 s for it)
    if (agent.signedIn && !(await agent.signedIn())) throw new Error(agent.notSignedIn());
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-acp-'));
    const v = new AcpConnection(agent);
    try {
        await v.start();
        const r = await v.call<{ configOptions?: ConfigOption[] }>('session/new', { cwd: folder, mcpServers: [] }).catch((e: Error) => { throw signInError(agent, e); });
        const o = modelOption(r.configOptions);
        const m = agent.engine;
        if (!o) return [{ value: m, resolvedModel: m, displayName: agent.name }];
        const list: ModelInfo[] = choices(o).map((x) => ({ value: `${m}:${x.value}`, resolvedModel: `${m}:${x.value}`, displayName: `${agent.modelLabel?.(x.name, x.value) ?? x.name} (${agent.name})` }));
        list.unshift({ value: m, resolvedModel: `${m}:${String(o.currentValue)}`, displayName: agent.name });
        return list;
    } finally {
        v.stop();
        // On Windows the agent that was just stopped still holds the folder briefly
        try {
            removeTree(folder, 5);
        } catch (e) {
            console.log(`${agent.engine}-models: ${folder} stays behind (${(e as Error).message})`);
        }
    }
}

// ------------------------------------------------------------------ Run of a bot session

/** Approval "always for this session": the agent remembers it itself (allow_always). */
const SESSION_ALWAYS: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'acp' }], behavior: 'allow', destination: 'session' }];

interface AcpToolCall {
    toolCallId: string;
    title?: string | null;
    name?: string | null;
    kind?: string | null;
    status?: string | null;
    rawInput?: unknown;
    rawOutput?: unknown;
    locations?: { path: string }[] | null;
    content?: ({ type: 'content'; content: { type: string; text?: string } } | { type: 'diff'; path: string; oldText?: string | null; newText: string } | { type: 'terminal'; terminalId: string })[] | null;
}

interface AcpQuestion {
    id: string;
    prompt: string;
    options: { id: string; label: string }[];
    allowMultiple?: boolean;
}

/**
 * Holds the agent process and the ACP session of a bot session. Jobs come one after another (the BotSession waits
 * for `done`); approvals go to the bot's approval rules.
 */
export class AcpRun {
    private v: AcpConnection | null = null;
    private starting: Promise<void> | null = null;
    private session: string | null = null;
    private access: ToolAccess | null = null;
    private models: ConfigOption | undefined;
    private ownTools: string[] = [];
    /** New session: persona and rules go along with the first message. */
    private pendingInstructions: string | null = null;
    /** During session/load the agent replays the old history as updates; they do not belong in the chat. */
    private loading = false;
    private active = false;
    private lastKind: 'text' | 'tool' | null = null;
    private calls = new Map<string, AcpToolCall>();
    private toolStart = new Map<string, number>();
    private requests = new Map<string, AbortController>();

    private agent: AcpAgent;
    private z: EngineTarget;
    constructor(agent: AcpAgent, z: EngineTarget) {
        this.agent = agent;
        this.z = z;
    }

    get running(): boolean {
        return !!this.v?.running;
    }

    async send(content: string | Record<string, unknown>[], s: EngineStart): Promise<void> {
        this.active = true;
        this.lastKind = null;
        try {
            await this.ready(s);
            await this.setModel(s.model);
            const prompt = acpInput(content, this.v?.capable.promptCapabilities?.image !== false);
            if (this.pendingInstructions) {
                prompt.unshift({ type: 'text', text: `<instructions>\n${this.pendingInstructions}\n</instructions>` });
                this.pendingInstructions = null;
            }
            const r = await this.v!.call<{ stopReason: string }>('session/prompt', { sessionId: this.session, prompt });
            this.finish(stopReason(r.stopReason));
        } catch (e) {
            this.finish((e as Error).message);
        }
    }

    async interrupt(): Promise<void> {
        if (!this.v || !this.session || !this.active) return;
        // Open approvals are answered "cancelled" by the abort, as ACP requires after session/cancel
        for (const a of this.requests.values()) a.abort();
        this.v.notify('session/cancel', { sessionId: this.session });
    }

    close(): void {
        const v = this.v;
        this.v = null;
        this.starting = null;
        this.session = null;
        this.access?.close();
        this.access = null;
        for (const a of this.requests.values()) a.abort();
        this.requests.clear();
        v?.stop();
    }

    private finish(error?: string): void {
        if (!this.active) return;
        this.active = false;
        this.calls.clear();
        this.toolStart.clear();
        this.z.done(error);
    }

    private async ready(s: EngineStart): Promise<void> {
        if (this.v?.running && this.starting) return this.starting;
        this.close();
        // Without a login do not even start a process (Antigravity alone would need 25 s for it)
        if (this.agent.signedIn && !(await this.agent.signedIn())) throw new Error(this.agent.notSignedIn());
        const v = new AcpConnection(this.agent, s.folder);
        this.v = v;
        v.onNotification = (m, p) => this.notification(m, p);
        v.onRequest = (m, p, id) => this.request(m, p, id);
        v.onEnd = (error) => {
            if (this.v !== v) return;
            this.close();
            this.finish(error ?? t('engine.processEnded', { name: this.agent.name }));
        };
        this.starting = this.open(v, s).catch((e: Error) => {
            this.close();
            throw e;
        });
        return this.starting;
    }

    private async open(v: AcpConnection, s: EngineStart): Promise<void> {
        await v.start();
        this.ownTools = s.tools.map((w) => w.name);
        this.access = await toolAccess(s.tools);
        const mcpServers = v.capable.mcpCapabilities?.http ? [{ type: 'http', name: 'openfolk', url: this.access.url, headers: [] }] : [];
        if (!mcpServers.length) this.z.notice(t('acp.noHttpMcp', { name: this.agent.name }));

        let options: ConfigOption[] | null | undefined;
        if (s.threadId && v.capable.loadSession) {
            this.loading = true;
            try {
                options = (await v.call<{ configOptions?: ConfigOption[] }>('session/load', { sessionId: s.threadId, cwd: s.folder, mcpServers })).configOptions;
                this.session = s.threadId;
            } catch (e) {
                console.log(`${this.agent.engine}: session ${s.threadId} cannot be resumed: ${(e as Error).message}`);
                this.z.notice(t('engine.resumeFailed', { name: this.agent.name }));
            } finally {
                this.loading = false;
            }
        }
        if (!this.session) {
            const r = await v.call<{ sessionId: string; configOptions?: ConfigOption[] }>('session/new', { cwd: s.folder, mcpServers }).catch((e: Error) => { throw signInError(this.agent, e); });
            this.session = r.sessionId;
            options = r.configOptions;
            this.pendingInstructions = s.instructions;
        }
        this.models = modelOption(options);
        this.z.threadId(this.session);
        this.reportAccount();
    }

    private reportAccount(): void {
        const current = this.models ? choices(this.models).find((x) => x.value === this.models?.currentValue)?.name ?? String(this.models.currentValue) : '';
        this.z.account({ plan: null, version: this.v?.version ?? '', model: current });
    }

    /** Switches the model if the bot wants a specific one; undefined keeps the agent's default. */
    private async setModel(model: string | undefined): Promise<void> {
        if (!model || !this.v || !this.session) return;
        if (!this.models) {
            this.z.notice(t('acp.noModelChoice', { name: this.agent.name }));
            return;
        }
        if (this.models.currentValue === model) return;
        try {
            const r = await this.v.call<{ configOptions?: ConfigOption[] }>('session/set_config_option', { sessionId: this.session, configId: this.models.id, value: model });
            this.models = modelOption(r.configOptions) ?? { ...this.models, currentValue: model };
            this.reportAccount();
        } catch (e) {
            this.z.notice(t('acp.modelUnavailable', { model, error: (e as Error).message, current: String(this.models.currentValue) }));
        }
    }

    // ---------------------------------------------------------------- Notifications

    private notification(method: string, p: Params): void {
        if (method !== 'session/update' || this.loading || p.sessionId !== this.session) return;
        const u = p.update as AcpToolCall & { sessionUpdate: string; content?: unknown; used?: number };
        switch (u.sessionUpdate) {
            case 'agent_message_chunk': {
                const c = u.content as { type?: string; text?: string } | undefined;
                if (c?.type !== 'text' || !c.text) break;
                if (this.lastKind === 'tool') this.z.textStarts();
                this.lastKind = 'text';
                this.z.delta(c.text);
                break;
            }
            case 'tool_call':
                this.toolStarts(u);
                break;
            case 'tool_call_update': {
                if (!this.calls.has(u.toolCallId)) this.toolStarts(u);
                const x = { ...this.calls.get(u.toolCallId)!, ...withoutEmpty(u) };
                this.calls.set(u.toolCallId, x);
                if (x.status === 'completed' || x.status === 'failed') this.toolDone(x);
                break;
            }
            case 'usage_update':
                if (typeof u.used === 'number' && u.used > 0) this.z.context(u.used);
                break;
            default:
                break;
        }
    }

    private toolStarts(x: AcpToolCall): void {
        this.calls.set(x.toolCallId, x);
        const a = acpTool(x, this.ownTools);
        if (!a) return;
        this.lastKind = 'tool';
        this.toolStart.set(x.toolCallId, Date.now());
        this.z.tool(a.call);
    }

    private toolDone(x: AcpToolCall): void {
        const since = this.toolStart.get(x.toolCallId);
        if (since === undefined) return;
        this.toolStart.delete(x.toolCallId);
        this.z.toolResult(x.toolCallId, x.status === 'completed', truncate(acpResult(x)), Date.now() - since);
    }

    // ---------------------------------------------------------------- Requests of the agent

    private async request(method: string, p: Params, id: number | string): Promise<unknown> {
        const abort = new AbortController();
        this.requests.set(String(id), abort);
        try {
            switch (method) {
                case 'session/request_permission':
                    return await this.permission(p as { toolCall: AcpToolCall; options: { optionId: string; kind: string }[] }, abort.signal);
                case 'cursor/ask_question':
                    return await this.question(p as { title?: string; questions: AcpQuestion[] }, abort.signal);
                case 'cursor/create_plan': {
                    // Rare without plan mode; the plan appears in the chat and counts as accepted
                    const plan = p as { name?: string; plan?: string };
                    if (plan.plan) {
                        this.z.textStarts();
                        this.z.delta(`**Plan${plan.name ? `: ${plan.name}` : ''}**\n\n${plan.plan}\n\n`);
                    }
                    return { outcome: { outcome: 'accepted' } };
                }
                default:
                    throw new Error(`${method} is not supported by OpenFolk`);
            }
        } finally {
            this.requests.delete(String(id));
        }
    }

    private async permission(p: { toolCall: AcpToolCall; options: { optionId: string; kind: string }[] }, signal: AbortSignal): Promise<unknown> {
        const x = { ...this.calls.get(p.toolCall.toolCallId), ...withoutEmpty(p.toolCall) } as AcpToolCall;
        const a = acpTool(x, this.ownTools) ?? { name: 'mcp__acp__tool', input: { title: x.title ?? '' } };
        const r = await this.z.approval(a.name, a.input, signal, SESSION_ALWAYS);
        if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
        const option = choose(p.options, r);
        return option ? { outcome: { outcome: 'selected', optionId: option } } : { outcome: { outcome: 'cancelled' } };
    }

    /** cursor/ask_question via the same question card as AskUserQuestion. */
    private async question(p: { title?: string; questions: AcpQuestion[] }, signal: AbortSignal): Promise<unknown> {
        const questions = p.questions.map((q) => ({
            question: q.prompt,
            header: (p.title || t('acp.questionHeader')).slice(0, 12),
            options: q.options.map((o) => ({ label: o.label, description: '' })),
            multiSelect: !!q.allowMultiple,
        }));
        const r = await this.z.approval('AskUserQuestion', { questions }, signal);
        if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
        if (r.behavior !== 'allow') return { outcome: { outcome: 'skipped', reason: r.message } };
        const answers = (r.updatedInput?.answers ?? {}) as Record<string, string>;
        return { outcome: { outcome: 'answered', answers: questionAnswers(p.questions, answers) } };
    }
}

// ------------------------------------------------------------------ Mapping

/** Answers of the question card (per question the chosen label, several separated by commas) as option ids. */
export function questionAnswers(questions: AcpQuestion[], answers: Record<string, string>): { questionId: string; selectedOptionIds: string[] }[] {
    return questions.map((q) => {
        const chosen = (answers[q.prompt] ?? '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
        return { questionId: q.id, selectedOptionIds: q.options.filter((o) => chosen.includes(o.label)).map((o) => o.id) };
    });
}

/** Matching option of the permission request: "always" only if the user wanted it and the agent offers it. */
export function choose(options: { optionId: string; kind: string }[], r: PermissionResult): string | undefined {
    const first = (...kinds: string[]) => kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean)?.optionId;
    if (r.behavior !== 'allow') return first('reject_once', 'reject_always');
    return r.updatedPermissions?.length ? first('allow_always', 'allow_once') : first('allow_once', 'allow_always');
}

function stopReason(reason: string): string | undefined {
    switch (reason) {
        case 'end_turn': return undefined;
        case 'cancelled': return t('engine.interrupted');
        case 'refusal': return t('acp.refusal');
        case 'max_tokens': return t('acp.maxTokens');
        case 'max_turn_requests': return t('acp.maxTurns');
        default: return undefined;
    }
}

function withoutEmpty<T extends object>(o: T): Partial<T> {
    return Object.fromEntries(Object.entries(o).filter(([, w]) => w !== null && w !== undefined)) as Partial<T>;
}

function text(x: unknown): string {
    return typeof x === 'string' ? x : '';
}

/**
 * Tool call of the agent as name and input as in Claude Code, so display and approval rules (policy.ts) apply
 * the same way. null for pure thinking steps.
 */
export function acpTool(x: AcpToolCall, own: string[] = []): { call: ToolCall; name: string; input: Record<string, unknown> } | null {
    const raw = (x.rawInput && typeof x.rawInput === 'object' ? x.rawInput : {}) as Record<string, unknown>;
    const title = x.title ?? '';
    const paths = [...new Set([
        ...(x.locations ?? []).map((l) => l.path),
        ...(x.content ?? []).flatMap((c) => (c.type === 'diff' ? [c.path] : [])),
        ...[raw.path, raw.file_path, raw.filePath].map(text).filter(Boolean),
    ])];
    const make = (name: string, input: Record<string, unknown>) => ({ call: { id: x.toolCallId, name, summary: toolSummary(name, input) }, name, input });

    // OpenFolk's own tools pass without a question, so only a call without a concrete kind counts as one, and only by
    // its exact name or a title like "openfolk: send_file" (OpenCode: "openfolk_send_file"): a shell command or an edit
    // whose title merely mentions send_file must stay what it is
    const concrete = ['execute', 'edit', 'delete', 'move', 'read', 'search', 'fetch'].includes(x.kind ?? '');
    const ownTool = concrete ? undefined : own.find((w) => x.name === w || title === w || new RegExp(`^(mcp__)?openfolk(\\W+|_)${w}$`, 'i').test(title.trim()));
    if (ownTool) return make(`mcp__openfolk__${ownTool}`, raw);
    switch (x.kind) {
        case 'execute': {
            const command = Array.isArray(raw.command) ? raw.command.map(String).join(' ') : text(raw.command) || text(raw.cmd) || title;
            return make(shellName(command), { command: withoutShell(command), description: title !== command ? title : '' });
        }
        case 'edit':
        case 'delete':
        case 'move': {
            const diffs = (x.content ?? []).flatMap((c) => (c.type === 'diff' ? [`${c.path}\n${c.oldText ? `- ${c.oldText.slice(0, 600)}\n` : ''}+ ${c.newText.slice(0, 600)}`] : []));
            const r = make('Write', { file_path: paths.join(', ') || title, files: paths, content: diffs.join('\n\n') || title });
            return { ...r, call: { ...r.call, name: 'Edit', summary: toolSummary('Edit', { file_path: paths.join(', ') || title }) } };
        }
        case 'read':
            return make('Read', { file_path: paths[0] ?? title });
        case 'search':
            return make('Grep', { pattern: text(raw.pattern) || text(raw.query) || title });
        case 'fetch':
            return make('WebFetch', { url: text(raw.url) || text(raw.query) || title });
        case 'think':
        case 'switch_mode':
            return null;
        default: {
            // policy.ts asks for these in "risky": the name comes from a free-text title, not from a tool's real name
            const short = (x.name || title || 'tool').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'tool';
            return make(`mcp__acp__${short}`, raw);
        }
    }
}

export function acpResult(x: AcpToolCall): string {
    const parts = (x.content ?? []).map((c) => {
        if (c.type === 'content') return c.content.type === 'text' ? c.content.text ?? '' : c.content.type === 'image' ? '[Image]' : '';
        if (c.type === 'diff') return `${c.path}\n${c.newText}`;
        return '[Terminal]';
    }).filter(Boolean);
    if (!parts.length) {
        const r = x.rawOutput as { output?: unknown; stdout?: unknown; stderr?: unknown } | string | undefined;
        if (typeof r === 'string') parts.push(r);
        else if (r) parts.push([r.output, r.stdout, r.stderr].map(text).filter(Boolean).join('\n'));
    }
    return parts.join('\n');
}

/** Content of a job (text or Claude content blocks) as an ACP prompt; PDFs are available as a file. */
export function acpInput(content: string | Record<string, unknown>[], images = true): Record<string, unknown>[] {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    const r: Record<string, unknown>[] = [];
    for (const b of content) {
        const source = b.source as { type?: string; media_type?: string; data?: string } | undefined;
        if (b.type === 'text') r.push({ type: 'text', text: String(b.text ?? '') });
        else if (b.type === 'image' && images && source?.type === 'base64') r.push({ type: 'image', mimeType: source.media_type, data: source.data });
    }
    return r.length ? r : [{ type: 'text', text: '' }];
}

function truncate(s: string): string {
    return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '\n…' : s;
}
