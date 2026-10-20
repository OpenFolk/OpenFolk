// The search over the history: every word must occur, phrases in quotes, a light stem, ranking, filters, the index
// built again only when a chat's file changed, and the entries around a hit.
//   node local/src/history-index.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-history-index-'));
const { appendEntry, historyFile, markDeleted, mergeHistory, searchHistory } = await import('./history.ts');
const { entriesAround, parseQuery, searchEntries, stem } = await import('./history-index.ts');

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const ids = (hits: { id: string }[]) => hits.map((h) => h.id).join(',');

// ---- the query
check('words lower case, short ones dropped', JSON.stringify(parseQuery('Deploy a Relay').terms) === '["deploy","relay"]', parseQuery('Deploy a Relay'));
check('a phrase in quotes stays whole', JSON.stringify(parseQuery('"Push Mirror" forgejo').phrases) === '["push mirror"]');
check('stem: deployen, Releases, pushed', stem('deployen') === 'deploy' && stem('releases') === 'releas' && stem('pushed') === 'push', [stem('deployen'), stem('releases'), stem('pushed')]);
check('stem leaves short words alone', stem('ssh') === 'ssh' && stem('test') === 'test');

// ---- a few chats
const at = (day: number, h = 12) => new Date(Date.UTC(2026, 9, day, h)).toISOString();
appendEntry('cloud', { id: 'c1', role: 'user', from: 'me', text: 'Wie deployen wir das Relay nach Coolify?', ts: at(1) });
appendEntry('cloud', { id: 'c2', role: 'assistant', botId: 'cloud', text: 'Entscheidung: Das Relay wird über den Webhook deployt, nicht per Hand.', ts: at(1, 13),
    tools: [{ id: 't1', name: 'Bash', input: {}, result: 'Relay Coolify webhook output deploy' } as never] });
appendEntry('cloud', { id: 'c3', role: 'event', text: 'Relay deploy started', ts: at(2) });
appendEntry('cloud', { id: 'c4', role: 'user', from: 'me', text: 'Relay deploy bitte nochmal prüfen', ts: at(8) });
appendEntry('web', { id: 'w1', role: 'assistant', botId: 'web', text: 'Die Landingpage ist fertig; das Relay habe ich nicht angefasst, weil es dort nicht hingehört und nur mit viel Abstand zu dem anderen Wort erwähnt wird. Deploy.', ts: at(5) });
appendEntry('web', { id: 'w2', role: 'user', from: 'me', text: 'Wartet in der Warteschlange: Relay deploy', ts: at(6) });
markDeleted('web', 'w2', at(6, 13));
appendEntry('web', { id: 'w3', role: 'user', from: 'me', text: 'Verschoben: Relay deploy', ts: at(7), movedTo: 'web~x' });

const hits = searchEntries('relay deploy');
check('every word must occur, stem finds "deployt" and "deployen"', ids(hits).split(',').sort().join(',') === 'c1,c2,c4,w1', ids(hits));
check('rank: words as written first, then close together, then far apart; newest among equals', ids(hits) === 'c4,c2,c1,w1', ids(hits));
check('never events, deleted or moved entries', !/c3|w2|w3/.test(ids(hits)));
check('never the tools\' output', searchEntries('webhook output').length === 0);
check('phrase in quotes', ids(searchEntries('"über den webhook"')) === 'c2');
check('filter by chat', ids(searchEntries('relay', { chats: ['web'] })) === 'w1');
check('filter by sender', ids(searchEntries('relay', { from: 'me' })) === 'c4,c1', ids(searchEntries('relay', { from: 'me' })));
check('filter by time', ids(searchEntries('relay', { since: at(4), until: at(7) })) === 'w1');
check('time order for the web app', ids(searchEntries('relay', { order: 'time' })) === 'c4,w1,c2,c1', ids(searchEntries('relay', { order: 'time' })));
check('max', searchEntries('relay', { max: 2 }).length === 2);
check('one letter searches nothing', searchEntries('r').length === 0);
const ex = searchEntries('Coolify')[0]?.excerpt ?? '';
check('excerpt around the hit', ex.includes('Coolify'), ex);
check('the web app search: newest first, one chat', ids(searchHistory('relay', 50, 'cloud')) === 'c4,c2,c1', ids(searchHistory('relay', 50, 'cloud')));

// ---- the index follows the file
appendEntry('cloud', { id: 'c5', role: 'assistant', botId: 'cloud', text: 'Relay ist wieder grün.', ts: at(9) });
check('an appended entry is found', searchEntries('grün').map((h) => h.id).join() === 'c5');
mergeHistory('cloud', [{ id: 'm1', role: 'user', from: 'me', text: 'Vom anderen Rechner: Kaffee', ts: at(3) }]);
check('a rewritten file (sync) is read again', searchEntries('kaffee').map((h) => h.id).join() === 'm1');

// ---- around a hit
const around = entriesAround('cloud', 'c2', 1, 1).map((e) => e.id).join(',');
check('entries around a hit, without events', around === 'c1,c2,m1', around);
check('unknown entry: nothing', entriesAround('cloud', 'nope').length === 0);

// ---- a long chat
const lines: string[] = [];
for (let i = 0; i < 5000; i++) lines.push(JSON.stringify({ id: `l${i}`, role: i % 2 ? 'assistant' : 'user', botId: 'long', from: 'me', ts: at(1 + (i % 28)), text: `Eintrag ${i} über Build, Tests und das Wetter ${i % 97 === 0 ? 'mit Sonderfall Zebra' : ''}` }));
fs.writeFileSync(historyFile('long'), lines.join('\n') + '\n');
const t0 = performance.now();
searchEntries('zebra');
const built = performance.now() - t0;
const t1 = performance.now();
const zebra = searchEntries('zebra sonderfall');
const searched = performance.now() - t1;
check('5000 entries: found', zebra.length === 50 && searchEntries('zebra', { max: 1000 }).length === 52, zebra.length);
check(`5000 entries: search after the build under 50 ms (build ${built.toFixed(0)} ms, search ${searched.toFixed(0)} ms)`, searched < 50);

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('all tests passed');
