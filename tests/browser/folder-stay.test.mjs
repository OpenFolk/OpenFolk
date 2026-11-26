// A list folder can keep its bots in place: set in its menu, they stay in the folder while they work or have something
// new instead of moving up to "Running now"; set back, they move up again. Other folders are not affected.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('anna', 'Anna', { category: 'kunden' }), bot('bert', 'Bert')],
        categories: [{ id: 'kunden', name: 'Kunden', createdAt: '', updatedAt: '' }],
    });
    const p = h.page;
    const sections = () => p.evaluate(() => [...document.querySelectorAll('#chat-list > li:not(.fav-strip)')].map((l) => l.classList.contains('section') ? `[${l.querySelector('.cat-name')?.textContent ?? l.textContent}]` : l.querySelector('.name').firstChild.textContent.trim()).join(' '));
    await h.push({ type: 'state', machine: 'desk', botId: 'anna', state: 'thinking', chatId: 'anna' });
    await h.wait(150);
    check('by default a working bot moves up', (await sections()).startsWith('[Running now] Anna'), await sections());

    await p.locator('#chat-list li.section[data-category="kunden"]').click({ button: 'right' });
    await h.wait(150);
    await p.locator('#row-menu button[data-action="stay"]').click();
    await h.wait(150);
    const saved = h.sent.findLast((f) => f.type === 'category_save');
    check('the menu sets the folder to keep its bots', saved?.category.id === 'kunden' && saved.category.stay === true, saved);
    check('… and the working bot stays in it', !(await sections()).includes('Running now') && /Kunden.*Anna/.test(await sections()), await sections());

    await p.locator('#chat-list li.section[data-category="kunden"]').click({ button: 'right' });
    await h.wait(150);
    check('the menu shows it as checked', (await p.getAttribute('#row-menu button[data-action="stay"]', 'aria-checked')) === 'true');
    check('a pin after the folder name', await p.isVisible('#chat-list li.section[data-category="kunden"] .stay-pin'));
    await p.locator('#row-menu button[data-action="stay"]').click();
    await h.wait(150);
    check('set back: it moves up again, no pin', (await sections()).startsWith('[Running now] Anna') && !(await p.isVisible('#chat-list li.section[data-category="kunden"] .stay-pin')), await sections());

    // an older backend drops the field: its bots frame comes back without it, and the app says why nothing changed
    await p.locator('#chat-list li.section[data-category="kunden"]').click({ button: 'right' });
    await h.wait(150);
    await p.locator('#row-menu button[data-action="stay"]').click();
    await h.wait(100);
    await h.push({ type: 'bots', machine: 'desk', bots: [bot('anna', 'Anna', { category: 'kunden' }), bot('bert', 'Bert')], groups: [], categories: [{ id: 'kunden', name: 'Kunden', createdAt: '', updatedAt: '' }], states: { anna: 'thinking' }, activity: {}, activeChats: { anna: 'anna' }, approvals: [] });
    await h.wait(200);
    const hint = await p.evaluate(() => document.getElementById('toast')?.textContent || '');
    check('older backend: the folder springs back and a hint names the machine', hint.includes('DESK') && hint.includes('restarted') && (await sections()).startsWith('[Running now] Anna'), [hint, await sections()]);
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
