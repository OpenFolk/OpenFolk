// Jobs between bots (message_bot, GitHub #43): what a backend keeps so the result of a job comes back into the chat
// that gave it, also after a restart and when the source's machine is asleep at that moment. The relay stores
// nothing; each side keeps its half in the account's jobs.json:
// - `open`: jobs a bot of this machine gave (Job), until their result is delivered or the user stops waiting;
// - `outbox`: results of jobs that ran here for a source elsewhere, until that machine confirms them (job_ack);
// - `running`: jobs running here for a source elsewhere, so a restart reports them as interrupted.

import { readJson, writeJson } from './store.ts';
import type { Job, JobOrigin, TurnResultData } from '../../shared/protocol.ts';

interface Outbox {
    id: string;
    to: string;
    botId: string;
    chatId: string;
    result: TurnResultData;
    stopped?: boolean;
}

/** A job as this machine keeps it: with what goes to the target, which the app does not need. */
export type StoredJob = Job & { content: string; full: string };

interface JobStore {
    open: StoredJob[];
    outbox: Outbox[];
    running: { origin: JobOrigin; botId: string; chatId: string }[];
}

const FILE = 'jobs.json';

function load(): JobStore {
    const s = readJson<Partial<JobStore>>(FILE, {});
    return { open: s.open ?? [], outbox: s.outbox ?? [], running: s.running ?? [] };
}

function change(fn: (s: JobStore) => void): void {
    const s = load();
    fn(s);
    writeJson(FILE, s);
}

export const openJobs = (): StoredJob[] => load().open;
export const findJob = (id: string): StoredJob | undefined => load().open.find((j) => j.id === id);

export function addJob(job: StoredJob): void {
    change((s) => { s.open = [...s.open.filter((j) => j.id !== job.id), job]; });
}

export function updateJob(id: string, patch: Partial<Job>): StoredJob | undefined {
    let found: StoredJob | undefined;
    change((s) => {
        s.open = s.open.map((j) => (j.id === id ? (found = { ...j, ...patch }) : j));
    });
    return found;
}

/** Takes a job off the open ones; the job as it was, or undefined if it was not open (delivered already, stopped). */
export function closeJob(id: string): StoredJob | undefined {
    let found: StoredJob | undefined;
    change((s) => {
        found = s.open.find((j) => j.id === id);
        s.open = s.open.filter((j) => j.id !== id);
    });
    return found;
}

/** Whether a chat of this machine waits for the result of a job it gave. */
export const waitsForJob = (chatId: string): boolean => load().open.some((j) => j.from.chatId === chatId);

export function startedHere(origin: JobOrigin, botId: string, chatId: string): void {
    change((s) => { s.running = [...s.running.filter((r) => r.origin.id !== origin.id), { origin, botId, chatId }]; });
}

export function endedHere(id: string): void {
    change((s) => { s.running = s.running.filter((r) => r.origin.id !== id); });
}

/** Jobs that were running here when the backend stopped: they have no result any more. Empties the list. */
export function takeInterrupted(): { origin: JobOrigin; botId: string; chatId: string }[] {
    let taken: JobStore['running'] = [];
    change((s) => {
        taken = s.running;
        s.running = [];
    });
    return taken;
}

export function keepResult(o: Outbox): void {
    change((s) => { s.outbox = [...s.outbox.filter((x) => x.id !== o.id), o]; });
}

export function resultsFor(machine: string): Outbox[] {
    return load().outbox.filter((o) => o.to === machine);
}

export function dropResult(id: string): void {
    change((s) => { s.outbox = s.outbox.filter((o) => o.id !== id); });
}
