// Runs every *.test.ts in a folder, each in its own Node process (the tests are plain scripts that print `ok` or
// `FAILED` per check and exit non-zero on a failure), and sums up. A new test file needs no registration.
//   node scripts/test.mjs local/src          all backend tests
//   node scripts/test.mjs local/src push     only files whose name contains "push"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [dir, filter = ''] = process.argv.slice(2);
if (!dir) {
    console.error('Usage: node scripts/test.mjs <folder> [name filter]');
    process.exit(2);
}
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.test.ts') && n.includes(filter)).sort();
const failed = [];
const t0 = Date.now();
for (const file of files) {
    const started = Date.now();
    const r = spawnSync(process.execPath, [path.join(dir, file)], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const ok = r.status === 0 && !/^FAIL/m.test(out);
    const checks = (out.match(/^ok /gm) ?? []).length;
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${file} (${checks} checks, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    if (!ok) {
        failed.push(file);
        console.log(out.split('\n').filter((l) => /^FAIL|Error|error/.test(l)).slice(0, 10).map((l) => `       ${l}`).join('\n'));
    }
}
console.log(failed.length
    ? `${failed.length} of ${files.length} test file(s) failed: ${failed.join(', ')}`
    : `all ${files.length} test files passed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failed.length ? 1 : 0);
