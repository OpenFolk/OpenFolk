// Tests for stopping a bot's background tasks from the app (task_stop):  node local/src/task-stop.test.ts
// The session hands each id it knows to the CLI's stopTask; unknown ids and a session without a CLI process do nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-task-stop-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const { BotSession } = await import('./session.ts');
const { checkClientFrame } = await import('./frames.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const hooks = new Proxy({}, { get: () => () => undefined });
const now = new Date().toISOString();
const bot = { id: 'fred', name: 'Fred', role: '', folder: process.env.ALLOWED_ROOTS, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'x', createdAt: now, updatedAt: now };
const s = new BotSession(bot, hooks as never);
const stopped: string[] = [];
const inner = s as unknown as { running: unknown; background: Map<string, string> };
inner.background = new Map([['t1', 'npm test'], ['t2', 'build']]);
inner.running = { stopTask: async (id: string) => { stopped.push(id); } };
await s.stopTasks(['t2', 'gone']);
check('a known task goes to the CLI, an unknown id does not', stopped.join() === 't2', stopped);
inner.running = null;
await s.stopTasks(['t1']);
check('without a CLI process nothing happens', stopped.join() === 't2');
check('frame: task_stop with ids passes', checkClientFrame({ type: 'task_stop', chatId: 'fred', taskIds: ['t1'] }).ok);
check('frame: task_stop without ids is refused', !checkClientFrame({ type: 'task_stop', chatId: 'fred', taskIds: [] }).ok);

console.log(failures ? `\n${failures} failure(s)` : '\nall tests passed');
process.exit(failures ? 1 : 0);
