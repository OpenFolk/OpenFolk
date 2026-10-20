// All menus uniform: every entry first an SVG icon, then the label (without an emoji or sign in front);
// a tap on the icon or the label triggers the action. The model switch (chips) is not an entry.
import { bot } from './harness.mjs';

const checkMenu = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(`${sel} button:not(.chip)`)].map((b) => {
    const [first, second] = b.children;
    const ok = first?.tagName.toLowerCase() === 'svg' && first.querySelector('path, circle, rect') && second?.tagName === 'SPAN' && second.textContent.trim()
        && !/^[^\p{L}]/u.test(second.textContent.trim());
    return ok ? '' : b.textContent.trim() || '(empty)';
}).filter(Boolean), sel);

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader', { conversations: [{ id: 'aa11', title: 'On the side', createdAt: '' }] }), bot('cloud', 'Cloud Carlo')],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['pdf', 'cloud'], createdAt: '', updatedAt: '' }],
        history: { pdf: [{ id: 'a1', role: 'assistant', botId: 'pdf', text: 'Hello', ts: '2026-10-08T05:00:00Z' }] },
    });
    const p = h.page;

    await p.click('#btn-new');
    check('"+" menu: icon, then label', (await checkMenu(p, '#new-menu')).length === 0 && (await p.locator('#new-menu button').count()) === 3, await checkMenu(p, '#new-menu'));
    await p.locator('#new-menu button span', { hasText: 'New bot' }).click();
    check('a tap on the label opens the editor', await p.evaluate(() => !document.getElementById('editor').hidden));
    await p.evaluate(() => { document.getElementById('editor').hidden = true; });

    for (const [name, row, sel] of [['bot', 'PDF-Reader', '#info-actions'], ['conversation', 'On the side', '#info-actions'], ['group', 'Team', '#group-actions']]) {
        await p.locator('#chat-list li', { hasText: row }).last().click();
        await h.wait(200);
        // the chat's entries are on the bot's page or in the group editor, opened via the header
        await p.click('[data-el=chat-title]');
        await h.wait(200);
        const errors = await checkMenu(p, sel);
        check(`chat entries (${name}): all with the icon before the label`, errors.length === 0 && (await p.locator(`${sel} button`).count()) >= 3, errors);
        await p.keyboard.press('Escape');
        await p.click('[data-el=btn-back]');
        await h.wait(200);
    }

    await h.openChat('PDF-Reader');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    await p.locator('#info-actions button span', { hasText: 'Search in chat' }).click();
    check('a tap on the label on the bot\'s page works', await p.evaluate(() => !document.querySelector('[data-el=chat-search]').hidden));
    await p.click('[data-el=cs-close]');

    await p.click('.bubble[data-eid="a1"] .more');
    const errors = await checkMenu(p, '#message-menu');
    check('message menu: all entries with the icon before the label', errors.length === 0 && (await p.locator('#message-menu button').count()) === 4, errors);
    await p.locator('#message-menu button svg').first().click();
    check('a tap on the icon works (Reply)', await p.evaluate(() => !document.querySelector('[data-el=reply-bar]').hidden));
}
