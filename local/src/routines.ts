// Routines: per bot a job on a schedule. The scheduler checks every 20 seconds whether a routine is
// due; missed runs (machine off) are not caught up. The last runs are kept in the routine itself (routines.json):
// they travel with it to the other machines in the sync, and since only the responsible machine runs a routine,
// the newest state (updatedAt) carries them.

import { randomUUID } from 'node:crypto';
import { nextRun, parseCron, runs } from './cron.ts';
import { t } from './i18n.ts';
import { readJson, setTombstone, writeJson } from './store.ts';
import type { Bot, Routine, RoutineInput, RoutineRun, WakeEntry } from '../../shared/protocol.ts';

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
        runs: existing?.runs,
        updatedAt: new Date().toISOString(),
    };
    if (existing) list[list.indexOf(existing)] = routine;
    else list.push(routine);
    saveRoutines(list);
    return routine;
}

/** The list for the web app: with the next due time of every active routine. */
export function routinesWithNextRun(now = new Date()): Routine[] {
    return loadRoutines().map((r) => {
        if (!r.enabled) return r;
        try {
            const next = nextRun(r.cron, now);
            return next ? { ...r, nextRun: next.toISOString() } : r;
        } catch {
            return r;
        }
    });
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

/** Copies of a bot's routines for another bot, paused: a copy that runs at once would do the same job twice. */
export function copyRoutines(fromBot: string, toBot: string): Routine[] {
    return loadRoutines().filter((r) => r.botId === fromBot)
        .map((r) => saveRoutine({ id: '', botId: toBot, name: r.name, cron: r.cron, prompt: r.prompt, enabled: false, wake: r.wake }));
}

/** This many runs per routine are kept. */
export const RUNS_KEPT = 20;

function changeRoutine(id: string, change: (r: Routine) => void): void {
    const list = loadRoutines();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    change(r);
    r.updatedAt = new Date().toISOString();
    saveRoutines(list);
}

/** A run begins; `start` names it until it ends. `entryId`: the routine's message in the chat. */
export function runStarted(id: string, start: string, entryId?: string): void {
    changeRoutine(id, (r) => {
        r.lastStatus = 'running';
        r.lastRun = start;
        const run: RoutineRun = { start, status: 'running', entryId };
        r.runs = [run, ...(r.runs ?? [])].slice(0, RUNS_KEPT);
    });
}

/** A run ended; with the answer's entry, if there was one, to jump to. */
export function runFinished(id: string, start: string, result: { error?: string; entryId?: string }, end = new Date()): void {
    changeRoutine(id, (r) => {
        const status = result.error ? 'error' : 'ok';
        r.lastStatus = status;
        const run = r.runs?.find((x) => x.start === start);
        if (!run) return;
        run.end = end.toISOString();
        run.status = status;
        if (result.error) run.error = result.error.slice(0, 500);
        if (result.entryId) run.entryId = result.entryId;
    });
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
