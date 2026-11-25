// Tests for a bot sorting the chat list into folders:  node local/src/folder-tool.test.ts
// set_folder puts bots and groups into a folder by id or name, creates the folder when it is new, finds an existing one
// whatever its case, changes nothing on an unknown name and says so in the chat; list_folders shows the result.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folder-tool-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folder-claude-'));
process.env.MACHINE_NAME = 'workstation';
const folder = path.resolve(import.meta.dirname, '..', '..');
process.env.ALLOWED_ROOTS = folder;
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { BotManager } = await import('./agent.ts');
const { botTools, engineToolsFor } = await import('./bot-tools.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'workstation' };
const me = bots.saveBot({ ...base, id: 'chief', name: 'Charlotte' });
bots.saveBot({ ...base, id: 'cloud', name: 'Carlo' });
bots.saveBot({ ...base, id: 'mail', name: 'Marie' });
const team = bots.saveGroup({ id: '', name: 'Team', avatar: '', members: ['cloud', 'mail'] });
bots.saveCategory({ id: '', name: 'Delivery' });

type Inner = { toolHost: unknown; updateAgents: (o: string[]) => void };
const sent: { type: string }[] = [];
const m = new BotManager((f: { type: string }) => { sent.push(f); }) as unknown as Inner;
m.updateAgents(['workstation']);
const s = { bot: me, currentTurn: { chatId: 'chief' } };
const tools = botTools(s as never, m.toolHost as never);
const run = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.find((x) => x.name === name)!.handler(args as never, undefined);
    return { text: (r.content[0] as { text: string }).text, error: r.isError === true };
};
const categoryOf = (id: string) => {
    const c = bots.loadBots().find((b) => b.id === id)?.category ?? bots.loadGroups().find((g) => `g:${g.id}` === id)?.category;
    return bots.loadCategories().find((x) => x.id === c)?.name ?? '';
};

check('list_folders and set_folder are tools of the other engines too', ['list_folders', 'set_folder'].every((n) => engineToolsFor(s as never, m.toolHost as never).some((x) => x.name === n)));

const bad = await run('set_folder', { folder: 'Agenten', chats: ['cloud', 'Nobody'] });
check('an unknown name: refused, nothing changed, no folder made', bad.error && bad.text.includes('Nobody') && categoryOf('cloud') === '' && !bots.loadCategories().some((c) => c.name === 'Agenten'), bad);

const before = sent.length;
const ok = await run('set_folder', { folder: 'Agenten', chats: ['cloud', 'marie', 'Team'] });
check('new folder made, bots by id and name, a group by name', !ok.error && ok.text.includes('(new)') && categoryOf('cloud') === 'Agenten' && categoryOf('mail') === 'Agenten' && categoryOf(`g:${team.id}`) === 'Agenten', ok);
check('… the browsers get the list again', sent.slice(before).some((f) => f.type === 'bots'));
const line = readHistory('chief').at(-1);
check('… a line in the chat', line?.role === 'event' && line.text.includes('Agenten') && line.text.includes('Carlo'), line);

await run('set_folder', { folder: 'delivery', chats: ['chief'] });
check('an existing folder whatever its case, no second one', categoryOf('chief') === 'Delivery' && bots.loadCategories().filter((c) => c.name.toLowerCase() === 'delivery').length === 1);

const listed = await run('list_folders', {});
check('list_folders: folders with their chats', listed.text.includes('Agenten: ') && listed.text.includes('Carlo (cloud)') && listed.text.includes('Delivery: Charlotte (chief)'), listed.text);

// People: by name, into a folder like bots; list_folders names them
const { setPeople, loadPersonChats } = await import('./people.ts');
setPeople([{ id: 'main', name: 'Marco', admin: true, reach: 'all' }, { id: 'erik', name: 'Erik', admin: false, reach: 'all' }]);
const people = await run('set_folder', { folder: 'Personen', chats: ['Erik'] });
check('a person by name into a new folder', !people.error && loadPersonChats().find((c) => c.id === 'erik')?.category === bots.loadCategories().find((c) => c.name === 'Personen')?.id, people);
check('… list_folders names the person', (await run('list_folders', {})).text.includes('Personen: Erik (person p:erik)'));

await run('set_folder', { folder: '', chats: ['cloud'] });
check('an empty folder takes it out', categoryOf('cloud') === '' && (await run('list_folders', {})).text.includes('In no folder: Carlo (cloud)'));

// ---- create_bot: a new bot like "New bot" in the app, set up in its own chat
const turns: { botId: string; chatId: string }[] = [];
(m as unknown as { startTurn: (b: { id: string }, spec: { chatId: string }) => void }).startTurn = (b, spec) => { turns.push({ botId: b.id, chatId: spec.chatId }); };
check('create_bot is a tool of the other engines too', engineToolsFor(s as never, m.toolHost as never).some((x) => x.name === 'create_bot'));
const made = await run('create_bot', { name: 'Hugo', folder, area: 'Hub', role: 'Hub and core', folder_of_list: 'Agenten' });
const hugo = bots.loadBots().find((b) => b.name === 'Hugo');
check('the bot is made on this machine with its profile, asking before risky steps', !made.error && !!hugo && hugo.area === 'Hub' && hugo.approval === 'risky' && hugo.machine === 'workstation', made);
check('… into the folder of the list', !!hugo && categoryOf(hugo.id) === 'Agenten');
check('… its setup starts in its own chat, with a line there', !!hugo && turns.some((x) => x.botId === hugo.id && x.chatId === hugo.id) && readHistory(hugo.id).some((e) => e.role === 'event'));
check('… and the chat of the bot that made it says so', readHistory('chief').some((e) => e.role === 'event' && e.text.includes('Hugo')));
check('a second bot of that name: refused', (await run('create_bot', { name: 'hugo', folder })).error);
check('a folder outside the allowed ones: refused, nothing made', (await run('create_bot', { name: 'Ida', folder: 'C:/nowhere-at-all' })).error && !bots.loadBots().some((b) => b.name === 'Ida'));
// Without a level the one of the settings for new bots, but "never" stays the user's
const { saveSettings } = await import('./settings.ts');
saveSettings({ botApproval: 'write' });
await run('create_bot', { name: 'Jana', folder });
check('without a level: the one of the settings for new bots', bots.loadBots().find((b) => b.name === 'Jana')?.approval === 'write');
saveSettings({ botApproval: 'never' });
await run('create_bot', { name: 'Kai', folder });
check('settings on "never": a bot made by a bot still asks before risky steps', bots.loadBots().find((b) => b.name === 'Kai')?.approval === 'risky');
check('the approval level "never" cannot be chosen', !JSON.stringify(engineToolsFor(s as never, m.toolHost as never).find((x) => x.name === 'create_bot')?.schema).includes('"never"'));

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
