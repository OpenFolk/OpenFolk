// AI providers in the settings of a machine: a switch per engine, per engine subscription or key, the key field only
// for the key; switching to a key without one stored sends key and choice together. A backend before the choice
// shows Claude alone. Claude can also run on both by rules (switch at the limit, a daily cap for the key). The image
// model's provider decides which key the bots' settings show.

const SETTINGS = {
    claudeAuth: 'subscription', claudeFallback: 'limit', claudeKeyBudgetUsd: 0, engineAuth: {}, disabledEngines: [], shutdown: true, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300,
    afterWakeWaitMinutes: 60, idleMinutes: 15, handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true,
    gitPushUser: '', gitPushHost: '',
};
const OFFERS = { shutdown: true, ide: true, terminal: true, voice: true };
const NO_KEYS = { codex: false, cursor: false, copilot: false, antigravity: false };

export default async function ({ start, check }) {
    const h = await start({ online: ['desk'] });
    const p = h.page;
    const machineSettings = (settings, more = {}) => h.push({
        type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: false, engineKeys: NO_KEYS, shutdownMethod: 'script', offers: OFFERS,
        settings: { ...SETTINGS, ...settings }, ...more,
    });
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'ready', codex: 'sign_in', cursor: 'missing', copilot: 'ready', antigravity: 'ready', opencode: 'ready' } });
    await p.click('#btn-settings');
    await machineSettings({});
    await h.wait(100);
    await p.click('#settings-machines details summary');
    const form = () => p.evaluate(() => {
        const d = document.querySelector('#settings-machines details');
        const part = (e) => d.querySelector(`.settings-engine[data-engine="${e}"]`);
        return {
            switches: Object.fromEntries([...d.querySelectorAll('.settings-engine-switch input')].map((b) => [b.dataset.engine, { on: b.checked, locked: b.disabled }])),
            parts: [...d.querySelectorAll('.settings-engine')].map((x) => x.dataset.engine),
            codex: part('codex') && { auth: part('codex').querySelector('select').value, key: Boolean(part('codex').querySelector('.settings-key')), text: part('codex').textContent },
            claudeKey: Boolean(part('claude')?.querySelector('.settings-key')),
            opencodeSelect: Boolean(part('opencode')?.querySelector('select')),
        };
    });
    let f = await form();
    check('a switch per engine, all on', Object.keys(f.switches).join() === 'claude,codex,cursor,copilot,antigravity,opencode' && Object.values(f.switches).every((s) => s.on && !s.locked), f.switches);
    check('subscription: no key field, how to sign in where needed', f.codex.auth === 'subscription' && !f.codex.key && !f.claudeKey
        && f.codex.text.includes('not signed in') && f.codex.text.includes('codex login'), f.codex);
    check('OpenCode: no choice of a key', f.parts.includes('opencode') && !f.opencodeSelect);

    await p.selectOption('.settings-engine[data-engine="codex"] select', 'apikey');
    await h.wait(100);
    f = await form();
    check('key picked without a stored one: the field shows, nothing sent yet', f.codex.auth === 'apikey' && f.codex.key && !h.sent.some((x) => x.type === 'machine_settings_save'), f.codex);
    await p.fill('.settings-engine[data-engine="codex"] .settings-key input', 'sk-openai');
    await p.click('.settings-engine[data-engine="codex"] .settings-key button');
    await h.wait(100);
    let save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('key and choice in one frame to that machine', save && save.machine === 'desk' && save.settings.engineAuth?.codex === 'apikey' && save.engineKeys?.codex === 'sk-openai', save);

    await machineSettings({ engineAuth: { codex: 'apikey' } }, { engineKeys: { ...NO_KEYS, codex: true } });
    await h.wait(100);
    p.on('dialog', (d) => d.accept());
    await p.click('.settings-engine[data-engine="codex"] .settings-key .danger');
    await h.wait(100);
    save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('removing the key goes back to the subscription', save.settings.engineAuth?.codex === 'subscription' && save.engineKeys?.codex === '', save);

    await p.click('.settings-engine-switch input[data-engine="cursor"]');
    await h.wait(100);
    save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('switching an engine off', JSON.stringify(save.settings.disabledEngines) === '["cursor"]', save);
    await machineSettings({ disabledEngines: ['codex', 'cursor', 'copilot', 'antigravity', 'opencode'] });
    await h.wait(100);
    f = await form();
    check('switched off: no sign-in shown; the last engine may go too', f.parts.join() === 'claude' && !f.switches.claude.locked && !f.switches.codex.on, f);
    await p.click('.settings-engine-switch input[data-engine="claude"]');
    await h.wait(100);
    save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('switching the last engine off', save.settings.disabledEngines?.length === 6, save);
    await machineSettings({ disabledEngines: ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'] });
    await h.wait(100);
    f = await form();
    check('none on: every switch off, no sign-in, the hint says so', !f.parts.length && Object.values(f.switches).every((s) => !s.on)
        && (await p.textContent('#settings-machines details .hint')).includes('cannot run bots'), f);

    // Claude on subscription and key by rules
    await machineSettings({});
    await h.wait(100);
    const options = (e) => p.evaluate((e) => [...document.querySelectorAll(`.settings-engine[data-engine="${e}"] select option`)].map((o) => o.value).join(), e);
    check('subscription and key by rules: offered for Claude only', (await options('claude')) === 'subscription,apikey,both' && (await options('codex')) === 'subscription,apikey');
    const sentBefore = h.sent.length;
    await p.selectOption('.settings-engine[data-engine="claude"] select', 'both');
    await h.wait(100);
    check('both without a stored key: the key field first, nothing sent', await p.isVisible('.settings-engine[data-engine="claude"] .settings-key')
        && !h.sent.slice(sentBefore).some((x) => x.type === 'machine_settings_save'));
    await p.fill('.settings-engine[data-engine="claude"] .settings-key input', 'sk-ant');
    await p.click('.settings-engine[data-engine="claude"] .settings-key button');
    await h.wait(100);
    save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('key and "both" in one frame', save.settings.claudeAuth === 'both' && save.anthropicKey === 'sk-ant', save);
    await machineSettings({ claudeAuth: 'both' }, { anthropicKey: true, keyFallback: { active: true, until: Math.round(Date.now() / 1000) + 3600, spentUsd: 1.5, budgetReached: false } });
    await h.wait(100);
    const rules = await p.evaluate(() => {
        const box = document.querySelector('.settings-engine[data-engine="claude"] .settings-fallback');
        return box && { when: box.querySelector('select').value, budget: box.querySelector('input').value, now: box.querySelector('.settings-fallback-now').textContent };
    });
    check('the rules and where Claude runs now', rules && rules.when === 'limit' && rules.budget === '0' && rules.now.includes('API key') && rules.now.includes('1.50'), rules);
    await p.selectOption('.settings-fallback select', 'warning');
    await h.wait(100);
    save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('rule: switch already at the warning', save.settings.claudeFallback === 'warning', save);
    await p.fill('.settings-fallback input', '5');
    await p.press('.settings-fallback input', 'Tab');
    await h.wait(100);
    save = h.sent.findLast((x) => x.type === 'machine_settings_save');
    check('rule: a daily cap for the key', save.settings.claudeKeyBudgetUsd === 5, save);

    // a backend before the choice: Claude alone, as before
    await h.push({ type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: false, shutdownMethod: 'script', offers: OFFERS,
        settings: { ...SETTINGS, engineAuth: undefined, disabledEngines: undefined, claudeFallback: undefined, claudeKeyBudgetUsd: undefined } });
    await h.wait(100);
    f = await form();
    check('older backend: Claude alone, no switches', f.parts.join() === 'claude' && !Object.keys(f.switches).length, f);
    check('older backend: no subscription and key by rules', (await options('claude')) === 'subscription,apikey');

    // the bots' image model decides which key shows
    const visibleKeys = () => p.evaluate(() => [...document.querySelectorAll('#settings-bots .settings-key')].filter((b) => !b.hidden).map((b) => b.dataset.key).join());
    check('image model from Google: only the Gemini key', (await visibleKeys()) === 'gemini', await visibleKeys());
    await p.selectOption('#settings-avatar-model', 'gpt-image-1');
    await h.wait(100);
    check('image model from OpenAI: only the OpenAI key, at once', (await visibleKeys()) === 'openai', await visibleKeys());
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
