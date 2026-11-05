// The bot editor opens in the side panel when it is started from the bot's page, on top of that page: the chat stays
// usable, Cancel and Save lead back to the page, and the page shows the saved values. A new bot keeps the window.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const pdf = bot('pdf', 'PDF-Reader', { machine: 'desk' });
    const anna = bot('anna', 'Anna', { machine: 'desk' });
    const h = await start({
        bots: [pdf, anna],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    const box = (sel) => p.locator(sel).boundingBox();
    const sideBySide = async () => {
        const e = await box('#editor-form');
        const i = await box('#info-panel');
        return Boolean(e && i && Math.abs(e.x - i.x) <= 2 && Math.abs(e.width - i.width) <= 2 && Math.abs(e.height - i.height) <= 2);
    };
    const infoName = () => p.textContent('#info-name');
    const infoHidden = () => p.evaluate(() => document.getElementById('info').hidden);
    const sideEdit = () => p.evaluate(() => document.getElementById('editor').classList.contains('side-edit'));
    const botList = (list) => h.push({ type: 'bots', machine: 'desk', bots: list, groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] });

    for (const [label, width] of [['docked (1900 px)', 1900], ['overlay (1100 px)', 1100]]) {
        await p.setViewportSize({ width, height: 900 });
        await h.wait(200);
        await h.openChat('PDF');
        await p.click('[data-el=chat-title]');
        await h.wait(200);
        await p.click('#info-edit-top');
        await h.wait(200);
        check(`${label}: the editor opens, the page stays open below it`, await p.isVisible('#editor-form') && !(await infoHidden()));
        const form = await box('#editor-form');
        check(`${label}: the editor sits at the right edge`, (await sideEdit()) && Math.round(form.x + form.width) === width && (width !== 1900 || (await sideBySide())), form);
        const chat = await box('[data-el=text]');
        check(`${label}: the chat stays visible on the left`, chat && chat.x < form.x - 100 && (width !== 1900 || chat.x + chat.width <= form.x + 2), { chat, form });
        if (width === 1900) {
            await p.fill('[data-el=text]', 'Still here');
            await p.press('[data-el=text]', 'Enter');
            await h.wait(200);
            check('docked: the chat stays usable next to the editor', h.sent.some((f) => f.type === 'send' && f.chatId === 'pdf' && f.text === 'Still here'));
            check('docked: the editor was not closed by that', await p.isVisible('#editor-form'));
        }
        await p.fill('#editor-name', 'Changed but cancelled');
        await p.click('#editor-form .actions [data-close]');
        await h.wait(200);
        check(`${label}: Cancel leads back to the page`, !(await p.isVisible('#editor-form')) && (await p.isVisible('#info-panel')) && (await infoName()) === 'PDF-Reader', await infoName());
        await p.click('#info [data-close]');
        await h.wait(150);
    }

    // The machine link on the page: same place
    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    await p.click('#info-facts .info-machine');
    await h.wait(200);
    check('the machine link opens the editor in the side panel too', (await sideEdit()) && (await sideBySide()));
    await p.keyboard.press('Escape');
    await h.wait(150);
    check('Escape closes the editor and keeps the page', !(await p.isVisible('#editor-form')) && (await p.isVisible('#info-panel')));

    // Save: back to the page, which shows the new name once the bot list comes
    await p.click('#info-edit-top');
    await h.wait(200);
    await p.fill('#editor-name', 'PDF-Writer');
    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    const saved = h.sent.findLast((f) => f.type === 'bot_save');
    check('Save sends the bot and leads back to the page', saved?.bot.name === 'PDF-Writer' && !(await p.isVisible('#editor-form')) && (await p.isVisible('#info-panel')), saved?.bot);
    check('the page still shows the old name until the bot list arrives', (await infoName()) === 'PDF-Reader', await infoName());
    await botList([{ ...pdf, name: 'PDF-Writer' }, anna]);
    await h.wait(300);
    check('the bot list redraws the page with the new name', (await infoName()) === 'PDF-Writer', await infoName());

    // A change from another device while the page is open: the same
    await botList([{ ...pdf, name: 'PDF-Writer', role: 'Edited elsewhere' }, anna]);
    await h.wait(300);
    check('a change from another device shows on the page', (await p.textContent('#info-role')) === 'Edited elsewhere', await p.textContent('#info-role'));
    // ... but not while the editor is open over it
    await p.click('#info-edit-top');
    await h.wait(200);
    await p.fill('#editor-role', 'Typing');
    await botList([{ ...pdf, name: 'PDF-Writer', role: 'Again elsewhere' }, anna]);
    await h.wait(300);
    check('with the editor open the page is left alone and the typing stays', (await p.textContent('#info-role')) === 'Edited elsewhere' && (await p.inputValue('#editor-role')) === 'Typing');
    await p.click('#editor-form .actions [data-close]');
    await h.wait(150);

    // Not from the page: the window as before
    await p.click('#info [data-close]');
    await h.wait(150);
    await p.evaluate(() => openEditor(null));
    await h.wait(200);
    check('a new bot opens the window, not the side panel', (await p.isVisible('#editor-form')) && !(await sideEdit()));
    await p.keyboard.press('Escape');
    await h.wait(100);
    await p.evaluate(() => openEditor(bot('pdf')));
    await h.wait(200);
    check('"Edit bot" without the page open keeps the window', (await p.isVisible('#editor-form')) && !(await sideEdit()));
    await p.keyboard.press('Escape');
    await h.wait(100);

    // Phone: a page over the page, back leads to it
    await p.setViewportSize({ width: 400, height: 860 });
    await h.wait(200);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    await p.click('#info-edit-top');
    await h.wait(300);
    const phone = await box('#editor-form');
    check('phone: the editor is a full page', phone && phone.width >= 399 && phone.x <= 1, phone);
    await p.click('#editor-form [data-page-back]');
    await h.wait(200);
    check('phone: back leads to the bot page', !(await p.isVisible('#editor-form')) && (await p.isVisible('#info-panel')));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
