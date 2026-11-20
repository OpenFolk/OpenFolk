// Tests for the folders of the chat list (categories): create, rename, assign, delete, sync, frames:
//   node local/src/categories.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-categories-'));
process.env.DATA_DIR = dir;
process.env.E2E_KEY = 'off';
// The bots below live in the repo; without this the allowed root is the home folder, which a CI checkout is not under
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

const bots = await import('./bots.ts');
const { merge, snapshot } = await import('./sync.ts');
const { tombstones } = await import('./store.ts');
const { checkClientFrame } = await import('./frames.ts');

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder: ROOT, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const anna = bots.saveBot({ ...base, id: '', name: 'Anna' });
const bert = bots.saveBot({ ...base, id: '', name: 'Bert' });
const team = bots.saveGroup({ id: '', name: 'Team', avatar: '', members: [anna.id, bert.id] });

const kunden = bots.saveCategory({ id: '', name: ' Kunden ' });
check('new folder: id from the name, name trimmed, times set', kunden.id === 'kunden' && kunden.name === 'Kunden' && kunden.createdAt === kunden.updatedAt && Boolean(kunden.createdAt), kunden);
check('the same name again: a free id', bots.saveCategory({ id: '', name: 'Kunden' }).id === 'kunden-2');
bots.deleteCategory('kunden-2');
await new Promise((r) => setTimeout(r, 5));
const renamed = bots.saveCategory({ id: 'kunden', name: 'Kundschaft' });
check('rename: same id and creation time, new name and time', renamed.id === 'kunden' && renamed.name === 'Kundschaft' && renamed.createdAt === kunden.createdAt && renamed.updatedAt > kunden.updatedAt, renamed);
check('rename of an unknown folder: an error', throws(() => bots.saveCategory({ id: 'nope', name: 'X' })));

bots.setCategory(anna.id, 'kunden');
bots.setCategory(`g:${team.id}`, 'kunden');
check('a bot and a group into the folder', bots.findBot(anna.id)?.category === 'kunden' && bots.findGroup(team.id)?.category === 'kunden');
check('into an unknown folder: an error', throws(() => bots.setCategory(bert.id, 'nope')) && bots.findBot(bert.id)?.category === undefined);
check('a conversation names its bot', (bots.setCategory(`${bert.id}~abcd`, 'kunden'), bots.findBot(bert.id)?.category === 'kunden'));
bots.setCategory(bert.id, '');
check('"" takes it out', bots.findBot(bert.id)?.category === undefined);
const intern = bots.saveCategory({ id: '', name: 'Intern' }, bert.id);
check('a new folder with a chat: the chat is in it', intern.id === 'intern' && bots.findBot(bert.id)?.category === 'intern');

// the editors send the field; an app without it leaves the folder as it is
const edited = (category: string | undefined) => bots.saveBot({ ...base, id: anna.id, name: 'Anna', category }).category;
check('bot editor: missing keeps, "" clears, unknown means none, known sets', edited(undefined) === 'kunden' && edited('') === undefined && edited('nope') === undefined && edited('intern') === 'intern');
const groupEdited = (category: string | undefined) => bots.saveGroup({ id: team.id, name: 'Team', avatar: '', members: [anna.id, bert.id], category }).category;
check('group editor: the same', groupEdited(undefined) === 'kunden' && groupEdited('') === undefined && groupEdited('intern') === 'intern');

check('the snapshot carries the folders', JSON.stringify(snapshot(false).categories?.map((c) => c.id)) === '["kunden","intern"]', snapshot(false).categories);

bots.deleteCategory('intern');
check('deleted: gone, a tombstone, the bots and group out of it', !bots.loadCategories().some((c) => c.id === 'intern') && Boolean(tombstones()['category:intern'])
    && bots.findBot(anna.id)?.category === undefined && bots.findBot(bert.id)?.category === undefined && bots.findGroup(team.id)?.category === undefined);

// sync with another machine: newer wins, a tombstone keeps a deleted folder away
const T = '2099-01-01T00:00:00.000Z';
const incoming = (categories: { id: string; name: string; createdAt: string; updatedAt: string }[]) => merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], categories });
let r = incoming([{ id: 'extern', name: 'Extern', createdAt: T, updatedAt: T }, { id: 'intern', name: 'Intern', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' }]);
check('a folder from another machine arrives, a deleted one stays away', r.config && bots.loadCategories().some((c) => c.id === 'extern') && !bots.loadCategories().some((c) => c.id === 'intern'));
r = incoming([{ id: 'kunden', name: 'Alt', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' }]);
check('an older state of a folder is ignored', !r.config && bots.loadCategories().find((c) => c.id === 'kunden')?.name === 'Kundschaft');
r = incoming([{ id: 'kunden', name: 'Neu', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: T }]);
check('a newer state is taken', r.config && bots.loadCategories().find((c) => c.id === 'kunden')?.name === 'Neu');

check('frame: a new folder, also with a chat', checkClientFrame({ type: 'category_save', category: { id: '', name: 'X' } }).ok && checkClientFrame({ type: 'category_save', category: { id: '', name: 'X' }, chatId: 'anna' }).ok);
check('frame: no name, or too long, refused', !checkClientFrame({ type: 'category_save', category: { id: '', name: '  ' } }).ok && !checkClientFrame({ type: 'category_save', category: { id: '', name: 'x'.repeat(41) } }).ok);
check('frame: assign (also out), delete', checkClientFrame({ type: 'category_assign', chatId: 'anna', categoryId: 'kunden' }).ok && checkClientFrame({ type: 'category_assign', chatId: 'g:team', categoryId: '' }).ok
    && checkClientFrame({ type: 'category_delete', categoryId: 'kunden' }).ok);
check('frame: the editors may send the folder', checkClientFrame({ type: 'bot_save', bot: { ...base, id: 'anna', name: 'Anna', category: '' } }).ok
    && checkClientFrame({ type: 'group_save', group: { id: 'team', name: 'Team', avatar: null, members: ['a', 'b'], category: 'kunden' } }).ok);

// The order of the folders: moved ones by their place, the rest by name after them; a renamed one keeps its place
for (const n of ['Alpha', 'Beta', 'Gamma']) bots.saveCategory({ id: '', name: n });
const names = () => bots.sortCategories(bots.loadCategories()).map((c) => c.name).join(',');
const idOf = (n: string) => bots.loadCategories().find((c) => c.name === n)!.id;
bots.orderCategories([idOf('Gamma'), idOf('Alpha')]);
check('ordered: the named ones first, the rest in their previous order', names().startsWith('Gamma,Alpha,'), names());
const before = bots.loadCategories().find((c) => c.name === 'Gamma')!.updatedAt;
bots.orderCategories([idOf('Gamma'), idOf('Alpha')]);
check('the same order again: no folder gets a new time', bots.loadCategories().find((c) => c.name === 'Gamma')!.updatedAt === before);
bots.saveCategory({ id: idOf('Alpha'), name: 'Alpha 2' });
check('a rename keeps the place', names().startsWith('Gamma,Alpha 2,'), names());
bots.orderCategories(['nope', idOf('Beta')]);
check('an unknown id is skipped', names().startsWith('Beta,'), names());
check('frame: order', checkClientFrame({ type: 'category_order', ids: ['a', 'b'] }).ok && !checkClientFrame({ type: 'category_order', ids: 'a' }).ok);

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
