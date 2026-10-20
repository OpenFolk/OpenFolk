// Tests for the backends' wake schedule (routines with `wake`):  node local/src/wake-schedule.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-wake-schedule-'));
const { runs } = await import('./cron.ts');
const { saveRoutine, wakeSchedule } = await import('./routines.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };

const from = new Date('2026-10-05T12:00:00');
const workdays = runs('30 7 * * 1-5', from, new Date('2026-10-12T12:00:00'));
check('runs: workdays 7:30, Tue to Mon = 5 runs', workdays.length === 5 && workdays[0].getHours() === 7 && workdays[0].getDay() === 2);
check('runs: max limited', runs('* * * * *', from, new Date('2026-10-06T12:00:00'), 10).length === 10);

const bots = [
    { id: 'mail', machine: '' },
    { id: 'win', machine: 'office' },
    { id: 'cloud', machine: 'workstation' },
];
saveRoutine({ id: '', botId: 'mail', name: 'Inbox', cron: '0 8 * * *', prompt: 'x', enabled: true, wake: true });
saveRoutine({ id: '', botId: 'win', name: 'Updates', cron: '0 3 * * 0', prompt: 'x', enabled: true, wake: true });
saveRoutine({ id: '', botId: 'cloud', name: 'without wake', cron: '0 9 * * *', prompt: 'x', enabled: true });
saveRoutine({ id: '', botId: 'mail', name: 'paused', cron: '0 10 * * *', prompt: 'x', enabled: false, wake: true });
saveRoutine({ id: '', botId: 'gone', name: 'bot deleted', cron: '0 11 * * *', prompt: 'x', enabled: true, wake: true });

const schedule = wakeSchedule(bots, new Date('2026-10-07T12:00:00'));
const mail = schedule.filter((e) => e.machine === '');
const win = schedule.filter((e) => e.machine === 'office');
check('only active routines with wake and an existing bot', schedule.length === mail.length + win.length && mail.length === 14 && win.length === 2);
check('local time 8:00 as a UTC time', new Date(mail[0].at).getHours() === 8 && mail[0].at.endsWith('Z'));
check('a bot with a machine wakes exactly that one, one not placed yet any', win.every((e) => e.machineOnly) && mail.every((e) => !e.machineOnly));
check('sorted by time', schedule.every((e, i) => i === 0 || schedule[i - 1].at <= e.at));

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
