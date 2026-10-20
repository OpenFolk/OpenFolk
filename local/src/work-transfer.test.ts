// Tests for taking a bot's work along when it changes machines:  node local/src/work-transfer.test.ts
// Real repos with a local remote: "desk" is the previous machine's checkout, "laptop" the new one's.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-work-')));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = tmp;
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
const { applyWork, packWork, pendingWork, stashWork, WorkReceiver, workParts } = await import('./work-transfer.ts');
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { removeTree } = await import('./remove-tree.ts');
const { BotManager } = await import('./agent.ts');
type PeerData = import('../../shared/protocol.ts').PeerData;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// git on Windows may check text out with CRLF (core.autocrlf)
const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');

const remote = path.join(tmp, 'remote.git');
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
const seed = path.join(tmp, 'seed');
execFileSync('git', ['clone', '-q', remote, seed], { stdio: 'ignore' });
git(seed, 'checkout', '-q', '-b', 'main');
fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
fs.writeFileSync(path.join(seed, 'logo.bin'), Buffer.from([0, 1, 2, 3]));
fs.writeFileSync(path.join(seed, '.gitignore'), 'ignored.log\n');
git(seed, 'add', '.');
git(seed, 'commit', '-q', '-m', 'start');
git(seed, 'push', '-q', '-u', 'origin', 'main');
const clone = (name: string) => {
    const p = path.join(tmp, name);
    execFileSync('git', ['clone', '-q', remote, p], { stdio: 'ignore' });
    return p;
};

// ---- Packing on the previous machine
const desk = clone('desk');
git(desk, 'commit', '-q', '--allow-empty', '-m', 'unpushed 1');
fs.writeFileSync(path.join(desk, 'b.txt'), 'committed\n');
git(desk, 'add', 'b.txt');
git(desk, 'commit', '-q', '-m', 'unpushed 2');
fs.writeFileSync(path.join(desk, 'a.txt'), 'one\ntwo\n');
fs.writeFileSync(path.join(desk, 'logo.bin'), Buffer.from([9, 8, 7]));
fs.mkdirSync(path.join(desk, 'notes'));
fs.writeFileSync(path.join(desk, 'notes', 'new ä.md'), 'draft');
fs.writeFileSync(path.join(desk, '.env'), 'SECRET=1');
fs.writeFileSync(path.join(desk, 'ignored.log'), 'x');
const repos = await packWork(desk);
const r = repos[0];
check('one repo with patch, commits, new file', repos.length === 1 && !!r.patch && r.commits === 2 && !!r.bundle && r.branch === 'main', repos.map((x) => ({ ...x, patch: !!x.patch, bundle: !!x.bundle, files: x.files.map((f) => f.path) })));
check('new file along, credentials and ignored files not', JSON.stringify(r.files.map((f) => f.path)) === '["notes/new ä.md"]' && JSON.stringify(r.left) === '[".env"]', { files: r.files.map((f) => f.path), left: r.left });
const clean = clone('clean');
check('a clean repo packs nothing', (await packWork(clean)).length === 0);

// Chunks: a pack larger than one chunk arrives whole, in any order
fs.writeFileSync(path.join(desk, 'big.dat'), Buffer.alloc(3 * 1024 * 1024, 7));
const big = await packWork(desk);
fs.rmSync(path.join(desk, 'big.dat'));
const parts = workParts('dev', 'w1', big);
const receiver = new WorkReceiver();
const got = parts.toReversed().map((p) => receiver.chunk(p));
check('several chunks, complete only with the last', parts.length > 3 && got.slice(0, -1).every((x) => x === null) && !!got.at(-1)?.[0].files.some((f) => f.path === 'big.dat'), parts.length);

// ---- Applying on the new machine
const laptop = clone('laptop');
let lines = await applyWork(laptop, repos);
check('applied: commits, changes, new file', git(laptop, 'log', '-1', '--format=%s') === 'unpushed 2' && read(laptop, 'a.txt') === 'one\ntwo\n'
    && fs.readFileSync(path.join(laptop, 'logo.bin')).equals(Buffer.from([9, 8, 7])) && read(laptop, 'notes', 'new ä.md') === 'draft', lines);
check('report names what came and what stayed', lines.length === 1 && lines[0].includes('unpushed commits (2)') && lines[0].includes('uncommitted changes') && lines[0].includes('new files (1)') && lines[0].includes('.env'), lines);
check('credentials did not come along', !fs.existsSync(path.join(laptop, '.env')));
check('nothing pushed', git(remote, 'log', '-1', '--format=%s', 'main') === 'start');

// Previous machine: uncommitted changes set aside, new files and commits stay
await stashWork(desk, repos, 'laptop');
check('previous machine: tracked changes in the stash, worktree clean', git(desk, 'status', '--porcelain', '--untracked-files=no') === '' && git(desk, 'stash', 'list').includes('OpenFolk: work moved to LAPTOP'));
check('previous machine: new files and commits stay', fs.existsSync(path.join(desk, 'notes', 'new ä.md')) && git(desk, 'log', '-1', '--format=%s') === 'unpushed 2');

// ---- Conflicts are parked, not forced
const busy = clone('busy');
fs.writeFileSync(path.join(busy, 'a.txt'), 'local edit\n');
lines = await applyWork(busy, repos);
const parkedDir = /kept in (.+?openfolk-work[\\/][\dT-]+)/.exec(lines[0])?.[1] ?? '';
check('local changes here: nothing applied, all parked', read(busy, 'a.txt') === 'local edit\n' && git(busy, 'log', '-1', '--format=%s') === 'start'
    && fs.existsSync(path.join(parkedDir, 'changes.patch')) && fs.existsSync(path.join(parkedDir, 'commits.bundle')) && fs.existsSync(path.join(parkedDir, 'files', 'notes', 'new ä.md')), lines);
check('parked inside .git, not shown as change', parkedDir.includes(`${path.sep}.git${path.sep}openfolk-work`) && git(busy, 'status', '--porcelain', '--untracked-files=no') === 'M a.txt');
check('the parked patch applies by hand', (() => { git(busy, 'checkout', '-q', '--', 'a.txt'); git(busy, 'fetch', '-q', path.join(parkedDir, 'commits.bundle'), 'HEAD'); git(busy, 'merge', '-q', '--ff-only', 'FETCH_HEAD'); git(busy, 'apply', path.join(parkedDir, 'changes.patch')); return read(busy, 'a.txt') === 'one\ntwo\n'; })());

const other = clone('branch');
git(other, 'checkout', '-q', '-b', 'feature');
lines = await applyWork(other, repos);
check('other branch checked out: parked with the reason', lines[0].includes('branch feature is checked out here, not main') && read(other, 'a.txt') === 'one\n', lines);

const diverged = clone('diverged');
git(diverged, 'commit', '-q', '--allow-empty', '-m', 'only here');
lines = await applyWork(diverged, repos);
check('own commits here: commits and changes parked', lines[0].includes('do not follow on') && git(diverged, 'log', '-1', '--format=%s') === 'only here' && read(diverged, 'a.txt') === 'one\n', lines);

const clash = clone('clash');
fs.mkdirSync(path.join(clash, 'notes'));
fs.writeFileSync(path.join(clash, 'notes', 'new ä.md'), 'other draft');
lines = await applyWork(clash, repos);
check('a new file exists here with other content: kept, parked, the rest applied', read(clash, 'notes', 'new ä.md') === 'other draft' && read(clash, 'a.txt') === 'one\ntwo\n'
    && lines[0].includes('other content: notes/new ä.md'), lines);

lines = await applyWork(path.join(tmp, 'nowhere'), repos);
check('repo missing here: says so', lines[0].includes('does not exist here'), lines);
const evil = [{ ...r, patch: undefined, bundle: undefined, commits: 0, files: [{ path: '../escaped.txt', data: 'eA==' }, { path: '.git/hooks/post-merge', data: 'eA==' }] }];
await applyWork(clone('evil'), evil);
check('paths outside the repo or into .git are dropped', !fs.existsSync(path.join(tmp, 'escaped.txt')) && !fs.existsSync(path.join(tmp, 'evil', '.git', 'hooks', 'post-merge')));

// ---- Through the backend: requested on the previous machine, sent once the move arrives
const sent: { d: PeerData; to?: string }[] = [];
type Inner = { handle: (f: unknown, cid: string) => void; peerInbound: (from: string, d: PeerData) => void; updateAgents: (o: string[]) => void; close: () => void };
const m = new BotManager(() => undefined, (d, to) => { sent.push({ d, to }); }) as unknown as Inner;
m.updateAgents(['workstation', 'office']);
const mover = clone('mover');
fs.writeFileSync(path.join(mover, 'a.txt'), 'moved work\n');
const base = { role: '', model: 'default', tone: '', avatar: '', approval: 'never' as const };
bots.saveBot({ ...base, id: 'dev', name: 'Dev', folder: mover, machine: 'workstation' });
const workSent = () => sent.filter((g) => g.d.kind === 'work_transfer');

m.handle({ type: 'work_take', botId: 'dev', machine: 'office', folder: mover }, 'c1');
await wait(1000);
check('requested, but the move has not arrived: nothing sent', workSent().length === 0 && pendingWork().dev?.machine === 'office');
const moved = { ...bots.findBot('dev')!, machine: 'office', folder: '/work/dev', updatedAt: new Date(Date.now() + 60_000).toISOString() };
m.peerInbound('office', { kind: 'snapshot', snapshot: { bots: [moved], groups: [], routines: [], deleted: {}, push: [] } });
await wait(3000);
check('move arrived: work to OFFICE, request done', workSent().length === 1 && workSent()[0].to === 'office' && !pendingWork().dev, workSent().map((g) => g.to));
check('previous machine: changes set aside', read(mover, 'a.txt') === 'one\n' && git(mover, 'stash', 'list').includes('OFFICE'));
let refused = '';
try { m.handle({ type: 'work_take', botId: 'dev', machine: 'office', folder: 'C:/Windows' }, 'c1'); } catch (e) { refused = (e as Error).message; }
check('a folder outside ALLOWED_ROOTS is refused', !pendingWork().dev, refused);

// New machine: the same backend plays it for a bot that now lives here
const arrivedHere = clone('arrived');
const helper = bots.saveBot({ ...base, id: 'helper', name: 'Helper', folder: arrivedHere, machine: 'workstation' });
// the parcel the previous machine sent above, addressed to the bot living here
const parcel = workSent().map((g) => ({ ...(g.d as Extract<PeerData, { kind: 'work_transfer' }>), botId: helper.id }));
for (const p of parcel) m.peerInbound('office', p);
await wait(4000);
const event = readHistory(helper.id).findLast((e) => e.role === 'event');
check('received: applied and reported in the chat', read(arrivedHere, 'a.txt') === 'moved work\n' && !!event && event.text.startsWith('Work taken along from OFFICE:') && event.text.includes('uncommitted changes'), event?.text);
m.peerInbound('office', { ...parcel[0], id: 'w3', botId: 'dev' });
await wait(2000);
check('work for a bot that does not live here is dropped', read(mover, 'a.txt') === 'one\n');

m.close();
removeTree(tmp);
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
