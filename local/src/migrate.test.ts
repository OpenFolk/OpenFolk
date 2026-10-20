// Tests for the migration of old (German) data to the English format:  node local/src/migrate.test.ts
// The sample data below is exactly what older versions wrote (German keys, values and file names).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-migrate-'));
process.env.DATA_DIR = dir;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };
const write = (rel: string, content: unknown) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const exists = (rel: string) => fs.existsSync(path.join(dir, rel));
/** Where the data of the time before accounts ends up. */
const acc = (rel: string) => path.join('accounts', 'main', rel);

// ---------------------------------------------------------------- old data folder
const T = '2026-10-01T08:00:00.000Z';
write('bots.json', [{
    id: 'anna', name: 'Anna', role: 'Server', folder: 'C:/www/project', model: 'opus', tone: '', avatar: '', approval: 'riskant',
    favorit: true, stumm: true, rechner: 'desk', nurDort: true, createdAt: T, updatedAt: T,
    unterhaltungen: [{ id: 'a1b2c3d4', titel: 'Release', archiviert: T, createdAt: T, model: 'haiku' }],
}, { id: 'bert', name: 'Bert', role: '', folder: 'C:/www/x', model: 'default', tone: '', avatar: '', approval: 'nie', rechner: '', nurDort: false, createdAt: T, updatedAt: T },
{ id: 'carl', name: 'Carl', role: '', folder: 'C:/www/y', model: 'default', tone: '', avatar: '', approval: 'schreiben', rechner: '', nurDort: false, createdAt: T, updatedAt: T }]);
write('groups.json', [{ id: 'team', name: 'Team', avatar: '', members: ['anna', 'bert'], favorit: true, stumm: false, createdAt: T, updatedAt: T }]);
write('routines.json', [
    { id: 'r1', botId: 'anna', name: 'Inbox', cron: '0 8 * * *', prompt: 'x', enabled: true, wecken: true, lastRun: T, lastStatus: 'läuft', updatedAt: T },
    { id: 'r2', botId: 'bert', name: 'Report', cron: '0 9 * * *', prompt: 'y', enabled: true, lastStatus: 'fehler', updatedAt: T },
]);
const noId = { role: 'user', text: 'Very old message', ts: '2026-09-01T08:00:00.000Z', from: 'ich' };
const oldHash = 'alt-' + createHash('sha1').update(`${noId.ts}|user|ich||${noId.text}`).digest('hex').slice(0, 16);
write('history/anna.jsonl', [
    noId,
    { id: 'e1', role: 'user', text: 'Voice', ts: T, from: 'ich', sprache: true, gelesen: T, attachments: [{ name: 'a.webm', type: 'audio/webm', size: 10, path: 'C:/x/a.webm', rechner: 'desk', dauerMs: 1234 }] },
    { id: 'e2', role: 'user', text: 'Reply', ts: T, from: 'ich', antwortAuf: { id: 'e1', von: 'ich', text: 'Voice' }, verschoben: 'anna~a1b2c3d4' },
    { id: 'e3', role: 'user', text: 'Gone', ts: T, from: 'ich', geloescht: T },
    { id: 'e4', role: 'user', text: 'Dropped', ts: T, from: 'ich', verworfen: T },
    { id: 'e5', role: 'assistant', text: 'Answer', ts: T, botId: 'anna', tools: [{ id: 't1', name: 'Read', summary: 'x', nachladen: true }] },
    { id: 'e6', role: 'user', text: 'From a bot', ts: T, from: 'bert', antwortAuf: { id: 'e5', von: 'anna', text: 'Answer' } },
].map((e) => JSON.stringify(e)).join('\n') + '\nnot json\n');
write('history/group-team.jsonl', JSON.stringify({ id: 'g1', role: 'user', text: 'Hi all', ts: T, from: 'ich' }) + '\n');
write('fixiert.json', { anna: { eintraege: [{ id: 'e1', text: 'Voice', ts: T, von: 'ich' }, { id: 'e5', text: 'Answer', ts: T, von: 'anna' }], updatedAt: T } });
write('gesehen.json', { anna: { bis: T, updatedAt: T }, bert: { ungelesen: true, updatedAt: T } });
write('push-einstellungen.json', { arten: { fertig: 'aus', routine: 'leise', freigabe: 'hoch', wach: 'normal', limit: 'hoch' }, updatedAt: T });
write('kontext.json', { anna: 12345 });
write('modelle.json', [{ value: 'opus', resolvedModel: 'claude-opus', displayName: 'Opus' }]);
write('umzuege.json', { anna: 'workstation' });
write('deleted.json', { 'bot:old': T, 'wissen:bot/anna/old': T, 'wissen:ordner/c--www-x/old': T, 'wissen:alle/old': T, 'wissen:gruppe/team/old': T });
write('wissen/bot/anna/tee.md', `---\nname: tee\nbeschreibung: Was Anna trinkt\ntyp: nutzer\nupdatedAt: ${T}\n---\nGrüner Tee.\n`);
write('wissen/ordner/c--www-project/deploy.md', `---\nname: deploy\nbeschreibung: Deploy\ntyp: projekt\nupdatedAt: ${T}\n---\nVia git.\n`);
write('wissen/gruppe/team/standup.md', `---\nname: standup\nbeschreibung: Standup\ntyp: arbeitsweise\nupdatedAt: ${T}\n---\n9 Uhr.\n`);
write('wissen/alle/stil.md', `---\r\nname: stil\r\nbeschreibung: Stil\r\ntyp: verweis\r\nupdatedAt: ${T}\r\n---\r\nKnapp.\r\n`);
write('wissen/alle/notiz.md', `---\nname: notiz\nbeschreibung: Notiz\ntyp: notiz\nupdatedAt: ${T}\n---\nx\n`);
write('neustart.wunsch', { grund: 'Deploy', seit: T });
write('neustart.schnell', '');
write('notes/anna.md.migriert', '- old notes');
write('sessions.json', { anna: 'abc' });
write('vapid.json', { publicKey: 'p', privateKey: 'q' });
write('e2e-key', 'k');

// ---------------------------------------------------------------- migrate
const { migrateDataDir, dataVersion, migratePeerData, migrateSnapshot, DATA_VERSION } = await import('./migrate.ts');
check('old folder has version 1', dataVersion(dir) === 1);
const report = migrateDataDir(dir);
check('migration reports changes', !!report && report.files.length > 5 && report.entries === 8 && report.facts === 5, report);
check('version marker written', dataVersion(dir) === DATA_VERSION && read('data-version.json').version === DATA_VERSION);

const bots = read(acc('bots.json'));
check('bots: keys renamed', bots[0].favorite === true && bots[0].muted === true && bots[0].machine === 'desk' && bots[0].machineOnly === true
    && !('favorit' in bots[0]) && !('rechner' in bots[0]) && !('nurDort' in bots[0]) && !('unterhaltungen' in bots[0]), bots[0]);
check('bots: conversations renamed', JSON.stringify(bots[0].conversations[0]) === JSON.stringify({ id: 'a1b2c3d4', title: 'Release', archived: T, createdAt: T, model: 'haiku' }), bots[0].conversations);
check('bots: approval values', bots.map((b: { approval: string }) => b.approval).join() === 'risky,never,write');
const groups = read(acc('groups.json'));
check('groups: favorite and muted', groups[0].favorite === true && groups[0].muted === false && !('stumm' in groups[0]));
const routines = read(acc('routines.json'));
check('routines: wake and status values', routines[0].wake === true && routines[0].lastStatus === 'running' && routines[1].lastStatus === 'error' && !('wecken' in routines[0]), routines);

const lines = fs.readFileSync(path.join(dir, acc('history'), 'anna.jsonl'), 'utf8').split('\n');
const entries = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
check('history: entry without id gets the id the old code derived', entries[0].id === oldHash && entries[0].from === 'me', entries[0]);
check('history: voice, readAt, attachment fields', entries[1].voice === true && entries[1].readAt === T && entries[1].attachments[0].machine === 'desk' && entries[1].attachments[0].durationMs === 1234 && !('dauerMs' in entries[1].attachments[0]), entries[1]);
check('history: replyTo and movedTo', JSON.stringify(entries[2].replyTo) === JSON.stringify({ id: 'e1', from: 'me', text: 'Voice' }) && entries[2].movedTo === 'anna~a1b2c3d4', entries[2]);
check('history: deletedAt and discardedAt', entries[3].deletedAt === T && entries[4].discardedAt === T);
check('history: tool deferred', entries[5].tools[0].deferred === true && !('nachladen' in entries[5].tools[0]));
check('history: sender bot stays, quote of a bot keeps its id', entries[6].from === 'bert' && entries[6].replyTo.from === 'anna');
check('history: broken line kept as it was', lines.includes('not json'));
check('history: group file migrated', JSON.parse(fs.readFileSync(path.join(dir, acc('history'), 'group-team.jsonl'), 'utf8').split('\n')[0]).from === 'me');

check('file renames', ['pinned.json', 'seen.json', 'push-settings.json', 'context.json', 'models.json', 'transfers.json'].every((n) => exists(acc(n))) && exists('restart.fast')
    && !['fixiert.json', 'gesehen.json', 'push-einstellungen.json', 'kontext.json', 'modelle.json', 'umzuege.json', 'neustart.schnell'].some(exists));
const pinned = read(acc('pinned.json'));
check('pinned: entries and from', pinned.anna.entries.length === 2 && pinned.anna.entries[0].from === 'me' && pinned.anna.entries[1].from === 'anna' && !('eintraege' in pinned.anna), pinned);
const seen = read(acc('seen.json'));
check('seen: until and unread', seen.anna.until === T && seen.bert.unread === true && !('bis' in seen.anna), seen);
const push = read(acc('push-settings.json'));
check('push settings: kinds and values', JSON.stringify(push.kinds) === JSON.stringify({ done: 'off', routine: 'quiet', approval: 'high', awake: 'normal', limit: 'high' }), push);
check('context and models unchanged in content', read(acc('context.json')).anna === 12345 && read(acc('models.json'))[0].value === 'opus' && read(acc('transfers.json')).anna === 'workstation');
const deleted = read(acc('deleted.json'));
check('tombstones: knowledge keys and scopes', Object.keys(deleted).sort().join() === 'bot:old,knowledge:all/old,knowledge:bot/anna/old,knowledge:folder/c--www-x/old,knowledge:group/team/old', deleted);

check('knowledge: folders renamed', exists(acc('knowledge/bot/anna/tee.md')) && exists(acc('knowledge/folder/c--www-project/deploy.md')) && exists(acc('knowledge/group/team/standup.md')) && exists(acc('knowledge/all/stil.md')) && !exists('wissen'));
const tea = fs.readFileSync(path.join(dir, acc('knowledge'), 'bot', 'anna', 'tee.md'), 'utf8');
check('knowledge: front matter translated', tea.includes('\ndescription: Was Anna trinkt\ntype: user\n') && !tea.includes('beschreibung') && tea.endsWith('Grüner Tee.\n'), tea);
const style = fs.readFileSync(path.join(dir, acc('knowledge'), 'all', 'stil.md'), 'utf8');
check('knowledge: CRLF files keep their line breaks', style.includes('\r\ndescription: Stil\r\ntype: reference\r\n'), style);
check('restart request', JSON.stringify(read('restart.request')) === JSON.stringify({ reason: 'Deploy', since: T }) && !exists('neustart.wunsch'));
check('old notes marker renamed', exists(acc('notes/anna.md.migrated')) && !exists(acc('notes/anna.md.migriert')));
check('sessions.json untouched', read(acc('sessions.json')).anna === 'abc');
check('account data moved, nothing of it left at the root', ['bots.json', 'sessions.json', 'history', 'knowledge', 'notes'].every((n) => exists(acc(n)) && !exists(n)));
check('machine data stays at the root', exists('vapid.json') && exists('e2e-key') && exists('restart.request') && !exists(acc('vapid.json')) && !exists(acc('restart.request')));

// The app's modules read the migrated data
const { loadBots, loadGroups } = await import('./bots.ts');
const { readFacts, knowledgeIndex } = await import('./knowledge.ts');
const { pushSettings } = await import('./push.ts');
const { loadSeen } = await import('./seen.ts');
const { loadPinned } = await import('./pinned.ts');
const { readHistory, searchHistory } = await import('./history.ts');
const anna = loadBots().find((b) => b.id === 'anna')!;
check('app reads bots', anna.machine === 'desk' && anna.conversations?.[0].title === 'Release' && anna.sessionId === 'abc');
check('app reads groups', loadGroups()[0].favorite === true);
check('app reads facts', readFacts({ scope: 'bot', key: 'anna' })[0]?.type === 'user' && readFacts({ scope: 'all', key: '' }).find((f) => f.name === 'stil')?.type === 'reference');
check('app builds the index from all scopes', ['tee (user)', 'deploy (project)', 'standup (workstyle)'].every((x) => knowledgeIndex(anna, loadGroups()).includes(x)), knowledgeIndex(anna, loadGroups()));
check('app reads push settings', pushSettings().kinds.done === 'off' && pushSettings().kinds.approval === 'high');
check('app reads seen and pinned', loadSeen().anna.until === T && loadPinned().anna.entries.length === 2);
check('app reads history with stable ids', readHistory('anna')[0].id === oldHash && searchHistory('very old')[0]?.from === 'me');

// ---------------------------------------------------------------- idempotent
const before = fs.readFileSync(path.join(dir, acc('history'), 'anna.jsonl'), 'utf8');
check('second run does nothing', migrateDataDir(dir) === null && fs.readFileSync(path.join(dir, acc('history'), 'anna.jsonl'), 'utf8') === before);
fs.writeFileSync(path.join(dir, 'data-version.json'), JSON.stringify({ version: 1 }));
const again = migrateDataDir(dir);
check('migrating already English data changes nothing', !!again && again.files.length === 0 && again.entries === 0 && again.facts === 0 && fs.readFileSync(path.join(dir, acc('history'), 'anna.jsonl'), 'utf8') === before, again);
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-migrate-empty-'));
check('new empty folder only gets the marker', JSON.stringify(migrateDataDir(empty)) === JSON.stringify({ files: [], entries: 0, facts: 0 }) && fs.readdirSync(empty).join() === 'data-version.json');

// ---------------------------------------------------------------- data from machines with old code
const oldSnapshot = {
    bots: [{ id: 'dora', name: 'Dora', role: '', folder: 'C:/x', model: 'default', tone: '', avatar: '', approval: 'nie', rechner: 'desk', nurDort: false, stumm: true, createdAt: T, updatedAt: T }],
    groups: [], routines: [{ id: 'r9', botId: 'dora', name: 'x', cron: '* * * * *', prompt: 'x', enabled: true, wecken: true, lastStatus: 'fehler', updatedAt: T }],
    deleted: { 'wissen:ordner/x/y': T }, push: [],
    wissen: { 'ordner/c--x/regel': { name: 'regel', beschreibung: 'Regel', typ: 'arbeitsweise', text: 'x', updatedAt: T } },
    pushEinstellungen: { arten: { fertig: 'leise' }, updatedAt: T },
    verlauf: { dora: [{ id: 'v1', role: 'user', text: 'hi', ts: T, from: 'ich', gelesen: T }] },
    fixiert: { dora: { eintraege: [{ id: 'v1', text: 'hi', ts: T, von: 'ich' }], updatedAt: T } },
    gesehen: { dora: { bis: T, updatedAt: T } },
};
const s = migrateSnapshot(oldSnapshot as never);
check('snapshot: bots and routines', s.bots[0].machine === 'desk' && s.bots[0].muted === true && s.bots[0].approval === 'never' && s.routines[0].wake === true && s.routines[0].lastStatus === 'error', s.bots[0]);
check('snapshot: knowledge with scope and fields', JSON.stringify(s.knowledge) === JSON.stringify({ 'folder/c--x/regel': { name: 'regel', description: 'Regel', type: 'workstyle', text: 'x', updatedAt: T } }), s.knowledge);
check('snapshot: tombstones, push settings', Object.keys(s.deleted).join() === 'knowledge:folder/x/y' && s.pushSettings?.kinds.done === 'quiet');
check('snapshot: history, pinned, seen', s.history?.dora[0].from === 'me' && s.history?.dora[0].readAt === T && s.pinned?.dora.entries[0].from === 'me' && s.seen?.dora.until === T);
check('snapshot: an English snapshot stays as it is', JSON.stringify(migrateSnapshot(s)) === JSON.stringify(s));

const p1 = migratePeerData({ art: 'verlauf', chatId: 'dora', eintraege: [{ id: 'v2', role: 'user', text: 'x', ts: T, from: 'ich', sprache: true }] });
check('peer: history', p1.kind === 'history' && p1.entries[0].from === 'me' && p1.entries[0].voice === true, p1);
const p2 = migratePeerData({ art: 'auftrag', id: 'j1', botId: 'dora', antwort: true, turn: { chatId: 'dora', content: 'x', text: 'x', from: 'ich', kette: ['a'], hop: 0, runde: 'r', rundeSchon: ['a'], eintragId: 'v2' } });
check('peer: job with turn fields', p2.kind === 'job' && p2.reply === true && p2.turn.chain[0] === 'a' && p2.turn.round === 'r' && p2.turn.roundDone?.[0] === 'a' && p2.turn.entryId === 'v2' && p2.turn.from === 'me', p2);
const p3 = migratePeerData({ art: 'auftrag_fertig', id: 'j1', ergebnis: { text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, fehler: 'x' } });
check('peer: job result', p3.kind === 'job_done' && p3.result.error === 'x', p3);
check('peer: restart, seen, interrupt', migratePeerData({ art: 'neustart', botId: 'dora' }).kind === 'restart'
    && JSON.stringify(migratePeerData({ art: 'gesehen', stand: { dora: { bis: T, updatedAt: T } } })) === JSON.stringify({ kind: 'seen', state: { dora: { until: T, updatedAt: T } } })
    && migratePeerData({ art: 'unterbrechen', chatId: 'dora' }).kind === 'interrupt');
check('peer: encrypted frame keeps its data', JSON.stringify(migratePeerData({ art: 'e2e', iv: 'a', data: 'b' })) === JSON.stringify({ kind: 'e2e', iv: 'a', data: 'b' }));
check('peer: English data stays as it is', JSON.stringify(migratePeerData({ kind: 'restart', botId: 'x' })) === JSON.stringify({ kind: 'restart', botId: 'x' }));

// Merging an old snapshot through sync.ts lands in the English format
const { merge } = await import('./sync.ts');
const result = merge(oldSnapshot as never);
check('merge: old snapshot taken over', result.config && loadBots().find((b) => b.id === 'dora')?.machine === 'desk' && readHistory('dora')[0].from === 'me'
    && readFacts({ scope: 'folder', key: 'c--x' })[0]?.type === 'workstyle', result);

for (const d of [dir, empty]) fs.rmSync(d, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
