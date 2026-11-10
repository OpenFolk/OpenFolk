// Tests for jobs between bots (message_bot, list_conversations; local/src/jobs.ts):  node local/src/delegation.test.ts
// The result of a job comes back into the chat that gave it by itself, also across machines, after the source slept,
// and after the target restarted; loops are refused; who may reach whom stays the user's choice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-delegation-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
process.env.MACHINE_NAME = 'desk';
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { openJobs } = await import('./jobs.ts');
const { BotManager } = await import('./agent.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const folder = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'desk' };
const sender = bots.saveBot({ ...base, id: 'chief', name: 'Chief' });
bots.saveBot({ ...base, id: 'helper', name: 'Helper' });

type Result = { text: string; tools: never[]; attachments: never[]; durationMs: number; costUsd: number; error?: string; stopped?: boolean };
type TurnLike = { chatId: string; from: string; chain: string[]; chats?: string[]; job?: { id: string; machine: string; chatId: string }; content: unknown };
type Inner = {
    sessions: Map<string, unknown>;
    runHere: (bot: { id: string }, turn: TurnLike, onDone?: (e: Result) => void) => void;
    botMessage: (s: unknown, target: string, job: string, wait: boolean, conversation?: string) => Promise<{ content: { text: string }[]; isError: boolean }>;
    peerInbound: (from: string, d: unknown) => void;
    handle: (frame: unknown, cid: string) => void;
    updateAgents: (online: string[]) => void;
    start: () => void;
    close: () => void;
};
const frames: { type: string; jobs?: unknown[] }[] = [];
const peers: { to?: string; d: { kind: string; id?: string; turn?: TurnLike; result?: Result } }[] = [];
const m = new BotManager((f) => frames.push(f as never), (d, to) => peers.push({ to, d: d as never })) as unknown as Inner;
const runs: TurnLike[] = [];
let answer: Result | null = { text: 'done', tools: [], attachments: [], durationMs: 5, costUsd: 0 };
// Without real Claude: every turn "runs" here and answers at once (or not, with answer = null)
const pending: (() => void)[] = [];
m.runHere = (_bot, turn, onDone) => {
    runs.push(turn);
    if (!onDone) return;
    const a = answer;
    if (a) onDone(a);
    else pending.push(() => onDone({ text: 'late', tools: [], attachments: [], durationMs: 5, costUsd: 0 }));
};
const say = (r: { content: { text: string }[] }) => r.content[0].text;
const s = (b = sender, chatId = 'chief') => ({ bot: b, key: chatId, currentTurn: { chatId, chain: [], chats: [] } });

// ---- Default: returns at once, the result comes back into the chat as a new turn of the source
let r = await m.botMessage(s(), 'helper', 'What is your folder called?', false);
check('handed over at once, says the result comes by itself', say(r).startsWith('Job handed to Helper') && say(r).includes('by itself'), say(r));
const job = runs.at(-2)!;
check('the job runs in the helper\'s main chat, with its origin', job.chatId === 'helper' && job.job?.chatId === 'chief' && job.job?.machine === 'desk', job);
const feedback = runs.at(-1)!;
check('the result starts a turn of the source in its chat', feedback.chatId === 'chief' && feedback.from === 'helper' && String(feedback.content).includes('Result of the job you gave Helper'), feedback);
const chiefChat = readHistory('chief');
check('the source chat shows the answer and who gave it', chiefChat.some((e) => e.role === 'event' && e.text.includes('Helper answered the job')) && chiefChat.some((e) => e.from === 'helper' && e.text === 'done'), chiefChat);
check('nothing open any more', openJobs().length === 0);

// ---- wait_for_reply: the answer as the tool's result, no extra turn
const before = runs.length;
r = await m.botMessage(s(), 'helper', 'Quick question', true);
check('wait: the answer comes back as the result', say(r).startsWith('Answer from Helper') && say(r).includes('done') && runs.length === before + 1, say(r));

// ---- Busy target: a conversation of its own
m.sessions.set('helper', { currentTurn: { chatId: 'helper' }, waiting: () => 0, waitingPerChat: () => ({}), backgroundTasks: [] });
await m.botMessage(s(), 'helper', 'Please check the bottom border in the web app', false);
const fresh = runs.at(-2)!.chatId;
check('busy: job in a new conversation', /^helper~[0-9a-f]{8}$/.test(fresh), fresh);
check('busy: title names the sender', bots.findConversation(fresh)?.title.startsWith('Chief: Please check') === true);
m.sessions.delete('helper');

// ---- A conversation as the target, also one of the same bot
const other = bots.createConversation('chief');
r = await m.botMessage(s(), '', 'Brainstorm three names', false, other);
check('another conversation of the same bot takes a job', runs.at(-2)!.chatId === other && say(r).startsWith('Job handed to Chief'), say(r));
r = await m.botMessage(s(), 'chief', 'Myself', false);
check('the same bot without a conversation: refused, points to list_conversations', r.isError && say(r).includes('list_conversations'));
r = await m.botMessage(s(), '', 'Here', false, 'chief');
check('the conversation it is in: refused', r.isError);
r = await m.botMessage(s(), '', 'Nowhere', false, 'helper~ffffffff');
check('an unknown conversation: refused', r.isError && say(r).includes('list_conversations'));

// ---- Loops: a chat waiting in the same chain
const inChain = { bot: bots.findBot('helper')!, key: 'helper', currentTurn: { chatId: 'helper', chain: ['chief'], chats: ['chief'] } };
r = await m.botMessage(inChain, 'chief', 'Back to you', false);
check('a job into a chat waiting in the same chain: refused with what to do', r.isError && say(r).includes('itself waiting for the result of this job'), say(r));

// ---- Another machine: job over the relay, result with job_feedback, confirmed with job_ack
bots.saveBots(bots.loadBots().map((b) => (b.id === 'helper' ? { ...b, machine: 'cloud' } : b)));
m.updateAgents(['desk', 'cloud']);
peers.length = 0;
await m.botMessage(s(), 'helper', 'Remote work', false);
const sent = peers.find((p) => p.d.kind === 'job');
check('remote: the job goes to that machine with its origin and reply for older backends', sent?.to === 'cloud' && sent.d.turn?.job?.machine === 'desk' && (sent.d as { reply?: boolean }).reply === true, sent);
const remoteId = sent!.d.id!;
check('remote: open, running, sent to the browsers', openJobs().some((j) => j.id === remoteId && j.state === 'running') && frames.some((f) => f.type === 'jobs' && (f.jobs ?? []).length > 0));
const turnsBefore = runs.length;
m.peerInbound('cloud', { kind: 'job_feedback', id: remoteId, botId: 'helper', chatId: 'helper', result: { text: 'remote done', tools: [], attachments: [], durationMs: 9, costUsd: 0 } });
check('remote: the result arrives, is confirmed and starts the source', peers.some((p) => p.d.kind === 'job_ack' && p.d.id === remoteId && p.to === 'cloud') && runs.length === turnsBefore + 1 && runs.at(-1)!.chatId === 'chief');
m.peerInbound('cloud', { kind: 'job_feedback', id: remoteId, botId: 'helper', chatId: 'helper', result: { text: 'again', tools: [], attachments: [], durationMs: 9, costUsd: 0 } });
check('remote: a result sent again is confirmed, not delivered twice', runs.length === turnsBefore + 1 && peers.filter((p) => p.d.kind === 'job_ack').length === 2);

// A backend before job_feedback answers with job_done
await m.botMessage(s(), 'helper', 'Old target', false);
const oldId = peers.findLast((p) => p.d.kind === 'job')!.d.id!;
m.peerInbound('cloud', { kind: 'job_done', id: oldId, result: { text: 'old done', tools: [], attachments: [], durationMs: 9, costUsd: 0 } });
check('an older target\'s job_done counts as the result', !openJobs().some((j) => j.id === oldId) && readHistory('chief').some((e) => e.text === 'old done'));

// ---- The target's machine asleep: the job waits and goes out when it wakes
m.updateAgents(['desk']);
peers.length = 0;
r = await m.botMessage(s(), 'helper', 'When you wake', false);
check('asleep: queued, nothing sent, the tool says so', !peers.some((p) => p.d.kind === 'job') && openJobs().some((j) => j.state === 'queued') && say(r).includes('asleep'), say(r));
m.updateAgents(['desk', 'cloud']);
check('awake: the queued job goes out', peers.some((p) => p.d.kind === 'job' && p.to === 'cloud') && !openJobs().some((j) => j.state === 'queued'));

// ---- Stop waiting and cancel
const waiting = openJobs().at(-1)!;
m.handle({ type: 'job_stop', id: waiting.id, cancel: true }, 'c1');
check('cancel: not open, the target machine is told to stop', !openJobs().some((j) => j.id === waiting.id) && peers.some((p) => p.d.kind === 'job_cancel' && p.to === 'cloud'));
check('cancel: the source chat says so', readHistory('chief').some((e) => e.role === 'event' && e.text.includes('cancelled')));
const afterStop = runs.length;
m.peerInbound('cloud', { kind: 'job_feedback', id: waiting.id, botId: 'helper', chatId: 'helper', result: { text: 'too late', tools: [], attachments: [], durationMs: 9, costUsd: 0 } });
check('a result after "stop waiting" is not delivered', runs.length === afterStop && !readHistory('chief').some((e) => e.text === 'too late'));

// ---- This machine as the target of another machine's job: the result is kept until confirmed
peers.length = 0;
bots.saveBots(bots.loadBots().map((b) => (b.id === 'helper' ? { ...b, machine: 'desk' } : b)));
m.updateAgents(['desk']);
answer = null;
m.peerInbound('laptop', { kind: 'job', id: 'j-remote', botId: 'helper', reply: true, turn: { chatId: 'helper', content: 'x', text: 'x', from: 'boss', chain: ['boss'], chats: ['boss'], hop: 0, job: { id: 'j-remote', machine: 'laptop', botId: 'boss', chatId: 'boss', chain: ['boss'], chats: ['boss'] } } });
pending.shift()!();
check('target: the result is not sent while the source sleeps, no job_done', !peers.some((p) => p.d.kind === 'job_feedback' || p.d.kind === 'job_done'));
m.updateAgents(['desk', 'laptop']);
check('target: sent once the source wakes', peers.some((p) => p.d.kind === 'job_feedback' && p.to === 'laptop' && p.d.result?.text === 'late'));
m.updateAgents(['desk']);
m.updateAgents(['desk', 'laptop']);
check('target: sent again until confirmed', peers.filter((p) => p.d.kind === 'job_feedback').length === 2);
m.peerInbound('laptop', { kind: 'job_ack', id: 'j-remote' });
m.updateAgents(['desk']);
m.updateAgents(['desk', 'laptop']);
check('target: confirmed, not sent again', peers.filter((p) => p.d.kind === 'job_feedback').length === 2);

// ---- A restart of the target cuts a running job: its source hears so
m.peerInbound('laptop', { kind: 'job', id: 'j-cut', botId: 'helper', reply: true, turn: { chatId: 'helper', content: 'x', text: 'x', from: 'boss', chain: ['boss'], chats: ['boss'], hop: 0, job: { id: 'j-cut', machine: 'laptop', botId: 'boss', chatId: 'boss', chain: ['boss'], chats: ['boss'] } } });
const m2 = new BotManager(() => undefined, (d, to) => peers.push({ to, d: d as never })) as unknown as Inner;
m2.updateAgents(['desk', 'laptop']);
peers.length = 0;
m2.start();
const cut = peers.find((p) => p.d.kind === 'job_feedback' && p.d.id === 'j-cut');
check('restart: the cut job reports an error to its source', !!cut && /restarted/.test(cut.d.result?.error ?? ''), cut);
m2.close();
answer = { text: 'done', tools: [], attachments: [], durationMs: 5, costUsd: 0 };

// ---- Who may reach whom: the sender's canMessage, set in its settings
const { botTools } = await import('./bot-tools.ts');
const host = { machineOf: () => 'here', online: () => ['here'], busy: () => false } as never;
const tool = (b: unknown, name: string) => botTools({ bot: b, key: (b as { id: string }).id, currentTurn: null } as never, host).find((x) => x.name === name)!;
const listed = async (b: unknown, name = 'list_bots') => ((await tool(b, name).handler({} as never, undefined)).content[0] as { text: string }).text;
bots.saveBot({ ...base, id: 'third', name: 'Third' });
check('canMessage missing: lists all', /helper/.test(await listed(bots.findBot('chief'))) && /third/.test(await listed(bots.findBot('chief'))));

const limited = bots.saveBot({ ...base, id: 'chief', name: 'Chief', canMessage: ['third', 'chief', 'nobody'] });
check('save: only existing other bots stay in the list', JSON.stringify(limited.canMessage) === '["third"]', limited.canMessage);
const count = runs.length;
r = await m.botMessage({ bot: limited, key: 'chief', currentTurn: null }, 'helper', 'Not allowed', false);
check('not allowed: refused with error', runs.length === count && say(r).includes('may not give Helper jobs'), say(r));
r = await m.botMessage({ bot: limited, key: 'chief', currentTurn: null }, '', 'Not allowed either', false, 'helper');
check('not allowed: a conversation of that bot neither', r.isError && say(r).includes('may not give Helper jobs'), say(r));
const shown = await listed(limited);
check('list_bots: only reachable bots and itself', /third/.test(shown) && /chief/.test(shown) && !/helper/.test(shown), shown);
const conversations = await listed(limited, 'list_conversations');
check('list_conversations: own and reachable ones with ids, not the others', conversations.includes(`- ${other}:`) && conversations.includes('- third:') && !conversations.includes('helper'), conversations);

const kept = bots.saveBot({ ...base, id: 'chief', name: 'Chief' });
check('save without the field (older app): keeps the list', JSON.stringify(kept.canMessage) === '["third"]', kept.canMessage);
const none = bots.saveBot({ ...base, id: 'chief', name: 'Chief', canMessage: [] });
check('none: list_bots says so', (await listed(none)).includes('not allowed you to give other bots jobs'));
const all = bots.saveBot({ ...base, id: 'chief', name: 'Chief', canMessage: null });
check('null: all again', all.canMessage === undefined && /helper/.test(await listed(all)), all.canMessage);

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
