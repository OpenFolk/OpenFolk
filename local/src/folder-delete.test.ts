// Tests for deleting a bot's working folder with the bot:  node local/src/folder-delete.test.ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folder-delete-'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folder-delete-data-'));
process.env.DATA_DIR = data;
process.env.ALLOWED_ROOTS = root;
process.env.MACHINE_NAME = 'desk';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const { inAccount } = await import('./store.ts');
const { loadBots, saveBot, saveBots } = await import('./bots.ts');
const { checkFolderDeletion, deleteBotFolder } = await import('./folder-delete.ts');

const dir = (...p: string[]) => { const d = path.join(root, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const bot = (name: string, folder: string) => saveBot({ id: '', name, role: '', folder, model: 'default', tone: '', avatar: '', approval: 'risky', machine: 'desk' });
/** A bot that lives on another machine, as the sync brings it (saveBot here only takes folders of this machine). */
const elsewhere = (name: string, folder: string) => {
    const now = new Date().toISOString();
    const b = { id: name.toLowerCase().replace(/\W+/g, '-'), name, role: '', folder: path.resolve(folder).split(path.sep).join('/'), model: 'default', tone: '', avatar: '',
        approval: 'risky' as const, machine: 'laptop', machineOnly: true, createdAt: now, updatedAt: now };
    saveBots([...loadBots(), b]);
    return b;
};
const main = <T>(fn: () => T) => inAccount('main', fn);
const message = async (id: string) => { const r = await main(() => checkFolderDeletion(id)); return r.ok ? '' : r.message; };

// A folder of its own: may go, and goes
const research = main(() => bot('Research', dir('Research')));
fs.writeFileSync(path.join(root, 'Research', 'notes.md'), 'x');
check('a folder only this bot uses: may go', (await main(() => checkFolderDeletion(research.id))).ok);
const gone = await main(() => deleteBotFolder(research.id));
check('deleted with what is in it', !fs.existsSync(gone) && gone.endsWith('Research'), gone);
check('a missing folder: says so', (await message(research.id)).includes('not there'));

// Shared: the same folder, a folder inside, a folder around; another account counts without its names
const shop = main(() => bot('Shop', dir('shop')));
main(() => bot('Shop docs', dir('shop', 'docs')));
check('a bot in a folder inside: stays, named', (await message(shop.id)).includes('Shop docs'));
const web = main(() => bot('Web', dir('web', 'src')));
main(() => bot('Web all', dir('web')));
check('a bot in a folder around: stays, named', (await message(web.id)).includes('Web all'));
const blog = main(() => bot('Blog', dir('blog')));
inAccount('work', () => bot('Secret name', path.join(root, 'blog')));
const shared = await message(blog.id);
check('a bot of another account: counted, not named', shared.includes('another account') && !shared.includes('Secret name'), shared);
// A bot on another machine with the same path is another folder
const notes = main(() => bot('Notes', dir('notes')));
main(() => elsewhere('Notes far', path.join(root, 'notes')));
check('the same path on another machine does not count', (await main(() => checkFolderDeletion(notes.id))).ok);

// Protected: an allowed folder itself, and a folder outside
const top = main(() => bot('Top', root));
check('the allowed folder itself: stays', (await message(top.id)).includes('stays'));

// Work not on a git server: changed files
const app = dir('app');
execFileSync('git', ['init', '-q'], { cwd: app });
fs.writeFileSync(path.join(app, 'a.txt'), 'x');
const appBot = main(() => bot('App', app));
check('changed files in a repo: stays, the repo named', (await message(appBot.id)).includes('app'));
check('deleting refuses as well and leaves it', (await main(() => deleteBotFolder(appBot.id)).then(() => '', (e: Error) => e.message)) !== '' && fs.existsSync(app));

// A bot on another machine: only that machine deletes
const far = main(() => elsewhere('Far', path.join(root, 'far')));
check('a bot of another machine: only there', (await message(far.id)).includes('LAPTOP'));

for (const d of [root, data]) fs.rmSync(d, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
