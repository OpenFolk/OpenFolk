// Deleting a bot's working folder together with the bot, on request. The backend decides, not the app: the folder must
// lie inside the allowed folders without being one of them or the folder for bots, must hold nothing of OpenFolk
// itself, must not be used by another bot of any account on this machine (also nested folders, either way round) and
// must not hold work that is not on a git server yet. Deleting goes through removeTree (AGENTS.md: junctions).

import fs from 'node:fs';
import path from 'node:path';
import { findBot, isUnder, loadBots, underAllowedRoot } from './bots.ts';
import { config, projectRoot } from './config.ts';
import { botRoot } from './folders.ts';
import { listChanges, overlaps } from './git.ts';
import { t } from './i18n.ts';
import { removeTree } from './remove-tree.ts';
import { accountIds, currentAccount, inAccount } from './store.ts';

/** Bots of this machine whose folder is `folder`, lies in it or around it: by name for this account, counted for others. */
function otherUsers(botId: string, folder: string): { names: string[]; foreign: number } {
    const mine = currentAccount();
    const here = (b: { machine?: string }) => !b.machine || b.machine === config.machine;
    const names: string[] = [];
    let foreign = 0;
    for (const account of new Set([mine, ...accountIds()])) {
        const bots = account === mine ? loadBots() : inAccount(account, () => loadBots());
        for (const b of bots) {
            if ((account === mine && b.id === botId) || !here(b) || !b.folder || !overlaps(b.folder, folder)) continue;
            if (account === mine) names.push(b.name);
            else foreign++;
        }
    }
    return { names, foreign };
}

/**
 * Whether the folder of `botId` may be deleted with it: its folder as stored, or a message that says why not.
 * Only on the bot's machine.
 */
export async function checkFolderDeletion(botId: string): Promise<{ ok: true; folder: string } | { ok: false; folder?: string; message: string }> {
    const b = findBot(botId);
    if (!b) return { ok: false, message: t('bots.botNotFound') };
    if (b.machine && b.machine !== config.machine) return { ok: false, folder: b.folder, message: t('folderDelete.elsewhere', { machine: b.machine.toUpperCase() }) };
    const folder = b.folder;
    if (!folder || !fs.existsSync(folder)) return { ok: false, folder, message: t('folderDelete.missing', { folder }) };
    const abs = path.resolve(folder);
    const same = (a: string, c: string) => isUnder(a, c) && isUnder(c, a);
    const roots = [...config.allowedRoots, botRoot()].filter(Boolean);
    if (!underAllowedRoot(abs) || roots.some((r) => same(abs, r))
        || [config.dataDir, projectRoot].some((p) => isUnder(p, abs))) {
        return { ok: false, folder, message: t('folderDelete.protected', { folder }) };
    }
    const users = otherUsers(botId, abs);
    if (users.names.length || users.foreign) {
        const who = [...users.names, ...(users.foreign ? [t('folderDelete.foreign', { n: String(users.foreign) })] : [])].join(', ');
        return { ok: false, folder, message: t('folderDelete.shared', { folder, bots: who }) };
    }
    // Work not on a git server yet: changed files or commits not pushed
    const open = (await listChanges(abs).catch(() => [])).filter((r) => r.files.length || r.more || r.ahead);
    if (open.length) return { ok: false, folder, message: t('folderDelete.changes', { folder, repos: open.map((r) => r.name).join(', ') }) };
    return { ok: true, folder };
}

/** Deletes the folder after the same check; throws with the reason when it may not. */
export async function deleteBotFolder(botId: string): Promise<string> {
    const r = await checkFolderDeletion(botId);
    if (!r.ok) throw new Error(r.message);
    removeTree(r.folder);
    return r.folder;
}
