// Tests for checking and cloning bot folders:  node local/src/folders.test.ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folders-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-folders-data-'));
process.env.ALLOWED_ROOTS = root;
const { cloneName, cloneRepository, inspectFolder, proposeFolder } = await import('./folders.ts');

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

for (const d of [root, process.env.DATA_DIR!]) fs.rmSync(d, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
