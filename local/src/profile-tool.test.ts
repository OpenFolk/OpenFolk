// Tests for a bot setting up its own profile:  node local/src/profile-tool.test.ts
// set_profile stores name, field of work, role and working instructions of this bot only, with a line in the chat;
// bot_save with `setup` starts the first turn, which asks the user, for a new bot only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-profile-tool-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-profile-claude-'));
process.env.MACHINE_NAME = 'workstation';
const folder = path.resolve(import.meta.dirname, '..', '..');
process.env.ALLOWED_ROOTS = folder;
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { BotManager } = await import('./agent.ts');
const { botTools } = await import('./bot-tools.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'workstation' };
const me = bots.saveBot({ ...base, id: 'ada', name: 'Ada' });
bots.saveBot({ ...base, id: 'other', name: 'Other', role: 'Keeps' });
type Inner = {
    toolHost: unknown;
    handle: (f: unknown, cid: string) => void;
    updateAgents: (o: string[]) => void;
    startTurn: (bot: { id: string }, spec: { chatId: string; content: unknown }) => void;
};
const m = new BotManager(() => undefined) as unknown as Inner;
m.updateAgents(['workstation']);
// No engine in a test: the turns are only counted
const turns: { botId: string; chatId: string; content: unknown }[] = [];
m.startTurn = (bot, spec) => { turns.push({ botId: bot.id, chatId: spec.chatId, content: spec.content }); };

const s = { bot: me, currentTurn: { chatId: 'ada' } };
const tools = botTools(s as never, m.toolHost as never);
check('make_avatar is among the tools of every engine', tools.some((x) => x.name === 'make_avatar'));
const setProfile = tools.find((x) => x.name === 'set_profile')!;
const call = async (args: Record<string, string>) => {
    const r = await setProfile.handler(args as never, undefined);
    return { text: (r.content[0] as { text: string }).text, error: r.isError === true };
};

const r1 = await call({ area: ' Research ', role: 'Web research and summaries', tone: 'Ask before you spend money.' });
const ada = bots.findBot('ada')!;
check('field of work, role and working instructions set, trimmed', !r1.error && ada.area === 'Research' && ada.role === 'Web research and summaries' && ada.tone === 'Ask before you spend money.', ada);
check('the name stays without one', ada.name === 'Ada');
check('only its own profile', bots.findBot('other')?.role === 'Keeps' && !bots.findBot('other')?.area);
check('the chat says what was set', readHistory('ada').some((e) => e.role === 'event' && e.text.includes('Ada set its profile') && e.text.includes('Research') && e.text.includes('working instructions')));
const r2 = await call({ name: 'Rudolf' });
check('a name of its own, the rest stays', !r2.error && bots.findBot('ada')?.name === 'Rudolf' && bots.findBot('ada')?.role === 'Web research and summaries', r2);
const r3 = await call({ name: '  ', area: '' });
check('nothing to set: error, nothing changed', r3.error && bots.findBot('ada')?.name === 'Rudolf', r3);

// ---- bot_save with setup: the first turn asks the user
m.handle({ type: 'bot_save', setup: true, bot: { ...base, id: '', name: 'Lena' } }, 'c1');
check('a new bot with setup: the setup turn starts in its main chat', turns.length === 1 && turns[0].botId === 'lena' && turns[0].chatId === 'lena' && String(turns[0].content).includes('set_profile'), turns);
check('the chat says the bot sets itself up', readHistory('lena').some((e) => e.role === 'event' && e.text.includes('Lena sets itself up')));
m.handle({ type: 'bot_save', bot: { ...base, id: '', name: 'Max', role: 'Docs' } }, 'c1');
m.handle({ type: 'bot_save', setup: true, bot: { ...base, id: 'lena', name: 'Lena' } }, 'c1');
check('without setup, or saving the bot again: no turn', turns.length === 1, turns);

for (const d of [process.env.DATA_DIR!, process.env.CLAUDE_CONFIG_DIR!]) fs.rmSync(d, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
