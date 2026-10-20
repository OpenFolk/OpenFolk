// Codex as a second engine: chip "Codex" in the model switch (as soon as the machine reports Codex models), the header
// shows the Codex model, account of both plans in the footer, limits of Claude and Codex separate, Codex in the bot editor.
import { bot } from './harness.mjs';

const MODELS = [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
    { value: 'codex', resolvedModel: 'codex:gpt-6.1-sol', displayName: 'Codex' },
    { value: 'codex:gpt-6.1-sol', resolvedModel: 'codex:gpt-6.1-sol', displayName: 'GPT-6.1 Sol (Codex)' },
    { value: 'codex:gpt-6-luna', resolvedModel: 'codex:gpt-6-luna', displayName: 'GPT-6 Luna (Codex)' },
];

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('skool', 'Skool Sven'), bot('cloud', 'Cloud Carlo', { model: 'codex:gpt-6-luna' })] });
    const p = h.page;
    await h.push({ type: 'models', machine: 'desk', models: MODELS });
    const chips = () => p.locator('#info-switches .model-switch .chip').allTextContents();
    const active = () => p.locator('#info-switches .model-switch .chip.on').allTextContents();
    // the switch is on the bot's page: the header opens it, the arrow leaves it
    const page = async () => { await p.click('[data-el=chat-title]'); await h.wait(150); };
    const leave = async () => { await p.click('#info [data-page-back]'); await h.wait(150); };
    const badge = () => p.textContent('[data-el=chat-model]');

    await h.openChat('Skool Sven');
    await page();
    check('Codex chip next to the Claude models', (await chips()).join('|') === 'Opus 5.5|Sonnet 5.5|Codex', await chips());
    await p.locator('#info-switches .model-switch .chip', { hasText: 'Codex' }).click();
    await h.wait(150);
    const f = h.sent.findLast((x) => x.type === 'model');
    check('switching to Codex goes to the machine', f && f.chatId === 'skool' && f.model === 'codex', f);
    check('Codex active, the page stays open', (await active()).join() === 'Codex' && await p.isVisible('#info'), await active());
    await leave();
    check('header shows the Codex model behind it', (await badge()) === 'GPT-6.1 Sol (Codex)', await badge());

    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Cloud Carlo');
    check('own Codex model in the header', (await badge()) === 'GPT-6 Luna (Codex)', await badge());
    await page();
    check('own Codex model as the active chip', (await active()).join() === 'GPT-6 Luna (Codex)', await active());
    await leave();

    // account and limits of both plans
    await h.push({ type: 'account', subscription: 'max', model: 'claude-opus-5-5', version: '2.5.0', apiKeySource: 'none' });
    await h.push({ type: 'usage', usage: { status: 'allowed', fiveHour: { utilization: 0.4 }, sevenDay: { utilization: 0.1 }, updatedAt: '' } });
    await h.wait(100);
    const bars = () => p.locator('#usage .usage-bar > span:first-child').allTextContents();
    check('only Claude: bars without prefix', (await bars()).join('|') === '5 h|Week', await bars());
    await h.push({ type: 'account', subscription: 'plus', model: 'gpt-6.1-sol', version: '0.162.1', apiKeySource: 'none', engine: 'codex' });
    await h.push({ type: 'usage', engine: 'codex', usage: { status: 'rejected', fiveHour: { utilization: 1, resetsAt: 1791648803 }, sevenDay: { utilization: 0.3 }, resetsAt: 1791648803, updatedAt: '' } });
    await h.wait(100);
    const account = await p.textContent('#account');
    check('account shows both plans', account.includes('max · Claude Code 2.5.0') && account.includes('ChatGPT plus · Codex 0.162.1'), account);
    check('bars per plan', (await bars()).join('|') === 'Claude 5 h|Claude Week|Codex 5 h|Codex Week', await bars());
    const limit = await p.locator('#usage .limit').allTextContents();
    check('Codex limit reported, Claude not', limit.length === 1 && limit[0].startsWith('Codex limit reached'), limit);

    // the bot editor knows Codex
    check('editor offers Codex', (await p.locator('#editor-model option[value="codex"]').count()) === 1);

    // Cursor only if the machine offers it (login present)
    const cursorOption = () => p.evaluate(() => { openEditor(null); const o = document.querySelector('#editor-model option[value="cursor"]'); document.getElementById('editor').hidden = true; return o ? !o.hidden : null; });
    check('without Cursor login: option hidden in the editor', (await cursorOption()) === false);
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Skool Sven');
    await page();
    check('without Cursor login: no chip', !(await chips()).includes('Cursor'), await chips());
    await leave();
    await h.push({ type: 'models', machine: 'desk', models: [...MODELS, { value: 'cursor', resolvedModel: 'cursor:auto', displayName: 'Cursor' }, { value: 'cursor:auto', resolvedModel: 'cursor:auto', displayName: 'Auto (Cursor)' }, { value: 'copilot', resolvedModel: 'copilot:auto', displayName: 'Copilot' }, { value: 'antigravity', resolvedModel: 'antigravity:g', displayName: 'Antigravity' }, { value: 'opencode', resolvedModel: 'opencode:opencode/big-pickle', displayName: 'OpenCode' }] });
    await h.wait(100);
    await page();
    check('with Cursor and Copilot: chips next to Codex', (await chips()).join('|') === 'Opus 5.5|Sonnet 5.5|Codex|Cursor|Copilot|Antigravity|OpenCode', await chips());
    await p.locator('#info-switches .model-switch .chip', { hasText: 'Cursor' }).click();
    await h.wait(150);
    await leave();
    const c = h.sent.findLast((x) => x.type === 'model');
    check('switch to Cursor', c && c.model === 'cursor' && (await badge()) === 'Auto (Cursor)', { c, u: await badge() });
    check('with Cursor: option visible in the editor', (await cursorOption()) === true);
    await h.push({ type: 'account', subscription: null, model: 'Auto', version: '2026.10.01', apiKeySource: 'none', engine: 'cursor' });
    await h.wait(100);
    check('account shows Cursor', (await p.textContent('#account')).includes('Cursor 2026.10.01'), await p.textContent('#account'));
}
