// Tests for the bots' knowledge tools and the app's frames:  node local/src/knowledge-tools.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-knowledge-tools-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const k = await import('./knowledge.ts');
const { BotManager } = await import('./agent.ts');
import type { AgentFrame, Bot } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const repo = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder: repo, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const anna = bots.saveBot({ ...base, id: 'anna', name: 'Anna' });
const bert = bots.saveBot({ ...base, id: 'bert', name: 'Bert' });
const carl = bots.saveBot({ ...base, id: 'carl', name: 'Carl', folder: path.join(repo, 'local') });
const annaFolder = `folder/${k.folderKey(anna.folder)}`;
bots.saveGroup({ id: 'team', name: 'Team', avatar: '', members: ['anna', 'carl'] });

type Tool = { name: string; run: (a: Record<string, unknown>) => Promise<{ text: string; error?: boolean }> };
type Inner = {
    sessions: Map<string, unknown>;
    engineTools: (s: unknown) => Tool[];
    handle: (f: unknown, cid: string) => void;
};
const sent: AgentFrame[] = [];
const m = new BotManager((f) => { sent.push(f); }) as unknown as Inner;
const reloaded: string[] = [];
const session = (bot: Bot, chatId = bot.id) => ({ bot, currentTurn: { chatId }, reload: () => reloaded.push(bot.id), backgroundTasks: [], waiting: () => 0, waitingPerChat: () => ({}) });
const sa = session(anna);
for (const s of [sa, session(bert), session(carl)]) m.sessions.set(s.bot.id, s);
const tool = (s: unknown, name: string) => m.engineTools(s).find((x) => x.name === name)!;

check('tools present', ['remember_fact', 'read_knowledge', 'forget_fact', 'remember_note'].every((n) => m.engineTools(sa).some((x) => x.name === n)));

let r = await tool(sa, 'remember_fact').run({ name: 'tea', description: 'Drink', text: 'Green tea.', type: 'user' });
check('remember in scope bot', r.text.startsWith('Remembered: tea (bot/anna)') && k.readFact({ scope: 'bot', key: 'anna' }, 'tea')?.type === 'user', r);
check('own change does not reload a session', reloaded.length === 0, reloaded);
r = await tool(sa, 'remember_fact').run({ name: 'tea', description: 'Drink', text: 'Green tea, no sugar.' });
check('same name updates and keeps the type', r.text.startsWith('Updated') && k.readFact({ scope: 'bot', key: 'anna' }, 'tea')?.type === 'user', r);

r = await tool(sa, 'remember_fact').run({ name: 'deploy', description: 'Deploy', text: 'Via the git server.', scope: 'folder' });
check('remember in the folder', r.text.includes(annaFolder), r);
r = await tool(session(bert), 'read_knowledge').run({ name: 'deploy' });
check('Bert (same folder) reads it', r.text.includes('Via the git server.') && !r.error, r);
r = await tool(session(carl), 'read_knowledge').run({ name: 'deploy' });
check('Carl (other folder) does not', !!r.error, r);

r = await tool(sa, 'remember_fact').run({ name: 'standup', description: 'Standup', text: '9 o\'clock.', scope: 'group' });
check('group outside a group chat rejected', !!r.error && r.text.includes('group chat'), r);
r = await tool(session(anna, 'g:team'), 'remember_fact').run({ name: 'standup', description: 'Standup', text: '9 o\'clock.', scope: 'group' });
check('group in the group chat', r.text.includes('group/team'), r);
r = await tool(session(bert, 'g:team'), 'remember_fact').run({ name: 'x', description: '', text: 'x', scope: 'group' });
check('non-member must not write into the group', !!r.error, r);

r = await tool(session(carl), 'read_knowledge').run({});
check('index for Carl: group yes, Anna\'s knowledge no', r.text.includes('standup') && !r.text.includes('- tea') && !r.text.includes('deploy'), r);

r = await tool(sa, 'remember_note').run({ note: 'The user likes short answers' });
r = await tool(sa, 'remember_note').run({ note: 'The user likes short answers' });
check('remember_note creates unique names', r.text === 'Remembered as the-user-likes-short-answers-2.', r);

r = await tool(sa, 'forget_fact').run({ name: 'deploy' });
check('forget finds the scope itself', r.text.includes('folder/') && !k.readFact({ scope: 'folder', key: k.folderKey(anna.folder) }, 'deploy'), r);
r = await tool(sa, 'forget_fact').run({ name: 'deploy' });
check('forget again: error', !!r.error, r);

// Frames of the app: saving reloads all sessions that see the scope
reloaded.length = 0;
m.handle({ type: 'knowledge_save', botId: 'anna', location: { scope: 'all', key: '' }, fact: { name: 'style', description: 'Style', type: 'workstyle', text: 'Concise.' } }, 'c1');
check('app: all sessions reloaded', reloaded.sort().join() === 'anna,bert,carl', reloaded);
const info = sent.findLast((f) => f.type === 'bot_info');
check('app: bot_info with knowledge to all browsers', info?.type === 'bot_info' && info.info.knowledge.find((a) => a.location.scope === 'all')?.facts[0]?.name === 'style');
reloaded.length = 0;
m.handle({ type: 'knowledge_save', botId: 'anna', location: { scope: 'all', key: '' }, fact: { name: 'tea', description: '', type: 'note', text: 'x' } }, 'c1');
m.handle({ type: 'knowledge_save', botId: 'anna', location: { scope: 'all', key: '' }, fact: { name: 'tea', description: '', type: 'note', text: 'y' } }, 'c1');
const err = sent.findLast((f) => f.type === 'error');
check('app: new fact with an existing name rejected', err?.type === 'error' && err.request === 'knowledge_save' && err.message.includes('already exists'), err);
m.handle({ type: 'knowledge_save', botId: 'anna', location: { scope: 'all', key: '' }, fact: { name: 'drink', description: '', type: 'note', text: 'z' }, oldName: 'tea' }, 'c1');
check('app: rename', !!k.readFact({ scope: 'all', key: '' }, 'drink') && !k.readFact({ scope: 'all', key: '' }, 'tea'));
m.handle({ type: 'knowledge_save', botId: 'bert', location: { scope: 'group', key: 'team' }, fact: { name: 'x', description: '', type: 'note', text: 'x' } }, 'c1');
const err2 = sent.findLast((f) => f.type === 'error');
check('app: foreign scope rejected', err2?.type === 'error' && err2.message.includes('does not see'), err2);
reloaded.length = 0;
m.handle({ type: 'knowledge_delete', botId: 'carl', location: { scope: 'group', key: 'team' }, name: 'standup' }, 'c1');
check('app: deleting in the group reloads only members', !k.readFact({ scope: 'group', key: 'team' }, 'standup') && reloaded.sort().join() === 'anna,carl', reloaded);

// Language setting: saved, sent as settings to all browsers, sessions reloaded
reloaded.length = 0;
m.handle({ type: 'language', language: 'de' }, 'c1');
const settings = sent.findLast((f) => f.type === 'settings');
check('language: settings frame to all browsers', settings?.type === 'settings' && settings.settings.language === 'de' && !!settings.settings.updatedAt, settings);
check('language: sessions reloaded (new system prompt)', reloaded.length === 3, reloaded);
m.handle({ type: 'knowledge_save', botId: 'bert', location: { scope: 'group', key: 'team' }, fact: { name: 'x', description: '', type: 'note', text: 'x' } }, 'c1');
const err3 = sent.findLast((f) => f.type === 'error');
check('language: errors now in German', err3?.type === 'error' && err3.message === 'Diesen Bereich sieht der Bot nicht.', err3);

fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
