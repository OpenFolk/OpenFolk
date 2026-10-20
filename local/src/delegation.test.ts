// Tests for message_bot: if the target bot is busy, the job runs in a conversation of its own.
//   node local/src/delegation.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-delegation-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { BotManager } = await import('./agent.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const folder = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const sender = bots.saveBot({ ...base, id: 'chief', name: 'Chief' });
bots.saveBot({ ...base, id: 'helper', name: 'Helper' });

// Without real Claude: intercept the delivery and "answer" right away; set sessions from outside
type Inner = {
    sessions: Map<string, unknown>;
    startTurn: (bot: unknown, spec: { chatId: string }, onDone?: (e: { text: string; error?: string }) => void) => void;
    botMessage: (s: unknown, target: string, job: string, wait: boolean) => Promise<{ content: { text: string }[] }>;
};
const m = new BotManager(() => undefined) as unknown as Inner;
const delivered: string[] = [];
m.startTurn = (_bot, spec, onDone) => { delivered.push(spec.chatId); onDone?.({ text: 'done' }); };
const s = { bot: sender, currentTurn: null };

let r = await m.botMessage(s, 'helper', 'What is your folder called?', true);
check('free: job into the main chat', delivered.at(-1) === 'helper', delivered);
check('free: answer without note', r.content[0].text.startsWith('Answer from Helper:\n'), r.content[0].text);

m.sessions.set('helper', { currentTurn: { chatId: 'helper' }, waiting: () => 0, waitingPerChat: () => ({}), backgroundTasks: [] });
r = await m.botMessage(s, 'helper', 'Please check the bottom border in the web app', true);
const fresh = delivered.at(-1) ?? '';
check('busy: job in a new conversation', /^helper~[0-9a-f]{8}$/.test(fresh), delivered);
check('busy: title names the sender', bots.findConversation(fresh)?.title.startsWith('Chief: Please check') === true, bots.findConversation(fresh));
check('busy: job is in the conversation\'s history, not in the main chat', readHistory(fresh).some((e) => e.from === 'chief') && readHistory('helper').length === 1);
check('busy: answer with note', r.content[0].text.includes('in a conversation of its own'), r.content[0].text);

m.sessions.set('helper', { currentTurn: null, waiting: () => 2, waitingPerChat: () => ({ helper: 2 }), backgroundTasks: [] });
await m.botMessage(s, 'helper', 'One more question', false);
check('queue only: also a conversation of its own', (delivered.at(-1) ?? '').startsWith('helper~') && delivered.at(-1) !== fresh, delivered);

m.sessions.set('helper', { currentTurn: null, waiting: () => 0, waitingPerChat: () => ({}), backgroundTasks: [] });
await m.botMessage(s, 'helper', 'Free again?', true);
check('free again: main chat', delivered.at(-1) === 'helper', delivered);

// Who may reach whom: the sender's canMessage, set in its settings
const { botTools } = await import('./bot-tools.ts');
const host = { machineOf: () => 'here', online: () => ['here'] } as never;
const listed = async (b: unknown) => ((await botTools({ bot: b } as never, host)[0].handler({} as never, undefined)).content[0] as { text: string }).text;
bots.saveBot({ ...base, id: 'third', name: 'Third' });
check('canMessage missing: lists all', /helper/.test(await listed(bots.findBot('chief'))) && /third/.test(await listed(bots.findBot('chief'))));

const limited = bots.saveBot({ ...base, id: 'chief', name: 'Chief', canMessage: ['third', 'chief', 'nobody'] });
check('save: only existing other bots stay in the list', JSON.stringify(limited.canMessage) === '["third"]', limited.canMessage);
const count = delivered.length;
r = await m.botMessage({ bot: limited, currentTurn: null }, 'helper', 'Not allowed', true);
check('not allowed: refused with error', delivered.length === count && r.content[0].text.includes('may not give Helper jobs'), r.content[0].text);
r = await m.botMessage({ bot: limited, currentTurn: null }, 'third', 'Allowed', true);
check('allowed: delivered', delivered.at(-1) === 'third', delivered);
const shown = await listed(limited);
check('list_bots: only reachable bots and itself', /third/.test(shown) && /chief/.test(shown) && !/helper/.test(shown), shown);

const kept = bots.saveBot({ ...base, id: 'chief', name: 'Chief' });
check('save without the field (older app): keeps the list', JSON.stringify(kept.canMessage) === '["third"]', kept.canMessage);
const none = bots.saveBot({ ...base, id: 'chief', name: 'Chief', canMessage: [] });
check('none: list_bots says so', (await listed(none)).includes('not allowed you to give other bots jobs'));
const all = bots.saveBot({ ...base, id: 'chief', name: 'Chief', canMessage: null });
check('null: all again', all.canMessage === undefined && /helper/.test(await listed(all)), all.canMessage);

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
