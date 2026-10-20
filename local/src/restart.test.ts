// Tests for the restart without admin rights:  node local/src/restart.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-restart-'));
const { requestRestart, watchRestart } = await import('./restart.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let busy = true;
let exited: string | null = null;
const t0 = Date.now();
const timer = watchRestart(() => busy, (reason) => { exited = `${reason} after ${((Date.now() - t0) / 1000).toFixed(0)} s`; });

await wait(2500);
check('no restart without request', exited === null);

requestRestart('Test');
await wait(4500);
check('requested, but a bot is working: waits', exited === null && fs.existsSync(path.join(process.env.DATA_DIR!, 'restart.request')));

busy = false;
await wait(3000);
check('free, but not yet 5 s quiet: waits', exited === null);
await wait(5000);
check('after 5 s quiet: restart with reason', exited !== null && (exited as string).startsWith('Test'));
check('request removed', !fs.existsSync(path.join(process.env.DATA_DIR!, 'restart.request')));
check('marker for a fast restart set', fs.existsSync(path.join(process.env.DATA_DIR!, 'restart.fast')));

clearInterval(timer);

// Backend code changed since the start
const { changedSince } = await import('./restart.ts');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-code-'));
for (const d of ['local/src', 'shared']) fs.mkdirSync(path.join(repo, d), { recursive: true });
for (const f of ['local/src/agent.ts', 'local/src/agent.test.ts', 'shared/protocol.ts', 'local/package.json', 'README.md']) fs.writeFileSync(path.join(repo, f), 'x');
const start = Date.now() + 60_000;
check('nothing newer than the start: empty', changedSince(start, repo).length === 0);
const later = new Date(start + 5000);
for (const f of ['local/src/agent.ts', 'local/src/agent.test.ts', 'shared/protocol.ts', 'README.md']) fs.utimesSync(path.join(repo, f), later, later);
check('changed: code and protocol, not tests and README', JSON.stringify(changedSince(start, repo)) === '["local/src/agent.ts","shared/protocol.ts"]');
fs.rmSync(repo, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
