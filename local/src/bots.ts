import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { t } from './i18n.ts';
import { personChat } from './people.ts';
import { rememberable } from './policy.ts';
import { readJson, readJsonCached, setTombstone, slug, writeJson } from './store.ts';
import { BOT_VOICES, botIdOf, type ApprovalPolicy, type Bot, type BotInput, type BotPlace, type BotVoice, type Category, type CategoryInput, type Group, type GroupInput } from '../../shared/protocol.ts';

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

/** A folder outside the allowed root folders; carries both, so the app can show them without reading the message. */
export class FolderNotAllowed extends Error {
    readonly folder: string;
    readonly roots: string[];

    constructor(folder: string) {
        super(t('bots.folderNotAllowed', { roots: config.allowedRoots.join(', '), folder }));
        this.folder = folder.replace(/\\/g, '/');
        this.roots = config.allowedRoots.map((r) => r.replace(/\\/g, '/'));
    }
}

/** The refused folder and the allowed ones for an answer to the app, when `e` is such a refusal. */
export const refusalOf = (e: unknown): { refused: { folder: string; roots: string[] } } | Record<string, never> =>
    e instanceof FolderNotAllowed ? { refused: { folder: e.folder, roots: e.roots } } : {};

/** Checks the folder: must exist and lie under an allowed root folder. */
export function checkFolder(folder: string): string {
    const abs = path.resolve(folder);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        throw new Error(t('bots.folderMissing', { folder: abs }));
    }
    if (!underAllowedRoot(abs)) throw new FolderNotAllowed(abs);
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
        // '' = guess from the name; an app without the field leaves it as it is
        voice: input.voice === undefined ? existing?.voice : BOT_VOICES.includes(input.voice as BotVoice) ? input.voice as BotVoice : undefined,
        // '' = no folder; an app without the field leaves it as it is
        category: input.category === undefined ? existing?.category : knownCategory(input.category),
        // The editor can only take tools off the list; they come onto it from an approval card (allowTool)
        allowedTools: input.allowedTools === undefined ? existing?.allowedTools : toolList(input.allowedTools.filter((tool) => existing?.allowedTools?.includes(tool))),
        canMessage: input.canMessage === undefined ? existing?.canMessage
            : input.canMessage === null ? undefined : [...new Set(input.canMessage)].filter((b) => b !== id && bots.some((x) => x.id === b)),
        machine,
        machineOnly: true,
        // '' takes the contact off; an app without the field leaves it as it is
        contact: input.contact === undefined || input.contact === null ? existing?.contact : (String(input.contact).trim().toLowerCase() || undefined),
        // Written down by the bot's machine (setPlace); another folder needs a new one
        place: existing?.folder === folder ? existing.place : undefined,
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

/**
 * Writes down the place of a bot's folder (Bot.place) if the bot still has that folder; true if it changed. The
 * place travels with the bot to the other machines.
 */
export function setPlace(botId: string, folder: string, place: BotPlace | undefined): boolean {
    const bots = loadBots();
    const b = bots.find((x) => x.id === botId);
    if (!b || b.folder !== folder || JSON.stringify(b.place) === JSON.stringify(place)) return false;
    if (place) b.place = place;
    else delete b.place;
    b.updatedAt = new Date().toISOString();
    saveBots(bots);
    return true;
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
        category: input.category === undefined ? existing?.category : knownCategory(input.category),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    if (existing) groups[groups.indexOf(existing)] = group;
    else groups.push(group);
    writeJson('groups.json', groups);
    return group;
}

/** Mark a bot or group (chatId 'g:<id>') as favorite or remove the mark. */
const toolList = (tools: string[]): string[] | undefined => {
    const list = [...new Set(tools)].filter(rememberable).sort();
    return list.length ? list : undefined;
};

/** "Always for this bot" on an approval card: the tool no longer asks for this bot, on every machine. */
export function allowTool(botId: string, tool: string): Bot {
    const bots = loadBots();
    const bot = bots.find((b) => b.id === botId);
    if (!bot) throw new Error(t('bots.botNotFound'));
    bot.allowedTools = toolList([...(bot.allowedTools ?? []), tool]);
    bot.updatedAt = new Date().toISOString();
    saveBots(bots);
    return bot;
}

export function setFavorite(chatId: string, on: boolean): void {
    setFlag(chatId, 'favorite', on);
}

/** Mute a bot or group for push (answers and routines; approvals still arrive). */
export function setMuted(chatId: string, on: boolean): void {
    setFlag(chatId, 'muted', on);
}

/** Whether answers of this chat stay without push. */
export function isMuted(chatId: string): boolean {
    if (chatId.startsWith('p:')) return Boolean(personChat(chatId.slice(2))?.muted);
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

// ---- Categories: the folders of the chat list ----

export function loadCategories(): Category[] {
    return readJson<Partial<Category>[]>('categories.json', []).map((c) => ({ updatedAt: c.createdAt ?? '', ...c }) as Category);
}

export function saveCategories(categories: Category[]): void {
    writeJson('categories.json', categories);
}

/** A folder id that exists; anything else means none. */
function knownCategory(id: string | undefined): string | undefined {
    return id && loadCategories().some((c) => c.id === id) ? id : undefined;
}

/** Creates (empty id) or renames a folder; `chatId`: a bot or group that goes into it right away. */
export function saveCategory(input: CategoryInput, chatId?: string): Category {
    const categories = loadCategories();
    let id = input.id;
    if (!id) {
        const base = slug(input.name) || 'folder';
        id = base;
        for (let i = 2; categories.some((c) => c.id === id); i++) id = `${base}-${i}`;
    }
    const existing = categories.find((c) => c.id === id);
    if (input.id && !existing) throw new Error(t('bots.categoryNotFound'));
    const now = new Date().toISOString();
    const category: Category = { id, name: input.name.trim() || id, createdAt: existing?.createdAt ?? now, updatedAt: now };
    if (existing) categories[categories.indexOf(existing)] = category;
    else categories.push(category);
    saveCategories(categories);
    if (chatId) setCategory(chatId, id);
    return category;
}

/** Removes a folder; the bots and groups in it stay, without one (their change syncs with them). */
export function deleteCategory(id: string): void {
    saveCategories(loadCategories().filter((c) => c.id !== id));
    setTombstone(`category:${id}`);
    const now = new Date().toISOString();
    const bots = loadBots();
    if (bots.some((b) => b.category === id)) saveBots(bots.map((b) => (b.category === id ? { ...b, category: undefined, updatedAt: now } : b)));
    const groups = loadGroups();
    if (groups.some((g) => g.category === id)) saveGroups(groups.map((g) => (g.category === id ? { ...g, category: undefined, updatedAt: now } : g)));
}

/** Puts a bot or group (chatId 'g:<id>') into a folder; '' takes it out. */
export function setCategory(chatId: string, categoryId: string): void {
    const value = categoryId || undefined;
    if (value && !loadCategories().some((c) => c.id === value)) throw new Error(t('bots.categoryNotFound'));
    const now = new Date().toISOString();
    if (chatId.startsWith('g:')) {
        const groups = loadGroups();
        const g = groups.find((x) => x.id === chatId.slice(2));
        if (!g) throw new Error(t('bots.groupNotFound'));
        g.category = value;
        g.updatedAt = now;
        saveGroups(groups);
        return;
    }
    const bots = loadBots();
    const b = botOrThrow(bots, botIdOf(chatId));
    b.category = value;
    b.updatedAt = now;
    saveBots(bots);
}
