// Folders for bots on this machine: the app checks one here before it saves a bot that lives here, and clones a
// repository into a new one, so a bot gets a folder on a machine without anyone opening a terminal there.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkFolder, underAllowedRoot } from './bots.ts';
import { config } from './config.ts';
import { pushAccess } from './git.ts';
import { t } from './i18n.ts';

const CLONE_TIMEOUT_MS = 10 * 60_000;

function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
    return new Promise((resolve, reject) => {
        // No prompt: without credentials the clone fails instead of waiting for input nobody can give
        execFile('git', args, { cwd, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e, out, err) => {
            if (e) reject(new Error(String(err).trim() || e.message));
            else resolve(out);
        });
    });
}

/** Address of the repository the folder lives in (origin), if it is one. */
export function originOf(folder: string): Promise<string | undefined> {
    return git(folder, ['remote', 'get-url', 'origin']).then((o) => o.trim() || undefined, () => undefined);
}

/**
 * The folder as this machine stores it, the address of its repository if it is one, and `push: false` if git here
 * has no credentials to push there.
 */
export async function inspectFolder(folder: string): Promise<{ folder: string; remote?: string; push?: false }> {
    const abs = checkFolder(folder);
    const remote = await originOf(abs);
    const push = remote ? await pushAccess(remote, abs) : null;
    return { folder: abs, remote, ...(push === false ? { push } : {}) };
}

/**
 * Only addresses git fetches over the network; `ext::`, local paths and anything starting with "-" (an option to git)
 * are refused.
 */
export function cloneName(url: string): string {
    const u = url.trim();
    if (!/^(https?|ssh):\/\/[^\s]+$/.test(u) && !/^[\w.-]+@[\w.-]+:[^\s]+$/.test(u)) throw new Error(t('folders.badUrl'));
    const name = u.replace(/[/\\]+$/, '').split(/[/:]/).pop()!.replace(/\.git$/, '');
    if (!/^[\w][\w.-]*$/.test(name)) throw new Error(t('folders.badUrl'));
    return name;
}

const sameRepo = (a: string, b: string) => a.trim().replace(/(\.git)?\/*$/, '') === b.trim().replace(/(\.git)?\/*$/, '');

/** A clone of `url` already lies in `folder`. */
async function holds(folder: string, url: string): Promise<boolean> {
    const existing = await inspectFolder(folder).catch(() => null);
    return Boolean(existing?.remote && sameRepo(existing.remote, url));
}

const isEmptyDir = (p: string) => fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0;
const slashes = (p: string) => p.replace(/\\/g, '/');

/**
 * Where `url` would go: a folder named after the repository in the first allowed root folder, or the one there that
 * already holds it; when that name is taken by something else, the next free one (name-2 …).
 */
export async function proposeFolder(url: string): Promise<{ folder: string; existing?: boolean }> {
    const name = cloneName(url);
    const root = config.allowedRoots[0];
    if (!root) throw new Error(t('folders.noRoot'));
    for (let i = 1; i <= 20; i++) {
        const target = path.join(root, i === 1 ? name : `${name}-${i}`);
        if (!fs.existsSync(target) || isEmptyDir(target)) return { folder: slashes(target) };
        if (await holds(target, url)) return { folder: slashes(target), existing: true };
    }
    throw new Error(t('folders.exists', { folder: slashes(path.join(root, name)) }));
}

/**
 * Clones `url` into `folder` (new or empty, inside the allowed folders) or, without one, where proposeFolder() says.
 * A folder that already holds a clone of the same repository is used as it is.
 */
export async function cloneRepository(url: string, folder?: string): Promise<string> {
    cloneName(url);
    const target = path.resolve(folder?.trim() || (await proposeFolder(url)).folder);
    if (!underAllowedRoot(target)) throw new Error(t('bots.folderNotAllowed', { roots: config.allowedRoots.join(', '), folder: target }));
    if (fs.existsSync(target) && !isEmptyDir(target)) {
        if (await holds(target, url)) return checkFolder(target);
        throw new Error(t('folders.exists', { folder: slashes(target) }));
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await git(path.dirname(target), ['clone', '--', url.trim(), path.basename(target)], CLONE_TIMEOUT_MS).catch((e: Error) => {
        throw new Error(t('folders.cloneFailed', { error: e.message }));
    });
    return checkFolder(target);
}
