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

await run('set_folder', { folder: '', chats: ['cloud'] });
check('an empty folder takes it out', categoryOf('cloud') === '' && (await run('list_folders', {})).text.includes('In no folder: Carlo (cloud)'));

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
