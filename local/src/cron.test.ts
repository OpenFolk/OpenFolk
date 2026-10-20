// Tests for the cron parser:  node local/src/cron.test.ts
import { nextRun, parseCron } from './cron.ts';

let failures = 0;
function check(name: string, ok: boolean): void {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`);
    if (!ok) failures++;
}

const cases: [string, string, boolean][] = [
    ['30 7 * * 1-5', '2026-10-06T07:30:00', true],   // Tuesday
    ['30 7 * * 1-5', '2026-10-04T07:30:00', false],  // Sunday
    ['30 7 * * 1-5', '2026-10-06T07:31:00', false],
    ['*/15 * * * *', '2026-10-06T10:45:00', true],
    ['*/15 * * * *', '2026-10-06T10:46:00', false],
    ['0 9 1 * *', '2026-10-01T09:00:00', true],
    ['0 9 * * 0', '2026-10-04T09:00:00', true],
    ['0 9 * * 7', '2026-10-04T09:00:00', true],
    ['0 8-18/2 * * *', '2026-10-06T14:00:00', true],
    ['0 8-18/2 * * *', '2026-10-06T15:00:00', false],
    ['0 9 15 * 1', '2026-10-05T09:00:00', true],      // Monday, day ≠ 15: day OR weekday
];
for (const [cron, time, expected] of cases) check(`${cron} @ ${time} → ${expected}`, parseCron(cron).matches(new Date(time)) === expected);

const n = nextRun('30 7 * * 1-5', new Date('2026-10-04T12:00:00'));
check('next workday from Sunday is Monday 7:30', !!n && n.getDay() === 1 && n.getHours() === 7 && n.getMinutes() === 30);

for (const invalid of ['61 * * * *', '* * * *', '0 25 * * *', '*/0 * * * *']) {
    let thrown = false;
    try { parseCron(invalid); } catch { thrown = true; }
    check(`invalid: ${invalid}`, thrown);
}

if (failures) {
    console.log(`${failures} failures`);
    process.exit(1);
}
console.log('all tests passed');
