// Routines: per bot a job on a schedule. The scheduler checks every 20 seconds whether a routine is
// due; missed runs (machine off) are not caught up.

import { randomUUID } from 'node:crypto';
import { parseCron, runs } from './cron.ts';
import { t } from './i18n.ts';
import { readJson, setTombstone, writeJson } from './store.ts';
import type { Bot, Routine, RoutineInput, WakeEntry } from '../../shared/protocol.ts';

export function loadRoutines(): Routine[] {
    return readJson<Partial<Routine>[]>('routines.json', []).map((r) => ({ updatedAt: r.lastRun ?? '', ...r }) as Routine);
}

export function saveRoutines(list: Routine[]): void {
    writeJson('routines.json', list);
}

export function saveRoutine(input: RoutineInput): Routine {
    parseCron(input.cron); // throws for an invalid expression
    if (!input.prompt.trim()) throw new Error(t('routines.promptMissing'));
    const list = loadRoutines();
    const existing = input.id ? list.find((r) => r.id === input.id) : undefined;
    const routine: Routine = {
        id: existing?.id ?? randomUUID().slice(0, 8),
        botId: input.botId,
        name: input.name.trim() || 'Routine',
        cron: input.cron.trim(),
        prompt: input.prompt.trim(),
        enabled: input.enabled,
        wake: input.wake || undefined,
        lastRun: existing?.lastRun,
        lastStatus: existing?.lastStatus,
        updatedAt: new Date().toISOString(),
    };
    if (existing) list[list.indexOf(existing)] = routine;
    else list.push(routine);
    saveRoutines(list);
    return routine;
}

export function deleteRoutine(id: string): void {
    saveRoutines(loadRoutines().filter((r) => r.id !== id));
    setTombstone(`routine:${id}`);
}

export function deleteBotRoutines(botId: string): void {
    const list = loadRoutines();
    for (const r of list.filter((x) => x.botId === botId)) setTombstone(`routine:${r.id}`);
    saveRoutines(list.filter((r) => r.botId !== botId));
}

export function setStatus(id: string, status: Routine['lastStatus'], lastRun?: string): void {
    const list = loadRoutines();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    r.lastStatus = status;
    if (lastRun) r.lastRun = lastRun;
    r.updatedAt = new Date().toISOString();
    saveRoutines(list);
}

/** This far ahead the backends report the runs of routines with `wake` to the relay. */
const WAKE_SCHEDULE_DAYS = 14;

/** Runs of active routines with `wake` in the coming days, as fixed times for the relay. */
export function wakeSchedule(bots: Pick<Bot, 'id' | 'machine'>[], now = new Date()): WakeEntry[] {
    const until = new Date(now.getTime() + WAKE_SCHEDULE_DAYS * 24 * 3600_000);
    const schedule: WakeEntry[] = [];
    for (const r of loadRoutines()) {
        const bot = bots.find((b) => b.id === r.botId);
        if (!r.enabled || !r.wake || !bot) continue;
        try {
            for (const d of runs(r.cron, now, until, 60)) {
                schedule.push({ routineId: r.id, at: d.toISOString(), machine: bot.machine, machineOnly: !!bot.machine });
            }
        } catch {
            // invalid expression: already caught when saving
        }
    }
    return schedule.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 500);
}

/** Starts the scheduler; `run` is called for every due routine. */
export function startScheduler(run: (r: Routine) => void): NodeJS.Timeout {
    let lastMinute = '';
    const check = () => {
        const now = new Date();
        const minute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
        if (minute === lastMinute) return;
        lastMinute = minute;
        for (const r of loadRoutines()) {
            if (!r.enabled) continue;
            try {
                if (parseCron(r.cron).matches(now)) run(r);
            } catch {
                // invalid expression: already caught when saving, silently ignored here
            }
        }
    };
    return setInterval(check, 20_000);
}
