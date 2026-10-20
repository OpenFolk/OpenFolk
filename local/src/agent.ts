// Bot manager: holds the sessions, answers the web app's frames and connects approvals, groups, routines, push
// and the bots' own tools (bot-tools.ts). Answers go out via `send(frame, cid?)`: with cid only to that browser,
// without cid to all connected browsers.
//
// Several machines: every machine runs a backend with a copy of all bots (sync in sync.ts). A bot lives on exactly
// one machine, in a folder on that machine (see responsibleMachine()); jobs for a bot that lives elsewhere go via
// the relay to that machine's backend. Nothing moves on its own: while its machine sleeps, the bot sleeps too.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { forkSession, getSessionInfo, type McpServerConfig, type PermissionResult, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { botToolServer, engineToolsFor, toolText, type ToolHost, type ToolText } from './bot-tools.ts';
import { e2eEnabled, e2eKeyForLink } from './e2e.ts';
import { joinDone, joinPending } from './join.ts';
import { appUrl, newMachineInvite, newPairingLink, pairingSvg, pairingUrl } from './pairing.ts';
import { startDeviceLogin } from './engine-login.ts';
import { claudeSignInCommand, engineAvailable } from './engine-home.ts';
import { cloneRepository, inspectFolder, originOf, proposeFolder } from './folders.ts';
import type { WarningCode } from './relay-client.ts';
import {
    archiveConversation, botSessionIds, createConversation, deleteBot, deleteGroup, findBot, findConversation, findGroup, isMuted, isUnder, loadBots, loadGroups, mayMessage,
    readSessionId, removeConversation, renameConversation, roleLine, saveBot, saveBots, saveGroup, setFavorite, setModel, setMuted, setSessionId, underAllowedRoot,
} from './bots.ts';
import { autologon, canAutologon, type AutologonState } from './autologon.ts';
import { config } from './config.ts';
import { pin, pinnedForBrowser } from './pinned.ts';
import { applySeen, loadSeen } from './seen.ts';
import { commitAndPush, listChanges, openRepos, overlaps, pullRepo, pullRepos, pullText, pushAccess } from './git.ts';
import { changedSince, requestRestart, requested } from './restart.ts';
import { canRestart, canShutdown, shutdown } from './shutdown.ts';
import {
    appendEntry, countEntries, deleteHistory, markDeleted, markDiscarded, markMoved, markRead, readEntry, readVisible, searchHistory, toolOutput,
    withoutToolOutput,
} from './history.ts';
import { claudeMdExcerpt, readFile, saveUploads, skillsFor } from './files.ts';
import { locale, t } from './i18n.ts';
import {
    deleteFact, isValidLocation, knowledgeSections, readFact, saveFact, sees,
} from './knowledge.ts';
import type { CodexLimits, EngineTool } from './codex.ts';
import { approvalText, needsApproval } from './policy.ts';
import { gitAutoPull, loadSettings, saveApiKeys, saveLanguage, saveSettings, settingsForBrowser, voiceLanguage } from './settings.ts';
import { claudeOnKey, keyFallbackState, onKeyFallbackChange, resetKeyFallback, subscriptionLimit } from './key-fallback.ts';
import {
    anthropicKey, applyGitPush, engineKey, gitPushToken, machineSettings, noEngine, saveAnthropicKey, saveEngineKey, saveGitPushToken, saveMachineSettings,
} from './machine-settings.ts';
import { checkClientFrame } from './frames.ts';
import {
    adoptVapid, publicKey, pushChannels, pushSettings, removeSubscriptions, savePushSettings, saveSubscription, sendPush, vapidKeys, type PushMessage,
} from './push.ts';
import { deleteBotRoutines, deleteRoutine, loadRoutines, saveRoutine, setStatus, startScheduler, wakeSchedule } from './routines.ts';
import {
    BotSession, claudeModels, newTurn, queryModels, type AccountInfo, type RateLimitInfo, type SessionHooks, type Turn, type TurnResult,
} from './session.ts';
import { pendingTransfers, scheduleTransfer, TransferReceiver, transferParts } from './session-transfer.ts';
import { applyWork, packWork, pendingWork, scheduleWork, stashWork, WorkReceiver, workParts } from './work-transfer.ts';
import { currentAccount, DEFAULT_ACCOUNT, readJson, writeJson } from './store.ts';
import { merge, snapshot } from './sync.ts';
import { keywordTitle } from './title.ts';
import { suggest } from './suggestions.ts';
import { transcriber } from './voice.ts';
import { setupVoice, voiceStatus } from './voice-setup.ts';
import { projectDir, listVscodeSessions, transcriptStoreError, transcriptPath, Watcher } from './vscode.ts';
import { availableTemplate, handOver, handoverTargets, openSignInTerminal, signInCommand } from './handover.ts';
import { claimRelay } from './relay-switch.ts';

import {
    botIdOf, isConversation, isGroup, modelDisplayName, engineOf, OTHER_ENGINES, ENGINE_NAMES, KEY_ENGINES, MIN_CLIENT_PROTOCOL, PROTOCOL_VERSION, type ModelInfo,
    type KnowledgeLocation, type BotInfo, type EngineStatuses, type HandoverTarget,
    type AgentFrame, type Approval, type PushKind, type Attachment, type Bot, type BotState, type ClientFrame, type GitRepo, type Group,
    type HistoryEntry, type PushGap, type LiveTurn, type NativePushSubscription, type PeerData, type Question, type Routine, type TurnSpec, type UploadInput, type Usage, type WakeEntry, type Quote,
} from '../../shared/protocol.ts';


export type Sender = (frame: AgentFrame, cid?: string) => void;
/** Data to other backends: to one machine or (without `to`) to all others. */
export type PeerSender = (data: PeerData, to?: string) => void;
/** Wake schedule to the relay (runs of routines with `wake`). */
export type WakeScheduleSender = (schedule: WakeEntry[]) => void;

const APPROVAL_TIMEOUT_MIN = 30;
const BOT_ANSWER_TIMEOUT_MIN = 20;
/** How often bots may pass on to each other with @ in a group. */
const MAX_GROUP_HOPS = 4;
/** Length of the delegation chain with message_bot. */
const MAX_CHAIN = 4;
/** This many entries of an adopted VS Code session go into the conversation's history. */
const VSCODE_HISTORY = 40;
/** Repos of the bots are fetched and fast-forwarded at least this often (shared setting gitAutoPull). */
const PULL_EVERY_MS = 15 * 60_000;

interface OpenApproval {
    approval: Approval;
    session: BotSession;
    input: Record<string, unknown>;
    suggestions?: PermissionUpdate[];
    settle: (r: PermissionResult, text: string) => void;
}

/** Who runs a bot when this machine is not responsible: a job via the relay. */
interface RemoteJob {
    onDone: (e: TurnResult) => void;
    timer: NodeJS.Timeout;
}

/**
 * The machine a bot runs on: its own machine if it is awake, otherwise none. A bot without a machine (from before
 * 0.2) runs on the alphabetically first machine awake, which claims it (claimUnplacedBots). All backends and the
 * web app compute the same so routines run only once.
 */
export function responsibleMachine(bot: Pick<Bot, 'machine'>, online: string[]): string | null {
    if (!bot.machine) return [...online].sort()[0] ?? null;
    return online.includes(bot.machine) ? bot.machine : null;
}

/** Frames about the machine and its logins, which only its owner's account ('main') may send. */
const MAIN_ONLY = new Set<string>(['claude_sign_in', 'relay_claim', 'machine_shutdown', 'machine_autologon', 'machine_settings_save', 'voice_setup', 'machine_join_link', 'backend_restart', 'vscode_sessions', 'vscode_open', 'vscode_close', 'vscode_adopt', 'vscode_show']);

export class BotManager implements SessionHooks {
    private sessions = new Map<string, BotSession>();
    private approvals = new Map<string, OpenApproval>();
    private clients = new Map<string, { visible: boolean }>();
    private claudeAccount: AccountInfo | null = null;
    /** Accounts of the other engines (Codex, Cursor), once one of them ran */
    private otherAccounts = new Map<string, AccountInfo>();
    /** Which engines can run on this machine (setup checklist); from the last model query, kept across restarts. */
    private engines: EngineStatuses = readJson<EngineStatuses>('engines.json', {});
    private claudeHintShown = false;
    private usageClaude: Usage | null = null;
    private usageCodex: Usage | null = null;
    private limitReported = false;
    private limitReportedCodex = false;
    private scheduler: NodeJS.Timeout | null = null;
    /** Per group round the bots already prompted (prevents duplicate answers). */
    private rounds = new Map<string, Set<string>>();
    /** Machines awake according to the relay (including this one). */
    private online: string[] = [config.machine];
    private remoteJobs = new Map<string, RemoteJob>();
    private transferReceiver = new TransferReceiver();
    private workReceiver = new WorkReceiver();
    /** Folders whose arrived work is being applied (work-transfer.ts); the automatic pull leaves them alone. */
    private applyingWork = new Set<string>();
    /** Routines the relay woke this machine for; once all are done, it shuts down again. */
    private wakeRoutines = new Set<string>();
    private offTimer: NodeJS.Timeout | null = null;
    private autologonCache: { state: AutologonState; time: number } | null = null;
    /** VS Code sessions a browser is looking at right now. */
    private watcher: Watcher;
    /** Last finding about the transcript store, so every outage is reported only once. */
    private storeError: string | null = null;
    /** Open repos per bot of this machine, as last sent to the browsers (see checkGitStatus()). */
    private gitStatus: Record<string, GitRepo[]> = {};
    private gitStatusJson = '{}';
    private gitRun: Promise<void> | null = null;
    private gitAgain = false;
    private gitTimer: NodeJS.Timeout | null = null;
    /** Start of this backend; backend code changed later means "restart needed" (see sendBackendStatus()). */
    private readonly startedAt = Date.now();
    private backendStatusJson = '';
    /** Created in the context of its account (store.ts), so this is the account it serves. */
    private readonly accountId = currentAccount();
    /** The language the sessions' system prompts were built with; other settings changes leave them alone. */
    private sessionLanguage = loadSettings().language;
    /** Repeating work of start(); close() ends it, an account can be deleted while the process runs. */
    private intervals: NodeJS.Timeout[] = [];
    private offKeyFallback: (() => void) | null = null;
    /** Whether another account on this machine is busy or watched (accounts.ts); the machine is shared. */
    othersInUse: () => boolean = () => false;

    private send: Sender;
    private peer: PeerSender;
    private sendWakeSchedule: WakeScheduleSender;
    constructor(send: Sender, peer: PeerSender = () => undefined, sendWakeSchedule: WakeScheduleSender = () => undefined) {
        this.send = send;
        this.peer = peer;
        this.sendWakeSchedule = sendWakeSchedule;
        this.watcher = new Watcher((part, cid) => this.send({ type: 'vscode_history', ...part }, cid));
    }

    start(): void {
        this.scheduler = startScheduler((r) => {
            // Only the responsible machine runs the routine
            const bot = findBot(r.botId);
            if (bot && responsibleMachine(bot, this.online) === config.machine) this.runRoutine(r);
        });
        this.reportWakeSchedule();
        this.refreshModels();
        // Claude on subscription and key: sessions change sides on their next turn, the browsers see on which
        if (this.accountId === DEFAULT_ACCOUNT) this.offKeyFallback = onKeyFallbackChange(() => {
            console.log(`claude: ${claudeOnKey() ? 'on the API key' : 'back on the subscription'}`);
            for (const s of this.sessions.values()) s.reload();
            this.sendMachineSettings();
        });
        const every = (fn: () => void, ms: number) => this.intervals.push(setInterval(fn, ms).unref());
        // Someone signs in to Claude in a terminal while the app shows the step: notice it without a restart
        every(() => {
            if (this.engines.claude !== 'sign_in') return;
            claudeModels().then((c) => { if (c.status === 'ready') this.refreshModels(); }, () => undefined);
        }, 30_000);
        // The schedule reaches 14 days ahead; renewed hourly so it does not run out
        every(() => this.reportWakeSchedule(), 3600_000);
        this.checkTranscriptStore();
        every(() => this.checkTranscriptStore(), 300_000);
        // Changes from outside (VS Code, terminal, other machines) are only noticed this way
        every(() => this.checkGitStatus(), 120_000);
        this.pullSoon('start', 20_000);
        // A gap between two ticks means the machine slept: fetch right away, otherwise every quarter hour
        every(() => {
            const now = Date.now();
            const slept = now - this.lastTick > 3 * 60_000;
            this.lastTick = now;
            if (slept || now - this.lastPull >= PULL_EVERY_MS) this.pullBotRepos(slept ? 'wake' : 'interval');
        }, 60_000);
        every(() => this.sendBackendStatus(), 30_000);
        this.checkPushSoon(10_000);
        every(() => this.checkPushSoon(0), 3600_000);
    }

    /** Models and engine states again (on start, after a sign-in); to all browsers. */
    private refreshModels(): void {
        queryModels().then(
            ({ models, engines }) => {
                writeJson('models.json', models);
                this.send({ type: 'models', models });
                if (engines.claude === 'sign_in' && !this.claudeHintShown) {
                    this.claudeHintShown = true;
                    console.log(t(process.env.OPENFOLK_CONTAINER === '1' ? 'setup.claudeContainer' : 'setup.claudeSignIn'));
                }
                this.engines = engines;
                writeJson('engines.json', engines);
                this.sendSetupStatus();
            },
            (e) => console.log(`models: ${(e as Error).message}`),
        );
    }

    private sendSetupStatus(cid?: string): void {
        this.send({
            type: 'setup_status', relay: config.relay.mode, container: process.env.OPENFOLK_CONTAINER === '1', engines: this.engines,
            ...(claudeSignInCommand() ? { claudeCommand: claudeSignInCommand() } : {}),
            // Another account signs in into a folder of its own, with the command; the terminal is the owner's
            ...(this.accountId === DEFAULT_ACCOUNT && signInCommand() ? { claudeTerminal: true } : {}),
            ...(noEngine() ? { noEngine: true } : {}),
            ...(this.pushGaps.length ? { push: this.pushGaps } : {}),
        }, cid);
    }

    /** Git hosts this machine's bots push to without credentials here; checked on start, hourly and after changes. */
    private pushGaps: PushGap[] = [];
    private pushTimer: NodeJS.Timeout | null = null;

    private checkPushSoon(ms = 3000): void {
        if (this.pushTimer) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => {
            this.pushTimer = null;
            this.checkPushAccess().catch((e: Error) => console.log(`git: push access: ${e.message}`));
        }, ms);
        this.pushTimer.unref();
    }

    private async checkPushAccess(): Promise<void> {
        const hosts = new Map<string, { remote: string; folder: string; bots: string[] }>();
        for (const b of loadBots().filter((x) => x.machine === config.machine && fs.existsSync(x.folder))) {
            const remote = await originOf(b.folder);
            let host = '';
            try {
                host = remote ? new URL(remote).host : '';
            } catch {
                // SSH form (git@host:path): the keys live in an agent, nothing to check
            }
            if (!remote || !host) continue;
            const h = hosts.get(host);
            if (h) h.bots.push(b.id);
            else hosts.set(host, { remote, folder: b.folder, bots: [b.id] });
        }
        const gaps: PushGap[] = [];
        for (const [host, h] of hosts) if (await pushAccess(h.remote, h.folder) === false) gaps.push({ host, bots: h.bots });
        if (JSON.stringify(gaps) === JSON.stringify(this.pushGaps)) return;
        this.pushGaps = gaps;
        for (const g of gaps) console.log(`git: no credentials to push to ${g.host} (bots ${g.bots.join(', ')}); set a git token in the settings of this machine or sign in to git once`);
        this.sendSetupStatus();
    }

    /** State of the backend to one browser (cid) or, if it changed, to all. */
    private sendBackendStatus(cid?: string): void {
        const w = requested();
        const status = {
            since: new Date(this.startedAt).toISOString(), changed: changedSince(this.startedAt), ...(w ? { requested: w } : {}),
            protocol: PROTOCOL_VERSION, minClientProtocol: MIN_CLIENT_PROTOCOL,
            handover: this.accountId === DEFAULT_ACCOUNT ? handoverTargets() : [],
        };
        const json = JSON.stringify(status);
        if (!cid && json === this.backendStatusJson) return;
        if (!cid) this.backendStatusJson = json;
        this.send({ type: 'backend_status', ...status }, cid);
    }

    /** Reports once per outage via push if the CLI cannot store transcripts (otherwise every session is gone after a restart). */
    private checkTranscriptStore(): void {
        const error = transcriptStoreError();
        if (error === this.storeError) return;
        this.storeError = error;
        if (!error) {
            console.log('transcripts: store reachable again');
            return;
        }
        console.log(`transcripts: ${error}`);
        void sendPush({
            title: t('push.storeTitle', { machine: config.machine.toUpperCase() }),
            body: t('push.storeBody', { error }),
            url: '/', tag: `store-${config.machine}`,
        }).catch((e) => console.log(`push: ${(e as Error).message}`));
    }

    private reportWakeSchedule(): void {
        try {
            this.sendWakeSchedule(wakeSchedule(loadBots()));
        } catch (e) {
            console.log(`wake schedule: ${(e as Error).message}`);
        }
    }

    // ------------------------------------------------------------------ Sessions

    /** Session for a chat: its own per conversation, otherwise (main chat, groups) the bot's. */
    private session(bot: Bot, chatId: string = bot.id): BotSession {
        const key = chatId.startsWith(`${bot.id}~`) ? chatId : bot.id;
        let s = this.sessions.get(key);
        if (s) {
            s.bot = bot;
            return s;
        }
        s = new BotSession(bot, this, key);
        this.sessions.set(key, s);
        return s;
    }

    /** All sessions of a bot (main chat and conversations). */
    private sessionsOf(botId: string): BotSession[] {
        return [...this.sessions.values()].filter((s) => s.bot.id === botId);
    }

    private endSession(key: string): void {
        this.sessions.get(key)?.close();
        this.sessions.delete(key);
    }

    /** Whether something is running that a restart would abort: jobs, queues, open approvals, background tasks. */
    busy(): boolean {
        if (this.approvals.size > 0) return true;
        for (const s of this.sessions.values()) if (working(s)) return true;
        return false;
    }

    // ------------------------------------------------------------------ Session transfer (session-transfer.ts)

    /**
     * On a bot's previous machine: send its Claude sessions to the scheduled target machine as soon as the bot rests
     * and the target is awake. The processes here are stopped first so the transcripts are complete and two machines
     * do not write into the same session.
     */
    private checkTransfer(botId: string): void {
        const pending = pendingTransfers()[botId];
        if (!pending) return;
        const target = pending.machine;
        const bot = findBot(botId);
        if (!bot || target === config.machine) { scheduleTransfer(botId, null); return; }
        if (!this.online.includes(target) || this.sessionsOf(botId).some(working)) return;
        scheduleTransfer(botId, null);
        let sessions = 0;
        let bytes = 0;
        for (const key of [bot.id, ...(bot.conversations ?? []).map((c) => `${bot.id}~${c.id}`)]) {
            const sessionId = readSessionId(key);
            if (!sessionId) continue;
            this.endSession(key);
            const parts = transferParts(bot.id, pending.folder || bot.folder, bot.folder, key, sessionId);
            for (const p of parts) {
                this.peer(p, target);
                bytes += p.data.length;
            }
            if (parts.length) sessions++;
        }
        console.log(`transfer: ${bot.id} to ${target}, ${sessions} session(s), ${(bytes * 0.75 / 1024 / 1024).toFixed(1)} MB`);
    }

    /**
     * On a bot's previous machine, after the user chose to take the work along: once the move has arrived here (the
     * synced bot names the target), the bot rests and the target is awake, pack what is not on the git server yet,
     * send it and set the uncommitted changes aside. Packing waits for the move so a save the new machine refused
     * sends nothing.
     */
    private checkWork(botId: string): void {
        const pending = pendingWork()[botId];
        if (!pending) return;
        const bot = findBot(botId);
        if (!bot) { scheduleWork(botId, null); return; }
        if (bot.machine !== pending.machine || !this.online.includes(pending.machine) || this.sessionsOf(botId).some(working)) return;
        scheduleWork(botId, null);
        const id = randomUUID();
        packWork(pending.folder).then(async (repos) => {
            if (!repos.length) return;
            const parts = workParts(botId, id, repos);
            for (const p of parts) this.peer(p, pending.machine);
            console.log(`work: ${botId} to ${pending.machine}, ${repos.map((r) => r.name).join(', ')}, ${(parts.reduce((n, p) => n + p.data.length, 0) * 0.75 / 1024).toFixed(0)} KB`);
            await stashWork(pending.folder, repos, pending.machine);
            this.gitStatusSoon(0);
        }, (e: Error) => {
            console.log(`work: ${botId}: ${e.message}`);
            this.entry(botId, { role: 'event', text: e.message, ts: new Date().toISOString() });
        });
    }

    /**
     * A bot changed machines (saved here or on another machine): if it ran here so far, its sessions follow it, read
     * from its old folder here and stored under its folder there.
     */
    private movedAway(old: Bot, bot: Bot): void {
        if (responsibleMachine(old, this.online) !== config.machine) return;
        scheduleTransfer(bot.id, bot.machine !== config.machine ? { machine: bot.machine, folder: old.folder } : null);
        this.checkTransfer(bot.id);
    }

    private states(): Record<string, BotState> {
        const r: Record<string, BotState> = {};
        for (const [id, s] of this.sessions) r[id] = s.state;
        return r;
    }

    private activeChats(): Record<string, string> {
        const r: Record<string, string> = {};
        for (const [id, s] of this.sessions) if (s.currentTurn) r[id] = s.currentTurn.chatId;
        return r;
    }

    private activity(): Record<string, string> {
        const r: Record<string, string> = {};
        for (const [id, s] of this.sessions) if (s.activity) r[id] = s.activity;
        return r;
    }

    private sendBots(cid?: string): void {
        this.send({
            type: 'bots', bots: loadBots(), groups: loadGroups(), states: this.states(), activity: this.activity(), activeChats: this.activeChats(),
            approvals: [...this.approvals.values()].map((f) => f.approval), context: readJson<Record<string, number>>('context.json', {}),
            background: Object.fromEntries([...this.sessions].filter(([, s]) => s.backgroundTasks.length).map(([k, s]) => [k, s.backgroundTasks])),
            queues: Object.fromEntries([...this.sessions].filter(([, s]) => s.waiting() > 0).map(([k, s]) => [k, s.waitingPerChat()])),
        }, cid);
    }

    /** Name a conversation right away with the shortened first line, later with keywords from Claude if nobody renamed it by then. */
    private nameConversation(chatId: string, text: string, prefix = ''): void {
        const provisional = titleFrom(prefix + text);
        renameConversation(chatId, provisional);
        this.sendBots();
        this.shareConfig();
        keywordTitle(text).then((keywords) => {
            const c = findConversation(chatId);
            if (!keywords || !c || c.title !== provisional.trim().slice(0, 60)) return;
            renameConversation(chatId, prefix + keywords);
            this.sendBots();
            this.shareConfig();
        }, (e: Error) => console.log(`title for ${chatId}: ${e.message}`));
    }

    private sendRoutines(cid?: string): void {
        this.send({ type: 'routines', routines: loadRoutines() }, cid);
    }

    private sendSettings(cid?: string): void {
        this.send({ type: 'settings', settings: settingsForBrowser() }, cid);
    }

    /** What this machine's settings allow the app (shut down, restart, autologon). */
    private sendCapabilities(cid?: string): void {
        const power = config.power;
        this.send({
            type: 'machine_capabilities', shutdown: canShutdown(), shutdownSeconds: power.shutdown.delaySeconds,
            cancelShutdown: canShutdown() && (power.shutdown.method !== 'command' || Boolean(power.shutdown.cancelCommand)),
            autologon: canAutologon(), restart: canRestart(),
        }, cid);
    }

    /** The machine settings, to the main account's browsers only: other accounts do not change this machine. */
    private sendMachineSettings(cid?: string): void {
        if (this.accountId !== DEFAULT_ACCOUNT) return;
        const available = config.power.shutdown.available;
        void voiceStatus().then((voice) => this.send({
            type: 'machine_settings', settings: machineSettings(), anthropicKey: Boolean(anthropicKey()), gitPushToken: Boolean(gitPushToken()),
            engineKeys: Object.fromEntries(KEY_ENGINES.map((e) => [e, Boolean(engineKey(e))])), shutdownMethod: available, voice,
            ...(machineSettings().claudeAuth === 'both' ? { keyFallback: keyFallbackState() } : {}),
            offers: {
                shutdown: available !== 'none', ide: availableTemplate('ide') !== null, terminal: availableTemplate('terminal') !== null,
                voice: voice.state !== 'unavailable',
            },
        }, cid));
    }

    // ------------------------------------------------------------------ Other machines

    /** Configuration (without history) to all other machines, after every local change. */
    private shareConfig(): void {
        this.reportWakeSchedule();
        if (this.online.length > 1) this.peer({ kind: 'snapshot', snapshot: snapshot(false) });
    }

    /** List of machines awake from the relay. Newly arrived ones get the full state including history. */
    updateAgents(online: string[], fromRelay = true): void {
        const before = new Set(this.online);
        this.online = online.includes(config.machine) ? online : [...online, config.machine];
        for (const r of this.online) {
            if (r !== config.machine && !before.has(r)) this.peer({ kind: 'snapshot', snapshot: snapshot(true) }, r);
        }
        // Joined by invitation: the shared web push keys come from the machines already there, encrypted only
        if (this.accountId === DEFAULT_ACCOUNT && e2eEnabled && joinPending() && this.online.some((r) => r !== config.machine && !before.has(r))) {
            this.peer({ kind: 'keys_request' });
        }
        // Jobs to machines that left are lost
        if (online.length < before.size) this.sendBots();
        for (const botId of Object.keys(pendingTransfers())) this.checkTransfer(botId);
        for (const botId of Object.keys(pendingWork())) this.checkWork(botId);
        // Bots may have changed machines
        this.gitStatusSoon(1000);
        // Only the relay's list says who else is awake; without it every machine would claim every bot
        if (fromRelay) this.claimUnplacedBots();
    }

    /**
     * Bots without a machine (saved before 0.2) become bots of the machine that runs them now. Only that machine
     * claims them, the sync carries the change to the others.
     */
    private claimUnplacedBots(): void {
        const bots = loadBots();
        const claimed = bots.filter((b) => !b.machine && responsibleMachine(b, this.online) === config.machine);
        if (!claimed.length) return;
        const now = new Date().toISOString();
        for (const b of claimed) Object.assign(b, { machine: config.machine, machineOnly: true, updatedAt: now });
        saveBots(bots);
        console.log(`bots: ${claimed.map((b) => b.id).join(', ')} now live on ${config.machine}`);
        this.checkPushSoon();
        this.sendBots();
        this.shareConfig();
    }

    /** Security warning of the relay (new device, rejected duplicate sign-in): always as push. */
    warning(code: WarningCode, params: Record<string, string>): void {
        const body = code === 'new_device'
            ? t('warning.newDevice', { name: params.name ?? '?', ip: params.ip ?? '?' })
            : code === 'duplicate_agent'
                ? t('warning.duplicateAgent', { machine: (params.machine ?? '?').toUpperCase(), ip: params.ip ?? '?' })
                : `${code} ${JSON.stringify(params)}`;
        console.log(`warning: ${code} ${JSON.stringify(params)}`);
        void sendPush({ title: t('warning.title'), body, url: '/', tag: `warning-${Date.now()}` })
            .catch((e) => console.log(`push: ${(e as Error).message}`));
    }

    /**
     * The relay reports: this machine was just woken, via the app or (with `routines`) for due routines. Then without
     * push: the routines run at their due time via the scheduler or are caught up if the machine only came up later;
     * once all are done, it shuts down again.
     */
    pushGone(gone: NativePushSubscription[]): void {
        const n = removeSubscriptions(gone);
        if (n) console.log(`push: ${n} app device token(s) dropped (reported by the relay)`);
    }

    /**
     * Pairing link for one more device: one-time token from the relay plus, with E2E_KEY, the end-to-end key. The
     * link only goes to the asking browser and only encrypted when there is a key, which is why the backend builds
     * it and not the relay.
     */
    private async pairLink(cid: string, invite?: { token: string; expiresAt?: string }): Promise<void> {
        const key = e2eKeyForLink();
        const { url, expiresAt, e2e } = invite
            ? { url: pairingUrl(appUrl(), invite.token, key), expiresAt: invite.expiresAt ?? '', e2e: !!key }
            : await newPairingLink(this.accountId);
        this.send({ type: 'pair_link', url, expiresAt, svg: await pairingSvg(url), e2e }, cid);
    }

    woken(routines?: { id: string; at: string }[]): void {
        if (routines?.length) {
            console.log(`${config.machine} was woken for ${routines.length} routine(s), shuts down again afterwards`);
            for (const r of routines) {
                this.wakeRoutines.add(r.id);
                const wait = Math.max(Date.parse(r.at) + 90_000 - Date.now(), 5_000);
                setTimeout(() => this.catchUpWakeRoutine(r.id, r.at), wait);
            }
            return;
        }
        console.log(`${config.machine} was woken via the app, sending push`);
        void sendPush({ title: t('push.awakeTitle', { machine: config.machine.toUpperCase() }), body: t('push.awakeBody'), url: '/', tag: `awake-${config.machine}` }, 'awake')
            .catch((e) => console.log(`push: ${(e as Error).message}`));
    }

    peerInbound(from: string, d: PeerData): void {
        try {
            switch (d.kind) {
                case 'snapshot': {
                    const result = merge(d.snapshot);
                    for (const old of result.botsMoved) {
                        const bot = findBot(old.id);
                        if (bot) this.movedAway(old, bot);
                    }
                    // Bots that now live here start with the remote's state of their repos
                    const arrived = result.botsMoved.map((o) => findBot(o.id)).filter((b) => b?.machine === config.machine).map((b) => b!.id);
                    if (arrived.length) this.pullSoon('bot moved here', 5000, arrived);
                    // a move waiting for its work to be sent may have arrived with this
                    for (const botId of Object.keys(pendingWork())) this.checkWork(botId);
                    for (const id of result.botsDeleted) for (const s of this.sessionsOf(id)) this.endSession(s.key);
                    for (const chatId of result.chatsDeleted) this.endSession(chatId);
                    this.reloadSessions(result.knowledge);
                    for (const id of result.botsChanged) {
                        const bot = findBot(id);
                        if (!bot) continue;
                        for (const s of this.sessionsOf(id)) {
                            s.bot = bot;
                            s.reload();
                        }
                    }
                    if (result.config) {
                        this.checkPushSoon();
                        this.sendBots();
                        this.sendRoutines();
                        this.reportWakeSchedule();
                    }
                    if (result.pushSettings) this.send({ type: 'push_settings', settings: pushSettings() });
                    if (result.settings) this.settingsChanged();
                    if (result.pinned) this.send({ type: 'pinned', all: pinnedForBrowser() });
                    if (result.seen) this.send({ type: 'seen', state: loadSeen() });
                    if (result.config || result.history.length) console.log(`sync: from ${from}${result.config ? ', configuration' : ''}${result.history.length ? `, history of ${result.history.length} chats` : ''}`);
                    break;
                }
                case 'seen': {
                    const changed = applySeen(d.state);
                    if (Object.keys(changed).length) this.send({ type: 'seen', state: changed });
                    break;
                }
                case 'history':
                    merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { [d.chatId]: d.entries } });
                    break;
                case 'job': {
                    const bot = findBot(d.botId);
                    if (!bot) {
                        this.peer({ kind: 'job_done', id: d.id, result: { text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, error: t('errors.botUnknownOn', { bot: d.botId, machine: config.machine }) } }, from);
                        break;
                    }
                    this.runHere(bot, d.turn, d.reply ? (e) => this.peer({ kind: 'job_done', id: d.id, result: e }, from) : undefined);
                    break;
                }
                case 'job_done': {
                    const f = this.remoteJobs.get(d.id);
                    if (!f) break;
                    clearTimeout(f.timer);
                    this.remoteJobs.delete(d.id);
                    f.onDone(d.result);
                    break;
                }
                case 'restart':
                    this.restartLocally(d.botId);
                    break;
                case 'git_pushed':
                    this.pullSoon(`push on ${from}`, 2000);
                    break;
                case 'keys_request':
                    // Never in the clear: without end-to-end encryption the relay would see the private key
                    if (this.accountId === DEFAULT_ACCOUNT && e2eEnabled) this.peer({ kind: 'keys', vapid: vapidKeys() }, from);
                    break;
                case 'keys':
                    if (this.accountId !== DEFAULT_ACCOUNT || !e2eEnabled || !joinPending()) break;
                    console.log(adoptVapid(d.vapid) ? `join: web push keys taken over from ${from}` : 'join: web push keys set in the .env, kept');
                    joinDone();
                    break;
                case 'work_transfer': {
                    const bot = findBot(d.botId);
                    if (!bot || bot.machine !== config.machine) throw new Error(`work for ${d.botId}, which does not live here`);
                    const repos = this.workReceiver.chunk(d);
                    if (!repos) break;
                    // git in the same repo at the same time would fail on its lock: after a running pull, and none meanwhile
                    this.applyingWork.add(bot.folder);
                    (this.pullRun ?? Promise.resolve()).then(() => applyWork(bot.folder, repos)).finally(() => this.applyingWork.delete(bot.folder)).then((lines) => {
                        console.log(`work: ${bot.id} from ${from}: ${lines.join(' | ')}`);
                        this.entry(bot.id, { role: 'event', text: [t('work.arrived', { machine: from.toUpperCase() }), ...lines.map((l) => `- ${l}`)].join('\n'), ts: new Date().toISOString() });
                        this.gitStatusSoon(0);
                    }, (e: Error) => console.log(`work: ${bot.id} from ${from}: ${e.message}`));
                    break;
                }
                case 'session_transfer': {
                    if (!/^[a-z0-9-]+(~[a-z0-9]+)?$/.test(d.key) || botIdOf(d.key) !== d.botId || !underAllowedRoot(path.resolve(d.folder))) {
                        throw new Error(`invalid transfer ${d.key} (${d.folder})`);
                    }
                    if (!this.transferReceiver.chunk(d)) break;
                    this.endSession(d.key);
                    setSessionId(d.key, d.sessionId);
                    console.log(`transfer: ${d.key} taken over from ${from} (session ${d.sessionId})`);
                    this.entry(d.key, { role: 'event', text: t('events.transferred', { machine: from.toUpperCase() }), ts: new Date().toISOString() });
                    break;
                }
                case 'interrupt':
                    this.interruptLocally(d.chatId);
                    break;
            }
        } catch (e) {
            console.log(`sync: error with ${d.kind} from ${from}: ${(e as Error).message}`);
        }
    }

    /**
     * Starts a job for a bot on the responsible machine: here or via the relay.
     * `onDone` comes back with the result in both cases.
     */
    private startTurn(bot: Bot, spec: Omit<TurnSpec, 'chain' | 'hop'> & Partial<Pick<TurnSpec, 'chain' | 'hop'>>, onDone?: (e: TurnResult) => void): void {
        const target = responsibleMachine(bot, this.online);
        const turn: TurnSpec = { chain: [], hop: 0, ...spec };
        if (target === config.machine) {
            this.runHere(bot, turn, onDone);
            return;
        }
        if (!target) {
            const error = t('errors.machineAsleep', { bot: bot.name, machine: bot.machine.toUpperCase() });
            this.send({ type: 'error', chatId: turn.chatId, botId: bot.id, message: error });
            onDone?.({ text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, error });
            return;
        }
        const id = randomUUID();
        if (onDone) {
            const timer = setTimeout(() => {
                this.remoteJobs.delete(id);
                onDone({ text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, error: t('errors.noAnswerFrom', { machine: target.toUpperCase() }) });
            }, (BOT_ANSWER_TIMEOUT_MIN + 5) * 60_000);
            this.remoteJobs.set(id, { onDone, timer });
        }
        this.peer({ kind: 'job', id, botId: bot.id, turn, reply: !!onDone }, target);
    }

    /**
     * Runs a job on this machine. The bot's folder is checked against this machine's ALLOWED_ROOTS every time: bots
     * arrive by sync from machines that may allow more, and a folder can have become a link since.
     */
    private runHere(bot: Bot, turn: TurnSpec, onDone?: (e: TurnResult) => void): void {
        if (!underAllowedRoot(bot.folder)) {
            const error = t('bots.folderNotAllowed', { roots: config.allowedRoots.join(', '), folder: bot.folder });
            this.send({ type: 'error', chatId: turn.chatId, botId: bot.id, message: error });
            onDone?.({ text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, error });
            return;
        }
        // Saved on another machine, or moved here without a folder of its own here
        if (!fs.existsSync(bot.folder)) {
            const error = t('errors.folderMissingHere', { bot: bot.name, machine: config.machine.toUpperCase(), folder: bot.folder });
            this.send({ type: 'error', chatId: turn.chatId, botId: bot.id, message: error });
            onDone?.({ text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, error });
            return;
        }
        this.session(bot, turn.chatId).send(newTurn({ ...turn, onDone }));
    }

    // ------------------------------------------------------------------ Browser

    /** Called when a browser connects. */
    greet(cid: string): void {
        this.clients.set(cid, { visible: true });
        this.sendBots(cid);
        this.sendRoutines(cid);
        this.sendSettings(cid);
        this.send({ type: 'push_settings', settings: pushSettings() }, cid);
        this.send({ type: 'pinned', all: pinnedForBrowser() }, cid);
        this.send({ type: 'seen', state: loadSeen(), all: true }, cid);
        if (this.claudeAccount) this.send({ type: 'account', ...this.claudeAccount }, cid);
        for (const k of this.otherAccounts.values()) this.send({ type: 'account', ...k }, cid);
        this.sendCapabilities(cid);
        this.sendMachineSettings(cid);
        this.sendAutologon(cid);
        const models = readJson<ModelInfo[]>('models.json', []);
        if (models.length) this.send({ type: 'models', models }, cid);
        if (this.usageClaude) this.send({ type: 'usage', usage: this.usageClaude }, cid);
        if (this.usageCodex) this.send({ type: 'usage', usage: this.usageCodex, engine: 'codex' }, cid);
        this.send({ type: 'git_status', status: this.gitStatus }, cid);
        this.gitStatusSoon(1000);
        this.sendBackendStatus(cid);
        this.sendSetupStatus(cid);
        try {
            this.send({ type: 'push_key', publicKey: publicKey(), channels: pushChannels() }, cid);
        } catch (e) {
            console.log(`push: no key (${(e as Error).message})`);
        }
    }

    /** Settings changed (here or on another machine): to all browsers; a new language reaches the sessions' system prompt. */
    private settingsChanged(): void {
        this.sendSettings();
        const language = loadSettings().language;
        if (language === this.sessionLanguage) return;
        this.sessionLanguage = language;
        for (const s of this.sessions.values()) s.reload();
    }

    /** State of the automatic sign-in to a browser; PowerShell query at most once per minute. */
    private sendAutologon(cid: string): void {
        if (!canAutologon()) return;
        const cached = this.autologonCache;
        const state = cached && Date.now() - cached.time < 60_000
            ? Promise.resolve(cached.state)
            : autologon().then((s) => { this.autologonCache = { state: s, time: Date.now() }; return s; });
        state.then(
            (s) => this.send({ type: 'machine_autologon_status', ok: true, ...s }, cid),
            (e) => console.log(`autologon: ${(e as Error).message}`),
        );
    }

    leave(cid: string): void {
        this.clients.delete(cid);
        this.watcher.close(cid);
    }

    /** Determine the open repos of this machine's bots and send them to all browsers on a change; without browsers only at the next connect. */
    private checkGitStatus(): void {
        if (this.gitRun) {
            this.gitAgain = true;
            return;
        }
        if (!this.clients.size) return;
        const bots = loadBots().filter((b) => responsibleMachine(b, this.online) === config.machine);
        this.gitRun = openRepos(bots).then((status) => {
            const json = JSON.stringify(status);
            if (json === this.gitStatusJson) return;
            this.gitStatus = status;
            this.gitStatusJson = json;
            this.send({ type: 'git_status', status });
        }, (e: Error) => console.log(`git: ${e.message}`)).finally(() => {
            this.gitRun = null;
            if (!this.gitAgain) return;
            this.gitAgain = false;
            this.checkGitStatus();
        });
    }

    private pullRun: Promise<void> | null = null;
    private pullAgain = false;
    private pullTimer: NodeJS.Timeout | null = null;
    private lastPull = 0;
    private lastTick = Date.now();

    /** Bots of the planned run; null = all. Planning again widens it, it never narrows a run already planned. */
    private pullPlanned: { reason: string; only: string[] | null } | null = null;

    private pullSoon(reason: string, ms: number, only?: string[]): void {
        const before = this.pullPlanned;
        this.pullPlanned = {
            reason: before ? `${before.reason}, ${reason}` : reason,
            only: (before && !before.only) || !only ? null : [...new Set([...(before?.only ?? []), ...only])],
        };
        if (this.pullTimer) clearTimeout(this.pullTimer);
        this.pullTimer = setTimeout(() => {
            const p = this.pullPlanned!;
            this.pullTimer = null;
            this.pullPlanned = null;
            this.pullBotRepos(p.reason, p.only ?? undefined);
        }, ms);
        this.pullTimer.unref();
    }

    /**
     * Bring the repos of this machine's bots (or of `only`) up to date with their remotes, see fastForward(). Repos a
     * working bot sits in stay as they are: files changing under a running job would confuse it. One run at a time; a
     * request meanwhile repeats the run for all bots afterwards.
     */
    private pullBotRepos(reason: string, only?: string[]): void {
        if (!gitAutoPull()) return;
        if (this.pullRun) {
            this.pullAgain = true;
            return;
        }
        const bots = loadBots().filter((b) => responsibleMachine(b, this.online) === config.machine && (!only || only.includes(b.id)));
        if (!bots.length) return;
        const busy = [...this.sessions.values()].filter(working).map((s) => s.bot.folder).concat([...this.applyingWork]);
        if (!only) this.lastPull = Date.now();
        this.pullRun = pullRepos(bots, (root) => busy.some((f) => overlaps(f, root))).then((results) => {
            for (const r of results) {
                const o = r.outcome;
                if (('pulled' in o && !o.pulled) || ('skipped' in o && o.skipped === 'no_upstream')) continue;
                console.log(`git (${reason}): ${pullText(r.name, o)}`);
            }
            // fetching changes the "behind" counts even where nothing was pulled
            if (results.length) this.gitStatusSoon(0);
        }, (e: Error) => console.log(`git (${reason}): ${e.message}`)).finally(() => {
            this.pullRun = null;
            if (!this.pullAgain) return;
            this.pullAgain = false;
            this.pullBotRepos(reason);
        });
    }

    /** Several triggers shortly after each other (answers, commits) result in one query. */
    private gitStatusSoon(ms = 5000): void {
        if (this.gitTimer) clearTimeout(this.gitTimer);
        this.gitTimer = setTimeout(() => {
            this.gitTimer = null;
            this.checkGitStatus();
        }, ms);
        this.gitTimer.unref();
    }

    private someoneWatching(): boolean {
        for (const c of this.clients.values()) if (c.visible) return true;
        return false;
    }

    /** A bot of this account works, an approval is open or an app watches. */
    inUse(): boolean {
        return this.busy() || this.someoneWatching();
    }

    /** Push for an answer: not while someone is watching, and not for muted chats. */
    private push(n: PushMessage, kind: PushKind, chatId: string): void {
        if (this.someoneWatching() || isMuted(chatId)) return;
        void sendPush(n, kind).catch((e) => console.log(`push: ${(e as Error).message}`));
    }

    handle(frame: ClientFrame, cid: string): void {
        // Unknown types reach the default branch below; malformed known ones stop here
        const checked = checkClientFrame(frame);
        if (!checked.ok && !checked.unknown) {
            console.log(`frame rejected: ${checked.problem}`);
            this.send({ type: 'error', request: checked.type, message: t('errors.invalidFrame', { machine: config.machine, request: checked.type, problem: checked.problem }) }, cid);
            return;
        }
        // The machine itself and its logins belong to its owner: another account may not shut it down, sign its
        // engines in elsewhere or look at the VS Code sessions under its home folder
        if (this.accountId !== DEFAULT_ACCOUNT && MAIN_ONLY.has(frame.type)) {
            this.send({ type: 'error', request: frame.type, message: t('errors.mainOnly', { machine: config.machine.toUpperCase() }) }, cid);
            return;
        }
        try {
            switch (frame.type) {
                case 'ping':
                    this.send({ type: 'pong' }, cid);
                    break;
                case 'presence': {
                    const c = this.clients.get(cid);
                    if (c) c.visible = frame.visible;
                    else this.clients.set(cid, { visible: frame.visible });
                    break;
                }
                case 'machine_shutdown': {
                    const cancel = Boolean(frame.cancel);
                    const restart = !cancel && Boolean(frame.restart);
                    const what = restart ? 'restart' : 'shutdown';
                    shutdown(cancel, frame.inSeconds, false, undefined, restart).then(
                        ({ at }) => {
                            console.log(cancel ? 'shutdown: cancelled' : `${what}: planned for ${at}`);
                            // to all browsers, so every device sees the countdown
                            this.send({ type: 'machine_shutdown_result', cancel, ok: true, at, restart });
                        },
                        (e) => {
                            const message = e instanceof Error ? e.message : String(e);
                            console.log(`${what}: error: ${message}`);
                            this.send({ type: 'machine_shutdown_result', cancel, ok: false, message, restart }, cid);
                        },
                    );
                    break;
                }
                case 'machine_autologon': {
                    const on = frame.on;
                    autologon(on).then(
                        (s) => {
                            if (on !== undefined) console.log(`autologon: ${s.on ? 'on' : 'off'}`);
                            this.autologonCache = { state: s, time: Date.now() };
                            this.send({ type: 'machine_autologon_status', ok: true, ...s });
                        },
                        (e) => {
                            const message = e instanceof Error ? e.message : String(e);
                            console.log(`autologon: error: ${message}`);
                            this.send({ type: 'machine_autologon_status', ok: false, message }, cid);
                        },
                    );
                    break;
                }
                case 'bots':
                    this.sendBots(cid);
                    break;
                case 'bot_save': {
                    const old = frame.bot.id ? findBot(frame.bot.id) : undefined;
                    const bot = saveBot(frame.bot);
                    // Machine changed and the bot ran here so far: take the sessions along (before the configuration sync)
                    if (old && old.machine !== bot.machine) this.movedAway(old, bot);
                    if (old && old.machine !== bot.machine && bot.machine === config.machine) this.pullSoon('bot moved here', 5000, [bot.id]);
                    this.checkPushSoon();
                    if (old) {
                        for (const s of this.sessionsOf(bot.id)) {
                            s.bot = bot;
                            // Persona, folder or model changed: restart the process (context stays, except for another folder)
                            if (old.folder !== bot.folder || old.model !== bot.model || old.tone !== bot.tone || old.name !== bot.name || old.area !== bot.area || old.role !== bot.role) s.reload();
                        }
                    }
                    this.sendBots();
                    this.shareConfig();
                    break;
                }
                case 'folder_check': {
                    const asked = frame.folder;
                    inspectFolder(asked).then(
                        (r) => this.send({ type: 'folder_checked', asked, ok: true, ...r }, cid),
                        (e: Error) => this.send({ type: 'folder_checked', asked, ok: false, message: e.message }, cid),
                    );
                    break;
                }
                case 'folder_clone': {
                    const { url } = frame;
                    // An address may carry a token (https://user:token@host/…); the log gets it without
                    const shown = url.replace(/\/\/[^@/]*@/, '//…@');
                    cloneRepository(url, frame.folder).then(inspectFolder).then(
                        ({ folder, push }) => {
                            console.log(`clone: ${shown} into ${folder}`);
                            this.send({ type: 'folder_cloned', url, ok: true, folder, ...(push === false ? { push } : {}) }, cid);
                        },
                        (e: Error) => { console.log(`clone: ${shown} failed: ${e.message}`); this.send({ type: 'folder_cloned', url, ok: false, message: e.message }, cid); },
                    );
                    break;
                }
                case 'folder_propose': {
                    const { url } = frame;
                    proposeFolder(url).then(
                        (r) => this.send({ type: 'folder_proposed', url, ok: true, ...r }, cid),
                        (e: Error) => this.send({ type: 'folder_proposed', url, ok: false, message: e.message }, cid),
                    );
                    break;
                }
                case 'bot_suggest': {
                    const { what } = frame.request;
                    const begin = Date.now();
                    const duration = () => `${((Date.now() - begin) / 1000).toFixed(1)} s`;
                    suggest(frame.request).then(
                        (result) => {
                            console.log(`suggestion ${what}: done after ${duration()} (${Math.round(JSON.stringify(result).length / 1024)} KB)`);
                            this.send({ type: 'bot_suggestion', what, result }, cid);
                        },
                        (e) => {
                            const message = e instanceof Error ? e.message : String(e);
                            console.log(`suggestion ${what}: error after ${duration()}: ${message}`);
                            this.send({ type: 'bot_suggestion', what, error: message }, cid);
                        },
                    );
                    break;
                }
                case 'bot_delete': {
                    for (const s of this.sessionsOf(frame.botId)) this.endSession(s.key);
                    for (const c of findBot(frame.botId)?.conversations ?? []) deleteHistory(`${frame.botId}~${c.id}`);
                    deleteBot(frame.botId);
                    deleteHistory(frame.botId);
                    deleteBotRoutines(frame.botId);
                    this.sendBots();
                    this.sendRoutines();
                    this.shareConfig();
                    break;
                }
                case 'group_save':
                    saveGroup(frame.group);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'mute':
                    setMuted(frame.chatId, frame.on);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'push_settings':
                    this.send({ type: 'push_settings', settings: savePushSettings(frame.kinds ?? {}) });
                    this.shareConfig();
                    break;
                case 'language':
                    saveLanguage(frame.language);
                    console.log(`settings: language ${frame.language}`);
                    this.settingsChanged();
                    this.shareConfig();
                    break;
                case 'settings_save': {
                    const fields = Object.keys(frame.settings);
                    if (fields.length) saveSettings(frame.settings);
                    const keys = frame.apiKeys ? saveApiKeys(frame.apiKeys) : false;
                    if (!fields.length && !keys) break;
                    console.log(`settings: ${[...fields, ...(keys ? ['API keys'] : [])].join(', ')}`);
                    this.settingsChanged();
                    this.shareConfig();
                    if (fields.includes('gitAutoPull') && gitAutoPull()) this.pullBotRepos('settings');
                    break;
                }
                case 'machine_settings_save': {
                    if (frame.anthropicKey !== undefined) saveAnthropicKey(frame.anthropicKey);
                    if (frame.gitPushToken !== undefined) saveGitPushToken(frame.gitPushToken);
                    const engineKeys = KEY_ENGINES.filter((e) => frame.engineKeys?.[e] !== undefined);
                    for (const e of engineKeys) saveEngineKey(e, frame.engineKeys?.[e] ?? '');
                    const before = machineSettings();
                    const wanted = { ...before, ...frame.settings };
                    const keyless = [
                        ...(wanted.claudeAuth !== 'subscription' && !anthropicKey() ? ['claude' as const] : []),
                        ...KEY_ENGINES.filter((e) => wanted.engineAuth[e] === 'apikey' && !engineKey(e)),
                    ][0];
                    if (keyless) {
                        this.send({ type: 'error', request: frame.type, message: t('settings.engineKeyMissing', { engine: ENGINE_NAMES[keyless] }) }, cid);
                        this.sendMachineSettings(cid);
                        break;
                    }
                    const after = saveMachineSettings(frame.settings);
                    if (after.claudeAuth !== 'both') resetKeyFallback();
                    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
                    const secrets = [
                        ...(frame.anthropicKey !== undefined ? ['Anthropic key'] : []), ...(frame.gitPushToken !== undefined ? ['git token'] : []),
                        ...engineKeys.map((e) => `${ENGINE_NAMES[e]} key`),
                    ];
                    console.log(`machine settings: ${[...changed, ...secrets].join(', ') || 'unchanged'}`);
                    // The speech model loads with these values: the next voice message starts it anew
                    if (changed.includes('voiceModel') || changed.includes('voiceDevice')) transcriber.stop();
                    // Sessions pick up a new sign-in on their next turn; which engines are ready shows after a new query
                    const signIn = changed.includes('claudeAuth') || changed.includes('claudeKeyBudgetUsd') || changed.includes('engineAuth') || frame.anthropicKey !== undefined || engineKeys.length > 0;
                    if (signIn) for (const s of this.sessions.values()) s.reload();
                    if (signIn || changed.includes('disabledEngines')) this.refreshModels();
                    // New sessions inherit the git token; whether pushing works now shows in "Open changes"
                    if (changed.includes('gitPushUser') || changed.includes('gitPushHost') || frame.gitPushToken !== undefined) {
                        applyGitPush();
                        this.checkPushSoon(0);
                    }
                    this.sendMachineSettings();
                    this.sendCapabilities();
                    this.sendBackendStatus();
                    break;
                }
                case 'favorite':
                    setFavorite(frame.chatId, frame.on);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'group_delete':
                    deleteGroup(frame.groupId);
                    deleteHistory(`g:${frame.groupId}`);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'history':
                    this.send({ type: 'history', chatId: frame.chatId, entries: withoutToolOutput(readVisible(frame.chatId, frame.limit)), live: this.live(frame.chatId) }, cid);
                    break;
                case 'tool_output':
                    this.send({ ...frame, result: toolOutput(frame.chatId, frame.entryId, frame.toolId) }, cid);
                    break;
                case 'send': {
                    const uploads = frame.attachments ?? [];
                    if (uploads.some((u) => u.type.startsWith('audio/'))) {
                        // Voice message: first turn it into text locally, then continue like a text message
                        void this.voiceMessage(frame.chatId, frame.text, uploads, frame.replyTo).catch((e: Error) => {
                            this.send({ type: 'error', chatId: frame.chatId, message: e.message });
                        });
                    } else {
                        this.messageFromUser(frame.chatId, frame.text, uploads, undefined, frame.replyTo);
                    }
                    break;
                }
                case 'voice_warmup':
                    transcriber.warmUp();
                    break;
                case 'voice_setup':
                    // Every step to all browsers; once ready, the model loads as after a start
                    void setupVoice((s) => {
                        this.sendMachineSettings();
                        if (s.state === 'ready') transcriber.preload();
                    });
                    break;
                case 'interrupt':
                    this.interruptLocally(frame.chatId);
                    this.peer({ kind: 'interrupt', chatId: frame.chatId });
                    break;
                case 'restart': {
                    const bot = findBot(frame.botId);
                    if (!bot) break;
                    // Key of the session: the conversation, otherwise the main chat (peer 'restart' carries it in botId)
                    const key = frame.chatId?.startsWith(`${bot.id}~`) ? frame.chatId : bot.id;
                    this.restartLocally(key);
                    this.peer({ kind: 'restart', botId: key });
                    this.entry(key, { role: 'event', text: t('events.newSession'), ts: new Date().toISOString() });
                    this.sendBots();
                    break;
                }
                case 'conversation_new': {
                    const chatId = createConversation(frame.botId);
                    this.sendBots();
                    this.shareConfig();
                    this.send({ type: 'conversation_created', chatId }, cid);
                    break;
                }
                case 'search':
                    this.send({
                        type: 'search_result', text: frame.text, chatId: frame.chatId,
                        hits: frame.chatId ? searchHistory(frame.text, 500, frame.chatId) : searchHistory(frame.text),
                    }, cid);
                    break;
                case 'queue_to_conversation': {
                    if (isGroup(frame.chatId)) throw new Error(t('errors.groupNoMove'));
                    const bot = findBot(botIdOf(frame.chatId));
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    const turn = this.sessions.get(isConversation(frame.chatId) ? frame.chatId : bot.id)?.fromQueue(frame.entryId);
                    if (!turn) throw new Error(t('errors.notQueued'));
                    // New conversation with the text as title; the job starts there right away, in parallel to the running one
                    const to = createConversation(bot.id);
                    this.nameConversation(to, turn.text);
                    const old = markMoved(frame.chatId, frame.entryId, to);
                    this.send({ type: 'moved', chatId: frame.chatId, entryId: frame.entryId, to });
                    const { id: entryId } = this.record(to, {
                        role: 'user', text: turn.text, ts: new Date().toISOString(), from: 'me', voice: old?.voice, attachments: old?.attachments,
                    }, true);
                    this.session(bot, to).send(newTurn({ chatId: to, from: 'me', text: turn.text, content: turn.content, entryId }));
                    break;
                }
                case 'queue_delete': {
                    // In groups the same job may wait with several members; take it out everywhere
                    let found = false;
                    for (const s of this.sessions.values()) if (s.fromQueue(frame.entryId)) found = true;
                    // Group jobs go to all machines; whoever does not have the message stays silent
                    if (!found && isGroup(frame.chatId)) break;
                    // No longer queued and never started (discarded, backend restarted): delete anyway
                    if (!found && readEntry(frame.chatId, frame.entryId)?.readAt) {
                        throw new Error(t('errors.notQueued'));
                    }
                    markDeleted(frame.chatId, frame.entryId, new Date().toISOString());
                    this.send({ type: 'deleted', chatId: frame.chatId, entryId: frame.entryId });
                    break;
                }
                case 'seen': {
                    // Only changes go on: to all browsers (also the reporting device, does no harm) and the other machines
                    const changed = applySeen(frame.state);
                    if (Object.keys(changed).length) {
                        this.send({ type: 'seen', state: changed });
                        if (this.online.length > 1) this.peer({ kind: 'seen', state: changed });
                    }
                    break;
                }
                case 'pin': {
                    const entries = pin(frame.chatId, frame.entry, frame.on);
                    this.send({ type: 'pinned', chatId: frame.chatId, entries });
                    this.shareConfig();
                    break;
                }
                case 'conversation_rename':
                    renameConversation(frame.chatId, frame.title);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'model': {
                    if (isGroup(frame.chatId)) throw new Error(t('errors.groupOwnModel'));
                    const old = loadBots().find((b) => b.id === botIdOf(frame.chatId));
                    const before = old ? engineOf(old.conversations?.find((c) => `${old.id}~${c.id}` === frame.chatId)?.model ?? old.model) : undefined;
                    const bot = setModel(frame.chatId, String(frame.model ?? ''));
                    // Conversations without their own model follow the bot; the others keep theirs
                    for (const s of this.sessionsOf(bot.id)) {
                        s.bot = bot;
                        void s.switchModel().catch((e: Error) => console.log(`model ${s.key}: ${e.message}`));
                    }
                    const engine = engineOf(String(frame.model ?? ''));
                    const change = before && before !== engine ? t('events.engineChange', { engine: ENGINE_NAMES[engine] }) : '';
                    this.entry(frame.chatId, { role: 'event', text: t('events.model', { model: modelDisplayName(frame.model, readJson<ModelInfo[]>('models.json', [])), change }), ts: new Date().toISOString() });
                    this.sendBots();
                    this.shareConfig();
                    break;
                }
                case 'conversation_delete':
                    this.interruptLocally(frame.chatId);
                    this.endSession(frame.chatId);
                    removeConversation(frame.chatId);
                    deleteHistory(frame.chatId);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'conversation_archive':
                    // archived nothing keeps running; restored, the session starts again with the next job
                    if (frame.on) {
                        this.interruptLocally(frame.chatId);
                        this.endSession(frame.chatId);
                    }
                    archiveConversation(frame.chatId, frame.on);
                    this.sendBots();
                    this.shareConfig();
                    break;
                case 'vscode_sessions': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    listVscodeSessions(bot.folder, botSessionIds(), loadBots().map((b) => b.folder)).then(
                        (sessions) => this.send({ type: 'vscode_sessions', botId: bot.id, sessions }, cid),
                        (e) => this.send({ type: 'error', request: 'vscode_sessions', message: t('errors.vscodeSessions', { error: (e as Error).message }) }, cid),
                    );
                    break;
                }
                case 'backend_restart':
                    requestRestart(t('restart.fromApp'));
                    console.log('restart: requested from the app');
                    this.sendBackendStatus();
                    break;
                case 'git_changes': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    listChanges(bot.folder).then(
                        (repos) => this.send({ type: 'git_changes', botId: bot.id, repos }, cid),
                        (e) => this.send({ type: 'error', request: 'git_changes', message: t('errors.openChanges', { error: (e as Error).message }) }, cid),
                    );
                    // the mark in the list should match what the browser is about to see
                    this.gitStatusSoon(0);
                    break;
                }
                case 'git_commit': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    const repoPath = frame.path;
                    commitAndPush(bot.folder, repoPath, String(frame.message ?? ''))
                        .then((message) => ({ ok: true, message }), (e: Error) => ({ ok: false, message: e.message }))
                        .then(async (result) => {
                            console.log(`git: ${result.message}`);
                            if (result.ok && this.online.length > 1) this.peer({ kind: 'git_pushed' });
                            this.send({ type: 'git_commit', botId: bot.id, path: repoPath, ...result }, cid);
                            this.send({ type: 'git_changes', botId: bot.id, repos: await listChanges(bot.folder) }, cid);
                            this.gitStatusSoon(0);
                        })
                        .catch((e: Error) => this.send({ type: 'error', request: 'git_changes', message: t('errors.openChanges', { error: e.message }) }, cid));
                    break;
                }
                case 'work_take': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    if (!underAllowedRoot(path.resolve(frame.folder))) throw new Error(t('bots.folderNotAllowed', { roots: config.allowedRoots.join(', '), folder: frame.folder }));
                    if (frame.machine === config.machine) break;
                    scheduleWork(bot.id, { machine: frame.machine, folder: frame.folder, since: Date.now() });
                    this.checkWork(bot.id);
                    break;
                }
                case 'git_pull': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    const repoPath = frame.path;
                    pullRepo(bot.folder, repoPath)
                        .catch((e: Error) => ({ ok: false, message: e.message }))
                        .then(async (result) => {
                            console.log(`git: ${result.message}`);
                            this.send({ type: 'git_pull', botId: bot.id, path: repoPath, ...result }, cid);
                            this.send({ type: 'git_changes', botId: bot.id, repos: await listChanges(bot.folder) }, cid);
                            this.gitStatusSoon(0);
                        })
                        .catch((e: Error) => this.send({ type: 'error', request: 'git_changes', message: t('errors.openChanges', { error: e.message }) }, cid));
                    break;
                }
                case 'vscode_open': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    try {
                        this.watcher.openFor(cid, transcriptPath(sessionFolderOf(bot, frame.folder), frame.sessionId), frame.sessionId);
                    } catch (e) {
                        this.send({ type: 'error', request: 'vscode_open', message: (e as Error).message }, cid);
                    }
                    break;
                }
                case 'vscode_close':
                    this.watcher.close(cid, frame.sessionId);
                    break;
                case 'vscode_adopt': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    void this.adoptVscode(bot, frame.sessionId, frame.folder, cid).catch((e: Error) => {
                        this.send({ type: 'error', request: 'vscode_adopt', message: t('errors.adoptFailed', { error: e.message }) }, cid);
                    });
                    break;
                }
                case 'vscode_show': {
                    const chatId = frame.chatId;
                    void this.handOver(chatId, frame.target ?? 'ide').then(
                        (message) => this.send({ type: 'vscode_shown', chatId, ok: true, message }, cid),
                        (e: Error) => this.send({ type: 'vscode_shown', chatId, ok: false, message: e.message }, cid),
                    );
                    break;
                }
                case 'approval_reply':
                    this.answerApproval(frame);
                    break;
                case 'routines':
                    this.sendRoutines(cid);
                    break;
                case 'routine_save':
                    if (!findBot(frame.routine.botId)) throw new Error(t('bots.botNotFound'));
                    saveRoutine(frame.routine);
                    this.sendRoutines();
                    this.shareConfig();
                    break;
                case 'routine_delete':
                    deleteRoutine(frame.id);
                    this.sendRoutines();
                    this.shareConfig();
                    break;
                case 'routine_run': {
                    const r = loadRoutines().find((x) => x.id === frame.id);
                    if (!r) throw new Error(t('errors.routineNotFound'));
                    this.runRoutine(r);
                    break;
                }
                case 'bot_info': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    this.send({ type: 'bot_info', botId: bot.id, info: this.botInfo(bot) }, cid);
                    break;
                }
                case 'knowledge_save':
                case 'knowledge_delete': {
                    const bot = findBot(frame.botId);
                    if (!bot) throw new Error(t('bots.botNotFound'));
                    try {
                        if (!isValidLocation(frame.location) || !sees(bot, frame.location)) throw new Error(t('errors.scopeNotVisible'));
                        if (frame.type === 'knowledge_delete') deleteFact(frame.location, frame.name);
                        else {
                            if (frame.oldName !== frame.fact.name && readFact(frame.location, frame.fact.name)) throw new Error(t('errors.factExists', { name: frame.fact.name }));
                            saveFact(frame.location, frame.fact);
                            if (frame.oldName && frame.oldName !== frame.fact.name) deleteFact(frame.location, frame.oldName);
                        }
                    } catch (e) {
                        this.send({ type: 'error', request: frame.type, message: (e as Error).message }, cid);
                        break;
                    }
                    this.knowledgeChanged([frame.location]);
                    this.send({ type: 'bot_info', botId: bot.id, info: this.botInfo(bot) });
                    break;
                }
                case 'file_get': {
                    const d = readFile(frame.path);
                    this.send({ type: 'file', path: frame.path, name: d.name, mime: d.mime, data: d.data }, cid);
                    break;
                }
                case 'push_subscribe':
                    saveSubscription(frame.subscription);
                    this.shareConfig();
                    break;
                case 'machine_join_link':
                    newMachineInvite().then(
                        (invite) => this.send({ type: 'machine_join_link', ...invite }, cid),
                        (e: Error) => this.send({ type: 'error', request: 'machine_join_link', message: t('errors.machineInvite', { error: e.message }) }, cid),
                    );
                    break;
                case 'pair_link':
                    this.pairLink(cid, frame.token ? { token: frame.token, expiresAt: frame.expiresAt } : undefined).catch((e: Error) => this.send({ type: 'error', request: 'pair_link', message: t('errors.pairLink', { error: e.message }) }, cid));
                    break;
                case 'engine_login': {
                    const engine = frame.engine;
                    if (!engineAvailable(engine)) {
                        this.send({ type: 'engine_login', engine, state: 'failed', message: t('engine.notForAccount', { name: ENGINE_NAMES[engine] }) }, cid);
                        break;
                    }
                    startDeviceLogin(engine, (r) => {
                        console.log(`${engine} sign-in: ${r.state}${r.state === 'failed' ? ` (${r.message})` : ''}`);
                        this.send({ type: 'engine_login', engine, ...r });
                        if (r.state === 'done') this.refreshModels();
                    });
                    break;
                }
                case 'relay_claim':
                    claimRelay(frame.address, frame.code).then(
                        ({ url }) => this.send({ type: 'relay_claimed', url }, cid),
                        (e: Error) => this.send({ type: 'error', request: 'relay_claim', message: e.message }, cid),
                    );
                    break;
                case 'claude_sign_in':
                    openSignInTerminal().then(
                        () => {
                            console.log('claude: sign-in terminal opened');
                            this.send({ type: 'claude_sign_in' }, cid);
                        },
                        (e: Error) => this.send({ type: 'error', request: 'claude_sign_in', message: e.message }, cid),
                    );
                    break;
                default: {
                    // Web app newer than the backend: report instead of silently ignoring
                    const request = String((frame as { type?: unknown }).type);
                    this.send({ type: 'error', request, message: t('errors.unknownFrame', { machine: config.machine, request }) }, cid);
                }
            }
        } catch (e) {
            this.send({ type: 'error', message: e instanceof Error ? e.message : String(e) }, cid);
        }
    }

    // ------------------------------------------------------------------ Messages

    /** Store a history entry and pass it to the other machines; with `show` also to the browsers. */
    private record(chatId: string, e: HistoryEntry, show: boolean): HistoryEntry {
        const stored = appendEntry(chatId, e);
        if (show) this.send({ type: 'user', chatId, entry: stored });
        if (this.online.length > 1) this.peer({ kind: 'history', chatId, entries: [stored] });
        return stored;
    }

    private entry(chatId: string, e: HistoryEntry): void {
        this.record(chatId, e, true);
    }

    private live(chatId: string): LiveTurn[] {
        const r: LiveTurn[] = [];
        for (const s of this.sessions.values()) {
            const l = s.live(chatId);
            if (l) r.push(l);
        }
        return r;
    }

    private content(chatId: string, text: string, uploads: UploadInput[]): { content: Turn['content']; attachments: Attachment[] } {
        if (uploads.length === 0) return { content: text, attachments: [] };
        const saved = saveUploads(chatId, uploads);
        const note = `\n\n${t('prompt.attachments', { machine: config.machine.toUpperCase(), paths: saved.map((g) => g.attachment.path).join(', ') })}`;
        const blocks = saved.map((g) => g.block).filter((b): b is Record<string, unknown> => b !== null);
        return { content: [{ type: 'text', text: (text || t('prompt.seeAttachment')) + note }, ...blocks], attachments: saved.map((g) => g.attachment) };
    }

    /**
     * Stores the recording, turns it into text with Whisper and passes it on as a message.
     * If the transcription fails, the recording stays in the history (playable), the bot gets nothing.
     */
    private async voiceMessage(chatId: string, text: string, uploads: UploadInput[], replyTo?: Quote): Promise<void> {
        const audio = uploads.filter((u) => u.type.startsWith('audio/'));
        const rest = uploads.filter((u) => !u.type.startsWith('audio/'));
        const saved = saveUploads(chatId, audio).map((g) => g.attachment);
        const parts: string[] = [];
        try {
            for (const a of saved) {
                const x = await transcriber.transcribe(a.path, voiceLanguage());
                if (x.text) parts.push(x.text);
            }
        } catch (e) {
            this.entry(chatId, {
                role: 'user', text: '', ts: new Date().toISOString(), from: 'me', voice: true, attachments: saved,
            });
            throw new Error(t('errors.voiceFailed', { error: (e as Error).message }), { cause: e });
        }
        const transcript = parts.join('\n\n').trim();
        if (!transcript && !text.trim()) {
            this.entry(chatId, { role: 'user', text: '', ts: new Date().toISOString(), from: 'me', voice: true, attachments: saved });
            throw new Error(t('errors.voiceEmpty'));
        }
        this.messageFromUser(chatId, text, rest, { transcript, attachments: saved }, replyTo);
    }

    private messageFromUser(chatId: string, text: string, uploads: UploadInput[], voice?: { transcript: string; attachments: Attachment[] }, quote?: Quote): void {
        text = text.trim();
        if (!text && uploads.length === 0 && !voice) return;
        const replyTo = quote?.id ? { id: String(quote.id), from: String(quote.from || 'me'), text: String(quote.text || '').slice(0, 300) } : undefined;
        const ts = new Date().toISOString();
        // For voice messages the history shows the transcript (plus typed text if any), the recording as an attachment;
        // Claude gets the note that the text comes from speech recognition.
        const display = voice ? [voice.transcript, text].filter(Boolean).join('\n\n') : text;
        const forClaude = quoteContext(replyTo) + (voice
            ? `${t('prompt.voice')}\n${voice.transcript}${text ? `\n\n${t('prompt.voiceTyped', { text })}` : ''}`
            : text);
        const firstAttachments = voice?.attachments ?? [];

        if (isGroup(chatId)) {
            const g = findGroup(chatId.slice(2));
            if (!g) throw new Error(t('bots.groupNotFound'));
            const { content, attachments: more } = this.content(chatId, forClaude, uploads);
            const attachments = [...firstAttachments, ...more];
            const { id: entryId } = this.record(chatId, { role: 'user', text: display, ts, from: 'me', voice: voice ? true : undefined, attachments: attachments.length ? attachments : undefined, replyTo }, true);
            const members = this.members(g);
            let targets = mentioned(display, members);
            if (targets.length === 0) targets = members.slice(0, 1);
            const round = randomUUID();
            const done = targets.map((b) => b.id);
            this.rememberRound(round, done);
            const context = groupContext(g, members, t('prompt.theUser'));
            // Images and PDFs go along as content blocks, also to bots on another machine
            const full: Turn['content'] = typeof content === 'string'
                ? context + content
                : [{ type: 'text', text: context + String((content[0] as { text?: string }).text ?? '') }, ...content.slice(1)];
            for (const bot of targets) {
                this.startTurn(bot, { chatId, from: 'me', text: display, round, roundDone: done, content: full, entryId });
            }
            return;
        }

        const bot = findBot(botIdOf(chatId));
        if (!bot) throw new Error(t('errors.botNotFoundId', { bot: botIdOf(chatId) }));
        if (isConversation(chatId)) {
            const c = findConversation(chatId);
            if (!c) throw new Error(t('errors.conversationGone'));
            // Still without a title: the first message names the conversation
            if (!c.title && display) this.nameConversation(chatId, display);
        }
        const note = delegationContext(mentioned(display, loadBots().filter((b) => b.id !== bot.id)));
        const { content, attachments: more } = this.content(chatId, note + forClaude, uploads);
        const attachments = [...firstAttachments, ...more];
        const { id: entryId } = this.record(chatId, { role: 'user', text: display, ts, from: 'me', voice: voice ? true : undefined, attachments: attachments.length ? attachments : undefined, replyTo }, true);
        this.startTurn(bot, { chatId, from: 'me', text: display, content, entryId });
    }

    private rememberRound(round: string, bots: string[]): Set<string> {
        let set = this.rounds.get(round);
        if (!set) {
            set = new Set();
            this.rounds.set(round, set);
            if (this.rounds.size > 200) this.rounds.delete(this.rounds.keys().next().value!);
        }
        for (const b of bots) set.add(b);
        return set;
    }

    private members(g: Group): Bot[] {
        const bots = loadBots();
        return g.members.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b);
    }

    private interruptLocally(chatId: string): void {
        for (const s of this.sessions.values()) {
            if (s.currentTurn?.chatId === chatId || (!isGroup(chatId) && s.key === chatId)) void s.interrupt();
        }
        for (const f of this.approvals.values()) {
            if (f.approval.chatId === chatId) f.settle({ behavior: 'deny', message: 'Aborted by the user.', interrupt: true }, t('approval.aborted'));
        }
    }

    /** key: bot id (main chat) or chatId of a conversation. */
    private restartLocally(key: string): void {
        const s = this.sessions.get(key);
        if (s) s.restart();
        else {
            setSessionId(key, undefined);
            this.storeContext(key, 0);
        }
    }

    /** If the routine did not run at its due time (machine came up too late), catch up now. */
    private catchUpWakeRoutine(id: string, at: string): void {
        const r = loadRoutines().find((x) => x.id === id);
        const bot = r && findBot(r.botId);
        if (!r || !r.enabled || !bot || responsibleMachine(bot, this.online) !== config.machine) {
            this.wakeRoutineDone(id);
            return;
        }
        // ran already or is running: runRoutine reports the end
        if (r.lastRun && Date.parse(r.lastRun) >= Date.parse(at) - 60_000) return;
        console.log(`routine ${r.name}: caught up, the machine was not awake yet at the due time`);
        this.runRoutine(r);
    }

    private wakeRoutineDone(id: string): void {
        if (!this.wakeRoutines.delete(id) || this.wakeRoutines.size > 0) return;
        this.shutdownAfterRoutine(Date.now());
    }

    /**
     * Shuts the machine down again after the wake routines (machine setting afterWake), but only when no app is watching,
     * no bot is working and no approval is open; otherwise again every 2 minutes, for at most
     * afterWakeWaitMinutes. With "ifIdle" it also stays on if someone uses the machine.
     */
    private shutdownAfterRoutine(since: number): void {
        if (this.offTimer) clearTimeout(this.offTimer);
        this.offTimer = null;
        const after = config.power.afterWake;
        if (this.wakeRoutines.size > 0 || after.mode === 'never' || !canShutdown()) return;
        const busy = this.approvals.size > 0 || [...this.sessions.values()].some((s) => s.state === 'thinking' || s.state === 'waiting');
        if (this.someoneWatching() || busy || this.othersInUse()) {
            if (Date.now() - since > after.waitMinutes * 60_000) {
                console.log('shutdown after routine: given up, app open or bots busy');
                return;
            }
            this.offTimer = setTimeout(() => this.shutdownAfterRoutine(since), 2 * 60_000);
            return;
        }
        shutdown(false, after.delaySeconds, after.mode === 'ifIdle').then(
            ({ at }) => {
                console.log(`shutdown after routine: planned for ${at}`);
                this.send({ type: 'machine_shutdown_result', cancel: false, ok: true, at });
            },
            (e) => console.log(`shutdown after routine: ${(e as Error).message}`),
        );
    }

    private runRoutine(r: Routine): void {
        const bot = findBot(r.botId);
        if (!bot) return;
        const ts = new Date().toISOString();
        setStatus(r.id, 'running', ts);
        this.sendRoutines();
        this.shareConfig();
        this.entry(bot.id, { role: 'user', text: r.prompt, ts, from: `routine:${r.name}` });
        this.startTurn(bot, {
            chatId: bot.id, from: `routine:${r.name}`, text: r.prompt, routineId: r.id,
            content: `${t('prompt.routine', { name: r.name, time: new Date().toLocaleString(locale()) })}\n\n${r.prompt}`,
        }, (e) => {
            setStatus(r.id, e.error ? 'error' : 'ok');
            this.sendRoutines();
            this.shareConfig();
            if (this.wakeRoutines.has(r.id)) this.wakeRoutineDone(r.id);
        });
    }

    // ------------------------------------------------------------------ Hooks of the sessions

    background(s: BotSession, tasks: { id: string; description: string }[]): void {
        this.send({ type: 'background', botId: s.key, tasks });
    }

    /** Remember the context size per session on this machine (also across restarts) and pass it to the browsers. */
    context(s: BotSession, tokens: number): void {
        this.storeContext(s.key, tokens);
    }

    private storeContext(key: string, tokens: number): void {
        const all = readJson<Record<string, number>>('context.json', {});
        if (tokens) all[key] = tokens;
        else delete all[key];
        writeJson('context.json', all);
        this.send({ type: 'context', botId: key, tokens });
    }

    started(_s: BotSession, turn: Turn): void {
        if (!turn.entryId) return;
        const ts = new Date().toISOString();
        // Groups: the entry may live only on the machine that accepted the message; the app shows the ticks anyway
        if (markRead(turn.chatId, turn.entryId, ts) || isGroup(turn.chatId)) {
            this.send({ type: 'read', chatId: turn.chatId, id: turn.entryId, ts });
        }
    }

    discarded(_s: BotSession, turns: Turn[]): void {
        const ts = new Date().toISOString();
        const per = new Map<string, string[]>();
        for (const x of turns) {
            if (!x.entryId) continue;
            // Groups: if the same message still waits with another member, it is not discarded
            if ([...this.sessions.values()].some((s) => s.stillWaits(x.entryId!))) continue;
            if (!markDiscarded(x.chatId, x.entryId, ts) && !isGroup(x.chatId)) continue;
            per.set(x.chatId, [...(per.get(x.chatId) ?? []), x.entryId]);
        }
        for (const [chatId, entryIds] of per) this.send({ type: 'discarded', chatId, entryIds, ts });
    }

    delta(s: BotSession, turn: Turn, text: string): void {
        this.send({ type: 'delta', chatId: turn.chatId, botId: s.bot.id, text });
    }

    tool(s: BotSession, turn: Turn, call: Parameters<SessionHooks['tool']>[2]): void {
        this.send({ type: 'tool', chatId: turn.chatId, botId: s.bot.id, tool: call });
    }

    toolResult(s: BotSession, turn: Turn, call: Parameters<SessionHooks['toolResult']>[2]): void {
        this.send({ type: 'tool_result', chatId: turn.chatId, botId: s.bot.id, id: call.id, ok: call.ok ?? true, result: call.result ?? '', durationMs: call.durationMs ?? 0 });
    }

    done(s: BotSession, turn: Turn, e: TurnResult): void {
        const ts = new Date().toISOString();
        let entry: HistoryEntry = {
            role: 'assistant', text: e.text, ts, botId: s.bot.id,
            tools: e.tools.length ? e.tools : undefined,
            attachments: e.attachments.length ? e.attachments : undefined,
        };
        if (e.text || e.tools.length || e.attachments.length) entry = this.record(turn.chatId, entry, false);
        if (e.stopped) this.record(turn.chatId, { role: 'event', text: isGroup(turn.chatId) ? t('events.botStopped', { bot: s.bot.name }) : t('events.stopped'), ts }, false);
        else if (e.error) this.record(turn.chatId, { role: 'event', text: t('events.botError', { bot: s.bot.name, error: e.error }), ts }, false);
        this.send({ type: 'done', chatId: turn.chatId, botId: s.bot.id, entry, durationMs: e.durationMs });
        this.gitStatusSoon();

        // Notification: not for answers to other bots (the requester reports them), not after a stop
        const toBot = turn.from !== 'me' && !turn.from.startsWith('routine:') && !isGroup(turn.chatId);
        if (!toBot && !e.stopped) {
            const group = isGroup(turn.chatId) ? findGroup(turn.chatId.slice(2)) : undefined;
            const routine = turn.from.startsWith('routine:') ? turn.from.slice(8) : '';
            const title = isConversation(turn.chatId) ? findConversation(turn.chatId)?.title : '';
            this.push({
                title: group ? t('push.inGroup', { bot: s.bot.name, group: group.name }) : routine ? `${s.bot.name} · ${routine}` : title ? `${s.bot.name} · ${title}` : s.bot.name,
                body: e.error ? t('push.error', { error: e.error }) : plain(e.text) || (e.attachments.length ? `📎 ${e.attachments.map((a) => a.name).join(', ')}` : t('push.done')),
                url: `/?chat=${encodeURIComponent(turn.chatId)}`,
                tag: turn.chatId,
            }, routine ? 'routine' : 'done', turn.chatId);
        }

        // Groups: bots addressed with @ in the answer are next
        if (isGroup(turn.chatId) && !e.error && e.text && turn.hop < MAX_GROUP_HOPS) {
            const g = findGroup(turn.chatId.slice(2));
            if (!g) return;
            const members = this.members(g);
            const round = turn.round ?? randomUUID();
            const done = this.rememberRound(round, turn.roundDone ?? []);
            for (const target of mentioned(e.text, members.filter((b) => b.id !== s.bot.id))) {
                // Already had a turn in this round (e.g. addressed directly by the user): not again
                if (done.has(target.id)) continue;
                done.add(target.id);
                this.startTurn(target, {
                    chatId: turn.chatId, from: s.bot.id, text: e.text, hop: turn.hop + 1, round, roundDone: [...done],
                    content: groupContext(g, members, `${s.bot.name} (@${s.bot.id})`) + e.text,
                });
            }
        }
    }

    state(s: BotSession, state: BotState, detail?: string): void {
        // a scheduled transfer waits until the bot is done; do not end it in the session's own callback
        if (state === 'idle' && pendingTransfers()[s.bot.id]) setTimeout(() => this.checkTransfer(s.bot.id), 1000);
        if (state === 'idle' && pendingWork()[s.bot.id]) setTimeout(() => this.checkWork(s.bot.id), 1000);
        // botId is the session key here (as in states/activity/activeChats), for conversations their chatId
        this.send({ type: 'state', botId: s.key, state, detail, activity: s.activity, chatId: s.currentTurn?.chatId, queue: s.waitingPerChat() });
    }

    error(s: BotSession, turn: Turn | null, message: string): void {
        this.send({ type: 'error', chatId: turn?.chatId, botId: s.bot.id, message });
    }

    account(_s: BotSession, info: AccountInfo): void {
        if (info.engine && info.engine !== 'claude') this.otherAccounts.set(info.engine, info);
        else this.claudeAccount = info;
        this.send({ type: 'account', ...info });
    }

    usage(info: RateLimitInfo): void {
        const w = info.unifiedWindows ?? {};
        const window = (key: 'five_hour' | 'seven_day', old?: Usage['fiveHour']) => {
            const u = w[key];
            if (u && typeof u.utilization === 'number') return { utilization: u.utilization, resetsAt: u.resetsAt };
            if (info.rateLimitType === key && typeof info.utilization === 'number') return { utilization: info.utilization, resetsAt: info.resetsAt };
            return old;
        };
        this.usageClaude = {
            status: info.status,
            fiveHour: window('five_hour', this.usageClaude?.fiveHour),
            sevenDay: window('seven_day', this.usageClaude?.sevenDay),
            resetsAt: info.status === 'rejected' ? info.resetsAt : undefined,
            updatedAt: new Date().toISOString(),
        };
        this.send({ type: 'usage', usage: this.usageClaude });
        // The subscription's limit is the machine owner's; another account's does not move the owner's sessions
        if (this.accountId === DEFAULT_ACCOUNT) subscriptionLimit(info.status, info.resetsAt);
        if (info.status === 'rejected' && !this.limitReported) {
            this.limitReported = true;
            const until = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : t('push.later');
            const body = this.accountId === DEFAULT_ACCOUNT && claudeOnKey() ? t('push.limitBodyKey', { until }) : t('push.limitBody', { until });
            void sendPush({ title: t('push.limitTitle'), body, url: '/', tag: 'limit' }, 'limit').catch(() => undefined);
        } else if (info.status !== 'rejected') {
            this.limitReported = false;
        }
    }

    /** Limits of the ChatGPT subscription for Codex: primary is the 5-hour window, secondary the weekly one. */
    codexLimits(l: CodexLimits): void {
        const window = (w: CodexLimits['primary']) => (w ? { utilization: w.usedPercent / 100, resetsAt: w.resetsAt ?? undefined } : undefined);
        const fiveHour = window(l.primary);
        const sevenDay = window(l.secondary);
        const full = [fiveHour, sevenDay].filter((w) => w && w.utilization >= 1);
        const status: Usage['status'] = l.rateLimitReachedType || full.length ? 'rejected' : Math.max(fiveHour?.utilization ?? 0, sevenDay?.utilization ?? 0) >= 0.9 ? 'allowed_warning' : 'allowed';
        const resetsAt = status === 'rejected' ? Math.max(...full.map((w) => w!.resetsAt ?? 0), 0) || fiveHour?.resetsAt : undefined;
        this.usageCodex = { status, fiveHour, sevenDay, resetsAt, updatedAt: new Date().toISOString() };
        this.send({ type: 'usage', usage: this.usageCodex, engine: 'codex' });
        if (status === 'rejected' && !this.limitReportedCodex) {
            this.limitReportedCodex = true;
            const until = resetsAt ? new Date(resetsAt * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : t('push.later');
            void sendPush({ title: t('push.codexLimitTitle'), body: t('push.codexLimitBody', { until }), url: '/', tag: 'limit-codex' }, 'limit').catch(() => undefined);
        } else if (status !== 'rejected') {
            this.limitReportedCodex = false;
        }
    }

    // ------------------------------------------------------------------ Approvals

    approval(s: BotSession, turn: Turn, toolName: string, input: Record<string, unknown>, signal: AbortSignal, suggestions?: PermissionUpdate[]): Promise<PermissionResult> {
        const e = needsApproval(s.bot.approval, toolName, input, s.bot.folder);
        if (e.deny) return Promise.resolve({ behavior: 'deny', message: e.reason ?? '' });
        if (!e.ask) return Promise.resolve({ behavior: 'allow', updatedInput: input });

        const isQuestion = toolName === 'AskUserQuestion';
        const texts = approvalText(toolName, input);
        const approval: Approval = {
            id: randomUUID().slice(0, 12),
            chatId: turn.chatId,
            botId: s.bot.id,
            kind: isQuestion ? 'question' : 'tool',
            tool: toolName,
            summary: isQuestion ? t('approval.question') : texts.summary,
            detail: isQuestion ? '' : `${e.reason ? `(${e.reason})\n` : ''}${texts.detail}`,
            questions: isQuestion ? questionsFrom(input) : undefined,
            ts: new Date().toISOString(),
            machine: config.machine,
        };

        return new Promise<PermissionResult>((resolve) => {
            let finished = false;
            const timer = setTimeout(() => settle({ behavior: 'deny', message: `No answer from the user within ${APPROVAL_TIMEOUT_MIN} minutes.` }, t('approval.noAnswer')), APPROVAL_TIMEOUT_MIN * 60_000);
            const settle = (r: PermissionResult, text: string) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                this.approvals.delete(approval.id);
                this.send({ type: 'approval_done', id: approval.id, chatId: approval.chatId, result: text });
                const symbol = r.behavior === 'allow' ? '✓' : '✗';
                this.record(approval.chatId, { role: 'event', text: `${symbol} ${s.bot.name}: ${approval.summary} – ${text}`, ts: new Date().toISOString() }, false);
                if (s.state === 'waiting') s.setState('thinking');
                resolve(r);
            };
            signal.addEventListener('abort', () => settle({ behavior: 'deny', message: 'aborted' }, t('approval.aborted')), { once: true });
            this.approvals.set(approval.id, { approval, session: s, input, suggestions, settle });
            s.setState('waiting', isQuestion ? t('approval.waitingAnswer') : t('approval.waitingApproval'));
            this.send({ type: 'approval', approval });
            const group = isGroup(turn.chatId) ? findGroup(turn.chatId.slice(2)) : undefined;
            void sendPush({
                title: t(isQuestion ? 'push.asks' : 'push.needsApproval', { bot: `${s.bot.name}${group ? ` ${t('push.inGroupSuffix', { group: group.name })}` : ''}` }),
                body: isQuestion ? (approval.questions?.[0]?.question ?? t('approval.question')) : approval.summary,
                url: `/?chat=${encodeURIComponent(turn.chatId)}`,
                tag: `approval-${approval.id}`,
            }, 'approval').catch(() => undefined);
        });
    }

    private answerApproval(f: Extract<ClientFrame, { type: 'approval_reply' }>): void {
        const open = this.approvals.get(f.id);
        if (!open) throw new Error(t('errors.approvalDone'));
        const { approval, input, suggestions } = open;
        if (!f.allow) {
            const reason = f.message?.trim();
            open.settle({ behavior: 'deny', message: reason ? `Rejected: ${reason}` : 'The user rejected.' }, reason ? t('approval.rejectedWith', { reason }) : t('approval.rejected'));
            return;
        }
        if (approval.kind === 'question') {
            const answers = f.answers ?? {};
            open.settle({ behavior: 'allow', updatedInput: { ...input, answers } }, Object.values(answers).join(' · ') || t('approval.answered'));
            return;
        }
        open.settle({
            behavior: 'allow', updatedInput: input,
            updatedPermissions: f.always && suggestions?.length ? suggestions : undefined,
        }, f.always ? t('approval.allowedAlways') : t('approval.allowed'));
    }

    // ------------------------------------------------------------------ Tools of the bots (bot-tools.ts)

    tools(s: BotSession): McpServerConfig {
        return botToolServer(s, this.toolHost);
    }

    engineTools(s: BotSession): EngineTool[] {
        return engineToolsFor(s, this.toolHost);
    }

    private readonly toolHost: ToolHost = {
        online: () => this.online,
        machineOf: (bot) => responsibleMachine(bot, this.online),
        send: (frame, cid) => this.send(frame, cid),
        messageBot: (s, target, job, wait) => this.botMessage(s, target, job, wait),
        knowledgeChanged: (locations, by) => this.knowledgeChanged(locations, by),
    };

    /**
     * Knowledge changed: pass it to the other machines and reload sessions that see it with the new index.
     * If a bot changes something itself (`by`), it stays for the next session; it and the others read it with
     * read_knowledge when needed, instead of every note restarting all processes.
     */
    private knowledgeChanged(locations: KnowledgeLocation[], by?: BotSession): void {
        if (!by) this.reloadSessions(locations);
        this.shareConfig();
    }

    private reloadSessions(locations: KnowledgeLocation[]): void {
        if (!locations.length) return;
        const groups = loadGroups();
        for (const s of this.sessions.values()) if (locations.some((o) => sees(s.bot, o, groups))) s.reload();
    }

    private botInfo(bot: Bot): BotInfo {
        return {
            skills: skillsFor(bot.folder), claudeMd: claudeMdExcerpt(bot.folder), knowledge: knowledgeSections(bot),
            routines: loadRoutines().filter((r) => r.botId === bot.id), sessionId: bot.sessionId, messages: countEntries(bot.id),
        };
    }

    private async botMessage(s: BotSession, target: string, job: string, wait: boolean): Promise<ToolText> {
        const text = toolText;
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
        const targetBot = loadBots().find((b) => b.id === target || norm(b.name) === norm(target) || norm(b.id) === norm(target));
        if (!targetBot) return text(`There is no bot "${target}". Use list_bots.`, true);
        if (targetBot.id === s.bot.id) return text('You cannot write to yourself.', true);
        if (!mayMessage(s.bot, targetBot)) return text(`You may not give ${targetBot.name} jobs; the user decides in your settings which bots you can reach. Solve the task yourself or tell the user.`, true);
        const turn = s.currentTurn;
        const chain = [...(turn?.chain ?? []), s.bot.id];
        if (chain.includes(targetBot.id)) return text(`${targetBot.name} is already waiting for you (cycle in the delegation). Solve the task yourself or answer first.`, true);
        if (chain.length > MAX_CHAIN) return text('Too many hand-offs in a row.', true);
        if (!responsibleMachine(targetBot, this.online)) return text(`${targetBot.name} lives on ${targetBot.machine.toUpperCase()}, and that machine is asleep. The user can wake it in the app.`, true);

        // If the target bot is working right now (or has a queue), the job would wait behind everything else; then it
        // runs right away in a conversation of its own with it, in parallel to the main chat
        const main = this.sessions.get(targetBot.id);
        const busy = responsibleMachine(targetBot, this.online) === config.machine && !!main && (!!main.currentTurn || main.waiting() > 0);
        let chatId = targetBot.id;
        if (busy) {
            chatId = createConversation(targetBot.id);
            this.nameConversation(chatId, job, `${s.bot.name}: `);
        }
        const where = busy ? ` (${targetBot.name} was busy, so in a conversation of its own)` : '';
        this.entry(chatId, { role: 'user', text: job, ts: new Date().toISOString(), from: s.bot.id });
        return new Promise<ToolText>((resolve) => {
            let timer: NodeJS.Timeout | null = null;
            this.startTurn(targetBot, {
                chatId, from: s.bot.id, text: job, chain,
                content: `${t('prompt.jobFromBot', { name: s.bot.name, id: s.bot.id })}\n\n${job}`,
            }, (e) => {
                if (timer) clearTimeout(timer);
                if (wait) resolve(e.error ? text(`${targetBot.name} reports an error: ${e.error}`, true) : text(`Answer from ${targetBot.name}${where}:\n\n${e.text || '(no text answer)'}`));
            });
            if (!wait) {
                resolve(text(`Job handed to ${targetBot.name}${where}.`));
                return;
            }
            timer = setTimeout(() => resolve(text(`${targetBot.name} has not answered after ${BOT_ANSWER_TIMEOUT_MIN} minutes; the answer will appear later in its chat.`)), BOT_ANSWER_TIMEOUT_MIN * 60_000);
        });
    }

    // ------------------------------------------------------------------ VS Code sessions

    /**
     * Branches a session from VS Code (or the terminal) into a new conversation: forkSession copies the transcript
     * under a new id, the conversation continues there via resume. The session in VS Code stays as it is. The last
     * messages go into the conversation's history so one sees what it was about.
     */
    private async adoptVscode(bot: Bot, sessionId: string, folder: string | undefined, cid: string): Promise<void> {
        // The transcript only exists on this machine; resume only finds it here
        const where = responsibleMachine(bot, this.online);
        if (where !== config.machine) {
            throw new Error(t('errors.runsElsewhereSession', { bot: bot.name, where: where ? where.toUpperCase() : t('errors.noMachineAwake'), machine: config.machine.toUpperCase() }));
        }
        const dir = sessionFolderOf(bot, folder);
        const file = transcriptPath(dir, sessionId);
        const info = await getSessionInfo(sessionId, { dir });
        if (!info) throw new Error(t('vscode.sessionGone'));
        const title = titleFrom(info.customTitle || info.summary || info.firstPrompt || t('events.fromVscode'));
        const { sessionId: fresh } = await forkSession(sessionId, { dir, title: `${title} (OpenFolk)` });
        // From a subfolder: resume searches in the project folder of the bot folder, move the branch there
        if (path.resolve(dir) !== path.resolve(bot.folder)) {
            fs.mkdirSync(projectDir(bot.folder), { recursive: true });
            fs.renameSync(transcriptPath(dir, fresh), transcriptPath(bot.folder, fresh));
        }
        const chatId = createConversation(bot.id);
        renameConversation(chatId, title);
        // The branch is a Claude Code session; if the bot runs on another engine, this conversation stays with Claude
        if (engineOf(bot.model) !== 'claude') setModel(chatId, 'default');
        setSessionId(chatId, fresh);
        const now = new Date().toISOString();
        const entries = [
            ...Watcher.last(file, VSCODE_HISTORY).map((e) => appendEntry(chatId,
                e.role === 'assistant' ? { ...e, botId: bot.id } : e.role === 'user' ? { ...e, readAt: e.ts } : e)),
            appendEntry(chatId, { role: 'event', text: t('events.adoptedVscode'), ts: now }),
        ];
        if (this.online.length > 1) this.peer({ kind: 'history', chatId, entries });
        console.log(`vscode: ${sessionId} adopted as ${chatId} (new session ${fresh})`);
        this.sendBots();
        this.shareConfig();
        this.send({ type: 'conversation_created', chatId }, cid);
    }

    /**
     * Hands a chat's session to the machine (handover.ts): stop the CLI process (otherwise two would write into the
     * same transcript), then open the session in an IDE or a terminal there. The next message in the chat continues
     * the same session, with everything that was added at the machine.
     */
    private async handOver(chatId: string, target: HandoverTarget): Promise<string> {
        const c = findConversation(chatId);
        const bot = c ? c.bot : findBot(chatId);
        if (!bot) throw new Error(t('bots.botNotFound'));
        const where = responsibleMachine(bot, this.online);
        if (where !== config.machine) throw new Error(t('errors.runsElsewhere', { bot: bot.name, where: where ? where.toUpperCase() : t('errors.noMachineAwake') }));
        const key = c ? chatId : bot.id;
        const s = this.sessions.get(key);
        if (s && (s.state === 'thinking' || s.state === 'waiting' || s.currentTurn || s.waiting() > 0 || s.backgroundTasks.length > 0)) {
            throw new Error(t('errors.botWorking', { bot: bot.name }));
        }
        const sessionId = readSessionId(key);
        if (!sessionId) throw new Error(t('errors.noSessionYet'));
        const foreign = OTHER_ENGINES.find((m) => sessionId.startsWith(`${m}:`));
        if (foreign) throw new Error(t('errors.handoverClaudeOnly', { engine: ENGINE_NAMES[foreign] }));
        if (!handoverTargets().includes(target)) throw new Error(t('handover.unavailable'));
        this.endSession(key);
        const message = await handOver(target, bot.folder, sessionId);
        console.log(`handover: ${key} (${sessionId}) opened at the machine (${target})`);
        return message;
    }

    /** Ends this account's sessions and timers; what the machine shares (voice, engine sign-ins) stops in index.ts. */
    close(): void {
        if (this.scheduler) clearInterval(this.scheduler);
        for (const i of this.intervals) clearInterval(i);
        this.offKeyFallback?.();
        for (const timer of [this.pushTimer, this.gitTimer, this.offTimer, this.pullTimer]) if (timer) clearTimeout(timer);
        for (const f of this.approvals.values()) f.settle({ behavior: 'deny', message: 'Backend is shutting down' }, t('approval.aborted'));
        for (const s of this.sessions.values()) s.close();
    }
}

// ------------------------------------------------------------------ Helpers

/** Bots addressed with @ (id or name, case-insensitive); @all (and the German @alle) hits everyone. */
export function mentioned(text: string, candidates: Bot[]): Bot[] {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
    const hits = new Set<string>();
    for (const m of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
        const n = norm(m[1]);
        if (n === 'all' || n === 'alle') candidates.forEach((b) => hits.add(b.id));
        const b = candidates.find((k) => norm(k.id) === n || norm(k.name) === n);
        if (b) hits.add(b.id);
    }
    return candidates.filter((b) => hits.has(b.id));
}

/** Note for Claude when the user replies to an earlier message (quote from the ⋯ menu). */
export function quoteContext(q: Quote | undefined): string {
    if (!q) return '';
    const who = q.from === 'me' ? t('prompt.quoteOfUser') : t('prompt.quoteOfBot', { name: findBot(q.from)?.name ?? q.from });
    return `${t('prompt.quote', { who, text: q.text.replace(/\s+/g, ' ').trim() })}\n\n`;
}

/** Title of a conversation from its first message: first line, cut at a word boundary. */
export function titleFrom(text: string): string {
    const line = text.replace(/^🎤[^\n]*\n/, '').split('\n').find((z) => z.trim())?.trim() ?? '';
    if (line.length <= 40) return line;
    const short = line.slice(0, 40);
    const word = short.lastIndexOf(' ');
    return (word > 20 ? short.slice(0, word) : short).replace(/[\s,.;:–-]+$/, '') + ' …';
}

/** Note for single chats: bots mentioned with @ are the suggested helpers for message_bot. */
export function delegationContext(mentionedBots: Bot[]): string {
    if (mentionedBots.length === 0) return '';
    const list = mentionedBots.map((b) => `@${b.id} (${b.name}${roleLine(b) ? `, ${roleLine(b)}` : ''})`).join(', ');
    return `${t(mentionedBots.length === 1 ? 'prompt.delegationOne' : 'prompt.delegationMany', { list })}\n\n`;
}

/** Folder of a VS Code session: the bot's or a subfolder of it (from the session list). */
function sessionFolderOf(bot: Bot, folder?: string): string {
    if (!folder) return bot.folder;
    if (!isUnder(folder, bot.folder)) throw new Error(t('errors.notInBotFolder', { folder, bot: bot.name }));
    return folder;
}

/** Is a session working right now (job, queue, background task)? */
function working(s: BotSession): boolean {
    return s.state === 'thinking' || s.state === 'waiting' || Boolean(s.currentTurn) || s.waiting() > 0 || s.backgroundTasks.length > 0;
}

function groupContext(g: Group, members: Bot[], from: string): string {
    const list = members.map((b) => `@${b.id} (${b.name}${roleLine(b) ? `, ${roleLine(b)}` : ''})`).join(', ');
    return `${t('prompt.group', { name: g.name, list, from })}\n\n`;
}

function questionsFrom(input: Record<string, unknown>): Question[] {
    const raw = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
    return raw.map((q) => ({
        question: String(q.question ?? ''),
        header: String(q.header ?? ''),
        multiSelect: q.multiSelect === true,
        options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []).map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') })),
    }));
}

function plain(text: string): string {
    return text.replace(/```[\s\S]*?```/g, ' [Code] ').replace(/[`*_#>|]+/g, '').replace(/\s+/g, ' ').trim();
}
