// Tests for the download locks:  node local/src/files.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from './remove-tree.ts';

// Allowed root for this test: the folder containing this repo (set before the config is loaded)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.ALLOWED_ROOTS = `${path.dirname(repo)};${os.homedir()}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-files-'));
const { fileBlocked, readFile, botFile } = await import('./files.ts');
const { config } = await import('./config.ts');
const { isUnder, saveBot } = await import('./bots.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const error = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

const blocked = ['C:/work/.env', 'C:/work/tools/install.env', 'C:/work/x/.env.local', 'C:/work/x/.env.tpl', 'C:/work/x/server.key',
    'C:/work/tools/zugangsdaten.txt', 'C:/work/x/credentials.json', path.join(config.dataDir, 'vapid.json'), path.join(config.dataDir, 'accounts', 'main', 'push.json'),
    path.join(config.dataDir, 'accounts', 'other', 'uploads', 'chat', 'a.txt'),
    path.join(os.homedir(), '.codex', 'auth.json'), path.join(os.homedir(), '.claude', 'projects', 'x', 'session.jsonl'),
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Cookies')];
for (const p of blocked) check(`blocked: ${p}`, fileBlocked(path.resolve(p)));
const free = [path.join(repo, 'README.md'), 'C:/work/x/environment.md', path.join(config.dataDir, 'accounts', 'main', 'uploads', 'a', 'image.png'),
    path.join(os.homedir(), 'projects', '.github', 'ci.yml')];
for (const p of free) check(`free: ${p}`, !fileBlocked(path.resolve(p)));

// Only bot folders and uploads are handed out, not everything under ALLOWED_ROOTS
check('no bot yet: README outside every bot folder', error(() => readFile(path.join(repo, 'README.md'))).includes('outside'));
saveBot({ id: 'docs', name: 'Docs', role: '', folder: path.join(repo, 'docs'), model: 'default', tone: '', avatar: '', approval: 'risky', machine: '' });
check('file in a bot folder readable', readFile(path.join(repo, 'docs', 'README.de.md')).data.length > 0);
check('file next to the bot folder rejected', error(() => readFile(path.join(repo, 'README.md'))).includes('outside'));
check('outside ALLOWED_ROOTS rejected', error(() => readFile(process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/hostname')).includes('outside'));
check('send_file: relative path in the bot folder', botFile(path.join(repo, 'docs'), 'README.de.md').name === 'README.de.md');
check('send_file: ../ out of the bot folder rejected', error(() => botFile(path.join(repo, 'docs'), '../README.md')).includes('outside'));
const upload = path.join(config.dataDir, 'accounts', 'main', 'uploads', 'chat', 'a.txt');
fs.mkdirSync(path.dirname(upload), { recursive: true });
fs.writeFileSync(upload, 'x');
check('upload readable', readFile(upload).data === Buffer.from('x').toString('base64'));

// A bot whose folder is home itself still cannot hand out the CLIs' logins
const homeBot = saveBot({ id: 'home', name: 'Home', role: '', folder: os.homedir(), model: 'default', tone: '', avatar: '', approval: 'risky', machine: '' });
check('home bot: ~/.codex blocked', error(() => botFile(homeBot.folder, '.codex/auth.json')).length > 0 && fileBlocked(path.join(os.homedir(), '.codex', 'auth.json')));

// A junction (Windows) or symbolic link inside an allowed folder must not lead out of it
const sandbox = fs.mkdtempSync(path.join(path.dirname(repo), '.openfolk-link-test-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-outside-'));
fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
try {
    fs.symlinkSync(outside, path.join(sandbox, 'link'), 'junction');
    const linkBot = saveBot({ id: 'link', name: 'Link', role: '', folder: sandbox, model: 'default', tone: '', avatar: '', approval: 'risky', machine: '' });
    check('link out of the bot folder: download rejected', error(() => botFile(linkBot.folder, 'link/secret.txt')).length > 0);
    check('link out of a folder: not under it', !isUnder(path.join(sandbox, 'link', 'secret.txt'), sandbox));
} finally {
    removeTree(sandbox);
    removeTree(outside);
}

if (failures) process.exit(1);
console.log('all tests passed');
