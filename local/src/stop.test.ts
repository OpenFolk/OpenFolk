// Tests for stopping a running job (without CLI, results rebuilt):  node local/src/stop.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-stop-'));
const { BotSession, newTurn } = await import('./session.ts');
type TurnResult = import('./session.ts').TurnResult;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const bot = { id: 'skool', name: 'Skool Sven', role: '', folder: '.', model: 'default', tone: '', avatar: '', approval: 'never', machine: '', createdAt: '', updatedAt: '' } as never;
const done: TurnResult[] = [];
const states: string[] = [];
const discarded: string[] = [];
const none = () => undefined;
const hooks = {
    background: none, context: none, started: none, delta: none, tool: none, toolResult: none, error: none, account: none, usage: none,
    discarded: (_s: unknown, turns: { text: string }[]) => { discarded.push(...turns.map((x) => x.text)); },
    done: (_s: unknown, _t: unknown, e: TurnResult) => { done.push(e); },
    state: (_s: unknown, st: string) => { states.push(st); },
    approval: async () => ({ behavior: 'allow' as const, updatedInput: {} }),
    tools: () => ({}) as never,
};

// Session without a CLI process: begin the turn directly, feed the CLI's result via handle
type Inner = { beginTurn(t: unknown): void; pending: unknown[]; handle(q: unknown, m: unknown): Promise<void>; next(): void };
const fresh = () => {
    const s = new BotSession(bot, hooks as never);
    const inner = s as unknown as Inner;
    inner.next = () => undefined; // no CLI start for waiting jobs
    return { s, inner };
};
const turn = (text: string) => newTurn({ chatId: 'skool', from: 'me', text, content: text });
const abortResult = { type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0.01, session_id: 'x' };

// Stop with waiting messages: the result error_during_execution is not an error
{
    const { s, inner } = fresh();
    inner.beginTurn(turn('Please check'));
    inner.pending.push(turn('Oh, and it is about the web app'));
    await s.interrupt();
    check('stop discards the queue', discarded.join() === 'Oh, and it is about the web app', discarded);
    await inner.handle(null, abortResult);
    const e = done.at(-1)!;
    check('after stop: reported as stopped, not as an error of the CLI', e.stopped === true && e.error === 'Stopped by the user', e);
    check('after stop: bot idle instead of error', states.at(-1) === 'idle', states);
}

// without a stop the same error stays an error
{
    const { inner } = fresh();
    inner.beginTurn(turn('Something else'));
    await inner.handle(null, abortResult);
    const e = done.at(-1)!;
    check('without stop: error stays an error', !e.stopped && e.error === 'error_during_execution', e);
    check('without stop: bot shows an error', states.at(-1) === 'error', states);
}

// A stop only applies to the interrupted job, not to the next one
{
    const { s, inner } = fresh();
    inner.beginTurn(turn('First'));
    await s.interrupt();
    await inner.handle(null, { ...abortResult, subtype: 'success', is_error: false, result: 'partly' });
    check('stop without an error of the CLI: normal answer', !done.at(-1)!.stopped && !done.at(-1)!.error, done.at(-1));
    inner.beginTurn(turn('Second'));
    await inner.handle(null, abortResult);
    check('next job: error is an error again', !done.at(-1)!.stopped && done.at(-1)!.error === 'error_during_execution', done.at(-1));
}

console.log(failures ? `${failures} test(s) failed` : 'all tests passed');
process.exit(failures ? 1 : 0);
