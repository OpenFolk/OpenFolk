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
    messageFromUser: (chatId: string, text: string, uploads: unknown[], voice?: unknown, quote?: unknown) => void;
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

const routine = { id: 'r1', botId: 'dev', name: 'Weekly', cron: '0 9 * * 1', enabled: true, updatedAt: '' };
m.runRoutine({ ...routine, prompt: '/release patch' });
check('routine with a command: without the routine header', delivered.at(-1)?.content === '/release patch', delivered.at(-1));
m.runRoutine({ ...routine, prompt: 'Look at the open issues' });
last = String(delivered.at(-1)?.content);
check('routine without a command: with the header', last.endsWith('Look at the open issues') && last.includes('Weekly'), last);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
