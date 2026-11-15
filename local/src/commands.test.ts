// Tests for slash commands: which messages count as one, what the picker offers, and that a command reaches the
// session without anything in front of it.   node local/src/commands.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-commands-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const { chatCommands, isCommand } = await import('./commands.ts');
const { BotManager } = await import('./agent.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

check('command with arguments', isCommand('/release 0.3.0 notes'));
check('command alone', isCommand('/compact'));
check('plugin command', isCommand('/n8n-skills:n8n-debugging why'));
check('command, then a new line', isCommand('/push\nfix the header'));
check('a path is no command', !isCommand('/etc/hosts is broken'));
check('a slash in the text is no command', !isCommand('see a/b'));
check('a lone slash is no command', !isCommand('/'));
check('text in front: no command', !isCommand('please /push'));

const list: SlashCommand[] = [
    { name: 'push', description: 'Commit and push', argumentHint: '<message>' },
    { name: 'compact', description: 'Free up context', argumentHint: '<instructions>', builtin: true },
    { name: 'model', description: 'Set the model', argumentHint: '<model>', builtin: true },
    { name: 'color', description: 'Prompt bar color', argumentHint: '', builtin: true },
    { name: 'plugin:skill', description: 'From a plugin', argumentHint: '' },
    { name: 'push', description: 'A second row with the same name', argumentHint: '' },
];
const offered = chatCommands(list);
check('picker: own and plugin commands, of the built-in ones only those for a chat', offered.map((c) => c.name).join(',') === 'push,compact,plugin:skill', offered);
check('picker: description and argument hint kept', offered[0].description === 'Commit and push' && offered[0].argumentHint === '<message>', offered[0]);

// Delivery without Claude: intercept startTurn, call the paths a message from the user takes
const folder = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
bots.saveBot({ ...base, id: 'dev', name: 'Dev' });
bots.saveBot({ ...base, id: 'ops', name: 'Ops' });
const group = bots.saveGroup({ id: '', name: 'Team', avatar: '', members: ['dev', 'ops'] });

type Spec = { chatId: string; content: unknown; text: string };
type Inner = {
    startTurn: (bot: { id: string }, spec: Spec) => void;
    messageFromUser: (chatId: string, text: string, uploads: unknown[], voice?: unknown, quote?: unknown, spoken?: boolean) => void;
    runRoutine: (r: unknown) => void;
};
const m = new BotManager(() => undefined) as unknown as Inner;
const delivered: { bot: string; content: unknown }[] = [];
m.startTurn = (bot, spec) => { delivered.push({ bot: bot.id, content: spec.content }); };
const quote = { id: 'e1', from: 'dev', text: 'The header is wrong' };

m.messageFromUser('dev', 'Can you fix it, maybe with @ops?', [], undefined, quote);
let last = String(delivered.at(-1)?.content);
check('normal message: quote and delegation note in front', last.includes('The header is wrong') && last.includes('@ops') && !last.startsWith('Can you'), last);

m.messageFromUser('dev', '/push fix the header, ask @ops', [], undefined, quote);
check('command: exactly the typed text, with a quote and a mention', delivered.at(-1)?.content === '/push fix the header, ask @ops', delivered.at(-1));

m.messageFromUser(`g:${group.id}`, '/release 0.3.0 @ops', []);
check('command in a group: to the mentioned bot, without group context', delivered.at(-1)?.bot === 'ops' && delivered.at(-1)?.content === '/release 0.3.0 @ops', delivered.at(-1));

m.messageFromUser(`g:${group.id}`, 'Who has time?', []);
last = String(delivered.at(-1)?.content);
check('normal message in a group: with group context', last.endsWith('Who has time?') && last.length > 'Who has time?'.length, last);

// From the voice conversation: a voice message or a typed request gets the note to answer briefly; others do not
const { t } = await import('./i18n.ts');
m.messageFromUser('dev', '', [], { transcript: 'How is the build?', attachments: [] }, undefined, true);
last = String(delivered.at(-1)?.content);
check('voice conversation: transcript, then the note to answer for being read aloud', last.includes('How is the build?') && last.includes(t('prompt.spoken')), last);
m.messageFromUser('dev', 'And the tests?', [], undefined, undefined, true);
last = String(delivered.at(-1)?.content);
check('spoken text message: with the note', last.includes('And the tests?') && last.includes(t('prompt.spoken')), last);
m.messageFromUser('dev', '', [], { transcript: 'Plain voice message', attachments: [] });
last = String(delivered.at(-1)?.content);
check('plain voice message: without the note', last.includes('Plain voice message') && !last.includes(t('prompt.spoken')), last);

// Forwarded from another chat: the whole text with its line breaks, the origin named, and it may go without own words
const long = 'Step 1: build\nStep 2: ' + 'x'.repeat(400);
const forward = { id: 'e9', from: 'ops', text: long, forwarded: true, origin: 'Ops · Deploy' };
let count = delivered.length;
m.messageFromUser('dev', '', [], undefined, forward);
last = String(delivered.at(-1)?.content);
check('forward without own words: delivered', delivered.length === count + 1, delivered.length);
check('forward: whole text with line breaks, origin named', last.includes(long) && last.includes('Ops · Deploy'), last.slice(0, 200));
m.messageFromUser('dev', 'Please take this over', [], undefined, forward);
last = String(delivered.at(-1)?.content);
check('forward with own words: the words after the forwarded text', last.endsWith('Please take this over') && last.indexOf(long) < last.indexOf('Please take'), last.slice(-80));
check('forward without its chat id: no hint to read_history', !last.includes('read_history'), last.slice(0, 200));
m.messageFromUser('dev', 'Look at this', [], undefined, { ...forward, originChat: 'ops' });
last = String(delivered.at(-1)?.content);
check('forward with its chat id: names chat and entry for read_history', last.includes('read_history') && last.includes('"ops"') && last.includes('"e9"'), last.slice(0, 600));
const { resolveChat } = await import('./history-tools.ts');
check('read_history takes that chat id', resolveChat('ops', 'dev') === 'ops');
count = delivered.length;
m.messageFromUser('dev', '', [], undefined, quote);
check('a reply without text is still not sent', delivered.length === count, delivered.length);
const { storedQuote } = await import('./agent.ts');
check('reply quote cut to 300, forward kept whole', storedQuote({ ...quote, text: long })!.text.length === 300 && storedQuote(forward)!.text === long);
check('stored quote: unknown fields dropped, a reply carries no origin', JSON.stringify(storedQuote({ ...quote, origin: 'x', extra: 1 } as never)) === JSON.stringify(quote));

const routine = { id: 'r1', botId: 'dev', name: 'Weekly', cron: '0 9 * * 1', enabled: true, updatedAt: '' };
m.runRoutine({ ...routine, prompt: '/release patch' });
check('routine with a command: without the routine header', delivered.at(-1)?.content === '/release patch', delivered.at(-1));
m.runRoutine({ ...routine, prompt: 'Look at the open issues' });
last = String(delivered.at(-1)?.content);
check('routine without a command: with the header', last.endsWith('Look at the open issues') && last.includes('Weekly'), last);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
