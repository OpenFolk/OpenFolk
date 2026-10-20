// Tests for keeping the bots' repos current across machines:  node local/src/git-sync.test.ts
// One backend with real repos and a local remote; "office" plays the other machine that pushes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-git-sync-')));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = tmp;
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
const bots = await import('./bots.ts');
const { removeTree } = await import('./remove-tree.ts');
const { BotManager } = await import('./agent.ts');
type PeerData = import('../../shared/protocol.ts').PeerData;
type AgentFrame = import('../../shared/protocol.ts').AgentFrame;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const head = (cwd: string) => git(cwd, 'log', '-1', '--format=%s');

// remote, the other machine's checkout, and the checkouts of this machine's bots
const remote = path.join(tmp, 'remote.git');
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
const office = path.join(tmp, 'office');
execFileSync('git', ['clone', '-q', remote, office], { stdio: 'ignore' });
git(office, 'checkout', '-q', '-b', 'main');
fs.writeFileSync(path.join(office, 'readme.md'), 'a');
git(office, 'add', '.');
git(office, 'commit', '-q', '-m', 'start');
git(office, 'push', '-q', '-u', 'origin', 'main');
const pushFromOffice = (subject: string) => {
    git(office, 'commit', '-q', '--allow-empty', '-m', subject);
    git(office, 'push', '-q');
};
const here = path.join(tmp, 'here');
const mover = path.join(tmp, 'mover');
execFileSync('git', ['clone', '-q', remote, here]);
execFileSync('git', ['clone', '-q', remote, mover]);

const base = { role: '', model: 'default', tone: '', avatar: '', approval: 'never' as const };
const bot = bots.saveBot({ ...base, id: 'dev', name: 'Dev', folder: here, machine: 'workstation' });

const sent: { d: PeerData; to?: string }[] = [];
const frames: AgentFrame[] = [];
type Inner = {
    handle: (f: unknown, cid: string) => void;
    peerInbound: (from: string, d: PeerData) => void;
    updateAgents: (o: string[]) => void;
    sessions: Map<string, unknown>;
    close: () => void;
};
const m = new BotManager((f) => { frames.push(f); }, (d, to) => { sent.push({ d, to }); }) as unknown as Inner;
m.updateAgents(['workstation', 'office']);

// ---- A push on another machine: the repos here follow
pushFromOffice('office 1');
m.peerInbound('office', { kind: 'git_pushed' });
await wait(4000);
check('push on another machine: repo here fast-forwarded', head(here) === 'office 1', head(here));

// ---- A bot working in the repo: left alone
pushFromOffice('office 2');
m.sessions.set('dev', { bot, key: 'dev', state: 'thinking', currentTurn: { chatId: 'dev' }, waiting: () => 0, waitingPerChat: () => ({}), backgroundTasks: [], close: () => undefined });
m.peerInbound('office', { kind: 'git_pushed' });
await wait(4000);
check('bot working in the repo: not pulled', head(here) === 'office 1', head(here));
m.sessions.delete('dev');

// ---- The button in "Open changes"
m.handle({ type: 'git_pull', botId: 'dev', path: '' }, 'c1');
await wait(3000);
const pulled = frames.find((f) => f.type === 'git_pull');
check('pull button: answer and repo current', pulled?.type === 'git_pull' && pulled.ok && pulled.message.startsWith('here: brought up to date') && head(here) === 'office 2', pulled);
check('pull button: the list follows', frames.some((f) => f.type === 'git_changes' && f.botId === 'dev'));

// Local changes here block it, and the answer says why
pushFromOffice('office 3');
fs.writeFileSync(path.join(here, 'readme.md'), 'edited');
frames.length = 0;
m.handle({ type: 'git_pull', botId: 'dev', path: '' }, 'c1');
await wait(3000);
const blocked = frames.find((f) => f.type === 'git_pull');
check('pull button with local changes: not ok, file kept', blocked?.type === 'git_pull' && !blocked.ok && blocked.message.includes('local changes')
    && fs.readFileSync(path.join(here, 'readme.md'), 'utf8') === 'edited', blocked);

// ---- Commit and push from the app: the other machines hear about it
sent.length = 0;
m.handle({ type: 'git_commit', botId: 'dev', path: '', message: 'edited here' }, 'c1');
await wait(4000);
const commitAnswer = frames.find((f) => f.type === 'git_commit');
// office 3 is newer on the remote: the push is rejected, and then nobody is told
check('push rejected (remote ahead): no notice to the others', commitAnswer?.type === 'git_commit' && !commitAnswer.ok && !sent.some((g) => g.d.kind === 'git_pushed'), commitAnswer);
git(here, 'pull', '-q', '--rebase');
frames.length = 0;
m.handle({ type: 'git_commit', botId: 'dev', path: '', message: '' }, 'c1');
await wait(4000);
check('push from the app: notice to the other machines', sent.some((g) => g.d.kind === 'git_pushed' && g.to === undefined), sent.map((g) => g.d.kind));

// ---- A bot moving here from another machine starts with the remote's state
// saveBot() refuses a folder on a sleeping machine; the sync would bring such a bot as it is
bots.saveBot({ ...base, id: 'mover', name: 'Mover', folder: mover, machine: 'workstation' });
bots.saveBots(bots.loadBots().map((b) => (b.id === 'mover' ? { ...b, machine: 'office' } : b)));
git(office, 'pull', '-q');
pushFromOffice('office 4');
const arrived = { ...bots.findBot('mover')!, machine: 'workstation', updatedAt: new Date(Date.now() + 60_000).toISOString() };
m.peerInbound('office', { kind: 'snapshot', snapshot: { bots: [arrived], groups: [], routines: [], deleted: {}, push: [] } });
await wait(7000);
check('bot moved here: its repo fast-forwarded', head(mover) === 'office 4', head(mover));

m.close();
removeTree(tmp);
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
