// Tests for the runs of routines and their next run:  node local/src/routines.test.ts
// Runs are kept newest first (at most 20) in the routine, keep the entry to jump to, survive a save from the editor
// and travel to another machine with the sync; the list for the web app carries the next run of active routines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-routines-'));
const { nextRun } = await import('./cron.ts');
const { RUNS_KEPT, loadRoutines, routinesWithNextRun, runFinished, runStarted, saveRoutine, saveRoutines } = await import('./routines.ts');
const { merge, snapshot } = await import('./sync.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

// ---- next run from the cron expression
const monday = new Date('2026-11-16T09:30:00');
const weekdays8 = nextRun('0 8 * * 1-5', monday);
check('next run: weekdays 8:00 after Monday 9:30 is Tuesday 8:00', weekdays8?.getDay() === 2 && weekdays8.getHours() === 8 && weekdays8.getMinutes() === 0, weekdays8);
const every2h = nextRun('0 */2 * * *', monday);
check('next run: every 2 hours after 9:30 is 10:00', every2h?.getHours() === 10 && every2h.getDate() === 16, every2h);
check('next run: never (31 February)', nextRun('0 8 31 2 *', monday) === null);

// ---- the list for the web app
const daily = saveRoutine({ id: '', botId: 'ada', name: 'Report', cron: '0 8 * * *', prompt: 'Write the report.', enabled: true });
const paused = saveRoutine({ id: '', botId: 'ada', name: 'Paused', cron: '0 9 * * *', prompt: 'x', enabled: false });
const listed = routinesWithNextRun(monday);
const next = listed.find((r) => r.id === daily.id)?.nextRun;
check('an active routine carries its next run', next !== undefined && new Date(next).getTime() === new Date('2026-11-17T08:00:00').getTime(), next);
check('a paused one has none', listed.find((r) => r.id === paused.id)?.nextRun === undefined);
check('the next run is never stored', loadRoutines().every((r) => r.nextRun === undefined));

// ---- run log
runStarted(daily.id, '2026-11-16T08:00:00.000Z', 'e-prompt');
let r = loadRoutines().find((x) => x.id === daily.id)!;
check('a started run: running, with the routine\'s message', r.lastStatus === 'running' && r.lastRun === '2026-11-16T08:00:00.000Z'
    && r.runs?.length === 1 && r.runs[0].status === 'running' && r.runs[0].entryId === 'e-prompt' && !r.runs[0].end, r.runs);
runFinished(daily.id, '2026-11-16T08:00:00.000Z', { entryId: 'e-answer' }, new Date('2026-11-16T08:01:30.000Z'));
r = loadRoutines().find((x) => x.id === daily.id)!;
check('finished: ok, end, jumps to the answer', r.lastStatus === 'ok' && r.runs?.[0].status === 'ok' && r.runs[0].end === '2026-11-16T08:01:30.000Z' && r.runs[0].entryId === 'e-answer', r.runs);

runStarted(daily.id, '2026-11-17T08:00:00.000Z', 'e-prompt-2');
runFinished(daily.id, '2026-11-17T08:00:00.000Z', { error: 'The machine OFFICE is asleep.' });
r = loadRoutines().find((x) => x.id === daily.id)!;
check('failed without an answer: error with reason, the jump stays at its message', r.lastStatus === 'error' && r.runs?.[0].status === 'error'
    && r.runs[0].error === 'The machine OFFICE is asleep.' && r.runs[0].entryId === 'e-prompt-2' && r.runs[1].status === 'ok', r.runs);

for (let i = 0; i < 25; i++) {
    const start = new Date(Date.UTC(2026, 11, 1, 8, i)).toISOString();
    runStarted(daily.id, start);
    runFinished(daily.id, start, {});
}
r = loadRoutines().find((x) => x.id === daily.id)!;
check(`at most ${RUNS_KEPT} runs, newest first`, r.runs?.length === RUNS_KEPT && r.runs[0].start === new Date(Date.UTC(2026, 11, 1, 8, 24)).toISOString()
    && r.runs.every((x, i) => i === 0 || r.runs![i - 1].start > x.start), r.runs?.length);

runFinished(daily.id, '1999-01-01T00:00:00.000Z', {});
check('the end of an unknown run changes no run', loadRoutines().find((x) => x.id === daily.id)!.runs?.length === RUNS_KEPT);

// ---- a save from the editor (pause switch) keeps the runs
saveRoutine({ id: daily.id, botId: 'ada', name: 'Report', cron: '0 8 * * *', prompt: 'Write the report.', enabled: false });
r = loadRoutines().find((x) => x.id === daily.id)!;
check('pausing keeps the runs', !r.enabled && r.runs?.length === RUNS_KEPT);
check('a paused routine has no next run', routinesWithNextRun(monday).find((x) => x.id === daily.id)?.nextRun === undefined);

// ---- the runs travel with the sync to another machine
const out = snapshot(false);
check('the snapshot carries the runs', out.routines.find((x) => x.id === daily.id)?.runs?.length === RUNS_KEPT);
saveRoutines([]);
const result = merge({ ...out, bots: [], groups: [] });
r = loadRoutines().find((x) => x.id === daily.id)!;
check('merged on the other machine with its runs', result.config && r?.runs?.length === RUNS_KEPT && r.runs[0].entryId === undefined, r?.runs?.length);

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
