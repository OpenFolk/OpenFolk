// Settings on a wide screen: a pane after the chats with a header and X like a chat's, without a backdrop. Where only
// one pane fits they take it and a chat opened from the list replaces them; where two fit they stand next to the chat.
// Narrow: a page over the whole screen as before. Saving shows a toast.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna')], online: ['desk'] });
    const p = h.page;
    const shownPanes = () => p.evaluate(() => [...document.querySelectorAll('.pane')].filter((x) => !x.hidden).length);
    await p.setViewportSize({ width: 1400, height: 900 });
    await h.wait(200);
    await p.click('#btn-settings');
    await h.wait(200);
    check('wide: settings open as a pane', await p.isVisible('#settings') && await p.evaluate(() => document.getElementById('settings').parentElement.id === 'panes'));
    check('no backdrop', await p.evaluate(() => getComputedStyle(document.getElementById('settings')).position === 'static'));
    check('a header with the title and an X, no Close button below', await p.isVisible('#settings .settings-bar .pane-close')
        && (await p.textContent('#settings .settings-bar')).includes('Settings') && !(await p.isVisible('#settings .settings-close-row button')));
    const list = await p.locator('.sidebar').boundingBox();
    const page = await p.locator('#settings').boundingBox();
    check('one pane fits: the settings take it', list && page && Math.round(page.x) === Math.round(list.x + list.width)
        && Math.round(page.x + page.width) === Math.round(list.x + list.width + (1400 - list.width - list.x * 2)) && page.height === 900
        && (await shownPanes()) === 0 && !(await p.isVisible('#chat-empty')), { list, page });
    await p.click('#settings .dialog');
    await h.wait(100);
    check('a click on the page does not close it', await p.isVisible('#settings'));
    await h.openChat('PDF');
    await h.wait(200);
    check('a chat replaces them in the only pane', !(await p.isVisible('#settings')) && (await shownPanes()) === 1);
    await p.click('#btn-settings');
    await h.wait(200);
    await p.click('#settings .settings-bar .pane-close');
    await h.wait(100);
    check('the X closes them, the chat is back', !(await p.isVisible('#settings')) && (await shownPanes()) === 1);
    await p.click('#btn-settings');
    await h.wait(200);
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('Escape closes them', !(await p.isVisible('#settings')) && (await shownPanes()) === 1);

    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    await p.click('#btn-settings');
    await h.wait(200);
    const chat = await p.locator('.pane:not([hidden])').boundingBox();
    const beside = await p.locator('#settings').boundingBox();
    check('two panes fit: the settings next to the chat, as wide', (await shownPanes()) === 1 && chat && beside && Math.round(chat.x + chat.width) <= Math.round(beside.x) + 1
        && Math.abs(chat.width - beside.width) < 2, { chat, beside });
    check('no + strip next to them', !(await p.isVisible('#pane-add')));
    await h.openChat('Anna');
    await h.wait(200);
    check('another chat goes into the pane, the settings stay', await p.isVisible('#settings') && (await shownPanes()) === 1
        && (await p.textContent('.pane:not([hidden]) [data-el=chat-name]')).includes('Anna'));
    await p.click('#settings .settings-bar .pane-close');
    await h.wait(100);
    check('closed: the + strip is back', !(await p.isVisible('#settings')) && await p.isVisible('#pane-add'));

    await p.setViewportSize({ width: 400, height: 860 });
    await h.wait(200);
    await p.evaluate(() => document.querySelector('.back')?.click());
    await h.wait(200);
    await p.click('#btn-settings');
    await h.wait(200);
    const narrow = await p.locator('#settings > .dialog').boundingBox();
    check('narrow: over the whole screen', narrow && narrow.x === 0 && narrow.width === 400
        && await p.evaluate(() => getComputedStyle(document.getElementById('settings')).position === 'fixed'), narrow);

    // Saving shows a toast at the bottom: local settings at once, the others when the backend answers
    const toast = () => p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
    await p.selectOption('#settings-theme', 'dark');
    await h.wait(100);
    check('colour scheme: toast at once', (await toast()) === 'Saved');
    await p.evaluate(() => { document.getElementById('toast').hidden = true; });
    await p.selectOption('#settings-avatar-model', 'gpt-image-1');
    await h.wait(100);
    check('shared setting: sent, no toast before the answer', h.sent.some((f) => f.type === 'settings_save' && f.settings.avatarModel === 'gpt-image-1') && !(await toast()));
    await h.push({ type: 'settings', machine: 'desk', settings: { updatedAt: new Date().toISOString(), avatarModel: 'gpt-image-1' } });
    await h.wait(100);
    check('the answer shows the toast', (await toast()) === 'Saved');
    await p.evaluate(() => { document.getElementById('toast').hidden = true; });
    await h.push({ type: 'settings', machine: 'desk', settings: { updatedAt: new Date().toISOString(), avatarModel: 'gpt-image-1' } });
    await h.wait(100);
    check('settings nobody saved here: no toast', !(await toast()));
    await h.wait(2600);
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
