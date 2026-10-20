// Tests for the migration of RELAY_DATA to data version 2:  node relay/src/migrate.test.ts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Devices } from './devices.ts';
import { MachinesSeen } from './machines-seen.ts';
import { migrateRelayData } from './migrate.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`); if (!ok) failed++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-migrate-'));
const secret = 'test-secret-for-the-old-device';
const hash = createHash('sha256').update(secret).digest('hex');
fs.writeFileSync(path.join(dir, 'geraete.json'), JSON.stringify([
    { id: 'a1b2c3d4e5f6', name: 'Phone', hash, erstellt: '2026-09-01T10:00:00.000Z', zuletzt: '2026-10-01T10:00:00.000Z', ip: '203.0.113.5', benutzt: true },
]));
fs.writeFileSync(path.join(dir, 'rechner-gesehen.json'), JSON.stringify({ desktop: '2026-10-08T21:00:00.000Z' }));
fs.writeFileSync(path.join(dir, 'weckplan.json'), JSON.stringify([
    { routineId: 'mail', zeit: '2026-10-20T05:30:00.000Z', rechner: 'desktop', nurDort: true },
]));

const first = migrateRelayData(dir);
check('all three files migrated', first.length === 3);

const devices = JSON.parse(fs.readFileSync(path.join(dir, 'devices.json'), 'utf8')) as Record<string, unknown>[];
check('devices: created/lastSeen mapped', devices[0].created === '2026-09-01T10:00:00.000Z' && devices[0].lastSeen === '2026-10-01T10:00:00.000Z' && !('erstellt' in devices[0]));
check('devices: hash unchanged', devices[0].hash === hash && devices[0].used === true);
check('devices: old key still signs in', new Devices(dir).verify(`a1b2c3d4e5f6.${secret}`, '203.0.113.9')?.name === 'Phone');

check('machines seen: kept', new MachinesSeen(dir).gone([]).desktop === '2026-10-08T21:00:00.000Z');

const schedule = JSON.parse(fs.readFileSync(path.join(dir, 'wake-schedule.json'), 'utf8')) as Record<string, unknown>[];
check('wake schedule: at/machine/machineOnly mapped', schedule.length === 1 && schedule[0].at === '2026-10-20T05:30:00.000Z' && schedule[0].machine === 'desktop' && schedule[0].machineOnly === true);

check('old files kept as .bak', ['geraete.json', 'rechner-gesehen.json', 'weckplan.json'].every((f) => !fs.existsSync(path.join(dir, f)) && fs.existsSync(path.join(dir, f + '.bak'))));
check('data version written', JSON.parse(fs.readFileSync(path.join(dir, 'data-version.json'), 'utf8')).version === 2);

// Idempotent: a second run changes nothing, even if an old file shows up again
const devicesBefore = fs.readFileSync(path.join(dir, 'devices.json'), 'utf8');
fs.writeFileSync(path.join(dir, 'geraete.json'), '[]');
check('second run migrates nothing', migrateRelayData(dir).length === 0);
check('existing devices.json is not overwritten', fs.readFileSync(path.join(dir, 'devices.json'), 'utf8') === devicesBefore);

// Empty folder: nothing to do, no crash
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-migrate-empty-'));
check('empty folder: nothing migrated', migrateRelayData(empty).length === 0);

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('all tests passed');
