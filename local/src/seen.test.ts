// Tests for the shared read state:  node local/src/seen.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-seen-'));
const { applySeen, loadSeen } = await import('./seen.ts');
const { snapshot, merge } = await import('./sync.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const T1 = '2026-10-10T08:00:00.000Z';
const T2 = '2026-10-10T09:00:00.000Z';
const T3 = '2026-10-10T10:00:00.000Z';

let g = applySeen({ skool: { until: T1, updatedAt: T1 }, 'skool~ab12': { until: T1, updatedAt: T1 } });
check('new: both taken over and reported', Object.keys(g).length === 2 && loadSeen().skool.until === T1);
g = applySeen({ skool: { until: T2, updatedAt: T2 }, 'skool~ab12': { until: T1, updatedAt: T1 } });
check('newer state wins, equal one is not reported again', Object.keys(g).join() === 'skool' && loadSeen().skool.until === T2);
g = applySeen({ skool: { until: T1, updatedAt: T1 } });
check('older state changes nothing', Object.keys(g).length === 0 && loadSeen().skool.until === T2);
applySeen({ skool: { until: T2, unread: true, updatedAt: T3 } });
check('marked unread by hand stays with until', loadSeen().skool.unread === true && loadSeen().skool.until === T2);
g = applySeen({ '../x': { updatedAt: T3 }, anna: { until: 'yesterday', updatedAt: T3 }, bert: { updatedAt: 5 }, carl: null });
check('invalid chat ids and values dropped', Object.keys(g).length === 0);
applySeen({ bert: { until: T3, updatedAt: T3, foreign: 'x' } as never });
check('only known fields stored', JSON.stringify(loadSeen().bert) === JSON.stringify({ updatedAt: T3, until: T3 }));

// Sync between machines via the snapshot
check('snapshot contains the read state', snapshot(false).seen?.skool?.updatedAt === T3);
const result = merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], seen: { anna: { until: T3, updatedAt: T3 } } });
check('snapshot of another machine: taken over and reported', result.seen && loadSeen().anna?.until === T3);

fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
