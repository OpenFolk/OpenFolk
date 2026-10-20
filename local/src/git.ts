// Open changes of the git repos in a bot's folder: the repo the folder lives in and the repos in
// subfolders (up to MAX_DEPTH levels, without node_modules, vendor and hidden folders).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import { REPO } from './restart.ts';
import type { GitRepo } from '../../shared/protocol.ts';

const MAX_DEPTH = 3;
const MAX_REPOS = 150;
/** This many files per repo go to the browser; the rest only counts in `more`. */
const MAX_FILES = 200;
const SKIP = new Set(['node_modules', 'vendor']);

export function git(cwd: string, args: string[], timeout = 15000, env?: NodeJS.ProcessEnv, maxBuffer = 16 * 1024 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, timeout, maxBuffer, windowsHide: true, ...(env ? { env } : {}) }, (e, out, err) => {
            if (e) reject(new Error(String(err).trim() || e.message));
            else resolve(out);
        });
    });
}

function subRepos(start: string): string[] {
    const r: string[] = [];
    const walk = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH || r.length >= MAX_REPOS) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (r.length >= MAX_REPOS) return;
            if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
            const p = path.join(dir, e.name);
            if (fs.existsSync(path.join(p, '.git'))) r.push(p);
            walk(p, depth + 1);
        }
    };
    walk(start, 1);
    return r;
}

/** Parse the output of `git status --porcelain=v1 --branch -z`. */
export function parseStatus(raw: string, max = MAX_FILES): Omit<GitRepo, 'name' | 'path'> {
    const parts = raw.split('\0');
    const repo: Omit<GitRepo, 'name' | 'path'> = { branch: '', ahead: 0, behind: 0, files: [], more: 0 };
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p) continue;
        if (p.startsWith('## ')) {
            const head = p.slice(3);
            repo.branch = head.replace(/^No commits yet on /, '').split('...')[0].split(' ')[0];
            repo.ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
            repo.behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
            continue;
        }
        const status = p.slice(0, 2);
        // Renamed/copied: the old path follows as its own entry
        if (status[0] === 'R' || status[0] === 'C') i++;
        if (repo.files.length < max) repo.files.push({ status, path: p.slice(3) });
        else repo.more++;
    }
    return repo;
}

/** Repos in the folder; `path` is relative to the folder ('' = the folder itself or the repo it lives in). */
export async function findRepos(folder: string): Promise<{ root: string; name: string; path: string }[]> {
    const base = path.resolve(folder);
    if (!fs.existsSync(base)) throw new Error(t('git.folderMissing', { folder }));
    const roots: string[] = [];
    const own = await git(base, ['rev-parse', '--show-toplevel']).then((o) => path.resolve(o.trim()), () => null);
    if (own) roots.push(own);
    for (const p of subRepos(base)) if (!roots.includes(p)) roots.push(p);
    return roots.map((root) => {
        const rel = path.relative(base, root);
        const relPath = rel.startsWith('..') ? '' : rel.split(path.sep).join('/');
        return { root, name: relPath || path.basename(root), path: relPath };
    });
}

/** git and Node may spell the same Windows path with a different drive letter case or slashes. */
function samePath(a: string, b: string): boolean {
    const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
    return norm(a) === norm(b);
}

/** State of a repo; --no-optional-locks so the query creates no index.lock while a bot works there. */
async function repoState(root: string, name: string, relPath: string, max = MAX_FILES): Promise<GitRepo> {
    try {
        const raw = await git(root, ['--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch', '-z']);
        return { name, path: relPath, ...parseStatus(raw, max), ...(samePath(root, REPO) ? { backend: true } : {}) };
    } catch (e) {
        return { name, path: relPath, branch: '', ahead: 0, behind: 0, files: [], more: 0, error: (e as Error).message.split('\n')[0] };
    }
}

/** All repos in the folder with their state. */
export async function listChanges(folder: string): Promise<GitRepo[]> {
    return Promise.all((await findRepos(folder)).map(({ root, name, path: p }) => repoState(root, name, p)));
}

/** Whether a repo has something open: files, unpushed or unpulled commits or an error. */
export function isOpen(r: GitRepo): boolean {
    return r.files.length > 0 || r.more > 0 || r.ahead > 0 || r.behind > 0 || !!r.error;
}

function isInside(p: string, folder: string): boolean {
    const rel = path.relative(folder, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Which bot gets a repo in the overview when several see it: one that works inside the repo (the one with the
 * shortest folder there), otherwise the one with the deepest folder containing the repo.
 */
export function owner(root: string, folders: { id: string; folder: string }[]): string | undefined {
    const r = path.resolve(root);
    const all = folders.map((o) => ({ id: o.id, f: path.resolve(o.folder) }));
    const inside = all.filter((o) => isInside(o.f, r)).sort((a, b) => a.f.length - b.f.length);
    if (inside.length) return inside[0].id;
    return all.filter((o) => isInside(r, o.f)).sort((a, b) => b.f.length - a.f.length)[0]?.id;
}

/** This many files per repo go into the overview; it goes to all browsers on every change. */
const OVERVIEW_FILES = 30;
const PARALLEL = 6;

/**
 * Open repos per bot for the overview: every repo queried once and assigned to exactly one bot (owner()),
 * `path` relative to that bot's folder as in listChanges(). Bots without an open repo are missing.
 */
export async function openRepos(bots: { id: string; folder: string }[]): Promise<Record<string, GitRepo[]>> {
    const found = new Map<string, { id: string; name: string; path: string }[]>();
    for (const b of bots) {
        const repos = await findRepos(b.folder).catch(() => []);
        for (const r of repos) found.set(r.root, [...(found.get(r.root) ?? []), { id: b.id, name: r.name, path: r.path }]);
    }
    const jobs = [...found].map(([root, views]) => {
        const id = owner(root, bots.filter((b) => views.some((s) => s.id === b.id)));
        const s = views.find((x) => x.id === id) ?? views[0];
        return { root, ...s };
    });
    const result: Record<string, GitRepo[]> = {};
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const a = jobs[next++];
            const r = await repoState(a.root, a.name, a.path, OVERVIEW_FILES);
            if (isOpen(r)) (result[a.id] ??= []).push(r);
        }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    for (const list of Object.values(result)) list.sort((x, y) => (x.path === '' ? -1 : y.path === '' ? 1 : x.name.localeCompare(y.name)));
    return result;
}

/** GIT_CONFIG_COUNT of each environment before the first call: entries of the user's own, which stay. */
const ownEntries = new WeakMap<NodeJS.ProcessEnv, number>();

/**
 * Credentials for git push from the machine settings (user, host, token): the backend may run as a task without an
 * interactive sign-in and then cannot reach the system's credential manager. The entries go into the environment
 * via GIT_CONFIG_COUNT so the bots' sessions inherit them; the token is only in the environment, not in .git/config
 * or on the command line. Called again after a change: what an earlier call added is replaced, the rest stays.
 */
export function gitPushCredentials(env: NodeJS.ProcessEnv, c: { user: string; token: string; host: string }): boolean {
    if (!ownEntries.has(env)) ownEntries.set(env, Number(env.GIT_CONFIG_COUNT) || 0);
    const own = ownEntries.get(env) ?? 0;
    for (let i = own; i < (Number(env.GIT_CONFIG_COUNT) || 0); i++) {
        delete env[`GIT_CONFIG_KEY_${i}`];
        delete env[`GIT_CONFIG_VALUE_${i}`];
    }
    if (own) env.GIT_CONFIG_COUNT = String(own);
    else delete env.GIT_CONFIG_COUNT;
    delete env.GIT_PUSH_USER;
    delete env.GIT_PUSH_TOKEN;
    const user = c.user.trim();
    const token = c.token.trim();
    const host = c.host.trim();
    if (!user || !token || !host) return false;
    env.GIT_PUSH_USER = user;
    env.GIT_PUSH_TOKEN = token;
    const key = `credential.https://${host}.helper`;
    const entries = [
        // an empty helper clears the list, otherwise the credential manager would ask first
        [key, ''],
        [key, '!f() { if [ "$1" = get ]; then echo "username=$GIT_PUSH_USER"; echo "password=$GIT_PUSH_TOKEN"; fi; }; f'],
    ];
    entries.forEach(([k, v], i) => {
        env[`GIT_CONFIG_KEY_${own + i}`] = k;
        env[`GIT_CONFIG_VALUE_${own + i}`] = v;
    });
    env.GIT_CONFIG_COUNT = String(own + entries.length);
    return true;
}

/**
 * Whether git on this machine can push to `remote` without asking anyone: a token in the address, the machine's git
 * token for its host or an entry of a credential helper (the credential manager on Windows and macOS). Asks the
 * helpers through `git credential fill` and keeps only whether a password came back; the secret itself never leaves this function.
 * null for addresses it cannot judge (SSH: the keys live in an agent). `cwd`: the repository, for its own settings.
 */
export function pushAccess(remote: string, cwd: string): Promise<boolean | null> {
    let u: URL;
    try {
        u = new URL(remote);
    } catch {
        return Promise.resolve(null);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return Promise.resolve(null);
    if (u.password) return Promise.resolve(true);
    // Nobody can answer a prompt: no terminal, no dialog of the credential manager
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
    return new Promise((resolve) => {
        const child = execFile('git', ['credential', 'fill'], { cwd, env, timeout: 15_000, windowsHide: true }, (e, out) => resolve(!e && /^password=./m.test(out)));
        const user = u.username ? `username=${decodeURIComponent(u.username)}\n` : '';
        child.stdin?.end(`protocol=${u.protocol.slice(0, -1)}\nhost=${u.host}\n${user}\n`);
    });
}

// ---- Bringing repos up to date: fetch, then only a fast-forward that cannot lose anything ----

/**
 * What fastForward() did. `pulled`: commits taken over (0 = already current). `skipped`: why it left the repo alone,
 * with `behind` the commits waiting upstream.
 */
export type PullOutcome =
    | { pulled: number }
    | { skipped: 'no_upstream' | 'local_changes' | 'diverged'; behind: number }
    | { error: string };

/**
 * Fetch the branch's upstream and fast-forward to it, but only when that is safe: no uncommitted changes to tracked
 * files and no local commits of its own. Never merges, rebases or resets; whatever needs a decision is reported.
 * Untracked files stay; if one would be overwritten, git refuses and that comes back as error.
 */
export async function fastForward(root: string): Promise<PullOutcome> {
    // Nobody can answer a prompt of git or the credential manager here
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    try {
        const upstream = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).then((o) => o.trim(), () => '');
        if (!upstream) return { skipped: 'no_upstream', behind: 0 };
        // without arguments git fetches the remote the branch tracks
        await git(root, ['fetch', '--quiet', '--no-tags'], 120000, env);
        const state = parseStatus(await git(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=no']), 1);
        if (!state.behind) return { pulled: 0 };
        if (state.ahead) return { skipped: 'diverged', behind: state.behind };
        if (state.files.length) return { skipped: 'local_changes', behind: state.behind };
        await git(root, ['merge', '--ff-only', '--quiet', '@{u}'], 60000, env);
        return { pulled: state.behind };
    } catch (e) {
        return { error: (e as Error).message.split('\n')[0] };
    }
}

/** One line for the user about a fastForward() of a repo. */
export function pullText(repo: string, o: PullOutcome): string {
    if ('error' in o) return t('git.pullFailed', { repo, reason: o.error });
    if ('skipped' in o) return t(`git.pullSkipped.${o.skipped}`, { repo, n: o.behind });
    return o.pulled ? t('git.pulledCommits', { repo, n: o.pulled }) : t('git.upToDate', { repo });
}

/** Fast-forward one repo of a bot's folder (the button in "Open changes"); `repoPath` as in GitRepo. */
export async function pullRepo(folder: string, repoPath: string): Promise<{ ok: boolean; message: string }> {
    const repo = (await findRepos(folder)).find((r) => r.path === repoPath);
    if (!repo) throw new Error(t('git.repoNotFound', { repo: repoPath || folder }));
    const o = await fastForward(repo.root);
    return { ok: !('error' in o) && !('skipped' in o), message: pullText(repo.name, o) };
}

/**
 * Fast-forward every repo in the bots' folders (each repo once), at most PARALLEL at a time. `skip(root)` leaves a
 * repo alone, e.g. because a bot works in it right now. Returns what happened per repo root.
 */
export async function pullRepos(bots: { id: string; folder: string }[], skip: (root: string) => boolean = () => false): Promise<{ root: string; name: string; outcome: PullOutcome }[]> {
    const found = new Map<string, string>();
    for (const b of bots) for (const r of await findRepos(b.folder).catch(() => [])) if (!found.has(r.root) && !skip(r.root)) found.set(r.root, r.name);
    const jobs = [...found];
    const result: { root: string; name: string; outcome: PullOutcome }[] = [];
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const [root, name] = jobs[next++];
            result.push({ root, name, outcome: await fastForward(root) });
        }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return result;
}

/** Whether two folders overlap (one inside the other); a bot working in either may be disturbed by a pull. */
export function overlaps(a: string, b: string): boolean {
    const ra = path.resolve(a);
    const rb = path.resolve(b);
    return isInside(ra, rb) || isInside(rb, ra);
}

/** Files that must never get into a repo through the button (templates such as .env.sample excepted). */
export function isSecret(file: string): boolean {
    const n = path.posix.basename(file).toLowerCase();
    if (/^\.env\.(sample|example|tpl|template|dist)$/.test(n)) return false;
    // 'zugangsdaten.txt' (German for "credentials") is a common credentials file name of existing setups
    return /^\.env(\..*)?$/.test(n) || /\.(pem|key|pfx|p12)$/.test(n) || n.startsWith('id_rsa') || /^(secrets|credentials)\./.test(n) || n === 'zugangsdaten.txt';
}

/**
 * Commit everything in the repo (`git add -A`) and push; without open files only push. Only repos that
 * findRepos() knows in the bot's folder. New files that look like credentials prevent the commit.
 */
export async function commitAndPush(folder: string, repoPath: string, message: string): Promise<string> {
    const repo = (await findRepos(folder)).find((r) => r.path === repoPath);
    if (!repo) throw new Error(t('git.repoNotFound', { repo: repoPath || folder }));
    const w = repo.root;
    const raw = await git(w, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all']);
    const state = parseStatus(raw, Infinity);
    const parts: string[] = [];
    if (state.files.length) {
        if (!message.trim()) throw new Error(t('git.messageMissing'));
        const secret = state.files.filter((d) => d.status === '??' && isSecret(d.path)).map((d) => d.path);
        if (secret.length) throw new Error(t('git.secretFiles', { files: secret.join(', ') }));
        if (state.files.some((d) => /U|AA|DD/.test(d.status) && d.status !== '??')) throw new Error(t('git.conflicts'));
        await git(w, ['add', '-A']);
        await git(w, ['commit', '-q', '-m', message.trim()], 60000);
        parts.push(t('git.commit', { hash: (await git(w, ['rev-parse', '--short', 'HEAD'])).trim() }));
    }
    const hasUpstream = await git(w, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).then(() => true, () => false);
    try {
        await git(w, hasUpstream ? ['push', '-q'] : ['push', '-q', '-u', 'origin', 'HEAD'], 120000);
    } catch (e) {
        const reason = (e as Error).message.split('\n').slice(0, 3).join(' ');
        throw new Error(t(parts.length ? 'git.pushFailedAfterCommit' : 'git.pushFailed', { repo: repo.name, commit: parts[0] ?? '', reason }), { cause: e });
    }
    parts.push(t('git.pushed'));
    return `${repo.name}: ${parts.join(', ')}`;
}
