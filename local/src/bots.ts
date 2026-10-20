import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { t } from './i18n.ts';
import { readJson, readJsonCached, setTombstone, slug, writeJson } from './store.ts';
import { botIdOf, type ApprovalPolicy, type Bot, type BotInput, type Group, type GroupInput } from '../../shared/protocol.ts';

const POLICIES: ApprovalPolicy[] = ['never', 'risky', 'write'];

/** Session ids belong to this machine (the transcripts live under ~/.claude) and are not synced. */
function loadSessions(): Record<string, string> {
    return { ...readJsonCached<Record<string, string>>('sessions.json', {}) };
}

/** Fresh objects on every call (callers change and save them); the parsed file is cached until it changes. */
export function loadBots(): Bot[] {
    const sessions = loadSessions();
    // Fill in newer fields for older entries; an old sessionId in bots.json counts as this machine's.
    // machineOnly only tells apps before 0.2 that a bot does not move to another machine.
    return readJsonCached<Partial<Bot>[]>('bots.json', []).map((b) => ({
        role: '', approval: 'risky' as ApprovalPolicy, machine: '', updatedAt: b.createdAt ?? '',
        ...b,
        machineOnly: !!b.machine,
        conversations: b.conversations?.map((c) => ({ ...c })),
        sessionId: b.id && b.id in sessions ? sessions[b.id] || undefined : b.sessionId,
    }) as Bot);
}

/** Field of work and role for prompts, e.g. "Research, web research"; empty if neither is set. */
export function roleLine(b: Pick<Bot, 'area' | 'role'>): string {
    return [b.area, b.role].filter(Boolean).join(', ');
}

/** Saves the bots without session ids (those live in sessions.json). */
export function saveBots(bots: Bot[]): void {
    writeJson('bots.json', bots.map(({ sessionId: _s, ...rest }) => rest));
}

/** Whether `from` may give `to` a job with message_bot (the user's choice in the bot's settings). */
export function mayMessage(from: Pick<Bot, 'canMessage'>, to: Pick<Bot, 'id'>): boolean {
    return !from.canMessage || from.canMessage.includes(to.id);
}

export function findBot(id: string): Bot | undefined {
    return loadBots().find((b) => b.id === id);
}

/** Checks the folder: must exist and lie under an allowed root folder. */
export function checkFolder(folder: string): string {
    const abs = path.resolve(folder);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        throw new Error(t('bots.folderMissing', { folder: abs }));
    }
    if (!underAllowedRoot(abs)) throw new Error(t('bots.folderNotAllowed', { roots: config.allowedRoots.join(', '), folder: abs }));
    return abs.replace(/\\/g, '/');
}

export function underAllowedRoot(abs: string): boolean {
    return config.allowedRoots.some((root) => isUnder(abs, root));
}

/**
 * Absolute path with junctions and symbolic links resolved, so a link inside an allowed folder cannot point out of
 * it. For a path that does not exist (yet), its nearest existing parent is resolved.
 */
export function realPath(p: string): string {
    const abs = path.resolve(p);
    try {
        return fs.realpathSync.native(abs);
    } catch {
        const parent = path.dirname(abs);
        return parent === abs ? abs : path.join(realPath(parent), path.basename(abs));
    }
}

export function isUnder(p: string, root: string): boolean {
    const rel = path.relative(realPath(root), realPath(p));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The folder of a bot that lives on another machine: only that machine can check a folder, so here it may only stay
 * as it is (apps before 0.2 move bots this way). That machine checks it again before every run.
 */
function folderElsewhere(existing: Bot | undefined, folder: string, machine: string): string {
    if (existing && existing.folder === folder.trim().replace(/\\/g, '/')) return existing.folder;
    throw new Error(t('bots.folderElsewhere', { machine: machine.toUpperCase() }));
}

export function saveBot(input: BotInput): Bot {
    const bots = loadBots();
    const before = input.id ? bots.find((b) => b.id === input.id) : undefined;
    // A bot lives on one machine; without a choice (apps before 0.2) it stays where it is, a new one lives here
    const machine = (input.machine ?? '').trim().toLowerCase() || before?.machine || config.machine;
    const folder = machine === config.machine ? checkFolder(input.folder) : folderElsewhere(before, input.folder, machine);
    let id = input.id;
    if (!id) {
        const base = slug(input.name || folder.split('/').findLast(Boolean)!);
        id = base;
        for (let i = 2; bots.some((b) => b.id === id); i++) id = `${base}-${i}`;
    }
    const existing = bots.find((b) => b.id === id);
    const now = new Date().toISOString();
    const bot: Bot = {
        id,
        name: input.name.trim() || id,
        area: (input.area ?? '').trim() || undefined,
        role: (input.role ?? '').trim(),
        folder,
        model: input.model || 'default',
        tone: input.tone ?? '',
        avatar: input.avatar ?? '',
        approval: POLICIES.includes(input.approval) ? input.approval : 'risky',
        canMessage: input.canMessage === undefined ? existing?.canMessage
            : input.canMessage === null ? undefined : [...new Set(input.canMessage)].filter((b) => b !== id && bots.some((x) => x.id === b)),
        machine,
        machineOnly: true,
        // Favorite and mute are only set by their own frames; editing leaves them as they are
        favorite: existing?.favorite || undefined,
        muted: existing?.muted || undefined,
        sessionId: existing?.sessionId,
        conversations: existing?.conversations,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    // Other folder: old sessions no longer fit (including those of the conversations; the transcripts live per
    // folder). Another model continues the same session. A bot leaving this machine keeps them until they are
    // handed over (session-transfer.ts).
    if (existing && existing.folder !== bot.folder && !(existing.machine === config.machine && machine !== config.machine)) {
        bot.sessionId = undefined;
        setSessionId(id, undefined);
        for (const c of bot.conversations ?? []) setSessionId(`${id}~${c.id}`, undefined);
    }
    if (existing) bots[bots.indexOf(existing)] = bot;
    else bots.push(bot);
    saveBots(bots);
    return bot;
}

/** `id`: bot id (main chat) or chatId of a conversation. */
export function setSessionId(id: string, sessionId: string | undefined): void {
    const sessions = loadSessions();
    if (sessionId) sessions[id] = sessionId;
    else sessions[id] = '';
    writeJson('sessions.json', sessions);
}

export function readSessionId(id: string): string | undefined {
    return loadSessions()[id] || undefined;
}

/** All session ids of the bots on this machine (main chats and conversations). */
export function botSessionIds(): Set<string> {
    return new Set(Object.values(loadSessions()).filter(Boolean));
}

// ---- Conversations ----

function botOrThrow(bots: Bot[], botId: string): Bot {
    const b = bots.find((x) => x.id === botId);
    if (!b) throw new Error(t('bots.botNotFound'));
    return b;
}

/** Creates another conversation and returns its chatId. */
export function createConversation(botId: string): string {
    const bots = loadBots();
    const b = botOrThrow(bots, botId);
    const list = b.conversations ?? [];
    let id: string;
    do id = randomBytes(4).toString('hex'); while (list.some((c) => c.id === id));
    const now = new Date().toISOString();
    b.conversations = [...list, { id, title: '', createdAt: now }];
    b.updatedAt = now;
    saveBots(bots);
    return `${botId}~${id}`;
}

export function findConversation(chatId: string): { bot: Bot; title: string } | undefined {
    const [botId, id] = chatId.split('~');
    const bot = findBot(botId);
    const c = bot?.conversations?.find((x) => x.id === id);
    return bot && c ? { bot, title: c.title } : undefined;
}

export function renameConversation(chatId: string, title: string): void {
    const [botId, id] = chatId.split('~');
    const bots = loadBots();
    const b = bots.find((x) => x.id === botId);
    const c = b?.conversations?.find((x) => x.id === id);
    if (!b || !c) throw new Error(t('bots.conversationNotFound'));
    c.title = title.trim().slice(0, 60);
    b.updatedAt = new Date().toISOString();
    saveBots(bots);
}

/** Set the model of a chat (main chat: the bot, conversation: only that one); the sessions stay. */
export function setModel(chatId: string, model: string): Bot {
    const m = model.trim();
    if (!/^[a-z0-9][a-z0-9.:/\-[\]]{0,79}$/i.test(m)) throw new Error(t('bots.invalidModel', { model }));
    const [botId, id] = chatId.split('~');
    const bots = loadBots();
    const b = botOrThrow(bots, botId);
    if (id) {
        const c = b.conversations?.find((x) => x.id === id);
        if (!c) throw new Error(t('bots.conversationNotFound'));
        c.model = m;
    } else {
        b.model = m;
    }
    b.updatedAt = new Date().toISOString();
    saveBots(bots);
    return b;
}

/** Archive or restore; the session id stays, restored it continues with the old context. */
export function archiveConversation(chatId: string, on: boolean): void {
    const [botId, id] = chatId.split('~');
    const bots = loadBots();
    const b = bots.find((x) => x.id === botId);
    const c = b?.conversations?.find((x) => x.id === id);
    if (!b || !c) throw new Error(t('bots.conversationNotFound'));
    if (on) c.archived = new Date().toISOString();
    else delete c.archived;
    b.updatedAt = new Date().toISOString();
    saveBots(bots);
}

export function removeConversation(chatId: string): void {
    const [botId, id] = chatId.split('~');
    const bots = loadBots();
    const b = bots.find((x) => x.id === botId);
    if (!b || !b.conversations?.some((c) => c.id === id)) throw new Error(t('bots.conversationNotFound'));
    b.conversations = b.conversations.filter((c) => c.id !== id);
    if (b.conversations.length === 0) b.conversations = undefined;
    b.updatedAt = new Date().toISOString();
    saveBots(bots);
    setSessionId(chatId, undefined);
    setTombstone(`chat:${chatId}`);
}

export function deleteBot(id: string): void {
    saveBots(loadBots().filter((b) => b.id !== id));
    setTombstone(`bot:${id}`);
    // remove from groups
    const now = new Date().toISOString();
    writeJson('groups.json', loadGroups().map((g) => (g.members.includes(id) ? { ...g, members: g.members.filter((m) => m !== id), updatedAt: now } : g)));
}

// ---- Groups ----

export function loadGroups(): Group[] {
    return readJson<Partial<Group>[]>('groups.json', []).map((g) => ({ updatedAt: g.createdAt ?? '', ...g }) as Group);
}

export function findGroup(id: string): Group | undefined {
    return loadGroups().find((g) => g.id === id);
}

export function saveGroup(input: GroupInput): Group {
    const groups = loadGroups();
    const bots = new Set(loadBots().map((b) => b.id));
    const members = [...new Set(input.members)].filter((m) => bots.has(m));
    if (members.length < 2) throw new Error(t('bots.groupTooSmall'));
    let id = input.id;
    if (!id) {
        const base = slug(input.name || 'group');
        id = base;
        for (let i = 2; groups.some((g) => g.id === id); i++) id = `${base}-${i}`;
    }
    const existing = groups.find((g) => g.id === id);
    const now = new Date().toISOString();
    const group: Group = {
        id,
        name: input.name.trim() || id,
        avatar: input.avatar ?? '',
        members,
        favorite: existing?.favorite || undefined,
        muted: existing?.muted || undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    if (existing) groups[groups.indexOf(existing)] = group;
    else groups.push(group);
    writeJson('groups.json', groups);
    return group;
}

/** Mark a bot or group (chatId 'g:<id>') as favorite or remove the mark. */
export function setFavorite(chatId: string, on: boolean): void {
    setFlag(chatId, 'favorite', on);
}

/** Mute a bot or group for push (answers and routines; approvals still arrive). */
export function setMuted(chatId: string, on: boolean): void {
    setFlag(chatId, 'muted', on);
}

/** Whether answers of this chat stay without push. */
export function isMuted(chatId: string): boolean {
    return chatId.startsWith('g:') ? Boolean(findGroup(chatId.slice(2))?.muted) : Boolean(findBot(botIdOf(chatId))?.muted);
}

function setFlag(chatId: string, field: 'favorite' | 'muted', on: boolean): void {
    const now = new Date().toISOString();
    if (chatId.startsWith('g:')) {
        const groups = loadGroups();
        const g = groups.find((x) => x.id === chatId.slice(2));
        if (!g) throw new Error(t('bots.groupNotFound'));
        g[field] = on || undefined;
        g.updatedAt = now;
        saveGroups(groups);
        return;
    }
    const bots = loadBots();
    const b = botOrThrow(bots, botIdOf(chatId));
    b[field] = on || undefined;
    b.updatedAt = now;
    saveBots(bots);
}

export function saveGroups(groups: Group[]): void {
    writeJson('groups.json', groups);
}

export function deleteGroup(id: string): void {
    writeJson('groups.json', loadGroups().filter((g) => g.id !== id));
    setTombstone(`group:${id}`);
}
