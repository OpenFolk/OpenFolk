// Work transfer when a bot changes machines: what is not on the git server yet (uncommitted changes, new files,
// unpushed commits) goes along, end-to-end encrypted through the relay like the session transcripts, so the bot
// continues where it left off. Nothing is pushed, so no webhook and no deployment runs.
// The previous machine packs the repos of the bot's folder once the bot rests and the move has reached it, sends the
// pack in chunks and then sets its uncommitted changes aside with `git stash`. The new machine first fast-forwards to
// the remote, then takes over the unpushed commits (only as a fast-forward) and applies the changes (only if they
// apply cleanly). Whatever does not fit is not forced in: it is parked in the repo's .git folder and named in the chat.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fastForward, findRepos, git, isSecret, parseStatus } from './git.ts';
import { t } from './i18n.ts';
import { readJson, writeJson } from './store.ts';
import type { PeerData } from '../../shared/protocol.ts';

/** Raw bytes per chunk, as for transcripts. */
const CHUNK_BYTES = 1024 * 1024;
/** A new file larger than this stays behind (named in the report). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** The whole pack; above it nothing is sent and the report says so. */
const MAX_PACK_BYTES = 64 * 1024 * 1024;
const RECEIVE_TIMEOUT_MS = 10 * 60_000;
/** A request whose move never arrives (the user changed their mind) is dropped after this long. */
const REQUEST_TIMEOUT_MS = 24 * 3600_000;

export type WorkPart = Extract<PeerData, { kind: 'work_transfer' }>;

/** The work of one repo; `path` relative to the bot's folder as in GitRepo, contents base64. */
export interface RepoWork {
    path: string;
    name: string;
    branch: string;
    /** `git diff --binary HEAD`: staged and unstaged changes of tracked files */
    patch?: string;
    /** New files (untracked, not ignored, not looking like credentials) */
    files: { path: string; data: string }[];
    /** `git bundle` of the commits not on any remote */
    bundle?: string;
    commits: number;
    /** New files that stayed behind: too large or looking like credentials */
    left: string[];
}

function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, encoding: 'buffer', timeout: 60_000, maxBuffer: MAX_PACK_BYTES, windowsHide: true }, (e, out, err) => {
            if (e) reject(new Error(String(err).trim() || e.message));
            else resolve(out);
        });
    });
}

function tmpFile(name: string): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-work-')), name);
}

function removeTmp(file: string): void {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

/** Pack what is not on the git server yet, per repo of the folder; repos without such work are missing. */
export async function packWork(folder: string): Promise<RepoWork[]> {
    const result: RepoWork[] = [];
    let total = 0;
    for (const repo of await findRepos(folder).catch(() => [])) {
        const w = repo.root;
        const state = parseStatus(await git(w, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=no']).catch(() => ''), 1);
        const hasHead = await git(w, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
        if (!hasHead || !state.branch) continue;
        const work: RepoWork = { path: repo.path, name: repo.name, branch: state.branch, files: [], commits: 0, left: [] };
        if (state.files.length) {
            const patch = await gitBuffer(w, ['diff', '--binary', 'HEAD']);
            if (patch.length) work.patch = patch.toString('base64');
            total += patch.length;
        }
        const untracked = (await git(w, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
        for (const f of untracked) {
            const file = path.join(w, f);
            const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
            if (isSecret(f) || size > MAX_FILE_BYTES) {
                work.left.push(f);
                continue;
            }
            work.files.push({ path: f, data: fs.readFileSync(file).toString('base64') });
            total += size;
        }
        // Commits no remote has: the branch's own work since its upstream, or everything not on a remote
        work.commits = Number((await git(w, ['rev-list', '--count', 'HEAD', '--not', '--remotes']).catch(() => '0')).trim()) || 0;
        if (work.commits) {
            const file = tmpFile('commits.bundle');
            try {
                await git(w, ['bundle', 'create', '-q', file, 'HEAD', '--not', '--remotes'], 60_000);
                const bundle = fs.readFileSync(file);
                work.bundle = bundle.toString('base64');
                total += bundle.length;
            } finally {
                removeTmp(file);
            }
        }
        if (work.patch || work.files.length || work.bundle || work.left.length) result.push(work);
    }
    if (total > MAX_PACK_BYTES) throw new Error(t('work.tooLarge', { mb: Math.round(total / 1024 / 1024), max: MAX_PACK_BYTES / 1024 / 1024 }));
    return result;
}

/** Set the uncommitted changes of tracked files aside after sending (`git stash`); new files stay where they are. */
export async function stashWork(folder: string, repos: RepoWork[], machine: string): Promise<void> {
    const roots = await findRepos(folder).catch(() => []);
    for (const r of repos) {
        const root = roots.find((x) => x.path === r.path)?.root;
        if (root && r.patch) await git(root, ['stash', 'push', '-q', '-m', `OpenFolk: work moved to ${machine.toUpperCase()}`]).catch((e: Error) => console.log(`work: stash in ${r.name}: ${e.message}`));
    }
}

export function workParts(botId: string, id: string, repos: RepoWork[]): WorkPart[] {
    const content = Buffer.from(JSON.stringify(repos));
    const parts = Math.max(1, Math.ceil(content.length / CHUNK_BYTES));
    return Array.from({ length: parts }, (_, i) => ({
        kind: 'work_transfer' as const, botId, id, part: i, parts, data: content.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64'),
    }));
}

/** Puts incoming chunks together; with the last missing chunk it returns the repos. */
export class WorkReceiver {
    private pending = new Map<string, { parts: (string | undefined)[]; since: number }>();

    chunk(w: WorkPart): RepoWork[] | null {
        const now = Date.now();
        for (const [k, o] of this.pending) if (now - o.since > RECEIVE_TIMEOUT_MS) this.pending.delete(k);
        if (!Number.isInteger(w.part) || !Number.isInteger(w.parts) || w.parts < 1 || w.part < 0 || w.part >= w.parts) throw new Error('invalid chunk');
        const k = `${w.botId}:${w.id}`;
        let o = this.pending.get(k);
        if (!o || o.parts.length !== w.parts) {
            o = { parts: Array.from({ length: w.parts }, () => undefined), since: now };
            this.pending.set(k, o);
        }
        o.parts[w.part] = w.data;
        if (o.parts.some((d) => d === undefined)) return null;
        this.pending.delete(k);
        const repos = JSON.parse(Buffer.concat(o.parts.map((d) => Buffer.from(d!, 'base64'))).toString('utf8')) as unknown;
        if (!Array.isArray(repos)) throw new Error('invalid work');
        return repos as RepoWork[];
    }
}

/** A path from another machine must stay inside the repo. */
function inside(root: string, rel: string): string | null {
    const p = path.resolve(root, rel);
    const r = path.relative(root, p);
    return !rel || r.startsWith('..') || path.isAbsolute(r) || r.split(path.sep)[0] === '.git' ? null : p;
}

/** Keep what could not be applied in the repo's .git folder, untracked and out of the way; returns that folder. */
function park(root: string, r: RepoWork, what: { patch?: boolean; bundle?: boolean; files?: { path: string; data: string }[] }): string {
    const dir = path.join(root, '.git', 'openfolk-work', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    if (what.patch && r.patch) fs.writeFileSync(path.join(dir, 'changes.patch'), Buffer.from(r.patch, 'base64'));
    if (what.bundle && r.bundle) fs.writeFileSync(path.join(dir, 'commits.bundle'), Buffer.from(r.bundle, 'base64'));
    for (const f of what.files ?? []) {
        const target = inside(path.join(dir, 'files'), f.path);
        if (!target) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(f.data, 'base64'));
    }
    return dir;
}

/**
 * Apply the work of the previous machine in the bot's folder here; one line per repo for the chat. Never forces
 * anything: commits only as a fast-forward, the patch only if `git apply --check` passes, a new file only where none
 * is. The rest is parked in .git/openfolk-work/<time>/ and the line says where.
 */
export async function applyWork(folder: string, repos: RepoWork[]): Promise<string[]> {
    const roots = await findRepos(folder).catch(() => []);
    const lines: string[] = [];
    for (const r of repos) {
        const root = roots.find((x) => x.path === r.path)?.root;
        if (!root) {
            lines.push(t('work.repoMissing', { repo: r.name }));
            continue;
        }
        await fastForward(root);
        const state = parseStatus(await git(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=no']).catch(() => ''), 1);
        let reason = state.branch !== r.branch ? t('work.otherBranch', { branch: state.branch || '?', wanted: r.branch })
            : state.files.length ? t('work.localChanges') : '';
        const done: string[] = [];
        const rest: { patch?: boolean; bundle?: boolean; files?: { path: string; data: string }[] } = {};
        if (r.bundle && !reason) {
            const file = tmpFile('commits.bundle');
            try {
                fs.writeFileSync(file, Buffer.from(r.bundle, 'base64'));
                await git(root, ['fetch', '-q', file, 'HEAD'], 60_000);
                await git(root, ['merge', '--ff-only', '-q', 'FETCH_HEAD'], 60_000);
                done.push(t('work.commits', { n: r.commits }));
            } catch {
                reason = t('work.commitsDiverged');
            } finally {
                removeTmp(file);
            }
        }
        if (r.bundle && reason && !done.length) rest.bundle = true;
        if (r.patch) {
            const file = tmpFile('changes.patch');
            try {
                fs.writeFileSync(file, Buffer.from(r.patch, 'base64'));
                if (reason) throw new Error(reason);
                await git(root, ['apply', '--check', '--binary', file]);
                await git(root, ['apply', '--binary', file]);
                done.push(t('work.changes'));
            } catch (e) {
                reason ||= t('work.patchConflict', { error: (e as Error).message.split('\n')[0] });
                rest.patch = true;
            } finally {
                removeTmp(file);
            }
        }
        const clash: { path: string; data: string }[] = [];
        let written = 0;
        // Whatever stopped the rest keeps the new files with it, so the parked work stays together
        const blocked = !!reason;
        for (const f of r.files) {
            const target = inside(root, f.path);
            if (!target) continue;
            const data = Buffer.from(f.data, 'base64');
            if (blocked) {
                clash.push(f);
                continue;
            }
            if (fs.existsSync(target)) {
                if (!fs.readFileSync(target).equals(data)) clash.push(f);
                continue;
            }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, data);
            written++;
        }
        if (written) done.push(t('work.files', { n: written }));
        if (clash.length) {
            rest.files = clash;
            if (!blocked) reason = t('work.filesExist', { files: clash.map((f) => f.path).join(', ') });
        }
        const parked = rest.patch || rest.bundle || rest.files ? park(root, r, rest) : '';
        const parts = [done.length ? t('work.applied', { what: done.join(', ') }) : '', parked ? t('work.parked', { reason, folder: parked }) : '',
            r.left.length ? t('work.left', { files: r.left.join(', ') }) : ''].filter(Boolean);
        lines.push(`${r.name}: ${parts.join(' ') || t('work.nothing')}`);
    }
    return lines;
}

// ------------------------------------------------------------------ pending requests on the previous machine

export interface PendingWork {
    machine: string;
    /** The bot's folder here, where the work is */
    folder: string;
    since: number;
}

export function pendingWork(): Record<string, PendingWork> {
    const all = readJson<Record<string, PendingWork>>('work-transfers.json', {});
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, p]) => now - p.since < REQUEST_TIMEOUT_MS));
}

export function scheduleWork(botId: string, w: PendingWork | null): void {
    const all = pendingWork();
    if (w) all[botId] = w;
    else delete all[botId];
    writeJson('work-transfers.json', all);
}
