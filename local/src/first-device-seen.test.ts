// The code for a first device stays out of the log once a device of the main account has talked to the backend:
// noteDeviceSeen() writes a mark into the data folder, deviceSeen() reads it, also in a later run.
//   node local/src/first-device-seen.test.ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-first-seen-'));
// Each run is a process of its own: the module reads the environment and the mark once
const run = (container: boolean, code: string) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    const m = await import(${JSON.stringify(new URL('./first-device.ts', import.meta.url).href)});
    const before = m.deviceSeen();
    ${code}
    console.log(JSON.stringify({ code: Boolean(m.firstDeviceCode), before, after: m.deviceSeen() }));
`], { env: { ...process.env, DATA_DIR: dir, OPENFOLK_CONTAINER: container ? '1' : '' }, encoding: 'utf8' }).trim().split('\n').pop() ?? '';

try {
    const first = JSON.parse(run(true, ''));
    check('container, nothing seen yet: a code, no mark', first.code && !first.before && !first.after, first);
    const noted = JSON.parse(run(true, 'm.noteDeviceSeen();'));
    check('a device of the main account talked: noted', !noted.before && noted.after && fs.existsSync(path.join(dir, 'first-device-seen')), noted);
    const later = JSON.parse(run(true, ''));
    check('the next start knows it: the log keeps the code to itself', later.before && later.after, later);

    fs.rmSync(path.join(dir, 'first-device-seen'));
    const outside = JSON.parse(run(false, 'm.noteDeviceSeen();'));
    check('outside a container (no code): nothing is written', !outside.code && !outside.after && !fs.existsSync(path.join(dir, 'first-device-seen')), outside);
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exitCode = failures ? 1 : 0;
