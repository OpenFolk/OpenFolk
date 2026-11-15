// Tests for a bot changing its own routines and for the run log of a routine run:  node local/src/routine-tool.test.ts
// set_routine changes or creates routines of this bot only, with a line in the chat; list_routines shows them; a run
// keeps the routine's message and, once answered, the answer to jump to.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-routine-tool-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-routine-claude-'));
process.env.MACHINE_NAME = 'workstation';
const folder = path.resolve(import.meta.dirname, '..', '..');
process.env.ALLOWED_ROOTS = folder;
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { loadRoutines, saveRoutine } = await import('./routines.ts');
const { BotManager } = await import('./agent.ts');
const { botTools, engineToolsFor } = await import('./bot-tools.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'workstation' };
const me = bots.saveBot({ ...base, id: 'ada', name: 'Ada' });
bots.saveBot({ ...base, id: 'other', name: 'Other' });
const report = saveRoutine({ id: '', botId: 'ada', name: 'Morning report', cron: '0 8 * * 1-5', prompt: 'Summarize the inbox.', enabled: true, wake: true });
const foreign = saveRoutine({ id: '', botId: 'other', name: 'Backup', cron: '0 3 * * *', prompt: 'Check the backup.', enabled: true });

type Result = { text: string; tools: never[]; attachments: never[]; durationMs: number; costUsd: number; error?: string; entryId?: string };
type Inner = {
    toolHost: unknown;
    updateAgents: (o: string[]) => void;
    startTurn: (bot: { id: string }, spec: { chatId: string; content: unknown }, onDone?: (e: Result) => void) => void;
    runRoutine: (r: unknown) => void;
    done: (s: unknown, turn: unknown, e: Result) => void;
};
const sent: { type: string }[] = [];
const m = new BotManager((f: { type: string }) => { sent.push(f); }) as unknown as Inner;
m.updateAgents(['workstation']);
const turns: { botId: string; chatId: string; onDone?: (e: Result) => void }[] = [];
m.startTurn = (bot, spec, onDone) => { turns.push({ botId: bot.id, chatId: spec.chatId, onDone }); };

const s = { bot: me, currentTurn: { chatId: 'ada' } };
const tools = botTools(s as never, m.toolHost as never);
const run = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.find((x) => x.name === name)!.handler(args as never, undefined);
    return { text: (r.content[0] as { text: string }).text, error: r.isError === true };
};
const engineTools = engineToolsFor(s as never, m.toolHost as never);
check('list_routines and set_routine are tools of the other engines too, with a schema', ['list_routines', 'set_routine'].every((n) => engineTools.some((x) => x.name === n))
    && JSON.stringify(engineTools.find((x) => x.name === 'set_routine')?.schema).includes('new_name'));
const own = (name: string) => loadRoutines().find((r) => r.botId === 'ada' && r.name === name);

// ---- list_routines
const listed = await run('list_routines', {});
check('list_routines: its own routines with cron, state and instruction', listed.text.includes('Morning report') && listed.text.includes('0 8 * * 1-5')
    && listed.text.includes('Summarize the inbox.') && listed.text.includes('active') && !listed.text.includes('Backup'), listed.text);

// ---- set_routine changes
const before = sent.length;
const r1 = await run('set_routine', { name: 'morning report', cron: '0 7 * * 1-5', enabled: false });
const changed = own('Morning report')!;
check('found by name regardless of case; cron and pause set', !r1.error && changed.id === report.id && changed.cron === '0 7 * * 1-5' && !changed.enabled, changed);
check('instruction and wake stay', changed.prompt === 'Summarize the inbox.' && changed.wake === true);
check('the chat says what changed', readHistory('ada').some((e) => e.role === 'event' && e.text.includes('Ada changed the routine "Morning report"') && e.text.includes('0 7 * * 1-5') && e.text.includes('paused')),
    readHistory('ada').map((e) => e.text));
check('the web app gets the new list', sent.slice(before).some((f) => f.type === 'routines'));

const r2 = await run('set_routine', { name: 'Morning report', new_name: 'Inbox', prompt: 'Summarize the inbox and the calendar.', enabled: true });
const renamed = loadRoutines().find((r) => r.id === report.id)!;
check('rename, new instruction, resumed', !r2.error && renamed.name === 'Inbox' && renamed.prompt === 'Summarize the inbox and the calendar.' && renamed.enabled, renamed);

const r3 = await run('set_routine', { name: 'Inbox', cron: '0 7 * * 1-5' });
check('nothing to set: error', r3.error && r3.text.includes('Nothing to set'), r3);
const r4 = await run('set_routine', { name: 'Inbox', cron: 'every morning' });
check('an invalid cron: error, nothing changed', r4.error && loadRoutines().find((r) => r.id === report.id)!.cron === '0 7 * * 1-5', r4);

// ---- only its own routines; a new one needs cron and prompt
const r5 = await run('set_routine', { name: 'Backup', enabled: false });
check('another bot\'s routine is not found, and stays', r5.error && r5.text.includes('"Inbox"') && loadRoutines().find((r) => r.id === foreign.id)!.enabled, r5);
const r6 = await run('set_routine', { name: 'Weekly review', cron: '0 16 * * 5', prompt: 'Review the week.' });
const created = own('Weekly review');
check('created for itself, active, without waking the machine', !r6.error && created?.botId === 'ada' && created.enabled && !created.wake && created.cron === '0 16 * * 5', created);
check('the chat says it was created', readHistory('ada').some((e) => e.role === 'event' && e.text.includes('Ada created the routine "Weekly review"')));
check('two routines of its own, the other bot keeps one', loadRoutines().filter((r) => r.botId === 'ada').length === 2 && loadRoutines().filter((r) => r.botId === 'other').length === 1);

// ---- a run: the routine's message, then the answer to jump to
const inbox = loadRoutines().find((r) => r.id === report.id)!;
m.runRoutine(inbox);
const prompt = readHistory('ada').findLast((e) => e.role === 'user' && e.from === 'routine:Inbox');
let logged = loadRoutines().find((r) => r.id === report.id)!.runs ?? [];
check('a run starts in the main chat: running, at the routine\'s message', turns.length === 1 && turns[0].chatId === 'ada' && logged.length === 1
    && logged[0].status === 'running' && !!prompt?.id && logged[0].entryId === prompt.id, logged);
// the session reports the answer: done() records it and names it in the result handed on
const result: Result = { text: 'All quiet.', tools: [], attachments: [], durationMs: 5, costUsd: 0 };
m.done({ bot: me, key: 'ada' }, { chatId: 'ada', from: 'routine:Inbox', hop: 0, chain: [] }, result);
const answer = readHistory('ada').findLast((e) => e.role === 'assistant');
check('the recorded answer is named in the result', !!answer?.id && result.entryId === answer.id, result);
turns[0].onDone?.(result);
logged = loadRoutines().find((r) => r.id === report.id)!.runs ?? [];
check('ended: ok, with an end, jumps to the answer', logged[0].status === 'ok' && !!logged[0].end && logged[0].entryId === answer?.id, logged);
m.runRoutine(inbox);
turns[1].onDone?.({ text: '', tools: [], attachments: [], durationMs: 0, costUsd: 0, error: 'The machine OFFICE is asleep.' });
logged = loadRoutines().find((r) => r.id === report.id)!.runs ?? [];
check('a failed run keeps its reason, newest first', logged.length === 2 && logged[0].status === 'error' && logged[0].error === 'The machine OFFICE is asleep.' && logged[1].status === 'ok', logged);

for (const d of [process.env.DATA_DIR!, process.env.CLAUDE_CONFIG_DIR!]) fs.rmSync(d, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
