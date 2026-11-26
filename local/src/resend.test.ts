// Tests for messages the app sends again after a dropped connection (webapp/js/outbox.js):  node local/src/resend.test.ts
// The machine stores a message once by its cid; a copy sent again gets the stored entry back as its answer, nothing is
// stored or started twice. Without a cid (an older app) every message counts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-resend-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-resend-data-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-resend-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = root;
const { BotManager } = await import('./agent.ts');
const { saveBot } = await import('./bots.ts');
const { readJson, writeJson } = await import('./store.ts');
const { readHistory } = await import('./history.ts');
const { removeTree } = await import('./remove-tree.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

type Inner = { handle: (f: unknown, cid: string) => void; updateAgents: (o: string[]) => void };
const frames: { type: string; [k: string]: unknown }[] = [];
const m = new BotManager((f) => { frames.push(f as { type: string }); }) as unknown as Inner;
m.updateAgents(['workstation']);
// The bot lives on a machine that sleeps: the message is stored, then the machine says it is asleep; no engine starts
const bot = saveBot({ id: '', name: 'Bruno', role: '', folder: root.replace(/\\/g, '/'), model: 'default', tone: '', avatar: '', approval: 'risky', machine: 'workstation' });
writeJson('bots.json', readJson<{ machine: string }[]>('bots.json', []).map((b) => ({ ...b, machine: 'laptop' })));
const users = () => frames.filter((f) => f.type === 'user') as unknown as { entry: { id: string; cid?: string; text: string } }[];

m.handle({ type: 'send', chatId: bot.id, text: 'Here are the photos', cid: 'c-1' }, 'phone');
check('the message is stored with its cid', readHistory(bot.id).filter((e) => e.role === 'user').length === 1 && users()[0]?.entry.cid === 'c-1', users());
const first = users()[0]?.entry.id;
m.handle({ type: 'send', chatId: bot.id, text: 'Here are the photos', cid: 'c-1' }, 'phone');
check('sent again: stored once, the stored entry is the answer', readHistory(bot.id).filter((e) => e.role === 'user').length === 1 && users().length === 2 && users()[1].entry.id === first, users());
check('… and nothing started twice (one "asleep" error)', frames.filter((f) => f.type === 'error').length === 1, frames.filter((f) => f.type === 'error'));
m.handle({ type: 'send', chatId: bot.id, text: 'Here are the photos', cid: 'c-2' }, 'phone');
check('another cid with the same words: a message of its own', readHistory(bot.id).filter((e) => e.role === 'user').length === 2);
m.handle({ type: 'send', chatId: bot.id, text: 'Old app' }, 'phone');
m.handle({ type: 'send', chatId: bot.id, text: 'Old app' }, 'phone');
check('without a cid (older app) every message counts', readHistory(bot.id).filter((e) => e.text === 'Old app').length === 2);

removeTree(root);
console.log(failures ? `\n${failures} failure(s)` : '\nall tests passed');
process.exit(failures ? 1 : 0);
