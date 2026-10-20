// Model switch on the bot's page (header of the chat): always shows the model that really runs ('default' → what the CLI takes for it),
// never "Default". A switch goes to the bot's machine and shows in the header right away; in a conversation
// only for it, groups do not have it.
import { bot } from './harness.mjs';

const MODELS = [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
    { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1' },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
    { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8' },
];

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven', { conversations: [{ id: 'aa11', title: 'Release', createdAt: '' }] }), bot('cloud', 'Cloud Carlo', { model: 'claude-opus-4-8' })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
    });
    const p = h.page;
    await h.push({ type: 'models', machine: 'desk', models: MODELS });
    const chips = () => p.locator('#info-switches .model-switch .chip').allTextContents();
    const active = () => p.locator('#info-switches .model-switch .chip.on').allTextContents();
    const page = async () => { await p.click('[data-el=chat-title]'); await h.wait(150); };
    const leave = async () => { await p.click('#info [data-page-back]'); await h.wait(150); };
    const badge = () => p.textContent('[data-el=chat-model]');
    const switches = () => h.sent.filter((x) => x.type === 'model');

    await h.openChat('Skool Sven');
    check('header shows the real model behind default', (await badge()) === 'Opus 5.5', await badge());
    await page();
    check('switch without "Default", names of the CLI', (await chips()).join('|') === 'Opus 5.5|Fable 5.1|Sonnet 5.5|Haiku 4.5', await chips());
    check('Opus active because the default is Opus', (await active()).join() === 'Opus 5.5');
    await p.locator('#info-switches .model-switch .chip', { hasText: 'Opus' }).click();
    await h.wait(100);
    check('a tap on the running model sends nothing', switches().length === 0);
    await p.locator('#info-switches .model-switch .chip', { hasText: 'Fable' }).click();
    await h.wait(150);
    const f = switches()[0];
    check('switch to the bot\'s machine', f && f.chatId === 'skool' && f.model === 'fable' && f.machine === 'desk', f);
    check('the page stays open with Fable active', (await p.isVisible('#info')) && (await active()).join() === 'Fable 5.1', await active());
    await leave();
    check('header shows Fable 5.1', (await badge()) === 'Fable 5.1', await badge());

    // the conversation inherits Fable from the bot and then gets a model of its own
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await p.locator('#chat-list li.sub').first().click();
    await h.wait(300);
    check('the conversation inherits the bot\'s model', (await badge()) === 'Fable 5.1', await badge());
    await page();
    await p.locator('#info-switches .model-switch .chip', { hasText: 'Haiku' }).click();
    await h.wait(150);
    await leave();
    const u = switches().pop();
    check('switch only for the conversation', u && u.chatId === 'skool~aa11' && u.model === 'haiku', u);
    check('the bot keeps its model', await p.evaluate(() => state.bots[0].model === 'fable' && state.bots[0].conversations[0].model === 'haiku'));
    const listed = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li[data-chat]')].map((l) => `${l.dataset.chat}:${l.querySelector('.model-badge')?.textContent ?? '-'}`).join(' '));
    check('overview: each bot and conversation with the model it runs on, groups without', (await listed()) === 'skool:Fable 5.1 skool~aa11:Haiku 4.5 cloud:Opus 4.8 g:team:-', await listed());
    check('the line below the name no longer repeats the model', !(await p.textContent('[data-el=chat-sub]')).includes('Haiku'), await p.textContent('[data-el=chat-sub]'));

    // custom model id from the editor: a chip of its own with the CLI's name
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Cloud Carlo');
    check('header shows the custom id with its name', (await badge()) === 'Opus 4.8', await badge());
    await page();
    check('custom id as the active chip', (await active()).join() === 'Opus 4.8' && (await chips()).length === 5, await chips());
    await leave();

    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Team');
    await page();
    check('groups: the header opens the group editor, without a model switch', (await p.isVisible('#group-editor')) && (await p.locator('#group-editor .model-switch, #info-switches .model-switch:visible').count()) === 0);
    await p.keyboard.press('Escape');
    check('no model badge in the header of a group', await p.isHidden('[data-el=chat-model]'));
}
