// Migrates the relay's data folder (RELAY_DATA) to the current format on start. Idempotent: a file is converted
// only while the new one does not exist yet; the old file is kept as `<name>.bak`. `data-version.json` records
// the version reached.
//
// Version 2 (English codebase): geraete.json -> devices.json, rechner-gesehen.json -> machines-seen.json,
// weckplan.json -> wake-schedule.json, each with English field names.

import fs from 'node:fs';
import path from 'node:path';
import { DEVICES_FILE, toDevices } from './devices.ts';
import { MACHINES_SEEN_FILE } from './machines-seen.ts';
import { WAKE_SCHEDULE_FILE, toWakeEntries } from './wake-schedule.ts';

export const DATA_VERSION = 2;
const VERSION_FILE = 'data-version.json';

interface Step {
    from: string;
    to: string;
    convert: (data: unknown) => unknown;
    /** Owner-only permissions (device hashes). */
    private?: boolean;
}

const STEPS: Step[] = [
    { from: 'geraete.json', to: DEVICES_FILE, convert: toDevices, private: true },
    {
        from: 'rechner-gesehen.json',
        to: MACHINES_SEEN_FILE,
        convert: (d) => (d && typeof d === 'object' && !Array.isArray(d)
            ? Object.fromEntries(Object.entries(d as Record<string, unknown>).filter(([, v]) => typeof v === 'string'))
            : {}),
    },
    { from: 'weckplan.json', to: WAKE_SCHEDULE_FILE, convert: toWakeEntries },
];

/** Returns the names of the files that were migrated in this call. */
export function migrateRelayData(dir: string, log: (text: string) => void = () => undefined): string[] {
    fs.mkdirSync(dir, { recursive: true });
    const done: string[] = [];
    for (const step of STEPS) {
        const oldFile = path.join(dir, step.from);
        const newFile = path.join(dir, step.to);
        if (!fs.existsSync(oldFile) || fs.existsSync(newFile)) continue;
        let data: unknown;
        try {
            data = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
        } catch (e) {
            log(`Migration: ${step.from} not readable, skipped (${(e as Error).message})`);
            continue;
        }
        const tmp = newFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(step.convert(data), null, 2), step.private ? { mode: 0o600 } : undefined);
        fs.renameSync(tmp, newFile);
        fs.renameSync(oldFile, oldFile + '.bak');
        done.push(step.from);
        log(`Migration: ${step.from} -> ${step.to}`);
    }
    const versionFile = path.join(dir, VERSION_FILE);
    let version = 0;
    try {
        version = Number((JSON.parse(fs.readFileSync(versionFile, 'utf8')) as { version?: unknown }).version) || 0;
    } catch {
        // no marker yet
    }
    if (version < DATA_VERSION) fs.writeFileSync(versionFile, JSON.stringify({ version: DATA_VERSION }));
    return done;
}
