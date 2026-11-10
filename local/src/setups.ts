// Setups of accounts by an admin (setup links): the admin keeps per account the bots it should have (name, role,
// repository, approval level) and a token per bot; the account's machine, bound to it by the setup link, gets the
// setup through the person route and makes the bots from it. The admin changes them later the same way; the account
// itself cannot change or delete them (Bot.managed).
//
// Each bot gets a clone of its own, with its token in the repository's git settings as a credential helper that reads
// a file of the account's data folder, never the address or .git/config itself: a support bot with a read token and
// a developer bot with a write token on the same repository stay apart, and a bot that reads its folder finds no token.
// The file names contain "credentials", which the bots' file tools and shell commands are refused (policy.ts).

import fs from 'node:fs';
import path from 'node:path';
import { saveBot, findBot, loadBots } from './bots.ts';
import { config } from './config.ts';
import { botRoot, cloneName } from './folders.ts';
import { fastForward, git } from './git.ts';
import { accountPath, PRIVATE, readJson, writeJson } from './store.ts';
import type { AccountSetup, AccountSetupInput, AccountSetupView, Bot, PeerData } from '../../shared/protocol.ts';

const FILE = 'setups.json';
/** The tokens per account and bot key; apart from the setups, which go to browsers without them. */
const TOKENS = 'setup-credentials.json';

type Tokens = Record<string, Record<string, string>>;

// ------------------------------------------------------------------ The admin's side

export function loadSetups(): AccountSetup[] {
    return readJson<AccountSetup[]>(FILE, []).filter((s) => s && typeof s.account === 'string' && Array.isArray(s.bots));
}

export function setupViews(): AccountSetupView[] {
    const tokens = readJson<Tokens>(TOKENS, {});
    return loadSetups().map((s) => ({ ...s, bots: s.bots.map((b) => ({ ...b, token: Boolean(tokens[s.account]?.[b.key]) })) }));
}

/** Stores a setup; a token '' keeps the one stored for that bot key. */
export function saveSetup(input: AccountSetupInput): AccountSetup {
    const all = readJson<Tokens>(TOKENS, {});
    const old = all[input.account] ?? {};
    const tokens: Record<string, string> = {};
    for (const b of input.bots) {
        const t = b.token.trim() || old[b.key];
        if (t) tokens[b.key] = t;
    }
    const setup: AccountSetup = {
        account: input.account, handover: input.handover, updatedAt: new Date().toISOString(),
        bots: input.bots.map(({ token: _t, ...b }) => ({
            key: b.key, name: b.name.trim(), role: b.role.trim(), tone: b.tone, approval: b.approval, repo: b.repo.trim(), gitUser: b.gitUser.trim(),
            ...(b.model ? { model: b.model } : {}),
        })),
    };
    writeJson(FILE, [...loadSetups().filter((s) => s.account !== setup.account), setup]);
    writeJson(TOKENS, { ...all, [setup.account]: tokens });
    return setup;
}

export function deleteSetup(account: string): void {
    writeJson(FILE, loadSetups().filter((s) => s.account !== account));
    const all = readJson<Tokens>(TOKENS, {});
    delete all[account];
    writeJson(TOKENS, all);
}

/** What goes to the account's machine; null without a setup for it. */
export function setupMessage(account: string): Extract<PeerData, { kind: 'setup' }> | null {
    const setup = loadSetups().find((s) => s.account === account);
    if (!setup) return null;
    return { kind: 'setup', setup, tokens: readJson<Tokens>(TOKENS, {})[account] ?? {} };
}

// ------------------------------------------------------------------ The account's machine

export const setupBotId = (key: string): string => `setup-${key}`;

const credentialFile = (key: string) => accountPath('setup-git', `${key}.credentials`);

/**
 * The repository's git settings ask the file for the password, and nothing else: an empty helper first clears the
 * ones of the system (the credential manager would ask the person or answer with their own login).
 */
function helperFor(key: string, user: string): string {
    const file = credentialFile(key).replace(/\\/g, '/');
    return `!f() { test "$1" = get && echo "username=${user.replace(/["$`\\]/g, '') || 'git'}" && echo "password=$(cat "${file}")"; }; f`;
}

/**
 * Sets the helpers unless they are set already: a setup applied again does not rewrite them, so a fetch of the bot
 * running meanwhile never sees the moment without one.
 */
async function useToken(folder: string, key: string, user: string): Promise<void> {
    const now = await git(folder, ['config', '--local', '--get-all', 'credential.helper']).catch(() => '');
    if (now.replace(/\r/g, '') === `\n${helperFor(key, user)}\n`) return;
    await git(folder, ['config', '--local', '--unset-all', 'credential.helper']).catch(() => '');
    await git(folder, ['config', '--local', '--add', 'credential.helper', '']);
    await git(folder, ['config', '--local', '--add', 'credential.helper', helperFor(key, user)]);
}

function writeToken(key: string, token: string): void {
    const file = credentialFile(key);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, token, { mode: PRIVATE });
}

/** A folder for the bot's clone under the folder for bots: <repository>-<key>, the next free one if that is taken. */
function folderFor(repo: string, key: string): string {
    const root = botRoot();
    if (!root) throw new Error('no folder for bots on this machine');
    const base = `${cloneName(repo)}-${key}`;
    for (let i = 1; i <= 20; i++) {
        const target = path.join(root, i === 1 ? base : `${base}-${i}`);
        if (!fs.existsSync(target) || fs.readdirSync(target).length === 0) return target;
    }
    throw new Error(`no free folder for ${base}`);
}

async function cloneWithToken(repo: string, key: string, user: string): Promise<string> {
    const target = folderFor(repo, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    await git(path.dirname(target), ['-c', 'credential.helper=', '-c', `credential.helper=${helperFor(key, user)}`, 'clone', '--', repo, path.basename(target)], 10 * 60_000, env);
    await useToken(target, key, user);
    return target.replace(/\\/g, '/');
}

export interface ApplyHooks {
    /** A bot was created or changed (agent.ts: botSaved). */
    saved(old: Bot | undefined, bot: Bot): void;
    /** A managed bot left the setup: delete it like bot_delete without its folder. */
    removed(botId: string): void;
    log(text: string): void;
}

/**
 * Makes the bots of a setup on this machine: clones what is new, takes over name, role, approval level and contact of
 * those there are, and deletes managed bots the setup no longer has (their folders stay). One bot that fails does not
 * stop the others; the result lists what went wrong.
 */
export async function applySetup(setup: AccountSetup, tokens: Record<string, string>, hooks: ApplyHooks): Promise<string[]> {
    const problems: string[] = [];
    for (const b of setup.bots) {
        const id = setupBotId(b.key);
        try {
            const token = tokens[b.key] ?? '';
            if (token) writeToken(b.key, token);
            const old = findBot(id);
            let folder = old && old.machine === config.machine && fs.existsSync(old.folder) ? old.folder : '';
            if (!folder) {
                if (!token) throw new Error('no token');
                folder = await cloneWithToken(b.repo, b.key, b.gitUser);
                hooks.log(`setup: ${b.repo.replace(/\/\/[^@/]*@/, '//…@')} cloned into ${folder} for ${id}`);
            } else if (token) {
                await useToken(folder, b.key, b.gitUser);
            }
            const bot = saveBot({
                id, name: b.name, role: b.role, tone: b.tone, folder, model: b.model || old?.model || 'default', avatar: old?.avatar ?? '',
                approval: b.approval, machine: config.machine, area: old?.area, contact: setup.handover,
            }, b.key);
            hooks.saved(old, bot);
        } catch (e) {
            problems.push(`${b.name}: ${(e as Error).message}`);
        }
    }
    const keep = new Set(setup.bots.map((b) => setupBotId(b.key)));
    for (const bot of loadBots().filter((x) => x.managed && !keep.has(x.id))) hooks.removed(bot.id);
    return problems;
}

/** Last pull per bot: a support bot reads the code as it is upstream, but not with a fetch before every message. */
const pulled = new Map<string, number>();
const pulling = new Map<string, Promise<void>>();
const PULL_EVERY_MS = 5 * 60_000;

/**
 * A managed bot that only reads keeps no changes of its own, so its clone follows upstream: fetched and fast-forwarded
 * before a turn, at most every five minutes. Returns the pull to wait for, or null when none is due; a turn that comes
 * while one runs waits for the same one, so the messages keep their order. Errors only go to the log; the bot answers
 * from what it has.
 */
export function freshen(bot: Bot, log: (text: string) => void): Promise<void> | null {
    if (!bot.managed || bot.approval !== 'read' || bot.machine !== config.machine) return null;
    const running = pulling.get(bot.id);
    if (running) return running;
    if (Date.now() - (pulled.get(bot.id) ?? 0) < PULL_EVERY_MS) return null;
    pulled.set(bot.id, Date.now());
    const p = fastForward(bot.folder).then((r) => {
        if ('pulled' in r && r.pulled) log(`setup: ${bot.id} took over ${r.pulled} commit(s)`);
        else if ('error' in r) log(`setup: ${bot.id} could not pull: ${r.error}`);
    }, (e: Error) => log(`setup: ${bot.id} could not pull: ${e.message}`)).finally(() => pulling.delete(bot.id));
    pulling.set(bot.id, p);
    return p;
}
