// Tests for the end-to-end encryption:  node local/src/e2e.test.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.E2E_KEY = crypto.randomBytes(32).toString('base64url');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-e2e-'));
const { e2eEnabled, decrypt, encrypt, setupE2eKey, ReplayError, REPLAY_WINDOW_MS } = await import('./e2e.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const thrown = (f: () => unknown) => { try { f(); return null; } catch (e) { return e as Error; } };
const throws = (f: () => unknown) => thrown(f) !== null;

check('enabled with E2E_KEY', e2eEnabled);
check('E2E_KEY wins, nothing generated', setupE2eKey() === 'env' && !fs.existsSync(path.join(process.env.DATA_DIR, 'e2e-key')));
const frame = { type: 'send', chatId: 'cloud', text: 'Secret message äöü 🔐' };
const v = encrypt(frame, 'b2c');
check('plain text is not in the frame', !v.data.includes('Secret') && !Buffer.from(v.data, 'base64').toString('latin1').includes('Secret'));
check('round trip equal, without the replay guard', JSON.stringify(decrypt(v, 'b2c')) === JSON.stringify(frame));
check('new IV every time', encrypt(frame, 'b2c').iv !== v.iv);
check('other direction is rejected', throws(() => decrypt(encrypt(frame, 'b2c'), 'c2b')));
const tampered = Buffer.from(v.data, 'base64');
tampered[0] ^= 1;
check('altered data is rejected', throws(() => decrypt({ iv: v.iv, data: tampered.toString('base64') }, 'b2c')));
check('wrong IV is rejected', throws(() => decrypt({ iv: crypto.randomBytes(12).toString('base64'), data: v.data }, 'b2c')));

// Replay: the same frame a second time, an older frame of the same sender, frames without a guard or too old
const replay = thrown(() => decrypt(v, 'b2c'));
check('same frame a second time is rejected', replay instanceof ReplayError && replay.reason === 'repeated');
const first = encrypt(frame, 'peer');
const second = encrypt(frame, 'peer');
decrypt(second, 'peer');
check('older frame of the same sender is rejected', (thrown(() => decrypt(first, 'peer')) as InstanceType<typeof ReplayError>)?.reason === 'repeated');

// A frame as another party builds it (fixed AAD bytes 'openfolk:<direction>', paired browsers use these bytes)
const key = Buffer.from(process.env.E2E_KEY.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function foreign(content: object, direction: string) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(`openfolk:${direction}`));
    const data = Buffer.concat([c.update(JSON.stringify(content), 'utf8'), c.final(), c.getAuthTag()]);
    return { iv: iv.toString('base64'), data: data.toString('base64') };
}
const browser = crypto.randomBytes(8).toString('hex');
check('frame of a browser with the fixed AAD bytes is accepted',
    JSON.stringify(decrypt(foreign({ ...frame, _r: { t: Date.now(), s: browser, n: 1 } }, 'c2b'), 'c2b')) === JSON.stringify(frame));
check('frame without a guard (app too old) is rejected', (thrown(() => decrypt(foreign(frame, 'c2b'), 'c2b')) as InstanceType<typeof ReplayError>)?.reason === 'missing');
check('frame from far in the past is rejected',
    (thrown(() => decrypt(foreign({ ...frame, _r: { t: Date.now() - REPLAY_WINDOW_MS - 1000, s: browser, n: 2 } }, 'c2b'), 'c2b')) as InstanceType<typeof ReplayError>)?.reason === 'stale');
check('counters are kept per sender',
    !throws(() => decrypt(foreign({ ...frame, _r: { t: Date.now(), s: crypto.randomBytes(8).toString('hex'), n: 1 } }, 'c2b'), 'c2b')));

// Without E2E_KEY the backend generates a key on its start and finds it again on the next start
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-e2e-new-'));
const probe = `
    const e2e = await import(${JSON.stringify(new URL('./e2e.ts', import.meta.url).href)});
    const before = e2e.e2eEnabled;
    console.log(JSON.stringify({ before, setup: e2e.setupE2eKey(), after: e2e.e2eEnabled, link: e2e.e2eKeyForLink() }));`;
const { execFileSync } = await import('node:child_process');
const run = (env: Record<string, string>) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe],
    { env: { ...process.env, DATA_DIR: dir, ...env }, encoding: 'utf8' }).trim().split('\n').pop()!);
const a = run({ E2E_KEY: '' });
check('no E2E_KEY: off until the start, then generated', a.before === false && a.setup === 'generated' && a.after === true && a.link.length === 43);
const keyFile = path.join(dir, 'e2e-key');
check('generated key stored', fs.readFileSync(keyFile, 'utf8').trim() === a.link);
if (process.platform !== 'win32') check('key file only readable by the owner', (fs.statSync(keyFile).mode & 0o077) === 0);
const b = run({ E2E_KEY: '' });
check('next start uses the same key', b.before === true && b.setup === 'file' && b.link === a.link);
const c = run({ E2E_KEY: 'off' });
check('E2E_KEY=off switches it off', c.before === false && c.setup === 'off' && c.after === false);
fs.rmSync(dir, { recursive: true, force: true });

if (failures) process.exit(1);
console.log('all tests passed');
