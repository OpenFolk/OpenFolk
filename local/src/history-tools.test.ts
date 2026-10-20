// The bots' tools search_history and read_history, through the bot manager as an engine calls them: which chats a
// name means, time spans, the answer's form, the entries around a hit, bots on another machine.
//   node local/src/history-tools.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-history-tools-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const { appendEntry } = await import('./history.ts');
const { parseTime } = await import('./history-tools.ts');
const { config } = await import('./config.ts');
const { BotManager } = await import('./agent.ts');
import type { Bot } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const repo = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder: repo, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const anna = bots.saveBot({ ...base, id: 'anna', name: 'Anna' });
const bert = bots.saveBot({ ...base, id: 'bert', name: 'Bert' });
// Dora lives on another machine (saved there, synced here)
bots.saveBots([...bots.loadBots(), { ...base, id: 'dora', name: 'Dora', folder: repo.replace(/\\/g, '/'), machine: 'zz-desk', createdAt: '', updatedAt: '' }]);
bots.saveGroup({ id: 'team', name: 'Team', avatar: '', members: ['anna', 'bert'] });

// The history: a decision in Bert's chat, a question in Anna's, a group message, an old one
const now = Date.now();
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
appendEntry('bert', { id: 'b1', role: 'user', from: 'me', text: 'Wie deployen wir das Relay?', ts: ago(5) });
appendEntry('bert', { id: 'b2', role: 'assistant', botId: 'bert', text: 'Entscheidung: Das Relay wird nur über den Webhook deployt.', ts: ago(5),
    tools: [{ id: 't', name: 'Bash', input: {}, result: 'SECRET-TOOL-OUTPUT relay deploy' } as never] });
appendEntry('bert', { id: 'b3', role: 'user', from: 'me', text: 'Danke, passt.', ts: ago(5) });
appendEntry('anna', { id: 'a1', role: 'user', from: 'me', text: 'Was hatten wir zum Relay Deploy entschieden?', ts: ago(0) });
appendEntry('group-team', { id: 'g1', role: 'assistant', botId: 'anna', text: 'Im Team: Relay deploy freitags nie.', ts: ago(2) });
appendEntry('bert', { id: 'b0', role: 'user', from: 'me', text: 'Uralter Relay deploy Plan', ts: ago(90) });

type Tool = { name: string; run: (a: Record<string, unknown>) => Promise<{ text: string; error?: boolean }> };
type Inner = { sessions: Map<string, unknown>; engineTools: (s: unknown) => Tool[]; online: string[] };
const m = new BotManager(() => undefined) as unknown as Inner;
m.online = [config.machine, 'zz-desk'];
const session = (bot: Bot, chatId = bot.id) => ({ bot, key: bot.id, currentTurn: { chatId }, reload: () => undefined, backgroundTasks: [], waiting: () => 0, waitingPerChat: () => ({}) });
const sa = session(anna);
const tool = (s: unknown, name: string) => m.engineTools(s).find((x) => x.name === name)!;

check('both tools offered to every engine', ['search_history', 'read_history'].every((n) => m.engineTools(sa).some((x) => x.name === n)));

let r = await tool(sa, 'search_history').run({ query: 'relay deploy' });
const order = [...r.text.matchAll(/\[entry (\w+)\]/g)].map((x) => x[1]).join(',');
check('all chats, best first: words as written (newest first), then close together', order.startsWith('a1,g1,b0,') && order.slice(9).split(',').sort().join() === 'b1,b2', { order, text: r.text });
check('chat and sender by name, with ids for read_history', r.text.includes('Bert [chat bert] · Bert: Entscheidung') && r.text.includes('group Team [chat g:team] · Anna'), r.text);
check('never the tools\' output', !r.text.includes('SECRET-TOOL-OUTPUT'));
check('bot on another machine named, not searched', r.text.includes('Not searched: the chats of Dora (ZZ-DESK) run'), r.text);

r = await tool(sa, 'search_history').run({ query: 'relay', chat: 'Bert', since: '30d' });
check('chat by bot name, time span back from now', /\[entry b2\]/.test(r.text) && !/b0|a1|g1/.test(r.text.replace(/Not searched.*/s, '')), r.text);
r = await tool(sa, 'search_history').run({ query: 'relay', chat: 'this' });
check('"this" is the asking chat', /\[entry a1\]/.test(r.text) && !/\[entry b/.test(r.text), r.text);
r = await tool(session(anna, 'g:team'), 'search_history').run({ query: 'relay', chat: 'this' });
check('"this" in a group chat', /\[entry g1\]/.test(r.text), r.text);
r = await tool(sa, 'search_history').run({ query: 'relay', from: 'user', until: '1d' });
check('sender "user" and until', /\[entry b1\]/.test(r.text) && !/\[entry (a1|b2|g1)\]/.test(r.text), r.text);
r = await tool(sa, 'search_history').run({ query: 'relay', chat: 'Zorro' });
check('unknown chat: an error that says what works', !!r.error && r.text.includes('"this"'), r);
r = await tool(sa, 'search_history').run({ query: 'relay', since: 'last tuesday' });
check('unreadable time: an error with the forms', !!r.error && r.text.includes('7d'), r);
r = await tool(sa, 'search_history').run({ query: 'kubernetes' });
check('no hits: says so and how to widen', !r.error && r.text.startsWith('No hits'), r);

r = await tool(sa, 'read_history').run({ chat: 'bert', entry_id: 'b2', before: 1, after: 1 });
check('read_history: the hit with what was said around it', r.text.includes('Wie deployen wir das Relay?') && r.text.includes('(the hit)') && r.text.includes('Danke, passt.'), r.text);
check('read_history: never the tools\' output', !r.text.includes('SECRET-TOOL-OUTPUT'));
r = await tool(sa, 'read_history').run({ chat: 'bert', entry_id: 'nope' });
check('read_history: unknown entry is an error', !!r.error, r);

const fixed = Date.UTC(2026, 9, 15, 12);
check('time spans: 12h, 7d, 2w, 3m', parseTime('12h', fixed) === '2026-10-15T00:00:00.000Z' && parseTime('7d', fixed) === '2026-10-08T12:00:00.000Z'
    && parseTime('2w', fixed) === '2026-10-01T12:00:00.000Z' && parseTime('3m', fixed)!.startsWith('2026-07-17'), [parseTime('3m', fixed)]);
check('a date', parseTime('2026-10-01')!.startsWith('2026-10-01'));

void bert;
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
