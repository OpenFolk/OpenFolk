// The Mission Builder: a goal in plain words becomes a proposal for a mission (criteria, team, milestones, risks,
// autonomy, rules, budget), asked of the model once without tools like the bot editor's suggestions. The user edits
// the proposal before anything is created; new team members get a portrait of the web app's own set.

import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './config.ts';
import { language, t } from './i18n.ts';
import { DEFAULT_RULES, folderTaken } from './missions.ts';
import { askJson, folderContext } from './suggestions.ts';
import { MISSION_AUTONOMY, MISSION_PRIORITIES, MISSION_RISK_LEVELS, type BotVoice, type MissionAutonomy, type MissionProposal } from '../../shared/protocol.ts';

/** A team bigger than this is hard to lead in one cycle and expensive. */
export const MAX_TEAM = 8;

const SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, goal: { type: 'string' },
        successCriteria: { type: 'array', items: { type: 'string' } },
        abortCriteria: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, level: { type: 'string', enum: [...MISSION_RISK_LEVELS] }, mitigation: { type: 'string' } }, required: ['text', 'level', 'mitigation'], additionalProperties: false } },
        priority: { type: 'string', enum: [...MISSION_PRIORITIES] },
        autonomy: { type: 'integer', enum: [...MISSION_AUTONOMY] },
        approvalRules: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, label: { type: 'string' }, upTo: { type: 'integer', enum: [...MISSION_AUTONOMY] } }, required: ['kind', 'label', 'upTo'], additionalProperties: false } },
        budget: { type: 'object', properties: { costUsd: { type: 'number' }, turns: { type: 'integer' }, turnsPerDay: { type: 'integer' } }, required: ['costUsd', 'turns', 'turnsPerDay'], additionalProperties: false },
        cadence: { type: 'string' },
        guardrails: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'], additionalProperties: false } },
        milestones: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, weeks: { type: 'integer' } }, required: ['title', 'weeks'], additionalProperties: false } },
        team: {
            type: 'array',
            items: {
                type: 'object',
                properties: { name: { type: 'string' }, area: { type: 'string' }, role: { type: 'string' }, tone: { type: 'string' }, voice: { type: 'string', enum: ['female', 'male'] }, supervisor: { type: 'boolean' } },
                required: ['name', 'area', 'role', 'tone', 'voice', 'supervisor'], additionalProperties: false,
            },
        },
    },
    required: ['name', 'type', 'description', 'goal', 'successCriteria', 'abortCriteria', 'risks', 'priority', 'autonomy', 'approvalRules', 'budget', 'cadence', 'guardrails', 'milestones', 'team'],
    additionalProperties: false,
} as const;

const SHAPE = '{"name":"…","type":"…","description":"…","goal":"…","successCriteria":["…"],"abortCriteria":["…"],"risks":[{"text":"…","level":"low|medium|high","mitigation":"…"}],'
    + '"priority":"low|normal|high","autonomy":1,"approvalRules":[{"kind":"…","label":"…","upTo":1}],"budget":{"costUsd":0,"turns":0,"turnsPerDay":0},"cadence":"0 9 * * 1-5",'
    + '"guardrails":[{"key":"…","value":"…"}],"milestones":[{"title":"…","weeks":2}],"team":[{"name":"…","area":"…","role":"…","tone":"…","voice":"female","supervisor":true}]}';

export function proposalPrompt(goal: string, context: string, lang = language()): string {
    const languageName = lang === 'de' ? 'German' : 'English';
    return [
        'A user of a messenger for AI coding agents ("bots", each a Claude Code colleague with a name, a role and a project folder) wants a mission:',
        'a long-term goal a team of bots pursues on its own, led by a supervisor bot that plans, delegates tasks to the team, checks results and',
        'adapts the strategy in cycles. Turn the goal below into a proposal the user will edit. Write every text in ' + languageName + '.',
        '',
        'Rules for the proposal:',
        '- goal: the goal, sharpened and measurable; a target is a target, not a promise.',
        '- successCriteria: 2 to 5 measurable criteria. abortCriteria: 2 to 4 conditions that end the mission (losses, time, budget, legal or ethical limits).',
        '- risks: 3 to 6 with a level and a mitigation. Safety, money and legal risks first.',
        '- team: 3 to 7 bots, exactly one with supervisor true (it leads, plans, delegates and checks; it does no specialist work). One bot challenges',
        '  the others (looks for weaknesses, alternative hypotheses), one checks risks. Each with a common ' + languageName + ' first name, a field of work',
        '  (one capitalised word or short term), a role line (at most 60 characters) and a tone: working instructions in 3 to 6 sentences (what it does,',
        '  what it never does, how it reports, that it works only in the project folder and uses the mission tools). voice as the name suggests.',
        '- milestones: 3 to 6, each with the weeks from the start until it should be reached.',
        '- autonomy: 1 assisted (every execution approved), 2 supervised (low-risk work alone), 3 autonomous (within budget and limits), 4 continuous.',
        '  Start low: 1 or 2 for anything with money, customers or effects outside the project.',
        '- approvalRules: which kinds of action need approval up to which autonomy level (upTo); always include delegate, external, money, status and limit,',
        '  plus kinds specific to the goal. limit always upTo 4.',
        '- budget: costUsd for model usage on API keys (0 = none), turns in total and per day; modest numbers.',
        '- cadence: a cron (5 fields, local time) for regular cycles, at most a few per day; "" if events are enough.',
        '- guardrails: hard limits for the programs of the project as key and value (e.g. mode=paper, max_daily_loss_eur=50, live_trading=false).',
        '  Anything with real money or effects outside starts switched off or simulated.',
        '- name: short. type: one or two words for the kind of mission. priority: normal unless the goal says otherwise.',
        '',
        `The goal in the user's words:\n${goal.slice(0, 4000)}`,
        context ? `\nThe project folder so far:\n${context}` : '',
    ].join('\n');
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strings = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const level = (v: unknown): MissionAutonomy => ((MISSION_AUTONOMY as readonly unknown[]).includes(v) ? v as MissionAutonomy : 1);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Values written as text become numbers and switches again. */
function guardrailValue(v: string): string | number | boolean {
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
}

/** The model's answer as a proposal; throws for an unusable one. */
export function proposalFrom(data: unknown, now = new Date()): MissionProposal {
    const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const goal = str(o.goal, 4000);
    const team = (Array.isArray(o.team) ? o.team : []).slice(0, MAX_TEAM).map((x: Record<string, unknown>) => ({
        name: str(x?.name, 40), area: str(x?.area, 40) || undefined, role: str(x?.role, 120), tone: str(x?.tone, 4000) || undefined,
        voice: (x?.voice === 'male' ? 'male' : 'female') as BotVoice, supervisor: x?.supervisor === true,
    })).filter((x) => x.name);
    if (!goal || !team.length) throw new Error(t('missions.proposalUnusable'));
    // exactly one supervisor: the first marked one, else the first member
    const lead = Math.max(0, team.findIndex((x) => x.supervisor));
    team.forEach((x, i) => { x.supervisor = i === lead; });
    const start = now.getTime();
    const rules = (Array.isArray(o.approvalRules) ? o.approvalRules : []).map((r: Record<string, unknown>) => ({
        kind: str(r?.kind, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ''), label: str(r?.label, 200), upTo: level(r?.upTo),
    })).filter((r) => r.kind).slice(0, 20);
    // the rules the backend enforces are always there; 'limit' always asks
    for (const d of DEFAULT_RULES) if (!rules.some((r) => r.kind === d.kind)) rules.push({ ...d });
    for (const r of rules) if (r.kind === 'limit') r.upTo = 4;
    const budget = (o.budget ?? {}) as Record<string, unknown>;
    const cadence = str(o.cadence, 100);
    return {
        name: str(o.name, 80) || goal.slice(0, 60), type: str(o.type, 40), description: str(o.description, 4000), goal,
        successCriteria: strings(o.successCriteria, 500, 10), abortCriteria: strings(o.abortCriteria, 500, 10),
        risks: (Array.isArray(o.risks) ? o.risks : []).map((r: Record<string, unknown>) => ({
            text: str(r?.text, 500), level: MISSION_RISK_LEVELS.includes(r?.level as never) ? r.level as 'low' | 'medium' | 'high' : 'medium', mitigation: str(r?.mitigation, 500) || undefined,
        })).filter((r) => r.text).slice(0, 10),
        priority: MISSION_PRIORITIES.includes(o.priority as never) ? o.priority as MissionProposal['priority'] : 'normal',
        autonomy: level(o.autonomy), approvalRules: rules,
        budget: { costUsd: count(budget.costUsd), turns: count(budget.turns), turnsPerDay: count(budget.turnsPerDay) },
        cadence: /^\S+( \S+){4}$/.test(cadence) ? cadence : '',
        guardrails: Object.fromEntries((Array.isArray(o.guardrails) ? o.guardrails : []).slice(0, 30)
            .map((g: Record<string, unknown>) => [str(g?.key, 60), guardrailValue(str(g?.value, 200))]).filter(([k]) => k)),
        milestones: (Array.isArray(o.milestones) ? o.milestones : []).slice(0, 10).map((x: Record<string, unknown>) => ({
            title: str(x?.title, 200), dueAt: count(x?.weeks) ? new Date(start + Number(x.weeks) * 7 * 86_400_000).toISOString().slice(0, 10) : undefined,
        })).filter((x) => x.title),
        team,
    };
}

/** Asks the model for a proposal; `folder`: an existing project folder whose README gives context. */
export async function propose(goal: string, folder = '', model?: string): Promise<MissionProposal> {
    if (!goal.trim()) throw new Error(t('missions.goalMissing'));
    const context = folder ? folderContext(folder) : '';
    const taken = folder ? folderTaken(folder) : undefined;
    if (taken) throw new Error(t('missions.folderTaken', { name: taken.name }));
    const data = await askJson({
        prompt: proposalPrompt(goal, context), schema: SCHEMA, shape: SHAPE, folder: context ? folder : '', model,
        system: 'You help plan missions for a team of AI agents.', timeoutMs: 180_000,
    });
    return { ...proposalFrom(data), ...(folder ? { folder } : {}) };
}

interface PortraitFile { file: string; voice: BotVoice }

/** Portraits of the web app's set as data URLs, by voice, leaving out those already in use. */
export function portraitFor(voice: BotVoice, used: Set<string>): string {
    const dir = path.join(projectRoot, 'webapp', 'avatars');
    let list: PortraitFile[] = [];
    try {
        list = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as PortraitFile[];
    } catch {
        return '';
    }
    const fitting = list.filter((p) => p.voice === voice && /^[a-z0-9]+\.png$/.test(p.file));
    for (const p of [...fitting, ...list.filter((x) => x.voice !== voice)]) {
        let url: string;
        try {
            url = `data:image/png;base64,${fs.readFileSync(path.join(dir, p.file)).toString('base64')}`;
        } catch {
            continue;
        }
        if (used.has(url)) continue;
        used.add(url);
        return url;
    }
    return '';
}
