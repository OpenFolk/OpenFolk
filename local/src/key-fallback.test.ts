// Tests for Claude on subscription and key (claudeAuth 'both'): when the sessions move to the key, the daily cap and
// the way back:  node local/src/key-fallback.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-fallback-'));
process.env.DATA_DIR = dir;
process.env.E2E_KEY = 'off';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const machine = await import('./machine-settings.ts');
const fallback = await import('./key-fallback.ts');
const { accountAuth, claudeEnv } = await import('./engine-home.ts');
const { checkClientFrame } = await import('./frames.ts');

let changes = 0;
fallback.onKeyFallbackChange(() => changes++);
const inSeconds = (s: number) => Date.now() / 1000 + s;

machine.saveAnthropicKey('sk-ant-test');
fallback.subscriptionLimit('rejected', inSeconds(600));
check('subscription only: a limit changes nothing', !fallback.claudeOnKey() && accountAuth() === 'subscription' && changes === 0);

machine.saveMachineSettings({ claudeAuth: 'both' });
check('both: on the subscription until it reports its limit', accountAuth() === 'subscription' && !('ANTHROPIC_API_KEY' in claudeEnv()));
fallback.subscriptionLimit('allowed_warning', inSeconds(600));
check('the warning alone does not switch with the rule "limit"', !fallback.claudeOnKey() && changes === 0);
fallback.subscriptionLimit('rejected', inSeconds(600));
check('limit reached: on the key, sessions told once', fallback.claudeOnKey() && accountAuth() === 'apikey' && claudeEnv().ANTHROPIC_API_KEY === 'sk-ant-test' && changes === 1, changes);
const state = fallback.keyFallbackState();
check('browsers see until when', state.active && Math.abs((state.until ?? 0) - inSeconds(600)) < 2 && state.spentUsd === 0, state);
fallback.subscriptionLimit('rejected', inSeconds(600));
check('the same limit again: no second change', changes === 1);

fallback.resetKeyFallback();
machine.saveMachineSettings({ claudeFallback: 'warning' });
fallback.subscriptionLimit('allowed_warning', inSeconds(600));
check('rule "warning": already the warning switches', fallback.claudeOnKey() && changes === 2, changes);

machine.saveMachineSettings({ claudeKeyBudgetUsd: 2 });
fallback.keyTurnCost(1.25);
check('cost below the cap counts, stays on the key', fallback.claudeOnKey() && fallback.spentToday() === 1.25 && changes === 2);
fallback.keyTurnCost(1);
check('daily cap reached: back to the subscription, sessions told', !fallback.claudeOnKey() && accountAuth() === 'subscription'
    && fallback.keyFallbackState().budgetReached && changes === 3, fallback.keyFallbackState());
check('spending kept in the data folder', JSON.parse(fs.readFileSync(path.join(dir, 'claude-key-spent.json'), 'utf8')).usd === 2.25);
machine.saveMachineSettings({ claudeKeyBudgetUsd: 0 });
check('without a cap the key counts again', fallback.claudeOnKey());

fallback.resetKeyFallback();
fallback.subscriptionLimit('rejected', inSeconds(0.2));
check('a short window: on the key', fallback.claudeOnKey());
const before = changes;
await new Promise((r) => setTimeout(r, 1500));
check('after the reset: back on the subscription, sessions told', !fallback.claudeOnKey() && accountAuth() === 'subscription' && changes === before + 1, changes - before);

machine.saveAnthropicKey('');
fallback.subscriptionLimit('rejected', inSeconds(600));
check('without a stored key nothing moves', !fallback.claudeOnKey() && accountAuth() === 'subscription');

check('frame: both and its rules accepted for Claude', checkClientFrame({ type: 'machine_settings_save', settings: { claudeAuth: 'both', claudeFallback: 'warning', claudeKeyBudgetUsd: 20 } }).ok);
check('frame: both refused for other engines, unknown rule refused', !checkClientFrame({ type: 'machine_settings_save', settings: { engineAuth: { codex: 'both' } } }).ok
    && !checkClientFrame({ type: 'machine_settings_save', settings: { claudeFallback: 'never' } }).ok
    && !checkClientFrame({ type: 'machine_settings_save', settings: { claudeKeyBudgetUsd: 1.5 } }).ok);

fallback.resetKeyFallback();
fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
