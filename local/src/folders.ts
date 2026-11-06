// Folders for bots on this machine: the app checks one here before it saves a bot that lives here, and clones a
// repository into a new one, so a bot gets a folder on a machine without anyone opening a terminal there.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkFolder, FolderNotAllowed, isUnder, realPath, underAllowedRoot } from './bots.ts';
import { config } from './config.ts';
import { pushAccess } from './git.ts';
import { t } from './i18n.ts';
import { machineSettings } from './machine-settings.ts';
import type { BotPlace, MoveAction } from '../../shared/protocol.ts';

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
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * Where bots go on this machine: the folder chosen in the machine settings while it lies inside the allowed folders,
 * otherwise the first allowed folder.
 */
export function botRoot(): string {
    const chosen = machineSettings().botFolder;
    if (chosen && underAllowedRoot(path.resolve(chosen))) return path.resolve(chosen);
    return config.allowedRoots[0] ?? '';
}

/** An origin as the other machines get it: without a password or token in the address. */
const withoutSecret = (url: string) => url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/@:]*):[^/@]*@/i, '$1@');

/**
 * The place of a bot's folder on this machine (Bot.place): relative to the folder for bots, or to the allowed folder
 * it lies in, with the repository around it. None for a folder outside the allowed folders, or in a repository
 * without an origin or reaching above that folder: another machine could not rebuild it.
 */
export async function placeOf(folder: string): Promise<BotPlace | undefined> {
    const abs = path.resolve(folder);
    const root = botRoot();
    const base = root && isUnder(abs, root) ? root : config.allowedRoots.find((r) => isUnder(abs, r));
    if (!base) return undefined;
    const rel = (p: string) => slashes(path.relative(realPath(base), realPath(p)));
    const top = await git(abs, ['rev-parse', '--show-toplevel']).then((o) => o.trim(), () => '');
    if (!top) return { path: rel(abs) };
    const repo = await originOf(top);
    if (!repo || !isUnder(top, base)) return undefined;
    return { path: rel(abs), repo: withoutSecret(repo), ...(rel(top) !== rel(abs) ? { repoPath: rel(top) } : {}) };
}

/** `rel` below `root`; a place comes from another machine, so nothing may lead out of the folder for bots. */
function inRoot(root: string, rel: string): string {
    if (path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(t('folders.badPlace'));
    return path.join(root, rel);
}

/**
 * What moving a bot with this place to this machine does: its folder under the folder for bots, and whether that is
 * there (`use`), the repository is cloned (`clone`) or the folder is created (`create`). Refused when the place is
 * taken by something else; the app then asks for the folder.
 */
export async function planMove(place: BotPlace): Promise<{ folder: string; action: MoveAction }> {
    const root = botRoot();
    if (!root) throw new Error(t('folders.noRoot'));
    const folder = inRoot(root, place.path);
    if (!underAllowedRoot(folder)) throw new FolderNotAllowed(folder);
    if (!place.repo) return { folder: slashes(folder), action: isDir(folder) ? 'use' : 'create' };
    cloneName(place.repo);
    const top = inRoot(root, place.repoPath ?? place.path);
    if (!isUnder(folder, top)) throw new Error(t('folders.badPlace'));
    if (!fs.existsSync(top) || isEmptyDir(top)) return { folder: slashes(folder), action: 'clone' };
    if (!(await holds(top, place.repo))) throw new Error(t('folders.exists', { folder: slashes(top) }));
    return { folder: slashes(folder), action: isDir(folder) ? 'use' : 'create' };
}

/** Carries out planMove(): clones or creates what is missing and returns the folder as this machine stores it. */
export async function prepareMove(place: BotPlace): Promise<{ folder: string; action: MoveAction }> {
    const plan = await planMove(place);
    if (plan.action === 'clone') await cloneRepository(place.repo!, inRoot(botRoot(), place.repoPath ?? place.path));
    fs.mkdirSync(plan.folder, { recursive: true });
    return { folder: checkFolder(plan.folder), action: plan.action };
}

/**
 * Where `url` would go: a folder named after the repository in the folder for bots, or the one there that already
 * holds it; when that name is taken by something else, the next free one (name-2 …).
 */
export async function proposeFolder(url: string): Promise<{ folder: string; existing?: boolean }> {
    const name = cloneName(url);
    const root = botRoot();
    if (!root) throw new Error(t('folders.noRoot'));
    for (let i = 1; i <= 20; i++) {
        const target = path.join(root, i === 1 ? name : `${name}-${i}`);
        if (!fs.existsSync(target) || isEmptyDir(target)) return { folder: slashes(target) };
        if (await holds(target, url)) return { folder: slashes(target), existing: true };
    }
    throw new Error(t('folders.exists', { folder: slashes(path.join(root, name)) }));
}

const LIST_MAX = 500;

/** `p` or the nearest of its parents that exists, '' if none does. */
function nearestDir(p: string): string {
    for (let at = p; ; at = path.dirname(at)) {
        if (isDir(at)) return at;
        if (path.dirname(at) === at) return '';
    }
}

/**
 * The subfolders of `folder` for the editor's folder picker, never outside the allowed roots. '' lists the roots
 * (with a single root: that root); a folder that is missing lists its nearest existing parent. Hidden folders and
 * node_modules are left out; links count only where they lead inside the roots.
 */
export function listFolder(folder: string): { folder: string; parent?: string; folders: string[] } {
    const roots = config.allowedRoots.map((r) => path.resolve(r)).filter(isDir);
    if (!roots.length) throw new Error(t('folders.noRoot'));
    const start = folder.trim() ? nearestDir(path.resolve(folder.trim())) : '';
    const abs = start && underAllowedRoot(start) ? start : roots.length === 1 ? roots[0] : '';
    if (!abs) return { folder: '', folders: roots.map(slashes) };
    const folders = fs.readdirSync(abs, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.') && d.name !== 'node_modules')
        .map((d) => ({ d, full: path.join(abs, d.name) }))
        .filter(({ d, full }) => d.isDirectory() || (d.isSymbolicLink() && isDir(full) && underAllowedRoot(full)))
        .map(({ full }) => full)
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base', numeric: true }))
        .slice(0, LIST_MAX);
    const up = path.dirname(abs);
    const atRoot = roots.some((r) => isUnder(r, abs) && isUnder(abs, r));
    const parent = !atRoot && up !== abs && underAllowedRoot(up) ? slashes(up) : roots.length > 1 ? '' : undefined;
    return { folder: slashes(abs), ...(parent !== undefined ? { parent } : {}), folders: folders.map(slashes) };
}

/**
 * Clones `url` into `folder` (new or empty, inside the allowed folders) or, without one, where proposeFolder() says.
 * A folder that already holds a clone of the same repository is used as it is.
 */
export async function cloneRepository(url: string, folder?: string): Promise<string> {
    cloneName(url);
    const target = path.resolve(folder?.trim() || (await proposeFolder(url)).folder);
    if (!underAllowedRoot(target)) throw new FolderNotAllowed(target);
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
