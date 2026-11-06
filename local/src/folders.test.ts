// Tests for checking and cloning bot folders:  node local/src/folders.test.ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folders-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folders-data-'));
process.env.ALLOWED_ROOTS = root;
const { botRoot, cloneName, cloneRepository, inspectFolder, listFolder, placeOf, planMove, prepareMove, proposeFolder } = await import('./folders.ts');
const { saveMachineSettings } = await import('./machine-settings.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const refused = async (f: () => unknown) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

check('name from https', cloneName('https://git.example.com/team/website.git') === 'website');
check('name from ssh form', cloneName('git@github.com:team/api.git') === 'api');
check('name without .git and with a trailing slash', cloneName('https://git.example.com/team/docs/') === 'docs');
for (const bad of ['--upload-pack=touch /tmp/x', 'ext::sh -c touch% /tmp/x', 'C:/www/website', '/home/me/website', 'file:///srv/repo.git', 'https://host/..']) {
    check(`refused: ${bad}`, (await refused(() => cloneName(bad))) !== '');
}

const repo = path.join(root, 'website');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-q'], { cwd: repo });
execFileSync('git', ['remote', 'add', 'origin', 'https://git.example.com/team/website.git'], { cwd: repo });
const inspected = await inspectFolder(repo);
check('check: folder as stored and its origin', inspected.folder === repo.replace(/\\/g, '/') && inspected.remote === 'https://git.example.com/team/website.git', inspected);
check('check: missing folder refused', (await refused(() => inspectFolder(path.join(root, 'nothing')))) !== '');
check('check: folder outside the allowed roots refused', (await refused(() => inspectFolder(os.homedir()))) !== '');

check('clone: existing clone of the same repository is used', await cloneRepository('https://git.example.com/team/website') === repo.replace(/\\/g, '/'));
fs.mkdirSync(path.join(root, 'api'));
fs.writeFileSync(path.join(root, 'api', 'notes.txt'), 'something else');
check('clone into a given folder: one with other content refused', (await refused(() => cloneRepository('https://git.example.com/team/api.git', path.join(root, 'api')))).includes('api'));
check('clone into a given folder: outside the allowed roots refused', (await refused(() => cloneRepository('https://git.example.com/team/api.git', path.join(os.homedir(), 'api-x')))) !== '');
check('clone into a given folder: the same repository there is used', await cloneRepository('https://git.example.com/team/website.git', repo) === repo.replace(/\\/g, '/'));

// Where a repository would go, for the editor's folder field
const slash = (p: string) => p.replace(/\\/g, '/');
const here = await proposeFolder('https://git.example.com/team/website.git');
check('propose: the folder holding it already', here.folder === slash(repo) && here.existing === true, here);
const taken = await proposeFolder('https://git.example.com/team/api.git');
check('propose: name taken by something else, the next free one', taken.folder === slash(path.join(root, 'api-2')) && !taken.existing, taken);
const fresh = await proposeFolder('git@github.com:team/docs.git');
check('propose: a new folder named after the repository', fresh.folder === slash(path.join(root, 'docs')) && !fresh.existing, fresh);
check('propose: no address refused', (await refused(() => proposeFolder('C:/www/website'))) !== '');

// The folder picker: subfolders, never outside the allowed roots
fs.mkdirSync(path.join(root, '.hidden'));
fs.mkdirSync(path.join(root, 'website', 'node_modules'));
fs.mkdirSync(path.join(root, 'website', 'src'));
fs.writeFileSync(path.join(root, 'file.txt'), '');
const top = listFolder('');
check('list: a single root is listed at once, without a way up', top.folder === slash(root) && top.parent === undefined, top);
check('list: subfolders sorted, without files and hidden folders', JSON.stringify(top.folders) === JSON.stringify(['api', 'website'].map((n) => slash(path.join(root, n)))), top.folders);
const inner = listFolder(repo);
check('list: a subfolder leads back up and leaves node_modules out', inner.parent === slash(root) && JSON.stringify(inner.folders) === JSON.stringify([slash(path.join(repo, 'src'))]), inner);
const missing = listFolder(path.join(repo, 'gone', 'deeper'));
check('list: a missing folder lists its nearest existing parent', missing.folder === slash(repo), missing);
const outside = listFolder(os.homedir());
check('list: a folder outside the roots lists the root instead', outside.folder === slash(root), outside);

// The place of a bot (Bot.place): relative to the folder for bots, with its repository, rebuilt on another machine
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
check('folder for bots: the first allowed folder without a setting', botRoot() === path.resolve(root), botRoot());
check('place: a repository at the top', JSON.stringify(await placeOf(repo)) === JSON.stringify({ path: 'website', repo: 'https://git.example.com/team/website.git' }), await placeOf(repo));
check('place: a folder inside a repository names the repository root', JSON.stringify(await placeOf(path.join(repo, 'src')))
    === JSON.stringify({ path: 'website/src', repo: 'https://git.example.com/team/website.git', repoPath: 'website' }), await placeOf(path.join(repo, 'src')));
fs.mkdirSync(path.join(root, 'notes', 'daily'), { recursive: true });
check('place: a folder without a repository', JSON.stringify(await placeOf(path.join(root, 'notes', 'daily'))) === JSON.stringify({ path: 'notes/daily' }), await placeOf(path.join(root, 'notes', 'daily')));
const local = path.join(root, 'local-only');
fs.mkdirSync(local);
git(local, 'init', '-q');
check('place: none for a repository without an origin', await placeOf(local) === undefined);
check('place: none outside the allowed folders', await placeOf(os.homedir()) === undefined);
const secret = path.join(root, 'secret');
fs.mkdirSync(secret);
git(secret, 'init', '-q');
git(secret, 'remote', 'add', 'origin', 'https://me:t0ken@git.example.com/team/secret.git');
check('place: the origin without its token', (await placeOf(secret))?.repo === 'https://me@git.example.com/team/secret.git', await placeOf(secret));

// The other machine: a source repository to clone from, and a folder for bots chosen in the machine settings
const source = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folders-source-'));
git(source, 'init', '-q');
fs.mkdirSync(path.join(source, 'src'));
fs.writeFileSync(path.join(source, 'src', 'index.txt'), 'hello');
git(source, 'add', '.');
git(source, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'first');
const url = 'https://git.example.com/team/shop.git';
const bots = path.join(root, 'bots');
saveMachineSettings({ botFolder: slash(bots) });
check('folder for bots: the one from the settings', botRoot() === path.resolve(bots), botRoot());
saveMachineSettings({ botFolder: slash(os.homedir()) });
check('folder for bots: one outside the allowed folders is ignored', botRoot() === path.resolve(root), botRoot());
saveMachineSettings({ botFolder: slash(bots) });
const shop = { path: 'apps/shop/src', repo: url, repoPath: 'apps/shop' };
const planned = await planMove(shop);
check('move: missing repository is cloned, the folder is inside it', planned.action === 'clone' && planned.folder === slash(path.join(bots, 'apps', 'shop', 'src')), planned);
// git clones from the source folder in place of the address (the address check happens first)
execFileSync('git', ['clone', '-q', source, path.join(bots, 'apps', 'shop')]);
git(path.join(bots, 'apps', 'shop'), 'remote', 'set-url', 'origin', url);
const there = await planMove(shop);
check('move: a clone of the same repository there is used', there.action === 'use' && there.folder === planned.folder, there);
const moved = await prepareMove(shop);
check('move: carried out, the folder as this machine stores it', moved.folder === slash(path.join(bots, 'apps', 'shop', 'src')) && fs.existsSync(path.join(moved.folder, 'index.txt')), moved);
const plain = await prepareMove({ path: 'notes/daily' });
check('move: a folder without a repository is created', plain.action === 'create' && fs.statSync(plain.folder).isDirectory() && plain.folder === slash(path.join(bots, 'notes', 'daily')), plain);
fs.mkdirSync(path.join(bots, 'website'));
fs.writeFileSync(path.join(bots, 'website', 'other.txt'), 'something else');
check('move: a folder there with other content is refused', (await refused(() => planMove({ path: 'website', repo: 'https://git.example.com/team/website.git' }))).includes('website'));
for (const bad of [{ path: '../outside' }, { path: 'C:/elsewhere' }, { path: '/etc' }, { path: 'a/src', repo: url, repoPath: 'b' }]) {
    check(`move: a place leading out refused (${JSON.stringify(bad)})`, (await refused(() => planMove(bad))) !== '');
}
check('propose: into the folder for bots', (await proposeFolder('https://git.example.com/team/blog.git')).folder === slash(path.join(bots, 'blog')));

for (const d of [root, source, process.env.DATA_DIR!]) fs.rmSync(d, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
