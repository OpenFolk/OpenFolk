// Tests for duplicating a bot:  node local/src/bot-duplicate.test.ts
// bot_duplicate makes a new bot with the original's profile on the same machine and folder, copies its routines
// paused, leaves history, conversations, favorite and the tools allowed for good with the original, and answers
// with the new id after the lists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-duplicate-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-duplicate-data-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-duplicate-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = root;
const bots = await import('./bots.ts');
const { loadRoutines, saveRoutine } = await import('./routines.ts');
const { BotManager } = await import('./agent.ts');
const { checkClientFrame } = await import('./frames.ts');
const { removeTree } = await import('./remove-tree.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const folder = path.join(root, 'website');
fs.mkdirSync(folder);
const frames: { type: string; [k: string]: unknown }[] = [];
type Inner = { handle: (f: unknown, cid: string) => void; updateAgents: (o: string[]) => void };
const m = new BotManager((f) => { frames.push(f as { type: string }); }) as unknown as Inner;
m.updateAgents(['workstation']);

bots.saveBots([{
    id: 'ada', name: 'Ada', area: 'Web', role: 'Website', folder: folder.replace(/\\/g, '/'), model: 'claude-opus-5-5', tone: 'Short answers.',
    avatar: 'data:image/png;base64,AA', approval: 'write', voice: 'female', machine: 'workstation', machineOnly: true, favorite: true, muted: true,
    allowedTools: ['mcp__mail__send'], canMessage: [], sessionId: 'session-1', conversations: [{ id: 'ab12', title: 'Release', createdAt: '' }],
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
}]);
saveRoutine({ id: '', botId: 'ada', name: 'Report', cron: '0 8 * * *', prompt: 'Write the report.', enabled: true, wake: true });
saveRoutine({ id: '', botId: 'other', name: 'Not hers', cron: '0 9 * * *', prompt: 'x', enabled: true });

check('the frame passes the check, an empty name does not', checkClientFrame({ type: 'bot_duplicate', botId: 'ada', name: 'Ada (copy)' }).ok && !checkClientFrame({ type: 'bot_duplicate', botId: 'ada', name: '  ' }).ok);
m.handle({ type: 'bot_duplicate', botId: 'ada', name: 'Ada (copy)' }, 'c1');
const answer = frames.find((f) => f.type === 'bot_duplicated');
const copy = answer ? bots.findBot(String(answer.id)) : undefined;
check('answers with the new id', answer?.botId === 'ada' && typeof answer.id === 'string' && answer.id !== 'ada', answer);
check('the copy: its own name, the profile of the original', copy?.name === 'Ada (copy)' && copy.area === 'Web' && copy.role === 'Website' && copy.tone === 'Short answers.'
    && copy.model === 'claude-opus-5-5' && copy.approval === 'write' && copy.avatar === 'data:image/png;base64,AA' && copy.voice === 'female'
    && copy.machine === 'workstation' && copy.folder === bots.findBot('ada')?.folder && JSON.stringify(copy.canMessage) === '[]', copy);
check('not taken over: session, conversations, favorite, mute, tools allowed for good', copy !== undefined && !copy.sessionId && !copy.conversations?.length
    && !copy.favorite && !copy.muted && !copy.allowedTools?.length, copy);
const routines = loadRoutines();
const copied = routines.filter((r) => r.botId === copy?.id);
check('her routine copied, paused, with its wake', copied.length === 1 && copied[0].name === 'Report' && copied[0].enabled === false && copied[0].wake === true
    && copied[0].id !== routines.find((r) => r.botId === 'ada')?.id, copied);
check('the original\'s routine still runs', routines.find((r) => r.botId === 'ada')?.enabled === true);
const order = frames.map((f) => f.type);
check('bots and routines come before the answer', order.indexOf('bots') >= 0 && order.indexOf('routines') >= 0
    && order.indexOf('bots') < order.indexOf('bot_duplicated') && order.indexOf('routines') < order.indexOf('bot_duplicated'), order);

frames.length = 0;
m.handle({ type: 'bot_duplicate', botId: 'ada', name: 'Ada (copy)' }, 'c1');
const second = frames.find((f) => f.type === 'bot_duplicated');
check('the same name twice: a second bot with its own id', second !== undefined && second.id !== answer?.id && bots.findBot(String(second.id))?.name === 'Ada (copy)', second);

frames.length = 0;
m.handle({ type: 'bot_duplicate', botId: 'nobody', name: 'X' }, 'c1');
check('an unknown bot: an error, nothing made', frames.some((f) => f.type === 'error') && !frames.some((f) => f.type === 'bot_duplicated'), frames.map((f) => f.type));

bots.saveBots(bots.loadBots().map((b) => (b.id === 'ada' ? { ...b, managed: 'support' } : b)));
frames.length = 0;
const before = bots.loadBots().length;
m.handle({ type: 'bot_duplicate', botId: 'ada', name: 'Ada 3' }, 'c1');
check('a bot of an admin\'s setup: refused', frames.some((f) => f.type === 'error') && bots.loadBots().length === before, frames.map((f) => f.type));

// a watcher of the backend may still hold the bot's folder on Windows
for (const d of [root, process.env.DATA_DIR!, process.env.CLAUDE_CONFIG_DIR!]) try { removeTree(d); } catch { /* left for the system's temp cleanup */ }
if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
