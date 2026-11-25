// Tests for messages to a working Claude bot:  node local/src/fold.test.ts
// The user's next message goes into the running turn (priority "next", as in the terminal) instead of the queue;
// "later", jobs of other bots, groups and other engines still queue; a retry sends the folded messages along.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-fold-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const { BotSession, newTurn } = await import('./session.ts');
const { checkClientFrame } = await import('./frames.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const calls: string[] = [];
const hooks = new Proxy({}, { get: (_t, name) => (_s: unknown, x?: { text?: string }) => { calls.push(`${String(name)}:${x?.text ?? ''}`); } });
const now = new Date().toISOString();
const bot = { id: 'fred', name: 'Fred', role: '', folder: process.env.ALLOWED_ROOTS, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'x', createdAt: now, updatedAt: now };
type Inner = { active: unknown; running: unknown; inbox: { priority?: string; uuid: string }[]; pending: unknown[]; folded: unknown[]; wake: (() => void) | null };
const fresh = () => {
    const s = new BotSession(bot, hooks as never);
    const i = s as unknown as Inner;
    i.active = newTurn({ chatId: 'fred', from: 'me', text: 'Build the vault', content: 'Build the vault' });
    i.running = {};
    return { s, i };
};
const turn = (more: Record<string, unknown> = {}) => newTurn({ chatId: 'fred', from: 'me', text: 'Also add tests', content: 'Also add tests', entryId: 'e2', ...more });

let { s, i } = fresh();
let woke = false;
i.wake = () => { woke = true; };
const t1 = turn();
s.send(t1);
check('a message to the working bot goes into the running turn', i.inbox.length === 1 && i.inbox[0].priority === 'next' && i.inbox[0].uuid === t1.id && i.pending.length === 0 && woke, i.inbox);
check('… marked read and said in the chat', calls.includes('started:Also add tests') && calls.includes('folded:Also add tests'), calls);
check('… not counted as waiting', s.waiting() === 0);

({ s, i } = fresh());
s.send(turn({ later: true }));
check('"Afterwards": queued behind the job', i.inbox.length === 0 && i.pending.length === 1);
({ s, i } = fresh());
s.send(turn({ from: 'cloud' }));
check('a job of another bot: queued', i.inbox.length === 0 && i.pending.length === 1);
({ s, i } = fresh());
s.send(turn({ chatId: 'fred~a1' }));
check('another chat of the bot: queued', i.pending.length === 1);
({ s, i } = fresh());
i.running = null;
s.send(turn());
check('no Claude process (another engine): queued', i.pending.length === 1 && i.inbox.length === 0);
({ s, i } = fresh());
i.active = newTurn({ chatId: 'fred', from: 'routine:daily', text: 'x', content: 'x' });
s.send(turn());
check('a routine runs: queued', i.pending.length === 1);

check('frame: send with later passes', checkClientFrame({ type: 'send', chatId: 'fred', text: 'x', later: true }).ok);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
