// Tests for "last connected" of the backends (survives a relay restart):  node relay/src/machines-seen.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MachinesSeen } from './machines-seen.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`); if (!ok) failed++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-machines-seen-'));
const s = new MachinesSeen(dir);
check('initially the relay knows no machine', JSON.stringify(s.gone([])) === '{}');

s.record(['desktop', 'laptop'], new Date('2026-10-08T21:00:00Z'));
s.record(['desktop'], new Date('2026-10-08T21:05:00Z'));
check('connected machines do not count as gone', JSON.stringify(s.gone(['desktop', 'laptop'])) === '{}');
check('disconnected machine with the time of its last connection', s.gone(['desktop']).laptop === '2026-10-08T21:00:00.000Z');

const afterRestart = new MachinesSeen(dir);
const gone = afterRestart.gone([]);
check('still known after the relay restarts', gone.laptop === '2026-10-08T21:00:00.000Z' && gone.desktop === '2026-10-08T21:05:00.000Z');

fs.writeFileSync(path.join(dir, 'machines-seen.json'), 'broken');
check('broken file: empty instead of a crash', JSON.stringify(new MachinesSeen(dir).gone([])) === '{}');

fs.rmSync(dir, { recursive: true, force: true });
if (failed) {
    console.log(`${failed} test(s) failed`);
    process.exit(1);
}
console.log('all tests passed');
