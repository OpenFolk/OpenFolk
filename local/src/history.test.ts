// Tests for the history (read marks, search, queue markers):  node local/src/history.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-history-'));
const { readHistory, markRead, appendEntry } = await import('./history.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };

const a = appendEntry('test', { role: 'user', text: 'one', ts: '2026-10-07T10:00:00Z', from: 'me' });
const b = appendEntry('test', { role: 'user', text: 'two', ts: '2026-10-07T10:01:00Z', from: 'me' });

check('marks an existing entry', markRead('test', a.id!, '2026-10-07T10:02:00Z'));
const v = readHistory('test');
check('readAt stored', v[0].readAt === '2026-10-07T10:02:00Z');
check('other entry unchanged', v[1].id === b.id && !v[1].readAt);
check('order and texts stay', v.map((e) => e.text).join(',') === 'one,two');
check('marking again changes nothing', !markRead('test', a.id!, '2026-10-07T11:00:00Z') && readHistory('test')[0].readAt === '2026-10-07T10:02:00Z');
check('unknown id', !markRead('test', 'doesnotexist', '2026-10-07T10:02:00Z'));
check('unknown chat', !markRead('missing', a.id!, '2026-10-07T10:02:00Z'));
appendEntry('test', { role: 'user', text: 'three', ts: '2026-10-07T10:03:00Z', from: 'me' });
check('appending after rewriting', readHistory('test').length === 3);

// Search over all chats
const { searchHistory } = await import('./history.ts');
appendEntry('cloud', { role: 'assistant', text: 'The deploy to the server went through.', ts: '2026-10-08T10:00:00Z', botId: 'cloud' });
appendEntry('skool~ab12', { role: 'user', text: 'When does the next DEPLOY go out?', ts: '2026-10-08T11:00:00Z', from: 'me' });
appendEntry('cloud', { role: 'event', text: 'Deploy event', ts: '2026-10-08T12:00:00Z' });
const hits = searchHistory('deploy');
check('finds in all chats, also conversations, without events', hits.map((x) => x.chatId).join(',') === 'skool~ab12,cloud');
check('case-insensitive, newest first', hits[0].excerpt.includes('DEPLOY') && hits[0].ts > hits[1].ts);
check('sender and entry id included', hits[1].from === 'cloud' && hits[0].from === 'me' && !!hits[0].id);
check('no search under two characters', searchHistory('d').length === 0);
check('with chatId only in that chat', searchHistory('deploy', 50, 'cloud').map((x) => x.chatId).join(',') === 'cloud');
const long = 'x'.repeat(200) + ' Keyword ' + 'y'.repeat(200);
appendEntry('test', { role: 'user', text: long, ts: '2026-10-08T13:00:00Z', from: 'me' });
const excerpt = searchHistory('keyword')[0].excerpt;
check('excerpt around the hit, truncated', excerpt.startsWith('…') && excerpt.endsWith('…') && excerpt.length < 170 && excerpt.includes('Keyword'));

// Deleted from the queue: stays in the file, missing in display and search
const { markDeleted, readVisible } = await import('./history.ts');
const gone = appendEntry('test', { role: 'user', text: 'Throwaway message', ts: '2026-10-08T14:00:00Z', from: 'me' });
check('delete marks', markDeleted('test', gone.id!, '2026-10-08T14:00:05Z'));
check('deleting again changes nothing', !markDeleted('test', gone.id!, '2026-10-08T14:00:09Z'));
check('stays as a marker in the history (for syncing)', readHistory('test').some((e) => e.id === gone.id && e.deletedAt === '2026-10-08T14:00:05Z'));
check('missing in the display', !readVisible('test').some((e) => e.id === gone.id) && readVisible('test').length === readHistory('test').length - 1);
check('missing in the search', searchHistory('throwaway').length === 0);

// Discarded (queue cleared): only unread ones, only once; stays visible
const { markDiscarded, readEntry } = await import('./history.ts');
const waiting = appendEntry('test', { role: 'user', text: 'Waiting one', ts: '2026-10-08T15:00:00Z', from: 'me' });
check('discard marks', markDiscarded('test', waiting.id!, '2026-10-08T15:00:05Z') && readEntry('test', waiting.id!)?.discardedAt === '2026-10-08T15:00:05Z');
check('discarding again changes nothing', !markDiscarded('test', waiting.id!, '2026-10-08T15:00:09Z'));
check('a read one is not discarded', !markDiscarded('test', a.id!, '2026-10-08T15:00:05Z'));
check('discarded one stays in the display', readVisible('test').some((e) => e.id === waiting.id));

// Tool output: not in the history for the browser, fetchable one by one
const { withoutToolOutput, toolOutput } = await import('./history.ts');
const withTools = appendEntry('test', {
    role: 'assistant', text: 'done', ts: '2026-10-08T16:00:00Z', botId: 'test',
    tools: [{ id: 't1', name: 'Grep', summary: 'pattern', ok: true, result: 'lots of output' }, { id: 't2', name: 'Read', summary: 'file', ok: true }],
});
const light = withoutToolOutput(readVisible('test')).find((e) => e.id === withTools.id)!;
check('output missing, tool marked as deferred', !light.tools![0].result && light.tools![0].deferred === true && light.tools![0].summary === 'pattern');
check('tool without output stays without mark', !light.tools![1].deferred);
check('stored entry unchanged', readEntry('test', withTools.id!)?.tools?.[0].result === 'lots of output');
check('output fetchable one by one', toolOutput('test', withTools.id!, 't1') === 'lots of output');
check('unknown tool', toolOutput('test', withTools.id!, 'missing') === undefined && toolOutput('test', 'missing', 't1') === undefined);

if (failures) process.exit(1);
console.log('all tests passed');
