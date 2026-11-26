// Likes on a bot's answer: stored with the entry, told to the bot with the user's next message in that chat (and only
// that one), forgotten when taken back before; not in groups, not on the user's own messages.   node local/src/bot-like.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-bot-like-'));
process.env.DATA_DIR = dir;
process.env.ALLOWED_ROOTS = dir;
const bots = await import('./bots.ts');
const { appendEntry, readEntry } = await import('./history.ts');
const { t } = await import('./i18n.ts');
const { BotManager } = await import('./agent.ts');
import type { AgentFrame, ClientFrame } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const base = { role: '', folder: dir, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
bots.saveBot({ ...base, id: 'dev', name: 'Dev' });
bots.saveBot({ ...base, id: 'ops', name: 'Ops' });
const group = bots.saveGroup({ id: '', name: 'Team', avatar: '', members: ['dev', 'ops'] });

type Inner = {
    startTurn: (bot: { id: string }, spec: { chatId: string; content: unknown }) => void;
    messageFromUser: (chatId: string, text: string, uploads: unknown[]) => void;
    handle: (frame: ClientFrame, cid: string) => void;
};
const frames: AgentFrame[] = [];
const m = new BotManager((f) => { frames.push(f); }) as unknown as Inner;
const delivered: { chatId: string; content: string }[] = [];
m.startTurn = (_bot, spec) => { delivered.push({ chatId: spec.chatId, content: String(spec.content) }); };
const errors = () => frames.filter((f) => f.type === 'error').length;

const long = 'Use a feature flag for the new header, then ship it to half of the users first. ' + 'More detail. '.repeat(40);
const a1 = appendEntry('dev', { role: 'assistant', botId: 'dev', text: long, ts: '2026-11-25T10:00:00Z' });
const a2 = appendEntry('dev', { role: 'assistant', botId: 'dev', text: 'Tests are green.', ts: '2026-11-25T10:01:00Z' });
const u1 = appendEntry('dev', { role: 'user', from: 'me', text: 'Thanks', ts: '2026-11-25T10:02:00Z' });

m.handle({ type: 'like', chatId: 'dev', entryId: a1.id!, on: true }, 'c1');
check('a like on a bot\'s answer is stored', readEntry('dev', a1.id!)?.like?.on === true);
const liked = frames.findLast((f) => f.type === 'liked');
check('the browsers hear of it', liked?.type === 'liked' && liked.chatId === 'dev' && liked.entryId === a1.id && liked.on, liked);
check('it starts no turn of its own', delivered.length === 0);

m.handle({ type: 'like', chatId: 'dev', entryId: a2.id!, on: true }, 'c1');
m.handle({ type: 'like', chatId: 'dev', entryId: a2.id!, on: false }, 'c1');
m.messageFromUser('dev', 'Next: the footer', []);
const first = delivered.at(-1)?.content ?? '';
check('the next message carries the note in front of the text', first.startsWith(t('prompt.liked')) && first.endsWith('Next: the footer'), first);
check('… with a reminder of the liked answer, cut short', first.includes('Use a feature flag for the new header') && first.includes(' …') && first.length < long.length, first.length);
check('… and without the like taken back before', !first.includes('Tests are green.'), first);
m.messageFromUser('dev', 'And the sidebar', []);
check('only once: the message after has no note', delivered.at(-1)?.content === 'And the sidebar', delivered.at(-1));

const before = errors();
m.handle({ type: 'like', chatId: 'dev', entryId: u1.id!, on: true }, 'c1');
check('the user\'s own message cannot be liked', errors() === before + 1 && !readEntry('dev', u1.id!)?.like);
const g1 = appendEntry(`g:${group.id}`, { role: 'assistant', botId: 'dev', text: 'In the group', ts: '2026-11-25T10:03:00Z' });
m.handle({ type: 'like', chatId: `g:${group.id}`, entryId: g1.id!, on: true }, 'c1');
check('nor an answer in a group', errors() === before + 2 && !readEntry(`g:${group.id}`, g1.id!)?.like);

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
