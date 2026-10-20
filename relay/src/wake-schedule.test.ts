// Tests for the relay's wake scheduler (routines with `wake`), without a wake service:  node relay/src/wake-schedule.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LEAD_MS, WakeScheduler, toWakeEntries } from './wake-schedule.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`); if (!ok) failed++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-wake-schedule-'));
let online: string[] = [];
const woken: { machine: string; routines: string[] }[] = [];
const create = () => new WakeScheduler(dir, {
    online: () => online,
    wakeable: async () => ['laptop', 'desktop'].sort(),
    wake: async (machine, routines) => { woken.push({ machine, routines: routines.map((r) => r.id) }); },
}, () => undefined);

const t = Date.parse('2026-10-08T05:30:00Z');
const scheduler = create();
scheduler.set([
    { routineId: 'mail', at: '2026-10-08T05:30:00Z', machine: '', machineOnly: false },
    { routineId: 'cloud', at: '2026-10-08T05:30:00Z', machine: 'desktop', machineOnly: false },
    { routineId: 'win', at: '2026-10-08T05:30:00Z', machine: 'laptop', machineOnly: true },
    { routineId: 'later', at: '2026-10-08T09:00:00Z', machine: 'desktop', machineOnly: false },
    { routineId: '../evil', at: 'broken', machine: 'DESKTOP!', machineOnly: 'yes' },
]);
check('invalid entries dropped, schedule saved', JSON.parse(fs.readFileSync(path.join(dir, 'wake-schedule.json'), 'utf8')).length === 4);

await scheduler.check(t - LEAD_MS - 60_000);
check('before the lead time: nothing woken', woken.length === 0);

await scheduler.check(t - LEAD_MS + 1000);
const desktop = woken.find((w) => w.machine === 'desktop');
const laptop = woken.find((w) => w.machine === 'laptop');
check('all off: each machine woken once', woken.length === 2);
check('without a preferred machine: alphabetically first (desktop), together with cloud', !!desktop && desktop.routines.sort().join() === 'cloud,mail');
check('machineOnly: its own machine', !!laptop && laptop.routines.join() === 'win');
check('later run not yet', !woken.some((w) => w.routines.includes('later')));

await scheduler.check(t);
check('each run only once', woken.length === 2);

// A new scheduler reads the saved schedule (relay restart) and wakes only when needed
woken.length = 0;
const afterRestart = create();
online = ['desktop'];
await afterRestart.check(Date.parse('2026-10-08T09:00:00Z') - 60_000);
check('machine already awake: not woken', woken.length === 0);

woken.length = 0;
const s2 = create();
s2.set([{ routineId: 'win2', at: '2026-10-09T05:30:00Z', machine: 'laptop', machineOnly: true }]);
online = ['desktop'];
await s2.check(Date.parse('2026-10-09T05:29:00Z'));
check('machineOnly with only another machine awake: woken anyway', woken.length === 1 && woken[0].machine === 'laptop');

woken.length = 0;
const s3 = create();
s3.set([{ routineId: 'old', at: '2026-10-09T05:30:00Z', machine: '', machineOnly: false }]);
online = [];
await s3.check(Date.parse('2026-10-09T05:40:00Z'));
check('long past (relay was off): no longer woken', woken.length === 0);

// Schedules from older backends with German field names
const legacy = toWakeEntries([{ routineId: 'r1', zeit: '2026-10-10T06:00:00Z', rechner: 'laptop', nurDort: true }]);
check('old field names are mapped', legacy.length === 1 && legacy[0].at === '2026-10-10T06:00:00.000Z' && legacy[0].machine === 'laptop' && legacy[0].machineOnly === true);

fs.rmSync(dir, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('all tests passed');
