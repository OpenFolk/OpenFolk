// Tests for moving a bot's main chat into a conversation:  node local/src/main-to-conversation.test.ts
// History, session, context and read state go to a new conversation; the main chat starts empty, here and on every
// other machine, and what another machine still sends from before stays away.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-main-move-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-main-move-data-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-main-move-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = root;
const bots = await import('./bots.ts');
const { appendEntry, readHistory } = await import('./history.ts');
const { loadSeen, applySeen } = await import('./seen.ts');
const { readJson, writeJson } = await import('./store.ts');
const { merge } = await import('./sync.ts');
const { BotManager } = await import('./agent.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const frames: { type: string; [k: string]: unknown }[] = [];
type Inner = { handle: (f: unknown, cid: string) => void; updateAgents: (o: string[]) => void };
const m = new BotManager((f) => { frames.push(f as { type: string }); }) as unknown as Inner;
m.updateAgents(['workstation']);
const now = new Date().toISOString();
bots.saveBots([{
    id: 'notes', name: 'Notes', role: '', folder: root, model: 'default', tone: '', avatar: '', approval: 'never', machine: 'workstation',
    createdAt: now, updatedAt: now,
}]);

// ---- Nothing to move: refused, no conversation
m.handle({ type: 'main_to_conversation', botId: 'notes' }, 'c1');
check('empty main chat: refused', frames.some((f) => f.type === 'error' && String(f.message).includes('empty')) && !bots.findBot('notes')?.conversations?.length, frames);

// ---- A main chat with history, session, context and read state
appendEntry('notes', { id: 'u1', role: 'user', text: 'Plan the release of version 2', ts: '2026-11-09T10:00:00.000Z', from: 'me' });
appendEntry('notes', { id: 'a1', role: 'assistant', text: 'Here is the plan', ts: '2026-11-09T10:00:05.000Z', botId: 'notes' });
bots.setSessionId('notes', 'sess-main');
writeJson('context.json', { notes: 41000 });
applySeen({ notes: { until: '2026-11-09T10:00:05.000Z', updatedAt: '2026-11-09T10:00:06.000Z' } });
frames.length = 0;
m.handle({ type: 'main_to_conversation', botId: 'notes' }, 'c1');
const conv = bots.findBot('notes')?.conversations?.[0];
const chatId = conv ? `notes~${conv.id}` : '';
check('a conversation, named after what was asked', Boolean(conv) && conv!.title === 'Plan the release of version 2', conv);
check('the history moved along', readHistory(chatId).filter((e) => e.role !== 'event').map((e) => e.id).join() === 'u1,a1', readHistory(chatId));
check('the conversation says where it came from', readHistory(chatId).at(-1)?.role === 'event');
check('the session moved along, the main chat starts a new one', bots.readSessionId(chatId) === 'sess-main' && bots.readSessionId('notes') === undefined);
const context = readJson<Record<string, number>>('context.json', {});
check('the context size moved along', context[chatId] === 41000 && !context.notes, context);
check('the read state moved along', loadSeen()[chatId]?.until === '2026-11-09T10:00:05.000Z', loadSeen()[chatId]);
const main = readHistory('notes');
check('the main chat holds only the note where it went', main.length === 1 && main[0].role === 'event' && main[0].text.includes(conv?.title ?? '?'), main);
check('the browsers get the emptied main chat', frames.some((f) => f.type === 'history' && f.chatId === 'notes' && (f.entries as unknown[]).length === 1));
const cleared = bots.findBot('notes')?.mainClearedAt;
check('the clearing is noted on the bot', Boolean(cleared) && main[0].ts > cleared!, { cleared, note: main[0].ts });

// ---- Another machine: its old main chat entries stay away
const before = { id: 'u0', role: 'user' as const, text: 'old', ts: '2026-11-09T09:00:00.000Z', from: 'me' };
merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { notes: [before] } });
check('old entries of the main chat from another machine stay away', !readHistory('notes').some((e) => e.id === 'u0'));
const later = { id: 'u9', role: 'user' as const, text: 'new', ts: new Date(Date.now() + 1000).toISOString(), from: 'me' };
merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { notes: [later] } });
check('new entries of the main chat do arrive', readHistory('notes').some((e) => e.id === 'u9'));

// ---- This machine as the other one: the bot with mainClearedAt arrives, the old entries go
const other = bots.findBot('notes')!;
bots.saveBots([{ ...other, mainClearedAt: undefined, updatedAt: '2026-11-09T09:00:00.000Z' }]);
appendEntry('notes', before);
const result = merge({ bots: [other], groups: [], routines: [], deleted: {}, push: [] });
check('the clearing from another machine drops the old entries', result.mainCleared.includes('notes') && !readHistory('notes').some((e) => e.id === 'u0')
    && readHistory('notes').some((e) => e.id === 'u9'), readHistory('notes').map((e) => e.id));

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
