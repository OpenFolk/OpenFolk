// Routines with `wake`: the backends report their next runs as fixed times (without the prompt).
// If no suitable machine is awake at the due time, the relay wakes one shortly before via the wake service;
// its backend learns on connecting for which routines, and shuts down again by itself afterwards.
// The schedule lives in RELAY_DATA so that it survives a relay restart.

import fs from 'node:fs';
import path from 'node:path';
import type { WakeEntry } from '../../shared/protocol.ts';

export const WAKE_SCHEDULE_FILE = 'wake-schedule.json';

/** Default: wake this long before the due time (operating system and backend need to start); WAKE_LEAD_SECONDS. */
export const LEAD_MS = 3 * 60_000;
/** Default: still wake up to this long after the due time (e.g. after a relay restart); WAKE_GRACE_SECONDS. */
export const GRACE_MS = 5 * 60_000;

export interface WakeTiming {
    leadMs: number;
    graceMs: number;
}

/** Seconds from an environment variable (0 to a day), otherwise the default. */
function seconds(raw: string | undefined, fallbackMs: number): number {
    const n = Number(raw);
    return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 86_400 ? n * 1000 : fallbackMs;
}

export function wakeTiming(env: NodeJS.ProcessEnv = process.env): WakeTiming {
    return { leadMs: seconds(env.WAKE_LEAD_SECONDS, LEAD_MS), graceMs: seconds(env.WAKE_GRACE_SECONDS, GRACE_MS) };
}

export interface WakeTargets {
    /** Machines awake (connected backends). */
    online(): string[];
    /** Machines the wake service knows (for routines without a preferred machine). */
    wakeable(): Promise<string[]>;
    /** Wakes the machine and remembers the routines for its backend. */
    wake(machine: string, routines: { id: string; at: string }[]): Promise<void>;
}

export class WakeScheduler {
    private schedule: WakeEntry[] = [];
    /** Runs already handled (routineId@at), so each one is woken only once. */
    private handled = new Set<string>();
    private file: string;

    private targets: WakeTargets;
    private log: (text: string) => void;
    private timing: WakeTiming;
    constructor(dataDir: string, targets: WakeTargets, log: (text: string) => void, timing: WakeTiming = wakeTiming()) {
        this.targets = targets;
        this.log = log;
        this.timing = timing;
        this.file = path.join(dataDir, WAKE_SCHEDULE_FILE);
        try {
            this.schedule = toWakeEntries(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        } catch {
            this.schedule = [];
        }
    }

    /** New schedule from a backend; replaces the previous one. */
    set(entries: unknown): void {
        const schedule = toWakeEntries(entries);
        const old = JSON.stringify(this.schedule);
        this.schedule = schedule;
        if (JSON.stringify(schedule) === old) return;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(schedule));
        } catch (e) {
            this.log(`Wake schedule not saved: ${(e as Error).message}`);
        }
        this.log(`Wake schedule: ${schedule.length} run(s)${schedule[0] ? `, next ${schedule[0].at}` : ''}`);
    }

    /** Every 30 s: check due runs and wake if needed (once per machine for all its routines). */
    async check(now = Date.now()): Promise<void> {
        this.schedule = this.schedule.filter((e) => Date.parse(e.at) > now - this.timing.graceMs);
        const due = this.schedule.filter((e) => {
            const t = Date.parse(e.at);
            return t - this.timing.leadMs <= now && !this.handled.has(`${e.routineId}@${e.at}`);
        });
        if (due.length === 0) return;
        const online = this.targets.online();
        const perMachine = new Map<string, { id: string; at: string }[]>();
        let wakeable: string[] | null = null;
        for (const e of due) {
            this.handled.add(`${e.routineId}@${e.at}`);
            // machineOnly: that machine itself must be awake; otherwise any awake machine will do
            const needed = e.machineOnly ? !online.includes(e.machine) : online.length === 0;
            if (!needed) continue;
            let target = e.machine;
            if (!target) {
                wakeable ??= await this.targets.wakeable().catch(() => []);
                target = wakeable[0] ?? '';
            }
            if (!target) {
                this.log(`Wake schedule: no machine to wake for routine ${e.routineId}`);
                continue;
            }
            perMachine.set(target, [...(perMachine.get(target) ?? []), { id: e.routineId, at: e.at }]);
        }
        for (const [machine, routines] of perMachine) {
            try {
                await this.targets.wake(machine, routines);
                this.log(`Wake schedule: woke ${machine} for ${routines.length} routine(s)`);
            } catch (err) {
                this.log(`Wake schedule: could not wake ${machine}: ${(err as Error).message}`);
            }
        }
        // clean up old markers
        if (this.handled.size > 2000) this.handled = new Set([...this.handled].slice(-500));
    }
}

/**
 * Takes only well-formed entries (the schedule comes from the backends, but over the network). Also accepts the
 * field names of older backends and stored schedules (`zeit`, `rechner`, `nurDort`).
 */
export function toWakeEntries(data: unknown): WakeEntry[] {
    if (!Array.isArray(data)) return [];
    const out: WakeEntry[] = [];
    for (const raw of data) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const e = { routineId: r.routineId, at: r.at ?? r.zeit, machine: r.machine ?? r.rechner, machineOnly: r.machineOnly ?? r.nurDort };
        if (typeof e.routineId !== 'string' || !/^[\w-]{1,40}$/.test(e.routineId)) continue;
        if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) continue;
        if (typeof e.machine !== 'string' || !/^[a-z0-9-]{0,32}$/.test(e.machine)) continue;
        if (typeof e.machineOnly !== 'boolean') continue;
        out.push({ routineId: e.routineId, at: new Date(e.at).toISOString(), machine: e.machine, machineOnly: e.machineOnly });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 1000);
}
