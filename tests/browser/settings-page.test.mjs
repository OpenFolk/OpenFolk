// Settings on a wide screen: the first pane with a header and X like a chat's, without a backdrop. The chats give way
// (parked, back when the settings close) and a chat opened from the list replaces them; what opens from the settings
// is the pane next to them, not a dialog over them. Narrow: a page over the whole screen as before. Saving shows a toast.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna')], online: ['desk'] });
    const p = h.page;
    const shownPanes = () => p.evaluate(() => [...document.querySelectorAll('.pane')].filter((x) => !x.hidden).length);
    await p.setViewportSize({ width: 1400, height: 900 });
    await h.wait(200);
    await p.click('[data-tab=settings]');
    await h.wait(200);
    check('wide: settings open as a pane', await p.isVisible('#settings') && await p.evaluate(() => document.getElementById('settings').parentElement.id === 'panes'));
    check('no backdrop', await p.evaluate(() => getComputedStyle(document.getElementById('settings')).position === 'static'));
    check('a header with the title and an X, no arrow, no Close button below', await p.isVisible('#settings .settings-bar .pane-close')
        && (await p.textContent('#settings .settings-bar')).includes('Settings') && !(await p.isVisible('#settings .settings-bar .page-back'))
        && (await p.locator('#settings .settings-close-row').count()) === 0);
    const head = await p.locator('#settings .settings-bar').boundingBox();
    const block = await p.locator('#settings-bots').boundingBox();
    check('the content starts at the left under the head, like the status page', head && block && Math.round(block.x - head.x) === 16 && block.width <= 640, { head, block });
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
    await p.click('[data-tab=settings]');
    await h.wait(200);
    await p.click('#settings .settings-bar .pane-close');
    await h.wait(100);
    check('the X closes them, the chat is back', !(await p.isVisible('#settings')) && (await shownPanes()) === 1);
    await p.click('[data-tab=settings]');
    await h.wait(200);
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('Escape closes them', !(await p.isVisible('#settings')) && (await shownPanes()) === 1);

    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    await p.click('[data-tab=settings]');
    await h.wait(200);
    const side = await p.locator('.sidebar').boundingBox();
    const left = await p.locator('#settings').boundingBox();
    check('two panes fit: the settings on the left, the chat gives way', (await shownPanes()) === 0 && side && left && Math.round(left.x) === Math.round(side.x + side.width)
        && Math.round(left.x + left.width) === Math.round(side.x + side.width + (1900 - side.width - side.x * 2)), { side, left });
    check('no + strip next to them', !(await p.isVisible('#pane-add')));
    // A form of the settings: the pane to their right, the settings keep the left
    await p.click('#settings-ai-add');
    await h.wait(200);
    const settingsBox = await p.locator('#settings').boundingBox();
    const sub = await p.locator('#settings-dialog').boundingBox();
    check('a form opens as the pane next to them, no backdrop', await p.isVisible('#settings-ai-form') && await p.evaluate(() => {
        const d = document.getElementById('settings-dialog');
        return d.parentElement.id === 'panes' && d.previousElementSibling.id === 'settings' && getComputedStyle(d).position === 'static';
    }) && settingsBox && sub && Math.round(settingsBox.x + settingsBox.width) <= Math.round(sub.x) + 1 && Math.abs(settingsBox.width - sub.width) < 2 && sub.height === 900, { settingsBox, sub });
    check('… with the X of a pane, no arrow', await p.isVisible('#settings-dialog .settings-dialog-close') && !(await p.isVisible('#settings-dialog .page-back')));
    await p.click('#settings-dialog .settings-dialog-close');
    await h.wait(100);
    check('its X closes only it', !(await p.isVisible('#settings-dialog')) && await p.isVisible('#settings') && await p.evaluate(() => !document.getElementById('settings-ai-form').closest('#panes > #settings-dialog')));
    await p.click('#settings-ai-add');
    await h.wait(100);
    await h.openChat('Anna');
    await h.wait(200);
    check('a chat from the list closes the settings and the form, the chat is back', !(await p.isVisible('#settings')) && !(await p.isVisible('#settings-dialog'))
        && (await shownPanes()) === 1 && (await p.textContent('.pane:not([hidden]) [data-el=chat-name]')).includes('Anna'));
    check('… the + strip too', await p.isVisible('#pane-add'));
    await p.click('[data-tab=settings]');
    await h.wait(200);

    await p.click('#settings .settings-bar .pane-close');
    await h.wait(100);
    await p.setViewportSize({ width: 400, height: 860 });
    await h.wait(200);
    await p.evaluate(() => document.querySelector('.back')?.click());
    await h.wait(200);
    await p.click('[data-tab=settings]');
    // The page slides in; on a slow CI runner it is still moving after a fixed wait
    let narrow = null;
    for (let i = 0; i < 30 && narrow?.x !== 0; i++) {
        await h.wait(100);
        narrow = await p.locator('#settings > .dialog').boundingBox();
    }
    check('narrow: over the whole screen', narrow && narrow.x === 0 && narrow.width === 400
        && await p.evaluate(() => getComputedStyle(document.getElementById('settings')).position === 'fixed'), narrow);
    check('narrow: the head with the arrow back instead of the X', await p.isVisible('#settings .settings-bar .page-back') && !(await p.isVisible('#settings .settings-bar .pane-close')));
    check('narrow: a tab like the others, no slide-in', await p.evaluate(() => getComputedStyle(document.getElementById('settings')).animationName === 'none'));
    const before = await p.locator('#settings').boundingBox();
    await h.swipe(20, 400, 200, 400, 8, 20);
    await h.wait(400);
    const after = await p.locator('#settings').boundingBox();
    check('narrow: a swipe to the right neither moves nor closes them', await p.isVisible('#settings') && before && after && before.x === after.x, { before, after });

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
