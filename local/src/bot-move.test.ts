// Tests for moving a bot without a folder field:  node local/src/bot-move.test.ts
// The machine a bot lives on writes down its place (Bot.place); bot_move on another machine puts the bot at that
// place under its folder for bots, after a dry run that only says what would happen.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-move-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-move-data-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-move-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = root;
const bots = await import('./bots.ts');
const { BotManager } = await import('./agent.ts');
const { removeTree } = await import('./remove-tree.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const wait = async (until: () => boolean, ms = 5000) => { for (const end = Date.now() + ms; !until() && Date.now() < end;) await new Promise((r) => setTimeout(r, 50)); };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const slash = (p: string) => p.replace(/\\/g, '/');

// A repository in a subfolder of the folder for bots, the bot works in a folder inside it
const repo = path.join(root, 'apps', 'website');
fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
git(repo, 'init', '-q');
git(repo, 'remote', 'add', 'origin', 'https://git.example.com/team/website.git');

const frames: { type: string; [k: string]: unknown }[] = [];
type Inner = { handle: (f: unknown, cid: string) => void; updateAgents: (o: string[]) => void };
const m = new BotManager((f) => { frames.push(f as { type: string }); }) as unknown as Inner;
m.updateAgents(['workstation']);
const base = { role: '', model: 'default', tone: '', avatar: '', approval: 'never' as const };

// ---- Saved here: the place is written down
m.handle({ type: 'bot_save', bot: { ...base, id: '', name: 'Docs', folder: path.join(repo, 'docs'), machine: 'workstation' } }, 'c1');
await wait(() => Boolean(bots.findBot('docs')?.place));
check('place written down after saving', JSON.stringify(bots.findBot('docs')?.place)
    === JSON.stringify({ path: 'apps/website/docs', repo: 'https://git.example.com/team/website.git', repoPath: 'apps/website' }), bots.findBot('docs')?.place);
check('the browsers got the bot with its place', frames.some((f) => f.type === 'bots' && (f.bots as { id: string; place?: unknown }[]).some((b) => b.id === 'docs' && b.place)));

// ---- Another folder for bots on this machine: the places follow
m.handle({ type: 'machine_settings_save', settings: { botFolder: slash(path.join(root, 'apps')) } }, 'c1');
await wait(() => bots.findBot('docs')?.place?.path === 'website/docs');
check('another folder for bots: the place is relative to it', bots.findBot('docs')?.place?.path === 'website/docs', bots.findBot('docs')?.place);
frames.length = 0;
m.handle({ type: 'machine_settings_save', settings: { botFolder: slash(os.homedir()) } }, 'c1');
check('a folder for bots outside the allowed folders is refused', frames.some((f) => f.type === 'error' && f.request === 'machine_settings_save'), frames.map((f) => f.type));
m.handle({ type: 'machine_settings_save', settings: { botFolder: '' } }, 'c1');

// ---- A bot from another machine moves here: its place is under this machine's folder for bots
const here = path.join(root, 'here');
m.handle({ type: 'machine_settings_save', settings: { botFolder: slash(here) } }, 'c1');
bots.saveBots([...bots.loadBots(), {
    ...base, id: 'notes', name: 'Notes', folder: 'C:/elsewhere/notes/daily', machine: 'office', machineOnly: true, place: { path: 'notes/daily' },
    createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
}]);
frames.length = 0;
m.handle({ type: 'bot_move', botId: 'notes', dryRun: true }, 'c1');
await wait(() => frames.some((f) => f.type === 'bot_moved'));
const dry = frames.find((f) => f.type === 'bot_moved');
check('dry run: the folder there and that it is created', dry?.ok === true && dry.dryRun === true && dry.action === 'create' && dry.folder === slash(path.join(here, 'notes', 'daily')), dry);
check('dry run: nothing created, the bot still on its machine', !fs.existsSync(path.join(here, 'notes')) && bots.findBot('notes')?.machine === 'office');

frames.length = 0;
m.handle({ type: 'bot_move', botId: 'notes' }, 'c1');
await wait(() => frames.some((f) => f.type === 'bot_moved'));
const done = frames.find((f) => f.type === 'bot_moved');
const notes = bots.findBot('notes');
check('moved: answered with the folder', done?.ok === true && !done.dryRun && done.folder === slash(path.join(here, 'notes', 'daily')), done);
check('moved: the bot lives here in that folder', notes?.machine === 'workstation' && notes.folder === slash(path.join(here, 'notes', 'daily')) && fs.statSync(notes.folder).isDirectory(), notes);
await wait(() => bots.findBot('notes')?.place?.path === 'notes/daily');
check('moved: the place written down again, relative to this machine', JSON.stringify(bots.findBot('notes')?.place) === JSON.stringify({ path: 'notes/daily' }), bots.findBot('notes')?.place);

// ---- No place, or one taken here: refused with the reason, the app asks for the folder
bots.saveBots(bots.loadBots().map((b) => (b.id === 'notes' ? { ...b, machine: 'office', place: undefined } : b)));
frames.length = 0;
m.handle({ type: 'bot_move', botId: 'notes', dryRun: true }, 'c1');
await wait(() => frames.some((f) => f.type === 'bot_moved'));
check('no place: refused', frames.find((f) => f.type === 'bot_moved')?.ok === false);
fs.mkdirSync(path.join(here, 'taken'), { recursive: true });
fs.writeFileSync(path.join(here, 'taken', 'file.txt'), 'other');
bots.saveBots(bots.loadBots().map((b) => (b.id === 'notes' ? { ...b, place: { path: 'taken', repo: 'https://git.example.com/team/taken.git' } } : b)));
frames.length = 0;
m.handle({ type: 'bot_move', botId: 'notes' }, 'c1');
await wait(() => frames.some((f) => f.type === 'bot_moved'));
const taken = frames.find((f) => f.type === 'bot_moved');
check('a place taken by something else: refused, the bot stays', taken?.ok === false && String(taken.message).includes('taken') && bots.findBot('notes')?.machine === 'office', taken);

for (const d of [root, process.env.DATA_DIR!, process.env.CLAUDE_CONFIG_DIR!]) removeTree(d);
if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
