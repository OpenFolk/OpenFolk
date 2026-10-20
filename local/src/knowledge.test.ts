// Tests for the bots' knowledge:  node local/src/knowledge.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-knowledge-'));
const k = await import('./knowledge.ts');
const { snapshot, merge } = await import('./sync.ts');
const { tombstones } = await import('./store.ts');
const { persona } = await import('./session.ts');
import type { Bot, Group, KnowledgeLocation } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`);
    if (!ok) { failures++; if (info !== undefined) console.log('       ', JSON.stringify(info)); }
};
const throws = (f: () => unknown) => { try { f(); return ''; } catch (e) { return (e as Error).message; } };

const bot = (id: string, folder: string): Bot => ({
    id, name: id, role: '', folder, model: 'default', tone: '', avatar: '', approval: 'risky', machine: '',
    createdAt: '', updatedAt: '',
} as Bot);
const anna = bot('anna', 'C:/www/project');
const bert = bot('bert', 'c:/www/Project/');
const carl = bot('carl', 'C:/www/other');
const groups: Group[] = [{ id: 'team', name: 'Team', avatar: '', members: ['anna', 'carl'], createdAt: '', updatedAt: '' }];
const ANNA: KnowledgeLocation = { scope: 'bot', key: 'anna' };
const ALL: KnowledgeLocation = { scope: 'all', key: '' };

// Folder keys and scopes
check('folder key independent of spelling and slash', k.folderKey(anna.folder) === k.folderKey(bert.folder) && k.folderKey(anna.folder) === 'c--www-project');
check('locations: bot, folder, groups, all', k.locationsFor(anna, groups).map(k.locationText).join() === 'bot/anna,folder/c--www-project,group/team,all');
check('bert is in no group', !k.sees(bert, { scope: 'group', key: 'team' }, groups));
check('invalid locations', !k.isValidLocation({ scope: 'bot', key: '../x' }) && !k.isValidLocation({ scope: 'all', key: 'x' }) && !k.isValidLocation({ scope: 'foo', key: 'x' }));
check('fact key round trip', JSON.stringify(k.splitFactKey(k.factKey(ANNA, 'tea'))) === JSON.stringify({ location: ANNA, name: 'tea' })
    && JSON.stringify(k.splitFactKey('all/tea')) === JSON.stringify({ location: ALL, name: 'tea' })
    && k.splitFactKey('bot/../tea') === null && k.splitFactKey('bot/anna/x/y') === null);

// Save, read, limits
const f = k.saveFact(ANNA, { name: 'tea', description: 'What  Anna\n drinks', text: 'Green tea, no sugar.', type: 'user' });
check('description on one line', f.description === 'What Anna drinks');
check('fact readable', k.readFact(ANNA, 'tea')?.text === 'Green tea, no sugar.' && k.readFact(ANNA, 'tea')?.type === 'user');
check('stored with English front matter', fs.readFileSync(path.join(process.env.DATA_DIR!, 'accounts', 'main', 'knowledge', 'bot', 'anna', 'tea.md'), 'utf8').includes('\ndescription: What Anna drinks\ntype: user\n'));
check('wrong name rejected', throws(() => k.saveFact(ANNA, { name: 'Tea Time', description: '', text: 'x', type: 'note' })).includes('name'));
check('empty text rejected', throws(() => k.saveFact(ANNA, { name: 'empty', description: '', text: '  ', type: 'note' })).includes('empty'));
check('too long text rejected', throws(() => k.saveFact(ANNA, { name: 'long', description: '', text: 'x'.repeat(k.MAX_TEXT + 1), type: 'note' })).includes('longer'));
const without = k.saveFact(ALL, { name: 'style', description: '', text: 'Answer briefly.', type: 'nonsense' as never });
check('missing description from the text, unknown type becomes note', without.description === 'Answer briefly.' && without.type === 'note');
check('fact name from text', k.factName('Der Nutzer mag grünen Tee über alles und noch viel mehr') === 'der-nutzer-mag-gruenen-tee-ueber-alles');

// Index in the system prompt
k.saveFact({ scope: 'folder', key: k.folderKey(bert.folder) }, { name: 'deploy', description: 'How deploys work here', text: 'Via the git server.', type: 'project' });
k.saveFact({ scope: 'group', key: 'team' }, { name: 'standup', description: 'Standup at 9', text: 'Daily at 9.', type: 'project' });
const idx = k.knowledgeIndex(anna, groups);
check('index contains all of Anna\'s scopes', ['- tea (user): What Anna drinks', '- deploy (project)', '- standup (project)', '- style (note)', 'group "Team"'].every((x) => idx.includes(x)), idx);
check('index without full text', !idx.includes('Green tea'));
check('Bert sees Anna\'s folder knowledge, but not hers', k.knowledgeIndex(bert, groups).includes('deploy') && !k.knowledgeIndex(bert, groups).includes('tea'));
check('Carl sees the group, not the folder', k.knowledgeIndex(carl, groups).includes('standup') && !k.knowledgeIndex(carl, groups).includes('deploy'));
const p = persona(anna, idx);
check('persona names the tools and contains the index', p.includes('remember_fact') && p.includes('- tea (user)'));
check('persona without knowledge without empty block', !persona(bot('new', 'C:/x'), '').endsWith('\n'));

// Delete and tombstone
check('delete', k.deleteFact(ANNA, 'tea') && !k.readFact(ANNA, 'tea') && !!tombstones()['knowledge:bot/anna/tea']);
check('delete again: false', !k.deleteFact(ANNA, 'tea'));

// Sync between machines
// Before any real tombstone so the test does not depend on the clock
const T1 = '2020-01-01T08:00:00.000Z';
const T2 = '2020-01-01T09:00:00.000Z';
check('snapshot contains the knowledge', !!snapshot(false).knowledge?.['all/style'] && !!snapshot(false).knowledge?.['group/team/standup']);
let result = merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], knowledge: {
    'bot/bert/coffee': { name: 'coffee', description: 'Coffee', text: 'Black.', type: 'user', updatedAt: T1 },
    'bot/anna/tea': { name: 'tea', description: 'old', text: 'old', type: 'user', updatedAt: T1 },
    'bot/../evil': { name: 'evil', description: '', text: 'x', type: 'note', updatedAt: T2 },
    'bot/bert/wrong': { name: 'other', description: '', text: 'x', type: 'note', updatedAt: T2 },
} });
check('foreign fact taken over, reported', k.readFact({ scope: 'bot', key: 'bert' }, 'coffee')?.updatedAt === T1 && result.knowledge.map(k.locationText).join() === 'bot/bert', result.knowledge);
check('deleted fact does not come back', !k.readFact(ANNA, 'tea'));
check('invalid keys dropped', !fs.existsSync(path.join(process.env.DATA_DIR!, 'evil.md')) && !fs.existsSync(path.join(process.env.DATA_DIR!, 'accounts', 'main', 'evil.md')) && !k.readFact({ scope: 'bot', key: 'bert' }, 'wrong'));
result = merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], knowledge: {
    'bot/bert/coffee': { name: 'coffee', description: 'older', text: 'With milk.', type: 'user', updatedAt: '2019-12-31T00:00:00.000Z' },
} });
check('older state changes nothing', k.readFact({ scope: 'bot', key: 'bert' }, 'coffee')?.text === 'Black.' && result.knowledge.length === 0);
result = merge({ bots: [], groups: [], routines: [], deleted: { 'knowledge:bot/bert/coffee': T2 }, push: [] });
check('tombstone from the other machine deletes here', !k.readFact({ scope: 'bot', key: 'bert' }, 'coffee') && result.knowledge.map(k.locationText).join() === 'bot/bert');
result = merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], notes: { anna: { text: 'old', updatedAt: T2 } } } as never);
check('old notes field is ignored', result.knowledge.length === 0);

// Splitting long notes
const parts = k.splitText(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(75)].join('\n'), 64);
check('split at line boundaries, nothing lost', parts.every((x) => x.length <= 64) && parts.join('').replace(/\n/g, '').length === 135, parts);

// Migration of the old notes
const notes = path.join(process.env.DATA_DIR!, 'accounts', 'main', 'notes');
fs.mkdirSync(notes, { recursive: true });
fs.writeFileSync(path.join(notes, 'dora.md'), '- 01.10.2026: likes lists\n');
fs.writeFileSync(path.join(notes, 'emil.md'), Array.from({ length: 300 }, (_, i) => `- Note ${i}: ${'x'.repeat(20)}`).join('\n'));
fs.writeFileSync(path.join(notes, 'empty.md'), '');
check('migration: two bots taken over', k.migrateNotes() === 2);
check('migration: text there, old file renamed', k.readFact({ scope: 'bot', key: 'dora' }, 'previous-notes')?.text === '- 01.10.2026: likes lists'
    && fs.existsSync(path.join(notes, 'dora.md.migrated')) && !fs.existsSync(path.join(notes, 'dora.md')));
const emil = k.readFacts({ scope: 'bot', key: 'emil' });
check('migration: long notes in parts, complete', emil.length > 1 && emil.map((x) => x.text).join('\n').includes('Note 0:') && emil.map((x) => x.text).join('\n').includes('Note 299:'), emil.map((x) => x.name));
check('migration: second run does nothing', k.migrateNotes() === 0);

fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
