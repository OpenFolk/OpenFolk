// Messages between web app, relay and local backend.
// Every frame is a JSON object with a `type` field (peer data between backends: `kind`).
//
// A chat is a bot's main chat (chatId = bot id), a further conversation with a bot
// (chatId = bot id + '~' + conversation id) or a group chat (chatId = 'g:' + group id).
// Every conversation has its own session; a bot answering in a group uses the session of
// its main chat.

/**
 * Version of these messages. Raise it with every change that the other side cannot ignore (a new required field, a
 * changed meaning); a new optional field or frame type is no such change. Backends report it in "backend_status",
 * the web app carries its own copy (PROTOCOL_VERSION in webapp/js/core.js, kept equal by a test) and compares, because
 * the mobile apps update through the stores at their own pace.
 */
export const PROTOCOL_VERSION = 2;
/**
 * Oldest web app or app this backend still serves; raise it when it drops support for an old frame. 2: encrypted
 * frames carry a ReplayGuard, without it the backend drops them.
 */
export const MIN_CLIENT_PROTOCOL = 2;

/** UI and bot language; the backends follow the language chosen in the web app. */
export type Language = 'en' | 'de';
export const LANGUAGES: readonly Language[] = ['en', 'de'];

/**
 * Claude models ('default', alias or full id) or another engine: '<engine>' = its default,
 * '<engine>:<model id>' = a specific model (e.g. 'codex', 'cursor:gpt-6').
 */
export type ModelChoice = 'default' | 'opus' | 'sonnet' | 'haiku' | 'codex' | 'cursor' | 'copilot' | 'antigravity' | 'opencode' | string;

/** What a session runs on: Claude Code, OpenAI Codex (app-server), Cursor, GitHub Copilot, Google Antigravity or OpenCode (all ACP). */
export type Engine = 'claude' | 'codex' | 'cursor' | 'copilot' | 'antigravity' | 'opencode';

/** Engines besides Claude, in display order. */
export const OTHER_ENGINES = ['codex', 'cursor', 'copilot', 'antigravity', 'opencode'] as const;

export const ENGINE_NAMES: Record<Engine, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot', antigravity: 'Antigravity', opencode: 'OpenCode' };

/** A git host the bots of a machine push to, without credentials there (setup_status). */
export interface PushGap {
    host: string;
    /** Ids of the bots on that machine whose folder is a repository on this host */
    bots: string[];
}

/** Whether an engine can run on a machine: ready, installed but not signed in, or not installed. */
export type EngineStatus = 'ready' | 'sign_in' | 'missing';
export type EngineStatuses = Partial<Record<Engine, EngineStatus>>;
/** Engines whose sign-in the web app can start (device code: a link and a code, no terminal). */
export const DEVICE_LOGIN_ENGINES = ['codex', 'copilot'] as const;
export type DeviceLoginEngine = typeof DEVICE_LOGIN_ENGINES[number];

/** Where a chat's session can be handed over to on its machine: an IDE window or a terminal. */
export const HANDOVER_TARGETS = ['ide', 'terminal'] as const;
export type HandoverTarget = typeof HANDOVER_TARGETS[number];

export function engineOf(model: string | undefined): Engine {
    return OTHER_ENGINES.find((e) => model === e || model?.startsWith(`${e}:`)) ?? 'claude';
}

/** Model id for another engine ('cursor:gpt-x' → 'gpt-x'); undefined = its default (or Claude). */
export function engineModelId(model: string | undefined): string | undefined {
    const engine = engineOf(model);
    return engine !== 'claude' && model?.startsWith(`${engine}:`) ? model.slice(engine.length + 1) : undefined;
}

/** Model id for Codex ('codex:gpt-x' → 'gpt-x'); undefined = Codex default. */
export function codexModelId(model: string | undefined): string | undefined {
    return engineOf(model) === 'codex' ? engineModelId(model) : undefined;
}

/** When a bot asks before acting. */
export type ApprovalPolicy = 'never' | 'risky' | 'write';

export interface Bot {
    id: string;
    name: string;
    /** Field of work shown with the name, e.g. "Research" for "Rudolf"; missing for bots saved before it existed. */
    area?: string;
    /** Short role for the list, e.g. "Infrastructure and deployments". */
    role: string;
    /** Working directory of the session, absolute path with /. */
    folder: string;
    model: ModelChoice;
    /** Free-text instructions on tone and way of working; part of the system prompt. */
    tone: string;
    /** Avatar as data URL or empty. */
    avatar: string;
    approval: ApprovalPolicy;
    /**
     * Bots this bot may give jobs with message_bot (and sees in list_bots); missing = all, empty = none. Group chats
     * are not limited by it: their members are what the user chose there.
     */
    canMessage?: string[];
    /** Pinned to the top of the list (synced across machines). */
    favorite?: boolean;
    /** No push for answers and routines of this chat; approvals still arrive. */
    muted?: boolean;
    /**
     * The machine the bot lives on (e.g. 'workstation'); its folder is a folder there. While that machine sleeps,
     * the bot sleeps. Empty only for bots saved before 0.2, until a machine claims them.
     */
    machine: string;
    /** Always true when `machine` is set; only for apps before 0.2, which let bots move to any machine awake. */
    machineOnly?: boolean;
    /** Session id of the CLI on this machine (not synced; sessions are per machine). */
    sessionId?: string;
    /** Further conversations besides the main chat, each with its own session. */
    conversations?: Conversation[];
    createdAt: string;
    updatedAt: string;
}

export interface Conversation {
    /** Short, a-z0-9 only; chatId is `<bot id>~<id>`. */
    id: string;
    /** Empty until the first message provides one. */
    title: string;
    /** Model of this conversation; missing = the bot's. */
    model?: ModelChoice;
    /** Archived since: hidden from the overview; history and session stay for restoring. */
    archived?: string;
    createdAt: string;
}

/** `canMessage`: null = all bots; missing (apps before it existed) keeps what the bot has. */
export type BotInput = Omit<Bot, 'sessionId' | 'createdAt' | 'updatedAt' | 'conversations' | 'canMessage'> & { canMessage?: string[] | null };

/** Bot id for a chatId (main chat or conversation). */
export function botIdOf(chatId: string): string {
    return chatId.split('~')[0];
}

export function isConversation(chatId: string): boolean {
    return !chatId.startsWith('g:') && chatId.includes('~');
}

export const isGroup = (chatId: string): boolean => chatId.startsWith('g:');

export interface Group {
    id: string;
    name: string;
    avatar: string;
    /** Bot ids; the first one answers when nobody is addressed with @. */
    members: string[];
    favorite?: boolean;
    muted?: boolean;
    createdAt: string;
    updatedAt: string;
}

export type GroupInput = Omit<Group, 'createdAt' | 'updatedAt'>;

/** Kinds of push notification; security warnings always arrive and cannot be configured. */
export type PushKind = 'done' | 'routine' | 'approval' | 'awake' | 'limit';
/** off = no push; quiet = silent, low urgency; high = stays visible, delivered with priority. */
export type PushPriority = 'off' | 'quiet' | 'normal' | 'high';

/** Settings for all devices, synced between machines (newer wins). */
export interface PushSettings {
    kinds: Record<PushKind, PushPriority>;
    updatedAt: string;
}

/** Image models for profile pictures as photos; gpt-image-1 needs the OpenAI key, the others the Gemini key. */
export const AVATAR_MODELS = ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gpt-image-1'] as const;
export type AvatarModel = (typeof AVATAR_MODELS)[number];
/** What Apple and Google see of an app notification: the title, title and text, or only "OpenFolk". */
export const PUSH_PREVIEWS = ['title', 'full', 'none'] as const;
export type PushPreview = (typeof PUSH_PREVIEWS)[number];
/** API keys kept in the shared settings; the keys themselves never reach a browser. */
export const SHARED_API_KEYS = ['gemini', 'openai'] as const;
export type SharedApiKey = (typeof SHARED_API_KEYS)[number];

/**
 * Settings shared by all devices and machines of an account (newer wins). Missing optional fields mean the default;
 * a backend from before they existed simply leaves them out.
 */
export interface SharedSettings {
    language: Language;
    /** Image model for profile pictures (default gemini-3.1-flash-image). */
    avatarModel?: AvatarModel;
    /** Language of voice messages ('' or missing = detect). */
    voiceLanguage?: '' | Language;
    /** Fast-forward the bots' repos on every machine (default true). */
    gitAutoPull?: boolean;
    /** What Apple and Google see of an app notification (default 'title'). */
    pushPreview?: PushPreview;
    /** Which API keys are stored (only in what goes to browsers). */
    apiKeys?: Partial<Record<SharedApiKey, boolean>>;
    updatedAt: string;
}

/** What a browser may change of the shared settings. */
export type SharedSettingsInput = Partial<Pick<SharedSettings, 'language' | 'avatarModel' | 'voiceLanguage' | 'gitAutoPull' | 'pushPreview'>>;

/** Faster-whisper models for voice messages; '' = automatic (large-v3-turbo, small without a graphics card). */
export const VOICE_MODELS = ['', 'large-v3-turbo', 'medium', 'small', 'base'] as const;
export type VoiceModel = (typeof VOICE_MODELS)[number];
export const VOICE_DEVICES = ['auto', 'cuda', 'cpu'] as const;
export type VoiceDevice = (typeof VOICE_DEVICES)[number];
export const AFTER_WAKE = ['ifIdle', 'always', 'never'] as const;
export type AfterWake = (typeof AFTER_WAKE)[number];
/** How an engine signs in on a machine: its subscription login, or a key stored on that machine. */
export const ENGINE_AUTH_MODES = ['subscription', 'apikey'] as const;
export type EngineAuth = (typeof ENGINE_AUTH_MODES)[number];
/**
 * Claude also knows 'both': the subscription first, the API key by the rules of the machine settings (claudeFallback,
 * claudeKeyBudgetUsd) once the subscription is at its limit. Only Claude reports its limit before the turn it ends, so
 * only Claude can switch without losing the session.
 */
export const CLAUDE_AUTH_MODES = [...ENGINE_AUTH_MODES, 'both'] as const;
export type ClaudeAuth = (typeof CLAUDE_AUTH_MODES)[number];
/** With 'both': switch to the key when the subscription's limit is reached, or already at Anthropic's warning before it. */
export const CLAUDE_FALLBACK = ['limit', 'warning'] as const;
export type ClaudeFallback = (typeof CLAUDE_FALLBACK)[number];
/**
 * Engines besides Claude that can run on a key instead of the subscription (Codex: an OpenAI API key, Cursor: a Cursor
 * API key, Copilot: a GitHub token with Copilot access, Antigravity: a Gemini API key). OpenCode is not among them:
 * it never takes keys (acp.ts).
 */
export const KEY_ENGINES = ['codex', 'cursor', 'copilot', 'antigravity'] as const;
export type KeyEngine = (typeof KEY_ENGINES)[number];

/** Settings of one machine, kept by its backend and not synced; changed by the main account only. */
export interface MachineSettings {
    /** Sign-in of the Claude sessions: the Claude Code login, the API key stored on this machine, or both by rules. */
    claudeAuth: ClaudeAuth;
    claudeFallback: ClaudeFallback;
    /** With 'both': at most this much (US dollars per day) through the key, then the sessions wait for the subscription; 0 = no cap. */
    claudeKeyBudgetUsd: number;
    /** The same for the other engines that take a key; a missing engine signs in with its subscription. */
    engineAuth: Partial<Record<KeyEngine, EngineAuth>>;
    /**
     * Engines switched off on this machine: not started, not offered in the model choice. A new installation starts
     * with all of them until the user picks. Missing from older backends.
     */
    disabledEngines: Engine[];
    /** The app may shut this machine down and restart it (where it knows how). */
    shutdown: boolean;
    /** Countdown of a shutdown or restart from the app (seconds). */
    shutdownDelaySeconds: number;
    /** After routines the relay woke this machine for: shut down if nobody uses it, always, or never. */
    afterWake: AfterWake;
    afterWakeSeconds: number;
    afterWakeWaitMinutes: number;
    /** A signed-in session counts as unused after this many minutes without input. */
    idleMinutes: number;
    /** Offer "Open in the IDE" and "Open in a terminal" for this machine. */
    handoverIde: boolean;
    handoverTerminal: boolean;
    voiceModel: VoiceModel;
    voiceDevice: VoiceDevice;
    /** Load the speech model when the backend starts. */
    voicePreload: boolean;
    /**
     * Pushing without the credential manager (a task without a signed-in user, a container): the user and the git host
     * the token applies to, e.g. git.example.com; the token itself is stored apart. Empty: push as usual.
     */
    gitPushUser: string;
    gitPushHost: string;
}

export const MACHINE_SETTINGS_DEFAULT: MachineSettings = {
    claudeAuth: 'subscription', claudeFallback: 'limit', claudeKeyBudgetUsd: 0, engineAuth: {}, disabledEngines: [], shutdown: true, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300,
    afterWakeWaitMinutes: 60, idleMinutes: 15, handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto',
    voicePreload: true, gitPushUser: '', gitPushHost: '',
};

/**
 * Voice messages on a machine: `ready` (faster-whisper loads), `missing` (not set up), `installing` (detail: python,
 * packages), `failed` (detail: no_python or the last line of the error), `unavailable` (a container, no Python).
 */
export interface VoiceSetup {
    state: 'ready' | 'missing' | 'installing' | 'failed' | 'unavailable';
    detail?: string;
}

/** Upper limits of the numbers in MachineSettings. */
export const MACHINE_SETTINGS_MAX = {
    shutdownDelaySeconds: 3600, afterWakeSeconds: 3600, afterWakeWaitMinutes: 24 * 60, idleMinutes: 24 * 60, claudeKeyBudgetUsd: 10_000,
} as const;

/** Claude with 'both': whether the sessions run on the key right now, until when, and what the key cost today. */
export interface KeyFallbackState {
    active: boolean;
    /** Unix seconds: back to the subscription. */
    until?: number;
    spentUsd: number;
    budgetReached: boolean;
}

export interface ToolCall {
    id: string;
    name: string;
    summary: string;
    ok?: boolean;
    /** Truncated tool output. */
    result?: string;
    /** Sent in the history without `result`: the browser fetches the output when expanded (tool_output). */
    deferred?: boolean;
    durationMs?: number;
}

export interface Attachment {
    name: string;
    type: string;
    size: number;
    /** Path on the machine that has the file (download via file_get). */
    path: string;
    /** Machine the file lives on. */
    machine?: string;
    /** Small preview (data URL) for images. */
    thumb?: string;
    /** Length of a voice recording in milliseconds. */
    durationMs?: number;
}

export interface HistoryEntry {
    /** Unique per entry; machines sync their history by it. */
    id?: string;
    role: 'user' | 'assistant' | 'event';
    text: string;
    ts: string;
    /** assistant: which bot speaks (matters in groups). */
    botId?: string;
    /** user: sender – 'me', a bot id or 'routine:<name>'. */
    from?: string;
    tools?: ToolCall[];
    attachments?: Attachment[];
    /** true = voice message; `text` is the transcript, the recording is in `attachments`. */
    voice?: boolean;
    /** user: when a bot started working on the message (blue ticks). */
    readAt?: string;
    /** user: moved from the queue into this conversation (chatId); runs there instead. */
    movedTo?: string;
    /** user: deleted from the queue before the bot read it; kept as a marker for syncing, not shown. */
    deletedAt?: string;
    /** user: still waiting when the queue was cleared (stop, new session); the bot never got it. */
    discardedAt?: string;
    /** user: reply to an earlier message of this chat (quote at the top of the bubble). */
    replyTo?: Quote;
}

/** Quoted message: copy of sender and (truncated) text, so the quote stays readable without the message. */
export interface Quote {
    id: string;
    /** 'me' or bot id */
    from: string;
    text: string;
}

export interface QuestionOption {
    label: string;
    description: string;
}

export interface Question {
    question: string;
    header: string;
    multiSelect: boolean;
    options: QuestionOption[];
}

/** Open request of a bot: tool approval or multiple-choice questions. */
export interface Approval {
    id: string;
    chatId: string;
    botId: string;
    kind: 'tool' | 'question';
    tool: string;
    summary: string;
    /** Details (command, path, diff excerpt) for the approval card. */
    detail: string;
    questions?: Question[];
    ts: string;
    /** Machine the bot waits on (the answer must go there). */
    machine?: string;
}

export interface UsageWindow {
    /** Utilization 0..1 */
    utilization: number;
    /** Unix seconds */
    resetsAt?: number;
}

export interface Usage {
    status: 'allowed' | 'allowed_warning' | 'rejected';
    fiveHour?: UsageWindow;
    sevenDay?: UsageWindow;
    /** With status 'rejected': when it continues (Unix seconds). */
    resetsAt?: number;
    updatedAt: string;
}

export interface Routine {
    id: string;
    botId: string;
    name: string;
    /** Cron expression with 5 fields (minute hour day month weekday), local time of the machine. */
    cron: string;
    prompt: string;
    enabled: boolean;
    /** If no suitable machine is awake, the relay wakes one; it shuts down again afterwards. */
    wake?: boolean;
    lastRun?: string;
    lastStatus?: 'ok' | 'error' | 'running';
    updatedAt: string;
}

export type RoutineInput = Omit<Routine, 'lastRun' | 'lastStatus' | 'updatedAt'>;

/**
 * A planned run of a routine with `wake`, as the backends report it to the relay. The relay only knows time and
 * machine, not the prompt; it wakes the machine shortly before if it is off.
 */
export interface WakeEntry {
    routineId: string;
    /** Due time (ISO, UTC); the backends convert the routine's local time. */
    at: string;
    /** The bot's machine; empty for a bot not placed yet = the alphabetically first one the wake service knows. */
    machine: string;
    /** Wake `machine` even if another machine is awake; true whenever `machine` is set. */
    machineOnly: boolean;
}

// ---- Knowledge: facts that bots and users keep permanently ----

/** Who sees the knowledge: one bot, all bots of a working folder, the members of a group or everyone. */
export type KnowledgeScope = 'bot' | 'folder' | 'group' | 'all';

export const KNOWLEDGE_TYPES = ['user', 'workstyle', 'project', 'reference', 'note'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** Storage of a scope; `key` = bot id, folder key or group id, empty for 'all'. */
export interface KnowledgeLocation {
    scope: KnowledgeScope;
    key: string;
}

export interface KnowledgeFact {
    /** Slug a-z0-9-, also the file name */
    name: string;
    /** One line; listed in the index in the system prompt */
    description: string;
    type: KnowledgeType;
    text: string;
    updatedAt: string;
}

/** A scope as the bot info shows it. */
export interface KnowledgeSection {
    location: KnowledgeLocation;
    /** Display name, e.g. "Folder /home/me/x" or "Group Website team" */
    title: string;
    facts: KnowledgeFact[];
}

export interface BotInfo {
    skills: string[];
    claudeMd: string;
    /** Knowledge the bot sees: its own, folder, groups, all */
    knowledge: KnowledgeSection[];
    routines: Routine[];
    sessionId?: string;
    messages: number;
}

/** A session running on the machine in VS Code or in the terminal (not from a bot). */
export interface VscodeSession {
    id: string;
    /** Custom title, summary or first message */
    title: string;
    firstPrompt: string;
    /** Last change (ISO) */
    lastModified: string;
    /** Transcript size in bytes */
    size: number;
    origin: 'vscode' | 'terminal';
    /** Subfolder of the bot in which the session was started; missing = the bot's folder. */
    folder?: string;
    /** A Claude process has the session open right now (VS Code starts it with --resume=<id>). */
    open: boolean;
    /** Claude is in the middle of an answer according to the transcript. */
    working: boolean;
    branch?: string;
}

/** A git repo in a bot's folder with its uncommitted files. */
export interface GitRepo {
    name: string;
    /** Relative to the bot's folder ('' = the folder itself or the repo it lives in) */
    path: string;
    branch: string;
    /** Commits not yet pushed or not yet pulled */
    ahead: number;
    behind: number;
    /** Status as in `git status --porcelain` (e.g. ' M', 'A ', '??') and path in the repo */
    files: { status: string; path: string }[];
    /** Further files not in the list */
    more: number;
    error?: string;
    /** The backend that sends this runs from this repo (the web app offers its restart there). */
    backend?: boolean;
}

/** A model as the CLI offers it (supportedModels); 'default' shows via resolvedModel what is behind it. */
export interface ModelInfo {
    value: string;
    resolvedModel: string;
    displayName: string;
}

/** Display name of the model that really runs behind a setting ('default' → e.g. "Opus 5.5"). */
export function modelDisplayName(model: string, list: ModelInfo[]): string {
    const entry = list.find((m) => m.value === model);
    const target = entry?.resolvedModel ?? model;
    // 'default', 'codex' and 'cursor' are only pointers; show the model behind them
    const alias = list.find((m) => m.value !== 'default' && !(OTHER_ENGINES as readonly string[]).includes(m.value) && m.resolvedModel === target);
    return (alias ?? entry)?.displayName ?? model;
}

/** Running answer of a bot (for browsers that open in the middle of an answer). */
export interface LiveTurn {
    botId: string;
    text: string;
    tools: ToolCall[];
}

export type BotState = 'idle' | 'thinking' | 'waiting' | 'error';

export interface UploadInput {
    name: string;
    type: string;
    /** Base64 without data: prefix */
    data: string;
    thumb?: string;
    /** For voice recordings: length in milliseconds. */
    durationMs?: number;
}

/** Suggestion for the bot editor: the model proposes names, a role or a profile picture. */
export interface SuggestionRequest {
    what: 'name' | 'role' | 'avatar';
    folder: string;
    name: string;
    area?: string;
    role: string;
    tone: string;
    model: ModelChoice;
    /** Suggestions already shown that should not come again. */
    previous?: string[];
}

export type SuggestionResult =
    /** `areas[i]` is the field of work for `names[i]`; missing from backends before the field existed. */
    | { what: 'name'; names: string[]; areas?: string[] }
    | { what: 'role'; role: string }
    /** Profile picture: `image` is a finished photo as data URL (image model, if a key is set), otherwise `svg` markup. */
    | { what: 'avatar'; image?: string; svg?: string };

// ---- Web app -> backend (the relay only passes these frames through) ----

export type ClientFrame =
    | { type: 'bots' }
    | { type: 'bot_save'; bot: BotInput }
    | { type: 'bot_delete'; botId: string }
    | { type: 'bot_suggest'; request: SuggestionRequest }
    /** Check a folder on this machine before a bot is saved with it (folder_checked) */
    | { type: 'folder_check'; folder: string }
    /**
     * Clone a repository on this machine (folder_cloned): into `folder` if given (new or empty, inside the allowed
     * folders), otherwise into a new folder named after the repository
     */
    | { type: 'folder_clone'; url: string; folder?: string }
    /** Where a repository would go on this machine (folder_proposed), for the bot editor's folder field */
    | { type: 'folder_propose'; url: string }
    | { type: 'group_save'; group: GroupInput }
    | { type: 'group_delete'; groupId: string }
    | { type: 'favorite'; chatId: string; on: boolean }
    | { type: 'mute'; chatId: string; on: boolean }
    | { type: 'push_settings'; kinds: Partial<Record<PushKind, PushPriority>> }
    /** Language for all devices and the bots' answers; answer: "settings" to all browsers. */
    | { type: 'language'; language: Language }
    /**
     * Change shared settings (only the fields given). `apiKeys`: a new key, '' removes it. Answer: "settings" to all
     * browsers; the change reaches the other machines through the sync.
     */
    | { type: 'settings_save'; settings: SharedSettingsInput; apiKeys?: Partial<Record<SharedApiKey, string>> }
    | { type: 'history'; chatId: string; limit?: number }
    /** Output of a tool from the history (sent there as `deferred` without output); answer "tool_output". */
    | { type: 'tool_output'; chatId: string; entryId: string; toolId: string }
    | { type: 'send'; chatId: string; text: string; attachments?: UploadInput[]; replyTo?: Quote }
    | { type: 'interrupt'; chatId: string }
    /** New session; with chatId only for that conversation, otherwise for the main chat. */
    | { type: 'restart'; botId: string; chatId?: string }
    | { type: 'conversation_new'; botId: string }
    | { type: 'conversation_rename'; chatId: string; title: string }
    /** Switch model, context stays: in the main chat the bot's, in a conversation only there. */
    | { type: 'model'; chatId: string; model: ModelChoice }
    | { type: 'conversation_delete'; chatId: string }
    | { type: 'conversation_archive'; chatId: string; on: boolean }
    /** Full-text search over all chats (from 2 characters), with chatId only in that chat; answer "search_result". */
    | { type: 'search'; text: string; chatId?: string }
    /** Move a waiting message from the queue into a new conversation with the bot and start it there. */
    | { type: 'queue_to_conversation'; chatId: string; entryId: string }
    /** Delete a waiting message from the queue (only while the bot has not started it). */
    | { type: 'queue_delete'; chatId: string; entryId: string }
    /** Pin a message at the top of the chat (on) or unpin it. */
    | { type: 'pin'; chatId: string; entry: PinnedEntry; on: boolean }
    /** Read state of changed chats from this device (applies to all devices). */
    | { type: 'seen'; state: Record<string, SeenEntry> }
    /** Sessions from VS Code and terminal in the bot's folder on the target machine; answer "vscode_sessions". */
    | { type: 'vscode_sessions'; botId: string }
    /** Read and follow one of these sessions; answers "vscode_history" until vscode_close. */
    | { type: 'vscode_open'; botId: string; sessionId: string; folder?: string }
    | { type: 'vscode_close'; sessionId: string }
    /** Adopt as a branch into a new conversation (the session in VS Code stays unchanged). */
    | { type: 'vscode_adopt'; botId: string; sessionId: string; folder?: string }
    /**
     * Hand this chat's session over to the machine: the bot ends its process, the machine opens the session in an
     * IDE window or a terminal. Missing target = 'ide' (clients from before). Answer "vscode_shown".
     */
    | { type: 'vscode_show'; chatId: string; target?: HandoverTarget }
    /** Uncommitted files of the git repos in the bot's folder; answer "git_changes". */
    | { type: 'git_changes'; botId: string }
    /** Commit and push everything in this repo (path as in GitRepo), push only without open files; answers "git_commit", then "git_changes". */
    | { type: 'git_commit'; botId: string; path: string; message: string }
    /**
     * To the machine a bot is leaving, sent with the move: once the move arrives there, pack what is not on the git
     * server yet in `folder` (the bot's folder there) and send it to `machine`. No answer.
     */
    | { type: 'work_take'; botId: string; machine: string; folder: string }
    /** Fetch this repo and fast-forward it if that is safe (no local changes, no own commits); answers "git_pull", then "git_changes". */
    | { type: 'git_pull'; botId: string; path: string }
    /** Restart this machine's backend once no bot is working; answer "backend_status". */
    | { type: 'backend_restart' }
    | { type: 'approval_reply'; id: string; allow: boolean; always?: boolean; answers?: Record<string, string>; message?: string }
    | { type: 'routines' }
    | { type: 'routine_save'; routine: RoutineInput }
    | { type: 'routine_delete'; id: string }
    | { type: 'routine_run'; id: string }
    | { type: 'bot_info'; botId: string }
    /** Create or change a fact; `oldName` when renaming. Answer: new "bot_info" to all browsers. */
    | { type: 'knowledge_save'; botId: string; location: KnowledgeLocation; fact: Omit<KnowledgeFact, 'updatedAt'>; oldName?: string }
    | { type: 'knowledge_delete'; botId: string; location: KnowledgeLocation; name: string }
    | { type: 'file_get'; path: string }
    | { type: 'push_subscribe'; subscription: unknown }
    /**
     * A link that signs in one more device without the password: the backend has the relay mint a one-time token
     * and adds the end-to-end key when it has one. Answer "pair_link" (only to the asking browser). With `token`: the
     * invitation to another account, a token the relay gave an admin in "account_created"; the backend only adds the key
     * and the QR code, it never mints a token for another account (it does not know who may).
     */
    | { type: 'pair_link'; token?: string; expiresAt?: string }
    /** Sign this machine in to an engine with a device code; answers "engine_login" with the link and the code. */
    | { type: 'engine_login'; engine: DeviceLoginEngine }
    /** Open a terminal with Claude Code on this machine for its sign-in (main account); answers "claude_sign_in" or an error. */
    | { type: 'claude_sign_in' }
    /**
     * Claim a relay of one's own on a server with the setup code from its log and move this backend there (main account,
     * embedded relay only); answers "relay_claimed" with a pairing link at that relay, or an error.
     */
    | { type: 'relay_claim'; address: string; code: string }
    | { type: 'presence'; visible: boolean }
    /** Recording in progress: load the speech model already so the transcription starts warm. */
    | { type: 'voice_warmup' }
    /** Shut down or (`restart`) restart the machine the frame goes to (`machine`), or cancel the planned shutdown or restart. */
    | { type: 'machine_shutdown'; cancel?: boolean; inSeconds?: number; restart?: boolean }
    /** Toggle automatic Windows sign-in of the machine (`machine`); without `on` only query. */
    | { type: 'machine_autologon'; on?: boolean }
    /**
     * Change the settings of the machine (`machine`), only the fields given; `anthropicKey`, `gitPushToken`, `engineKeys`:
     * a new secret, '' removes it. Answer: "machine_settings" to all browsers, an error only to the asking one.
     */
    | { type: 'machine_settings_save'; settings: Partial<MachineSettings>; anthropicKey?: string; gitPushToken?: string; engineKeys?: Partial<Record<KeyEngine, string>> }
    /** Set up voice messages on the machine (`machine`): Python environment and packages; progress in "machine_settings". */
    | { type: 'voice_setup' }
    /** An invitation for one more machine (npm run join); answer "machine_join_link" to the asking browser only. */
    | { type: 'machine_join_link' }
    | { type: 'ping' };

/** What the browser sends: frame plus optionally the target machine (without: the first machine awake). */
export type ClientMessage = (ClientFrame | E2eFrame) & { machine?: string };

/**
 * End-to-end encrypted frame (AES-256-GCM, key only in browsers and backends).
 * `data` = Base64 of ciphertext plus 16-byte tag, `iv` = Base64 of 12 bytes. Inside is a ClientFrame,
 * AgentFrame or PeerData; the direction is bound as additional authenticated data.
 */
/**
 * Inside every encrypted frame (field `_r` next to the frame's own fields, since protocol version 2): sender id per
 * process or page load, a counter that only grows and the sending time. The receiver rejects a frame whose counter it
 * has seen from that sender or whose time lies more than ten minutes off, so a relay that records frames cannot deliver
 * them again.
 */
export interface ReplayGuard {
    t: number;
    s: string;
    n: number;
}

export interface E2eFrame {
    type: 'e2e';
    iv: string;
    data: string;
}

/**
 * Frames the relay answers itself (waking via the wake service, devices, accounts). Devices are those of the
 * signed-in account; creating, changing others and deleting accounts needs an account with `admin`.
 */
export type RelayRequest =
    | { type: 'wake_status' }
    | { type: 'wake'; host: string }
    | { type: 'devices' }
    | { type: 'device_logout'; id: string }
    | { type: 'accounts' }
    /** Answers "account_created" with a pairing token for the new account's first device. */
    | { type: 'account_create'; name: string; admin?: boolean }
    /** `password`: own account only; `admin`: not for one's own account. */
    | { type: 'account_update'; id: string; name?: string; password?: string; admin?: boolean }
    /** Removes the account, its devices and, on every machine, its data; not for 'main'. */
    | { type: 'account_delete'; id: string }
    /** A new invitation for another account (the last one expired); answers "account_invite". Not for 'main'. */
    | { type: 'account_invite'; id: string }
    /** Who is waiting behind the QR code of a new device ("pair_wait"); answers "pair_request". */
    | { type: 'pair_request'; id: string }
    /** Signs that device in: `box` holds its pairing link, sealed for its key; answers "pair_approved". */
    | { type: 'pair_approve'; id: string; box: PairBox }
    /** The second factor of 'main' (answers "totp"); other accounts only learn that it is not theirs to set. */
    | { type: 'totp_status' }
    /** A new secret to scan (answers "totp_setup"); it counts only once confirmed. `label`: names the relay in the app. */
    | { type: 'totp_begin'; label?: string }
    /** Confirms the new secret with a code from the authenticator app; answers "totp" or error totp_wrong_code. */
    | { type: 'totp_confirm'; code: string }
    /** Switches the second factor off, with a current code; answers "totp" or error totp_wrong_code. */
    | { type: 'totp_off'; code: string }
    /** The machines joined by invitation; answers "machine_tokens". Only 'main'. */
    | { type: 'machine_tokens' }
    /** Logs a joined machine out: its token is gone and its backend disconnected; answers "machine_tokens". */
    | { type: 'machine_token_remove'; machine: string };

/**
 * The part behind '#' of a pairing link (`pair=…&e2e=…`), sealed for a device that shows a QR code: ECDH P-256 of
 * `pk` (the approving device's one-time key) with the waiting device's key, HKDF-SHA-256, AES-256-GCM with the request
 * id as additional data. Its key travels only in the QR code, so the relay can neither read nor swap the link.
 */
export interface PairBox {
    pk: string;
    iv: string;
    data: string;
}

/** An account on the relay: a person or role with its own bots, chats and devices. 'main' is the relay's owner. */
export interface RelayAccount {
    id: string;
    name: string;
    /** May create, change and delete accounts. */
    admin: boolean;
    created: string;
}

/**
 * First message of the browser: device key, a one-time pairing token from a pairing link (see "pair_link"), or
 * (once per device) password, optionally with TOTP code.
 */
export type AuthRequest =
    | { type: 'auth'; device: string }
    | { type: 'auth'; pair: string; name?: string }
    /** `account`: id or name; missing = 'main'. */
    | { type: 'auth'; token: string; name?: string; totp?: string; account?: string }
    /**
     * Sign-in by QR code: instead of signing in, the connection waits (answer "pair_wait" with an id for the QR code)
     * until a signed-in device approves it ("pair_box") or the request expires (closed with 4005).
     */
    | { type: 'pair_wait'; name?: string };

export interface DeviceInfo {
    id: string;
    name: string;
    created: string;
    lastSeen: string;
    ip: string;
}

/**
 * Codes for texts the relay or a backend produces without knowing the user's language; the web app translates
 * them (`message` stays as English fallback).
 */
export type MessageCode =
    | 'device_logged_out'
    | 'too_many_attempts'
    | 'totp_required'
    | 'totp_wrong_code'
    | 'wrong_password'
    | 'pairing_invalid'
    | 'wake_not_configured'
    | 'unknown_machine'
    | 'wake_failed'
    | 'machine_not_connected'
    | 'no_machine_connected'
    /** The machine runs a backend without accounts; it serves 'main' only. */
    | 'machine_outdated'
    | 'not_allowed'
    | 'account_name_taken';

// ---- Backend -> web app ----

export type AgentFrame =
    | { type: 'bots'; bots: Bot[]; groups: Group[]; states: Record<string, BotState>; activity: Record<string, string>; activeChats: Record<string, string>; approvals: Approval[];
        /** Context size in tokens per session key (bot id or conversation chatId), on this machine */
        context?: Record<string, number>;
        /** Waiting jobs per session key and chat, on this machine */
        queues?: Record<string, Record<string, number>>;
        /** Running background tasks per session key */
        background?: Record<string, BackgroundTask[]> }
    /** Running background tasks of a session (botId = session key); empty = none left. */
    | { type: 'background'; botId: string; tasks: BackgroundTask[] }
    /** New context size of a session (botId = session key); 0 after "New session". */
    | { type: 'context'; botId: string; tokens: number }
    | { type: 'history'; chatId: string; entries: HistoryEntry[]; live: LiveTurn[] }
    /** `result` is missing if the entry or tool is unknown. */
    | { type: 'tool_output'; chatId: string; entryId: string; toolId: string; result?: string }
    | { type: 'user'; chatId: string; entry: HistoryEntry }
    | { type: 'read'; chatId: string; id: string; ts: string }
    | { type: 'search_result'; text: string; chatId?: string; hits: SearchHit[] }
    /** A waiting message was moved into the conversation `to`. */
    | { type: 'moved'; chatId: string; entryId: string; to: string }
    /** A waiting message was deleted from the queue. */
    | { type: 'deleted'; chatId: string; entryId: string }
    /** Waiting messages were discarded (stop, new session); the bot will not get them. */
    | { type: 'discarded'; chatId: string; entryIds: string[]; ts: string }
    | { type: 'vscode_sessions'; botId: string; sessions: VscodeSession[] }
    | { type: 'vscode_shown'; chatId: string; ok: boolean; message: string }
    | { type: 'git_changes'; botId: string; repos: GitRepo[] }
    | { type: 'git_commit'; botId: string; path: string; ok: boolean; message: string }
    | { type: 'git_pull'; botId: string; path: string; ok: boolean; message: string }
    /** Open repos per bot, for all bots running on this machine (replaces the machine's previous state); sent on every change. */
    | { type: 'git_status'; status: Record<string, GitRepo[]> }
    /**
     * Backend state: start time, backend code changed since (not empty = restart needed) and a requested restart
     * that is still waiting. Sent on connect and on every change.
     */
    | { type: 'backend_status'; since: string; changed: string[]; requested?: { reason: string; since: string };
        /** PROTOCOL_VERSION and MIN_CLIENT_PROTOCOL of the backend; missing = backend from before (version 0). */
        protocol?: number; minClientProtocol?: number;
        /** Handover targets this machine offers the account; missing = backend from before, which knows only 'ide'. */
        handover?: HandoverTarget[] }
    /**
     * History of a VS Code session: `from` is the index of the first entry; from there the browser replaces its
     * state (everything on open, afterwards only the changed end).
     */
    | { type: 'vscode_history'; sessionId: string; from: number; entries: HistoryEntry[]; working: boolean }
    /** Answer to conversation_new to the requesting browser, which then opens it. */
    | { type: 'conversation_created'; chatId: string }
    /** Pinned messages: one chat after a change, all on connect (chatId missing). */
    | { type: 'pinned'; chatId?: string; entries?: PinnedEntry[]; all?: Record<string, PinnedEntry[]> }
    /** Read state: changed chats, all on connect (`all`). */
    | { type: 'seen'; state: Record<string, SeenEntry>; all?: boolean }
    /** Shared settings (language), on connect and after every change. */
    | { type: 'settings'; settings: SharedSettings }
    | { type: 'delta'; chatId: string; botId: string; text: string }
    | { type: 'tool'; chatId: string; botId: string; tool: ToolCall }
    | { type: 'tool_result'; chatId: string; botId: string; id: string; ok: boolean; result: string; durationMs: number }
    | { type: 'attachment'; chatId: string; botId: string; attachment: Attachment }
    | { type: 'done'; chatId: string; botId: string; entry: HistoryEntry; durationMs: number }
    /** botId: session key as in `bots.states` (bot id or conversation chatId). */
    | { type: 'state'; botId: string; state: BotState; detail?: string; activity?: string; /** chat of the running job */ chatId?: string;
        /** Waiting jobs of this session per chat (empty if none) */ queue?: Record<string, number> }
    | { type: 'approval'; approval: Approval }
    | { type: 'approval_done'; id: string; chatId: string; result: string }
    | { type: 'error'; chatId?: string; botId?: string; message: string; /** for an unknown request its type */ request?: string; code?: MessageCode }
    | { type: 'account'; subscription: string | null; model: string; version: string; apiKeySource: string; /** missing = Claude Code */ engine?: Engine }
    /** Models of the CLI on this machine (queried and stored when the backend starts). */
    | { type: 'models'; models: ModelInfo[] }
    | { type: 'usage'; usage: Usage; /** missing = Claude subscription */ engine?: Engine }
    | { type: 'routines'; routines: Routine[] }
    | { type: 'bot_info'; botId: string; info: BotInfo }
    | { type: 'bot_suggestion'; what: SuggestionRequest['what']; result?: SuggestionResult; error?: string }
    /**
     * `asked`: the folder as sent; `folder`: as this machine stores it; `remote`: its repository's origin; `push`
     * false: git here has no credentials to push there
     */
    | { type: 'folder_checked'; asked: string; ok: boolean; folder?: string; remote?: string; push?: false; message?: string }
    | { type: 'folder_cloned'; url: string; ok: boolean; folder?: string; push?: false; message?: string }
    /** `folder`: where the repository goes; `existing`: a clone of it is there already, saving uses it as it is. */
    | { type: 'folder_proposed'; url: string; ok: boolean; folder?: string; existing?: boolean; message?: string }
    | { type: 'file'; path: string; name: string; mime: string; data: string }
    /** VAPID key for Web Push and the channels this backend can send to ('web', 'apns', 'fcm'; missing = only 'web'). */
    | { type: 'push_key'; publicKey: string; channels?: ('web' | 'apns' | 'fcm')[] }
    | { type: 'push_settings'; settings: PushSettings }
    /** Result of machine_shutdown, to all browsers; `at` = planned time (ISO) when it shuts down or restarts. */
    | { type: 'machine_shutdown_result'; cancel: boolean; ok: boolean; at?: string; message?: string; restart?: boolean }
    /**
     * State of the automatic Windows sign-in, on connect and after every change to all browsers; an error while
     * toggling only to the requesting one. `password`: stored, otherwise it cannot be switched on.
     */
    | { type: 'machine_autologon_status'; ok: boolean; on?: boolean; password?: boolean; message?: string }
    /**
     * What this machine's settings allow (machine settings, AUTOLOGON_METHOD); on every connect of a browser.
     * `restart` missing = older backend, which would shut down instead of restarting.
     */
    | { type: 'machine_capabilities'; shutdown: boolean; shutdownSeconds: number; cancelShutdown: boolean; autologon: boolean; restart?: boolean }
    /**
     * The invitation for one more machine: the link (relay, one-time token, end-to-end key behind '#') and the command
     * to run there. Carries the key, so it only travels encrypted, like "pair_link".
     */
    | { type: 'machine_join_link'; url: string; command: string; expiresAt: string; e2e: boolean }
    /**
     * Settings of this machine, to the main account's browsers on connect and after every change. `anthropicKey`,
     * `gitPushToken`, `engineKeys`: such a secret is stored. `offers`: what this machine can do at all, whatever the settings say (the settings page greys out
     * the rest); `shutdownMethod`: how it shuts down, from the .env.
     */
    | {
        type: 'machine_settings'; settings: MachineSettings; anthropicKey: boolean; gitPushToken: boolean;
        offers: { shutdown: boolean; ide: boolean; terminal: boolean; voice: boolean }; shutdownMethod: string;
        /** Missing from backends before the setup button. */
        voice?: VoiceSetup;
        /** Missing from backends before keys for the other engines. */
        engineKeys?: Partial<Record<KeyEngine, boolean>>;
        /** Claude with 'both' only. */
        keyFallback?: KeyFallbackState;
    }
    | { type: 'pong' }
    /**
     * Pairing link for a new device (`<relay>/#pair=<token>&e2e=<key>`), valid until `expiresAt`, with the QR code
     * as SVG. The link carries the end-to-end key, so it only ever travels encrypted.
     */
    | { type: 'pair_link'; url: string; expiresAt: string; svg: string; /** the link includes the end-to-end key */ e2e: boolean }
    /**
     * What the setup checklist needs from this machine: how it reaches the relay (embedded: only this computer, a
     * phone needs a relay on a server), whether it runs in a container (other commands) and which engines can run here. Sent
     * on connect and on every change.
     */
    | { type: 'setup_status'; relay: 'embedded' | 'remote'; container: boolean; engines: EngineStatuses;
        /** How this account signs in to Claude Code on this machine; missing = the plain `claude` (the machine's owner) */
        claudeCommand?: string;
        /** The backend can open a terminal with Claude Code here for the sign-in ("claude_sign_in") */
        claudeTerminal?: boolean;
        /** Every engine is switched off here (a new installation): the main account picks first */
        noEngine?: boolean;
        /** Git hosts of this machine's bots' repositories that git here cannot push to without asking */
        push?: PushGap[] }
    /**
     * Sign-in with a device code: `code` with the link and the code to enter there, then `done` or `failed`. To all
     * browsers, so the one that started it sees the outcome even after a reconnect.
     */
    | { type: 'engine_login'; engine: DeviceLoginEngine; state: 'code' | 'done' | 'failed'; url?: string; code?: string; message?: string }
    /** The sign-in terminal is open on the machine (to the asking browser only). */
    | { type: 'claude_sign_in' }
    /** The relay is claimed; `url` signs the asking device in there. The backend moves over a moment later. */
    | { type: 'relay_claimed'; url: string }
    | E2eFrame
    /** Backend with E2E_KEY received an unencrypted frame: the browser needs the key. */
    | { type: 'e2e_required' };

// ---- Relay -> web app (produced by the relay itself) ----

export interface MachineStatus {
    active?: boolean;
    speed?: number | null;
    error?: string;
}

export type RelayFrame =
    /** `gone`: machines not connected, with the time (ISO) their backend was last connected. */
    | { type: 'agents'; online: string[]; gone?: Record<string, string> }
    | { type: 'auth'; ok: boolean; message?: string; code?: MessageCode; /** TOTP code needed */ totp?: boolean; /** device logged out, key deleted */ loggedOut?: boolean;
        /** new device key after password login */ device?: { id: string; token: string; name: string };
        /** the account this device belongs to; missing = relay without accounts */ account?: { id: string; name: string; admin: boolean } }
    | { type: 'devices'; list: DeviceInfo[]; current: string }
    /** Whether the second factor is on; `available`: this account may set it (only 'main'). */
    | { type: 'totp'; active: boolean; available: boolean }
    /** The secret being set up, as text and as the address for the QR code. */
    | { type: 'totp_setup'; secret: string; uri: string }
    /** Machines with a token of their own (joined by invitation). */
    | { type: 'machine_tokens'; list: { machine: string; created: string }[] }
    /** All accounts for an admin, otherwise only one's own. */
    | { type: 'accounts'; list: RelayAccount[]; current: string }
    | { type: 'account_created'; account: RelayAccount; pair: { token: string; expiresAt: string } }
    | { type: 'account_invite'; account: RelayAccount; pair: { token: string; expiresAt: string } }
    /**
     * To a device waiting for approval: the id for its QR code, then (with `box`) its sealed pairing link. `first`: the
     * main account has no device yet, so a backend that shows a code in its log may sign this one in ("pair_first").
     */
    | { type: 'pair_wait'; id?: string; expiresAt?: string; box?: PairBox; first?: boolean }
    /**
     * The first device could not be asked for: no device of the main account may exist (`not_first`), a backend of it
     * must be connected (`no_backend`) and show a code (`off`), and one request runs at a time (`busy`).
     */
    | { type: 'pair_first'; ok: false; reason: 'not_first' | 'no_backend' | 'off' | 'busy' }
    /** To the approving device: the waiting device as the relay sees it (name, address, since when). */
    | { type: 'pair_request'; id: string; name: string; ip: string; since: string }
    | { type: 'pair_approved'; id: string }
    | { type: 'machine_status'; configured: boolean; hosts: Record<string, MachineStatus>; at: string; error?: string }
    | { type: 'wake_result'; host: string; ok: boolean; message?: string; code?: MessageCode };

/** Frames from a backend carry the machine name, inserted by the relay. */
export type ServerFrame = (AgentFrame & { machine?: string }) | RelayFrame;

// ---- Backend <-> relay <-> backend (sync and jobs between machines) ----

/** A job for a bot in transferable form (without callback). */
export interface TurnSpec {
    chatId: string;
    content: string | Record<string, unknown>[];
    text: string;
    from: string;
    chain: string[];
    hop: number;
    round?: string;
    roundDone?: string[];
    routineId?: string;
    /** History entry of the message, marked as read when the job starts. */
    entryId?: string;
}

export interface TurnResultData {
    text: string;
    tools: ToolCall[];
    attachments: Attachment[];
    durationMs: number;
    costUsd: number;
    error?: string;
}

export interface Snapshot {
    bots: Bot[];
    groups: Group[];
    routines: Routine[];
    /** Knowledge: fact key '<location>/<name>' (see KnowledgeLocation) -> fact */
    knowledge?: Record<string, KnowledgeFact>;
    /** Deleted items: 'bot:<id>', 'group:<id>', 'routine:<id>', 'knowledge:<location>/<name>' -> time */
    deleted: Record<string, string>;
    push: unknown[];
    pushSettings?: PushSettings;
    settings?: SharedSettings;
    /** The shared API keys; only in encrypted sync (E2E), never otherwise. */
    apiKeys?: { keys: Partial<Record<SharedApiKey, string>>; updatedAt: string };
    /** History per chat (the last entries); missing for pure configuration changes */
    history?: Record<string, HistoryEntry[]>;
    /** Pinned messages per chat */
    pinned?: Record<string, { entries: PinnedEntry[]; updatedAt: string }>;
    /** Read state per chat */
    seen?: Record<string, SeenEntry>;
}

/** Task a bot runs in the background (sub-agent, shell); ends with its process. */
export interface BackgroundTask {
    id: string;
    description: string;
}

/** Hit of the search over all chats. */
export interface SearchHit {
    chatId: string;
    /** Id of the history entry (to jump there) */
    id: string;
    ts: string;
    /** 'me', bot id or 'routine:<name>' */
    from: string;
    /** Text around the hit, truncated */
    excerpt: string;
}

/** Read state of a chat: seen until `until`, or marked unread by hand; newer `updatedAt` wins. */
export interface SeenEntry {
    until?: string;
    unread?: boolean;
    updatedAt: string;
}

/** A pinned message: copy of text and sender, so the bar can show it without a loaded history. */
export interface PinnedEntry {
    /** Id of the history entry */
    id: string;
    text: string;
    ts: string;
    /** 'me' or bot id */
    from: string;
}

export type PeerData =
    | { kind: 'snapshot'; snapshot: Snapshot }
    | { kind: 'history'; chatId: string; entries: HistoryEntry[] }
    | { kind: 'job'; id: string; botId: string; turn: TurnSpec; reply: boolean }
    | { kind: 'job_done'; id: string; result: TurnResultData }
    | { kind: 'restart'; botId: string }
    /** Transcript of a Claude session when switching machines, in chunks (base64); `key` = bot id or conversation chatId. */
    | { kind: 'session_transfer'; botId: string; folder: string; key: string; sessionId: string; part: number; parts: number; data: string }
    | { kind: 'seen'; state: Record<string, SeenEntry> }
    | { kind: 'interrupt'; chatId: string }
    /** A backend pushed commits from the app; the others fetch and fast-forward the repos of their bots. */
    | { kind: 'git_pushed' }
    /** Work not on the git server yet when a bot changes machines (work-transfer.ts), JSON in chunks (base64). */
    | { kind: 'work_transfer'; botId: string; id: string; part: number; parts: number; data: string }
    /** A machine joined by invitation asks for the keys the machines share (local/src/join.ts). */
    | { kind: 'keys_request' }
    /** The shared web push key pair; sent only through encrypted sync. */
    | { kind: 'keys'; vapid: { publicKey: string; privateKey: string } }
    | { kind: 'e2e'; iv: string; data: string };

/**
 * Relay -> backend. `account`: the account a browser or sync belongs to; missing = 'main'. The relay sends other
 * accounts only to backends that sign in with the header X-Accounts: 1, older ones would take them for 'main'.
 */
export type AgentInbound =
    | { cid: string; frame: ClientFrame | E2eFrame; account?: string }
    | { type: 'client_open' | 'client_close'; cid: string; account?: string }
    | { type: 'agents'; online: string[] }
    | { type: 'peer'; from: string; data: PeerData; account?: string }
    /** This machine was just woken; with `routines` for these due routines (shuts down again afterwards). */
    | { type: 'woken'; routines?: { id: string; at: string }[] }
    /** Security warning of the relay (new device, rejected duplicate sign-in): pass on as push. */
    | { type: 'warning'; code: 'new_device' | 'duplicate_agent'; params: Record<string, string>; account?: string }
    /** First message after connecting: what the relay can do for this backend. Older relays send none. */
    | { type: 'relay_hello'; /** app push channels the relay can deliver to (APNS_* / FCM_* set on the relay) */ pushChannels: NativePushChannel[];
        /** the accounts there are and the ones deleted (their data goes); missing = relay without accounts, only 'main' */
        accounts?: string[]; deletedAccounts?: string[] }
    /** An account was deleted: the backend stops its bots and removes its data. */
    | { type: 'account_deleted'; account: string }
    /** An account was created; the backend starts serving it. */
    | { type: 'account_added'; account: string }
    /** Answer to `push`: device tokens the push service no longer knows (app uninstalled); the backend drops them. */
    | { type: 'push_result'; gone: NativePushSubscription[] }
    /**
     * A waiting device (QR sign-in) asks to be the main account's first device, with its public key. The backend
     * answers with the pairing link sealed for that key and the code from its log (first-device.ts), or `error`.
     */
    | { type: 'first_device'; id: string; pk: string };

export type NativePushChannel = 'apns' | 'fcm';

/** Device token of an app installation, as the app registers it with "push_subscribe". */
export interface NativePushSubscription {
    channel: NativePushChannel;
    token: string;
    /** App id (iOS bundle id / Android application id). */
    app?: string;
    /** APNs only: 'sandbox' once production rejected the token (development builds). */
    env?: 'sandbox';
}

/** A notification for the apps, already reduced to what the push service may see (shared setting pushPreview). */
export interface NativePushMessage {
    title: string;
    body: string;
    /** Relative link that opens the chat, e.g. /?chat=cloud */
    url: string;
    tag?: string;
    priority: Exclude<PushPriority, 'off'>;
    ttlSeconds: number;
}

/** Backend -> relay. `account`: missing = 'main'; a frame without `cid` goes to every browser of that account. */
export type AgentOutbound =
    | { frame: AgentFrame; cid?: string; account?: string }
    | { peer: PeerData; to?: string; account?: string }
    /** Planned runs of routines with `wake` (replaces the relay's previous schedule). */
    | { wakeSchedule: WakeEntry[] }
    /**
     * Deliver a notification to apps through the relay's APNs/FCM credentials (a backend without its own). The relay
     * forwards it as it is and stores nothing; it sees what Apple and Google see.
     */
    | { push: { subscriptions: NativePushSubscription[]; message: NativePushMessage } }
    /** Answer to "first_device": the sealed pairing link, or why there is none (no code on this backend). */
    | { firstDevice: { id: string; box?: PairBox; error?: 'off' } };
