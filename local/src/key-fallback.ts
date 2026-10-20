// Claude on "subscription and key" (claudeAuth 'both' in the machine settings): the sessions run on the subscription
// until it reports its limit (or, as set, Anthropic's warning before it), then on the API key until the limit window
// resets, and only up to the daily budget. Main account only: the key is the machine owner's (engine-home.ts).
//
// While the sessions run on the key, the subscription reports nothing; so the way back is a timer at the reset time
// the subscription named, an hour without one. What the key cost today is kept in the data folder, so a restart does
// not reset the budget.

import { anthropicKey, machineSettings } from './machine-settings.ts';
import { readMachineJson, writeMachineJson } from './store.ts';
import type { KeyFallbackState, Usage } from '../../shared/protocol.ts';

const SPENT_FILE = 'claude-key-spent.json';
/** Back to the subscription after this long when its limit named no reset time (seconds). */
const NO_RESET_S = 3600;

/** Unix seconds until which the sessions run on the key; 0 = on the subscription. */
let until = 0;
let timer: NodeJS.Timeout | null = null;
const listeners = new Set<() => void>();

const now = () => Date.now() / 1000;
/** The local day, so the budget starts anew at midnight where the machine is. */
const today = () => new Date().toLocaleDateString('sv-SE');

/** Called when the sessions change sides (to the key, back, budget reached): reload them, tell the browsers. */
export function onKeyFallbackChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function changed(): void {
    for (const fn of listeners) fn();
}

export function spentToday(): number {
    const s = readMachineJson<{ day?: string; usd?: number }>(SPENT_FILE, {});
    return s.day === today() && typeof s.usd === 'number' ? s.usd : 0;
}

function budgetReached(): boolean {
    const budget = machineSettings().claudeKeyBudgetUsd;
    return budget > 0 && spentToday() >= budget;
}

/** Whether Claude runs on the key right now instead of the subscription ('both' only). */
export function claudeOnKey(): boolean {
    if (machineSettings().claudeAuth !== 'both' || !until) return false;
    if (now() >= until) {
        until = 0;
        return false;
    }
    return !budgetReached() && Boolean(anthropicKey());
}

/**
 * The subscription's rate limit from a session (main account only): with 'both' a full window, or the warning if the
 * rules say so, moves the sessions to the key until `resetsAt`.
 */
export function subscriptionLimit(status: Usage['status'], resetsAt?: number): void {
    const s = machineSettings();
    if (s.claudeAuth !== 'both') return;
    if (status !== 'rejected' && !(status === 'allowed_warning' && s.claudeFallback === 'warning')) return;
    const before = claudeOnKey();
    const end = resetsAt && resetsAt > now() ? resetsAt : now() + NO_RESET_S;
    if (before && end <= until) return;
    until = end;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        if (until && now() >= until) {
            until = 0;
            changed();
        }
    }, Math.max(0, (until - now()) * 1000) + 1000);
    timer.unref();
    if (!before && claudeOnKey()) changed();
}

/** Cost of a turn that ran on the key while 'both' is set; reaching the budget sends the sessions back. */
export function keyTurnCost(usd: number): void {
    if (!(usd > 0) || machineSettings().claudeAuth !== 'both') return;
    const was = budgetReached();
    writeMachineJson(SPENT_FILE, { day: today(), usd: spentToday() + usd });
    if (!was && budgetReached() && until) changed();
}

export function keyFallbackState(): KeyFallbackState {
    const active = claudeOnKey();
    return { active, ...(active ? { until: Math.round(until) } : {}), spentUsd: Math.round(spentToday() * 100) / 100, budgetReached: budgetReached() };
}

/** Back to the start: a changed mode in the settings, tests. */
export function resetKeyFallback(): void {
    until = 0;
    if (timer) clearTimeout(timer);
    timer = null;
}
