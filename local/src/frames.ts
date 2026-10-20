// Checks the frames of web apps and mobile apps before the backend acts on them.
// Clients update at their own pace (app stores), so a frame may come from an older or newer client or be malformed;
// it is answered with a clear error instead of failing somewhere inside. Valid frames are passed on unchanged
// (unknown extra fields are kept), so newer clients may add optional fields.

import { z } from 'zod';
import {
    AFTER_WAKE, AVATAR_MODELS, CLAUDE_AUTH_MODES, CLAUDE_FALLBACK, DEVICE_LOGIN_ENGINES, ENGINE_AUTH_MODES, HANDOVER_TARGETS, KEY_ENGINES, KNOWLEDGE_TYPES, LANGUAGES, MACHINE_SETTINGS_MAX,
    OTHER_ENGINES, PUSH_PREVIEWS, VOICE_DEVICES, VOICE_MODELS, type ClientFrame, type PeerData,
} from '../../shared/protocol.ts';

const str = z.string();
const id = z.string().min(1).max(200);
const loose = z.looseObject;

const pushKind = z.enum(['done', 'routine', 'approval', 'awake', 'limit']);
const pushPriority = z.enum(['off', 'quiet', 'normal', 'high']);
const knowledgeLocation = loose({ scope: z.enum(['bot', 'folder', 'group', 'all']), key: str });
const quote = loose({ id: str, from: str, text: str });
const upload = loose({ name: str, type: str, data: str, thumb: str.optional(), durationMs: z.number().optional() });
const pinnedEntry = loose({ id, text: str, ts: str, from: str });
const seenEntry = loose({ until: str.nullish(), unread: z.boolean().optional(), updatedAt: str });

/** `id` is empty for a new bot or group. */
const botInput = loose({
    id: str, name: str, area: str.optional(), role: str.optional(), folder: str, model: str.optional(), tone: str.optional(), avatar: str.nullish(),
    approval: z.enum(['never', 'risky', 'write']).optional(), favorite: z.boolean().optional(), muted: z.boolean().optional(),
    machine: str.optional(), machineOnly: z.boolean().optional(), canMessage: z.array(str).nullish(),
});
const groupInput = loose({ id: str, name: str, avatar: str.nullish(), members: z.array(str), favorite: z.boolean().optional(), muted: z.boolean().optional() });
const routineInput = loose({ id: str, botId: id, name: str, cron: str, prompt: str, enabled: z.boolean(), wake: z.boolean().optional() });
const suggestion = loose({
    what: z.enum(['name', 'role', 'avatar']), folder: str, name: str, area: str.optional(), role: str, tone: str, model: str, previous: z.array(str).optional(),
});
const fact = loose({ name: str, description: str, type: z.enum(KNOWLEDGE_TYPES), text: str });
/** Web Push subscription of a browser, or the device token of an app (APNs on iOS, FCM on Android). */
const pushSubscription = z.union([
    loose({ endpoint: str, keys: loose({ p256dh: str, auth: str }) }),
    loose({ channel: z.enum(['apns', 'fcm']), token: z.string().min(8).max(4096), app: str.optional() }),
]);

/** An API key as typed in; '' removes the stored one. */
const apiKey = z.string().max(500);
const upTo = (max: number) => z.number().int().min(0).max(max);
const sharedSettings = loose({
    language: z.enum(LANGUAGES).optional(), avatarModel: z.enum(AVATAR_MODELS).optional(), voiceLanguage: z.enum(['', ...LANGUAGES]).optional(),
    gitAutoPull: z.boolean().optional(), pushPreview: z.enum(PUSH_PREVIEWS).optional(),
});
/** One optional value per engine that can run on a key. */
const perKeyEngine = <T extends z.ZodType>(value: T) => loose(Object.fromEntries(KEY_ENGINES.map((e) => [e, value.optional()])) as Record<(typeof KEY_ENGINES)[number], z.ZodOptional<T>>);
const machineSettings = loose({
    claudeAuth: z.enum(CLAUDE_AUTH_MODES).optional(), engineAuth: perKeyEngine(z.enum(ENGINE_AUTH_MODES)).optional(),
    claudeFallback: z.enum(CLAUDE_FALLBACK).optional(), claudeKeyBudgetUsd: upTo(MACHINE_SETTINGS_MAX.claudeKeyBudgetUsd).optional(),
    disabledEngines: z.array(z.enum(['claude', ...OTHER_ENGINES])).max(OTHER_ENGINES.length + 1).optional(), shutdown: z.boolean().optional(),
    shutdownDelaySeconds: upTo(MACHINE_SETTINGS_MAX.shutdownDelaySeconds).optional(), afterWake: z.enum(AFTER_WAKE).optional(),
    afterWakeSeconds: upTo(MACHINE_SETTINGS_MAX.afterWakeSeconds).optional(), afterWakeWaitMinutes: upTo(MACHINE_SETTINGS_MAX.afterWakeWaitMinutes).optional(),
    idleMinutes: upTo(MACHINE_SETTINGS_MAX.idleMinutes).optional(), handoverIde: z.boolean().optional(), handoverTerminal: z.boolean().optional(),
    voiceModel: z.enum(VOICE_MODELS).optional(), voiceDevice: z.enum(VOICE_DEVICES).optional(), voicePreload: z.boolean().optional(),
    gitPushUser: z.string().max(200).optional(), gitPushHost: z.string().max(253).regex(/^[a-z0-9.:-]*$/i).optional(),
});

const frame = <T extends string, S extends z.core.$ZodLooseShape>(type: T, shape: S = {} as S) => loose({ type: z.literal(type), ...shape });

/** One schema per frame type; the compiler checks that the list matches ClientFrame exactly. */
const SCHEMAS = {
    bots: frame('bots'),
    bot_save: frame('bot_save', { bot: botInput }),
    bot_delete: frame('bot_delete', { botId: id }),
    bot_suggest: frame('bot_suggest', { request: suggestion }),
    folder_check: frame('folder_check', { folder: z.string().min(1).max(1000) }),
    folder_clone: frame('folder_clone', { url: z.string().min(1).max(1000), folder: z.string().min(1).max(1000).optional() }),
    folder_propose: frame('folder_propose', { url: z.string().min(1).max(1000) }),
    group_save: frame('group_save', { group: groupInput }),
    group_delete: frame('group_delete', { groupId: id }),
    favorite: frame('favorite', { chatId: id, on: z.boolean() }),
    mute: frame('mute', { chatId: id, on: z.boolean() }),
    push_settings: frame('push_settings', { kinds: z.partialRecord(pushKind, pushPriority) }),
    language: frame('language', { language: z.enum(LANGUAGES) }),
    settings_save: frame('settings_save', { settings: sharedSettings, apiKeys: loose({ gemini: apiKey.optional(), openai: apiKey.optional() }).optional() }),
    history: frame('history', { chatId: id, limit: z.number().int().positive().optional() }),
    tool_output: frame('tool_output', { chatId: id, entryId: str, toolId: str }),
    send: frame('send', { chatId: id, text: str, attachments: z.array(upload).optional(), replyTo: quote.optional() }),
    interrupt: frame('interrupt', { chatId: id }),
    restart: frame('restart', { botId: id, chatId: id.optional() }),
    conversation_new: frame('conversation_new', { botId: id }),
    conversation_rename: frame('conversation_rename', { chatId: id, title: str }),
    model: frame('model', { chatId: id, model: str }),
    conversation_delete: frame('conversation_delete', { chatId: id }),
    conversation_archive: frame('conversation_archive', { chatId: id, on: z.boolean() }),
    search: frame('search', { text: str, chatId: id.optional() }),
    queue_to_conversation: frame('queue_to_conversation', { chatId: id, entryId: str }),
    queue_delete: frame('queue_delete', { chatId: id, entryId: str }),
    pin: frame('pin', { chatId: id, entry: pinnedEntry, on: z.boolean() }),
    seen: frame('seen', { state: z.record(str, seenEntry) }),
    vscode_sessions: frame('vscode_sessions', { botId: id }),
    vscode_open: frame('vscode_open', { botId: id, sessionId: id, folder: str.optional() }),
    vscode_close: frame('vscode_close', { sessionId: id }),
    vscode_adopt: frame('vscode_adopt', { botId: id, sessionId: id, folder: str.optional() }),
    vscode_show: frame('vscode_show', { chatId: id, target: z.enum(HANDOVER_TARGETS).optional() }),
    git_changes: frame('git_changes', { botId: id }),
    git_commit: frame('git_commit', { botId: id, path: str, message: str }),
    git_pull: frame('git_pull', { botId: id, path: str }),
    work_take: frame('work_take', { botId: id, machine: id, folder: str }),
    backend_restart: frame('backend_restart'),
    approval_reply: frame('approval_reply', {
        id, allow: z.boolean(), always: z.boolean().optional(), answers: z.record(str, str).optional(), message: str.optional(),
    }),
    routines: frame('routines'),
    routine_save: frame('routine_save', { routine: routineInput }),
    routine_delete: frame('routine_delete', { id }),
    routine_run: frame('routine_run', { id }),
    bot_info: frame('bot_info', { botId: id }),
    knowledge_save: frame('knowledge_save', { botId: id, location: knowledgeLocation, fact, oldName: str.optional() }),
    knowledge_delete: frame('knowledge_delete', { botId: id, location: knowledgeLocation, name: str }),
    file_get: frame('file_get', { path: z.string().min(1) }),
    push_subscribe: frame('push_subscribe', { subscription: pushSubscription }),
    pair_link: frame('pair_link', { token: str.max(200).optional(), expiresAt: str.max(40).optional() }),
    engine_login: frame('engine_login', { engine: z.enum(DEVICE_LOGIN_ENGINES) }),
    claude_sign_in: frame('claude_sign_in'),
    relay_claim: frame('relay_claim', { address: z.string().min(1).max(300), code: z.string().min(1).max(100) }),
    presence: frame('presence', { visible: z.boolean() }),
    voice_warmup: frame('voice_warmup'),
    machine_shutdown: frame('machine_shutdown', { cancel: z.boolean().optional(), inSeconds: z.number().nonnegative().optional(), restart: z.boolean().optional() }),
    machine_autologon: frame('machine_autologon', { on: z.boolean().optional() }),
    voice_setup: frame('voice_setup'),
    machine_join_link: frame('machine_join_link'),
    machine_settings_save: frame('machine_settings_save', {
        settings: machineSettings, anthropicKey: apiKey.optional(), gitPushToken: apiKey.optional(), engineKeys: perKeyEngine(apiKey).optional(),
    }),
    ping: frame('ping'),
} satisfies { [K in ClientFrame['type']]: z.ZodType };

export type FrameCheck = { ok: true; frame: ClientFrame } | { ok: false; type: string; unknown: boolean; problem: string };

/** Checks a decrypted frame of a browser or app. */
export function checkClientFrame(input: unknown): FrameCheck {
    const type = typeof input === 'object' && input !== null && typeof (input as { type?: unknown }).type === 'string'
        ? (input as { type: string }).type : '';
    const schema = Object.hasOwn(SCHEMAS, type) ? SCHEMAS[type as keyof typeof SCHEMAS] : undefined;
    if (!schema) return { ok: false, type, unknown: true, problem: type ? 'unknown frame type' : 'no frame type' };
    const r = schema.safeParse(input);
    if (r.success) return { ok: true, frame: input as ClientFrame };
    const issue = r.error.issues[0];
    return { ok: false, type, unknown: false, problem: `${issue.path.join('.') || type}: ${issue.message}` };
}

// ------------------------------------------------------------------ Between backends

// Peer data comes from another backend of the same user, which may run older or newer code; a malformed snapshot or
// job must not end up in bots.json or start a session. The schemas check what the receiver relies on and keep the rest.
const toolCall = loose({ id: str, name: str });
const attachment = loose({ name: str, type: str, size: z.number(), path: str });
const historyEntry = loose({ id: str.optional(), role: z.enum(['user', 'assistant', 'event']), text: str, ts: str });
const record = loose({ id, updatedAt: str.optional() });
const peerBot = loose({ id, name: str, folder: str, updatedAt: str.optional() });
const turnSpec = loose({
    chatId: id, content: z.union([str, z.array(loose({}))]), text: str, from: str, chain: z.array(str), hop: z.number().int().min(0),
});
const turnResult = loose({ text: str, tools: z.array(toolCall), attachments: z.array(attachment), durationMs: z.number(), costUsd: z.number(), error: str.optional() });
const peer = <K extends string, S extends z.core.$ZodLooseShape>(kind: K, shape: S = {} as S) => loose({ kind: z.literal(kind), ...shape });

const PEER_SCHEMAS = {
    snapshot: peer('snapshot', {
        snapshot: loose({
            bots: z.array(peerBot), groups: z.array(record), routines: z.array(record), deleted: z.record(str, str), push: z.array(z.unknown()),
            knowledge: z.record(str, loose({})).optional(), history: z.record(str, z.array(historyEntry)).optional(),
            pinned: z.record(str, loose({ entries: z.array(pinnedEntry), updatedAt: str })).optional(), seen: z.record(str, seenEntry).optional(),
            apiKeys: loose({ keys: z.record(str, str), updatedAt: str }).optional(),
        }),
    }),
    history: peer('history', { chatId: id, entries: z.array(historyEntry) }),
    job: peer('job', { id, botId: id, turn: turnSpec, reply: z.boolean() }),
    job_done: peer('job_done', { id, result: turnResult }),
    restart: peer('restart', { botId: id }),
    session_transfer: peer('session_transfer', {
        botId: id, folder: str, key: id, sessionId: id, part: z.number().int().min(0), parts: z.number().int().positive(), data: str,
    }),
    seen: peer('seen', { state: z.record(str, seenEntry) }),
    interrupt: peer('interrupt', { chatId: id }),
    git_pushed: peer('git_pushed'),
    work_transfer: peer('work_transfer', { botId: id, id, part: z.number().int().min(0), parts: z.number().int().positive(), data: str }),
    keys_request: peer('keys_request'),
    keys: peer('keys', { vapid: loose({ publicKey: z.string().min(20).max(200), privateKey: z.string().min(20).max(200) }) }),
    e2e: peer('e2e', { iv: str, data: str }),
} satisfies { [K in PeerData['kind']]: z.ZodType };

export type PeerCheck = { ok: true; data: PeerData } | { ok: false; kind: string; problem: string };

/** Check of peer data from another backend (after decrypting and migrating); valid data is passed on unchanged. */
export function checkPeerData(input: unknown): PeerCheck {
    const kind = typeof input === 'object' && input !== null && typeof (input as { kind?: unknown }).kind === 'string'
        ? (input as { kind: string }).kind : '';
    const schema = Object.hasOwn(PEER_SCHEMAS, kind) ? PEER_SCHEMAS[kind as keyof typeof PEER_SCHEMAS] : undefined;
    if (!schema) return { ok: false, kind, problem: kind ? 'unknown kind' : 'no kind' };
    const r = schema.safeParse(input);
    if (r.success) return { ok: true, data: input as PeerData };
    const issue = r.error.issues[0];
    return { ok: false, kind, problem: `${issue.path.join('.') || kind}: ${issue.message}` };
}
