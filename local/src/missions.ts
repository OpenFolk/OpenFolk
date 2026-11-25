// Missions: long-term goals a team of bots pursues on its own (Mission Control). This module keeps them: the list in
// the account's missions.json (synced like routines, newest wins), each mission's log in missions/<id>/events.jsonl
// (only on the mission's machine, like sessions), and the two files that connect a mission to its project:
// <folder>/.openfolk/mission.json, which the backend writes and the project reads (the guardrails, the kill switch),
// and <folder>/.openfolk/metrics.json, which the project writes and Mission Control shows. OpenFolk knows no field of
// work; everything a mission does in its field lies in its folder and its bots. The cycle is in mission-control.ts.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCron } from './cron.ts';
import { t } from './i18n.ts';
import { accountPath, PRIVATE, readJson, setTombstone, writeJson } from './store.ts';
import {
    MISSION_AUTONOMY, MISSION_PRIORITIES, MISSION_RISK_LEVELS,
    type Mission, type MissionApprovalRule, type MissionAutonomy, type MissionEvent, type MissionInput, type MissionMetrics, type MissionStatus,
} from '../../shared/protocol.ts';

const FILE = 'missions.json';
/** Statuses a mission does not leave by itself; only deleting removes it. */
export const TERMINAL: ReadonlySet<MissionStatus> = new Set(['completed', 'failed', 'cancelled']);
/** Statuses in which cycles run. */
export const ACTIVE: ReadonlySet<MissionStatus> = new Set(['planning', 'running', 'waiting_approval']);
/** Size limits: everything here travels in the sync and into prompts. */
export const LIMITS = { text: 4000, short: 200, list: 30, tasks: 200, results: 50, guardrails: 60, events: 500, metricsBytes: 1_000_000 } as const;
/** The rules a mission starts with when the user names none: the backend enforces 'delegate' and 'status'. */
export const DEFAULT_RULES: MissionApprovalRule[] = [
    { kind: 'delegate', label: 'Delegating a task', upTo: 1 },
    { kind: 'external', label: 'Anything with an effect outside the project (mail, posts, purchases, orders)', upTo: 2 },
    { kind: 'money', label: 'Spending or moving money', upTo: 3 },
    { kind: 'status', label: 'Completing, failing or cancelling the mission', upTo: 3 },
    { kind: 'limit', label: 'Changing a guardrail or a budget', upTo: 4 },
];

export function loadMissions(): Mission[] {
    return readJson<Mission[]>(FILE, []).map(withDefaults);
}

export function saveMissions(list: Mission[]): void {
    writeJson(FILE, list);
}

export function findMission(id: string): Mission | undefined {
    return loadMissions().find((m) => m.id === id);
}

/** Missions from older files or another machine's newer code: every field the code reads is there. */
function withDefaults(m: Mission): Mission {
    return {
        ...m,
        successCriteria: m.successCriteria ?? [], abortCriteria: m.abortCriteria ?? [], risks: m.risks ?? [], approvalRules: m.approvalRules ?? [],
        budget: m.budget ?? {}, spent: { costUsd: m.spent?.costUsd ?? 0, turns: m.spent?.turns ?? 0, day: m.spent?.day ?? '', turnsToday: m.spent?.turnsToday ?? 0 },
        guardrails: m.guardrails ?? {}, team: m.team ?? [], milestones: m.milestones ?? [], tasks: m.tasks ?? [], approvals: m.approvals ?? [], results: m.results ?? [],
        loop: { ...m.loop, ticks: m.loop?.ticks ?? 0, errors: m.loop?.errors ?? 0, pending: m.loop?.pending ?? [] }, cadence: m.cadence ?? '', progress: m.progress ?? 0,
        killSwitch: !!m.killSwitch,
    };
}

/** Changes one mission and stores it with a new updatedAt; the mission as stored, undefined if there is none. */
export function changeMission(id: string, change: (m: Mission) => void): Mission | undefined {
    const list = loadMissions();
    const m = list.find((x) => x.id === id);
    if (!m) return undefined;
    change(m);
    m.updatedAt = new Date().toISOString();
    saveMissions(list);
    return m;
}

export function addMission(m: Mission): void {
    saveMissions([...loadMissions().filter((x) => x.id !== m.id), m]);
}

export function deleteMission(id: string): Mission | undefined {
    const list = loadMissions();
    const m = list.find((x) => x.id === id);
    if (!m) return undefined;
    saveMissions(list.filter((x) => x.id !== id));
    setTombstone(`mission:${id}`);
    fs.rmSync(accountPath('missions', id), { recursive: true, force: true });
    return m;
}

export const newId = (): string => randomUUID().slice(0, 8);

/** Today on the mission's machine, for the daily budget. */
export const today = (now = new Date()): string => now.toLocaleDateString('sv');

// ------------------------------------------------------------------ Log

function eventsFile(id: string): string {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`invalid mission id ${id}`);
    return accountPath('missions', id, 'events.jsonl');
}

export function appendEvent(id: string, e: Omit<MissionEvent, 'id' | 'ts'> & { ts?: string }): MissionEvent {
    const event: MissionEvent = { id: newId(), ts: e.ts ?? new Date().toISOString(), ...e, text: e.text.slice(0, LIMITS.text) };
    const file = eventsFile(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + '\n', { mode: PRIVATE });
    return event;
}

/** The newest events, oldest first. */
export function readEvents(id: string, limit: number = LIMITS.events): MissionEvent[] {
    let text = '';
    try {
        text = fs.readFileSync(eventsFile(id), 'utf8');
    } catch {
        return [];
    }
    const out: MissionEvent[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as MissionEvent); } catch { /* a line cut by a crash */ }
    }
    return out.slice(-limit);
}

export function eventsSince(id: string, ts: string | undefined): MissionEvent[] {
    return readEvents(id).filter((e) => !ts || e.ts > ts);
}

// ------------------------------------------------------------------ Rules, budget, progress

/** Whether an action of this kind needs the user's approval at the mission's autonomy now. */
export function needsApproval(m: Pick<Mission, 'approvalRules' | 'autonomy'>, kind: string): boolean {
    return m.approvalRules.some((r) => r.kind === kind && m.autonomy <= r.upTo);
}

/** Which limit of the budget is used up; null while there is room. The daily one only holds cycles until tomorrow. */
export function budgetExceeded(m: Pick<Mission, 'budget' | 'spent'>, now = new Date()): 'costUsd' | 'turns' | 'turnsPerDay' | null {
    const b = m.budget;
    if (b.costUsd !== undefined && m.spent.costUsd >= b.costUsd) return 'costUsd';
    if (b.turns !== undefined && m.spent.turns >= b.turns) return 'turns';
    if (b.turnsPerDay !== undefined && m.spent.day === today(now) && m.spent.turnsToday >= b.turnsPerDay) return 'turnsPerDay';
    return null;
}

/** Counts a turn (a cycle or a delegated task) against the budget. */
export function countTurn(m: Mission, costUsd: number, now = new Date()): void {
    const day = today(now);
    if (m.spent.day !== day) {
        m.spent.day = day;
        m.spent.turnsToday = 0;
    }
    m.spent.turns++;
    m.spent.turnsToday++;
    if (Number.isFinite(costUsd) && costUsd > 0) m.spent.costUsd = Math.round((m.spent.costUsd + costUsd) * 10_000) / 10_000;
}

/** Progress from the milestones, unless the supervisor set a higher value itself. */
export function milestoneProgress(m: Pick<Mission, 'milestones'>): number {
    if (!m.milestones.length) return 0;
    return Math.round((m.milestones.filter((x) => x.status === 'done').length / m.milestones.length) * 100);
}

// ------------------------------------------------------------------ Input of the user

const clip = (s: unknown, max: number = LIMITS.short): string => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const list = (l: unknown, max: number = LIMITS.list): string[] => (Array.isArray(l) ? l.map((x) => clip(x, 500)).filter(Boolean).slice(0, max) : []);
const amount = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** A cron for scheduled cycles, '' for none; throws for an invalid one or one that runs more than every 15 minutes. */
export function checkCadence(cron: string): string {
    const c = cron.trim().replace(/\s+/g, ' ');
    if (!c) return '';
    parseCron(c);
    const minute = c.split(' ')[0];
    if (minute === '*' || /^\*\/([1-9]|1[0-4])$/.test(minute) || minute.split(',').length > 4) throw new Error(t('missions.cadenceTooOften'));
    return c;
}

/** The fields of MissionInput the user sets, cleaned; throws with a message for the user. */
export function cleanInput(input: MissionInput): Omit<MissionInput, 'team' | 'milestones' | 'folder' | 'id'> {
    const name = clip(input.name, 80);
    if (!name) throw new Error(t('missions.nameMissing'));
    const goal = clip(input.goal, LIMITS.text);
    if (!goal) throw new Error(t('missions.goalMissing'));
    const autonomy = (MISSION_AUTONOMY as readonly number[]).includes(input.autonomy) ? input.autonomy : 1;
    const guardrails: Mission['guardrails'] = {};
    for (const [k, v] of Object.entries(input.guardrails ?? {}).slice(0, LIMITS.guardrails)) {
        const key = clip(k, 60);
        if (key && (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean' || typeof v === 'string')) guardrails[key] = typeof v === 'string' ? v.slice(0, 500) : v;
    }
    const money = input.budget?.money && amount(input.budget.money.amount) !== undefined
        ? { amount: input.budget.money.amount, currency: clip(input.budget.money.currency, 8).toUpperCase() || 'EUR' } : undefined;
    const date = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined);
    return {
        name, goal, autonomy: autonomy as MissionAutonomy,
        description: clip(input.description, LIMITS.text), type: clip(input.type, 40),
        successCriteria: list(input.successCriteria), abortCriteria: list(input.abortCriteria),
        risks: (Array.isArray(input.risks) ? input.risks : []).slice(0, LIMITS.list).map((r) => ({
            text: clip(r?.text, 500), level: MISSION_RISK_LEVELS.includes(r?.level) ? r.level : 'medium', mitigation: clip(r?.mitigation, 500) || undefined,
        })).filter((r) => r.text),
        priority: MISSION_PRIORITIES.includes(input.priority) ? input.priority : 'normal',
        startAt: date(input.startAt), dueAt: date(input.dueAt),
        approvalRules: (Array.isArray(input.approvalRules) ? input.approvalRules : DEFAULT_RULES).slice(0, LIMITS.list).map((r) => ({
            kind: clip(r?.kind, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ''), label: clip(r?.label, 200),
            upTo: ((MISSION_AUTONOMY as readonly number[]).includes(r?.upTo) ? r.upTo : 1) as MissionAutonomy,
        })).filter((r) => r.kind),
        budget: { costUsd: amount(input.budget?.costUsd), turns: amount(input.budget?.turns), turnsPerDay: amount(input.budget?.turnsPerDay), money },
        cadence: checkCadence(clip(input.cadence, 100)),
        guardrails,
    };
}

// ------------------------------------------------------------------ The project's two files

export const GUARDRAIL_FILE = '.openfolk/mission.json';
export const METRICS_FILE = '.openfolk/metrics.json';

/** What the project reads: everything that limits it, nothing of the log. */
export function guardrailContent(m: Mission): Record<string, unknown> {
    return {
        mission: m.id, name: m.name, status: m.status, killSwitch: m.killSwitch, autonomy: m.autonomy,
        guardrails: m.guardrails, approvalRules: m.approvalRules.map((r) => ({ kind: r.kind, needsApproval: m.autonomy <= r.upTo })),
        money: m.budget.money ?? null, note: 'Written by OpenFolk. Changes here are undone; the user changes these values in Mission Control.',
    };
}

/** Writes the guardrails into the project; false when the folder is not there (another machine, removed). */
export function writeGuardrails(m: Mission): boolean {
    if (!m.folder || !fs.existsSync(m.folder)) return false;
    const file = path.join(m.folder, GUARDRAIL_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(guardrailContent(m), null, 2) + '\n');
    fs.renameSync(tmp, file);
    return true;
}

/** Whether the file in the project still says what the backend wrote; a bot or program that changed it is caught here. */
export function guardrailsIntact(m: Mission): boolean {
    try {
        const now = JSON.parse(fs.readFileSync(path.join(m.folder, GUARDRAIL_FILE), 'utf8')) as unknown;
        return JSON.stringify(now) === JSON.stringify(guardrailContent(m));
    } catch {
        return false;
    }
}

/** The project's metrics; null without the file. Anything unexpected in it is dropped rather than shown. */
export function readMetrics(folder: string): { metrics: MissionMetrics | null; error?: string } {
    const file = path.join(folder, METRICS_FILE);
    let text: string;
    try {
        if (fs.statSync(file).size > LIMITS.metricsBytes) return { metrics: null, error: t('missions.metricsTooLarge') };
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return { metrics: null };
    }
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(text) as Record<string, unknown>;
        if (!raw || typeof raw !== 'object') throw new Error('no object');
    } catch (e) {
        return { metrics: null, error: t('missions.metricsInvalid', { error: (e as Error).message }) };
    }
    const obj = (v: unknown): Record<string, Record<string, unknown>> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, Record<string, unknown>> : {});
    const label = (v: unknown, key: string) => clip(v, 80) || key;
    const metrics: MissionMetrics = { updatedAt: clip(raw.updatedAt, 40) || undefined, kpis: {}, series: {}, tables: {} };
    for (const [k, v] of Object.entries(obj(raw.kpis)).slice(0, 40)) {
        const value = typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : clip(v?.value, 60);
        if (value === '') continue;
        metrics.kpis![k] = {
            label: label(v.label, k), value, unit: clip(v.unit, 12) || undefined,
            target: typeof v.target === 'number' && Number.isFinite(v.target) ? v.target : undefined, good: v.good === 'down' ? 'down' : v.good === 'up' ? 'up' : undefined,
        };
    }
    for (const [k, v] of Object.entries(obj(raw.series)).slice(0, 12)) {
        const points = (Array.isArray(v?.points) ? v.points : [])
            .filter((p): p is [string, number] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number' && Number.isFinite(p[1]))
            .slice(-2000).map((p) => [p[0].slice(0, 40), p[1]] as [string, number]);
        if (points.length) metrics.series![k] = { label: label(v.label, k), unit: clip(v.unit, 12) || undefined, points };
    }
    for (const [k, v] of Object.entries(obj(raw.tables)).slice(0, 12)) {
        const columns = list(v?.columns, 12);
        const rows = (Array.isArray(v?.rows) ? v.rows : []).filter(Array.isArray).slice(0, 200)
            .map((r: unknown[]) => r.slice(0, columns.length).map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : clip(c, 200))));
        if (columns.length) metrics.tables![k] = { label: label(v.label, k), columns, rows };
    }
    return { metrics };
}

/** Another mission that is not over already works in this folder: one folder, one mission, one guardrail file. */
export function folderTaken(folder: string, except = ''): Mission | undefined {
    const norm = (f: string) => path.resolve(f).toLowerCase();
    return loadMissions().find((m) => m.id !== except && !TERMINAL.has(m.status) && m.folder && norm(m.folder) === norm(folder));
}
