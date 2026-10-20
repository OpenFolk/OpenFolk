// The data folder holds push keys, device tokens, the history and the uploads: only its owner may read it.
// File modes exist on Linux and macOS only (CI, the container); on Windows the folder's access rights apply.
//   node local/src/data-permissions.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-perm-')), 'data');
process.env.DATA_DIR = dir;
const { secureDataDir, writeJson, accountPath } = await import('./store.ts');
const { appendEntry, markRead } = await import('./history.ts');
const { saveUploads } = await import('./files.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const mode = (p: string) => fs.statSync(p).mode & 0o777;

secureDataDir();
writeJson('push.json', { subscriptions: [] });
const e = appendEntry('cloud', { role: 'user', from: 'me', text: 'hi', ts: new Date().toISOString() });
markRead('cloud', e.id!, new Date().toISOString());
const [upload] = saveUploads('cloud', [{ name: 'a.txt', type: 'text/plain', data: Buffer.from('x').toString('base64') }]);
const history = fs.readdirSync(accountPath('history')).map((f) => accountPath('history', f));

if (process.platform === 'win32') {
    check('files written (modes are checked on Linux and macOS)', fs.existsSync(accountPath('push.json')) && history.length === 1 && fs.existsSync(upload.attachment.path));
} else {
    check('data folder only for its owner', mode(dir) === 0o700, mode(dir).toString(8));
    check('JSON file 0600', mode(accountPath('push.json')) === 0o600, mode(accountPath('push.json')).toString(8));
    check('history 0600, also after rewriting', history.every((p) => mode(p) === 0o600), history.map((p) => mode(p).toString(8)));
    check('upload 0600', mode(upload.attachment.path) === 0o600, mode(upload.attachment.path).toString(8));
    fs.chmodSync(dir, 0o755);
    secureDataDir();
    check('a folder opened up later is restricted again on start', mode(dir) === 0o700, mode(dir).toString(8));
}
fs.rmSync(path.dirname(dir), { recursive: true, force: true });

if (failures) process.exit(1);
console.log('all tests passed');
