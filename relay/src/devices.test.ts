// Tests for device keys and TOTP:  node relay/src/devices.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVICE_IDLE_MS, Devices, PAIRING_TTL_MS, totpCode, totpVerify, totpVerifyOnce } from './devices.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`); if (!ok) failed++; };

// RFC 6238, appendix B: secret "12345678901234567890" (Base32 GEZDGNBVGY3TQOJQ…), SHA-1, 8 digits 94287082 at T=59 s
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
check('TOTP: RFC 6238 test vector (last 6 digits 287082)', totpCode(RFC, 59_000) === '287082');
check('TOTP: RFC 6238 at T=1111111109 (081804)', totpCode(RFC, 1111111109_000) === '081804');
check('TOTP: code of the previous window is still valid', totpVerify(RFC, totpCode(RFC, 1_000_000_000_000 - 30_000), 1_000_000_000_000));
check('TOTP: code from two windows ago is not valid', !totpVerify(RFC, totpCode(RFC, 1_000_000_000_000 - 60_000), 1_000_000_000_000));
check('TOTP: garbage is rejected', !totpVerify(RFC, 'abc123') && !totpVerify(RFC, '12345'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-devices-'));
const d = new Devices(dir);
const { device, token } = d.create('Test phone', '203.0.113.5');
check('creating a device returns the key <id>.<secret>', token.startsWith(device.id + '.') && token.length > 40);
const stored = fs.readFileSync(path.join(dir, 'devices.json'), 'utf8');
check('file contains only the hash, not the key', !stored.includes(token.split('.')[1]) && /"hash": "[0-9a-f]{64}"/.test(stored));
check('stored with English field names', /"created":/.test(stored) && /"lastSeen":/.test(stored) && !/erstellt|zuletzt/.test(stored));
check('correct key is accepted', d.verify(token, '203.0.113.6')?.id === device.id);
check('wrong secret is rejected', d.verify(`${device.id}.wrong`, 'x') === null);
check('foreign id is rejected', d.verify('000000000000.' + token.split('.')[1], 'x') === null);
check('list after reloading from the file', new Devices(dir).all().length === 1);
check('logging out removes the device', d.remove(device.id) && d.verify(token, 'x') === null);
const a = d.create('Chrome on Windows', '198.51.100.1');
const b = d.create('Chrome on Windows', '198.51.100.1');
check('unused device with the same name and address is replaced', d.all().filter((x) => x.name === 'Chrome on Windows').length === 1 && d.verify(a.token, 'x') === null && d.verify(b.token, '198.51.100.1') !== null);
const c = d.create('Chrome on Windows', '198.51.100.1');
check('used device stays', d.all().filter((x) => x.name === 'Chrome on Windows').length === 2 && d.verify(b.token, 'x') !== null && !!c);

// ---- pairing links: one-time tokens a backend mints for a new device
const now = 1_800_000_000_000;
const p = d.createPairing(now);
check('pairing token is long and expires in 15 minutes', p.token.length >= 32 && p.expiresAt === new Date(now + PAIRING_TTL_MS).toISOString());
check('unknown token is refused', d.redeemPairing('nope', 'Phone', '1.2.3.4', now) === null);
const paired = d.redeemPairing(p.token, 'Phone', '1.2.3.4', now + 60_000);
check('token signs a device in and returns its key', !!paired && paired.token.startsWith(paired.device.id + '.') && d.verify(paired.token, '1.2.3.4') !== null);
check('token works only once', d.redeemPairing(p.token, 'Phone again', '1.2.3.4', now + 60_000) === null);
const late = d.createPairing(now);
check('expired token is refused', d.redeemPairing(late.token, 'Phone', '1.2.3.4', now + PAIRING_TTL_MS + 1) === null);
check('tokens are not stored in the devices file', !fs.readFileSync(path.join(dir, 'devices.json'), 'utf8').includes(p.token.slice(0, 12)));
fs.rmSync(dir, { recursive: true, force: true });

// A TOTP code counts once: whoever saw it (shoulder, recording) cannot use it again within its 90 seconds
const T = 1_700_000_000_000;
const SECRET2 = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
check('TOTP once: first use accepted', totpVerifyOnce(SECRET2, totpCode(SECRET2, T), T));
check('TOTP once: same code again refused', !totpVerifyOnce(SECRET2, totpCode(SECRET2, T), T + 5_000));
check('TOTP once: older window refused afterwards', !totpVerifyOnce(SECRET2, totpCode(SECRET2, T - 30_000), T));
check('TOTP once: next window accepted', totpVerifyOnce(SECRET2, totpCode(SECRET2, T + 30_000), T + 30_000));

// Device keys unused for DEVICE_IDLE_MS expire, with the stored address
const idleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-devices-idle-'));
const idle = new Devices(idleDir);
const fresh = idle.create('Phone', '203.0.113.9');
const later = Date.now() + DEVICE_IDLE_MS + 60_000;
check('idle device: valid before', idle.verify(fresh.token, '203.0.113.9') !== null);
check('idle device: refused after 90 days without use', idle.verify(fresh.token, '203.0.113.9', later) === null);
check('idle device: removed from the file', !fs.readFileSync(path.join(idleDir, 'devices.json'), 'utf8').includes(fresh.device.id));
const active = idle.create('Laptop', '203.0.113.10');
check('device in use stays', idle.verify(active.token, '203.0.113.10', Date.now() + DEVICE_IDLE_MS / 2) !== null
    && idle.verify(active.token, '203.0.113.10', Date.now() + DEVICE_IDLE_MS) !== null);
fs.rmSync(idleDir, { recursive: true, force: true });

if (failed) process.exit(1);
console.log('all tests passed');
