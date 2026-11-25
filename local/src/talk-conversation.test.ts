// Tests for the voice conversation's own conversation:  node local/src/talk-conversation.test.ts
// talk_start gives the bot's talk conversation on the fast model with fresh context (the main chat for a bot that
// wants it there or runs on another engine); the first message of a dialog gets the main chat's last messages and the
// hint to hand heavy work to the main chat; talk_end puts what was said in front of the main chat's next message.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-talk-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-talk-data-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-talk-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = root;
const bots = await import('./bots.ts');
const { appendEntry, readHistory } = await import('./history.ts');
const { BotManager } = await import('./agent.ts');
const { checkClientFrame } = await import('./frames.ts');
const { TALK_MODEL } = await import('../../shared/protocol.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const frames: { type: string; [k: string]: unknown }[] = [];
type Inner = { handle: (f: unknown, cid: string) => void; updateAgents: (o: string[]) => void; startTurn: (b: { id: string }, spec: { chatId: string; content: unknown }) => void };
const m = new BotManager((f) => { frames.push(f as { type: string }); }) as unknown as Inner;
m.updateAgents(['workstation']);
const turns: { chatId: string; content: string }[] = [];
m.startTurn = (_b, spec) => { turns.push({ chatId: spec.chatId, content: typeof spec.content === 'string' ? spec.content : JSON.stringify(spec.content) }); };
const now = new Date().toISOString();
const base = { role: '', folder: root, tone: '', avatar: '', approval: 'never' as const, machine: 'workstation', createdAt: now, updatedAt: now };
bots.saveBots([{ ...base, id: 'fred', name: 'Fred', model: 'opus' }, { ...base, id: 'slow', name: 'Slow', model: 'opus', talkFast: false }, { ...base, id: 'cdx', name: 'Cdx', model: 'codex' }]);
appendEntry('fred', { role: 'user', from: 'me', text: 'Deploy the relay tonight.', ts: '2026-11-22T08:00:00.000Z' });
appendEntry('fred', { role: 'assistant', botId: 'fred', text: 'Done, the relay runs 0.7.1.', ts: '2026-11-22T08:01:00.000Z' });
const started = () => frames.findLast((f) => f.type === 'talk_started') as { chatId: string } | undefined;

check('frames: talk_start and talk_end pass the check', checkClientFrame({ type: 'talk_start', botId: 'fred' }).ok && checkClientFrame({ type: 'talk_end', chatId: 'fred~x' }).ok);

m.handle({ type: 'talk_start', botId: 'fred' }, 'c1');
const chatId = started()?.chatId ?? '';
const conv = bots.findBot('fred')?.conversations?.find((c) => `fred~${c.id}` === chatId);
check('talk_start: a conversation of its own, marked, on the fast model', chatId.startsWith('fred~') && conv?.talk === true && conv.model === TALK_MODEL && conv.title.length > 0, conv);
m.handle({ type: 'talk_start', botId: 'fred' }, 'c1');
check('a second dialog: the same conversation', started()?.chatId === chatId && bots.findBot('fred')!.conversations!.length === 1);
bots.setSessionId(chatId, 'old-session');
m.handle({ type: 'talk_start', botId: 'fred' }, 'c1');
check('every dialog starts with fresh context', bots.readSessionId(chatId) === undefined);

m.handle({ type: 'send', chatId, text: 'How did the deploy go?', spoken: true }, 'c1');
const first = turns.at(-1)!;
check('first message: the main chat\'s last messages and the hint to hand over', first.chatId === chatId && first.content.includes('Deploy the relay tonight.') && first.content.includes('relay runs 0.7.1')
    && first.content.includes('message_bot') && first.content.includes('"fred"') && first.content.endsWith('How did the deploy go?\n\nThe user is in a voice conversation and hears your answer read aloud. Answer in a few short spoken sentences: no lists, headings, code or links, at most one question. Use your tools as usual; when that takes a while, first say in one sentence what you are doing.'), first.content);
m.handle({ type: 'send', chatId, text: 'And the app?', spoken: true }, 'c1');
check('the next message without it', !turns.at(-1)!.content.includes('Deploy the relay tonight.'));
appendEntry(chatId, { role: 'assistant', botId: 'fred', text: 'The app is published too.', ts: new Date().toISOString() });

m.handle({ type: 'talk_end', chatId }, 'c1');
const event = readHistory('fred').at(-1);
check('talk_end: the main chat says so', event?.role === 'event' && event.text.includes('3'), event);
m.handle({ type: 'send', chatId: 'fred', text: 'Next step?' }, 'c1');
const main = turns.at(-1)!;
check('the main chat\'s next message carries what was said', main.chatId === 'fred' && main.content.includes('How did the deploy go?') && main.content.includes('The app is published too.') && main.content.endsWith('Next step?'), main.content);
m.handle({ type: 'send', chatId: 'fred', text: 'Thanks' }, 'c1');
check('… once', turns.at(-1)!.content === 'Thanks', turns.at(-1)!.content);
m.handle({ type: 'talk_end', chatId }, 'c1');
check('an end without a dialog changes nothing', readHistory('fred').filter((e) => e.role === 'event').length === 1);

m.handle({ type: 'talk_start', botId: 'slow' }, 'c1');
check('switched off for the bot: the main chat', started()?.chatId === 'slow' && !bots.findBot('slow')?.conversations?.length);
m.handle({ type: 'talk_start', botId: 'cdx' }, 'c1');
check('another engine: the main chat', started()?.chatId === 'cdx');

bots.saveBot({ ...bots.findBot('fred')!, talkFast: false });
check('editor: off is stored', bots.findBot('fred')!.talkFast === false);
bots.saveBot({ ...bots.findBot('fred')!, talkFast: undefined });
check('an app without the field leaves it', bots.findBot('fred')!.talkFast === false);
bots.saveBot({ ...bots.findBot('fred')!, talkFast: true });
check('on again: the default, not stored', bots.findBot('fred')!.talkFast === undefined);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
