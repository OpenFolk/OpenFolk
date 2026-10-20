// Long press on a chat in the overview: its menu, the entries of the bot's page plus open changes, info and archive, on
// the phone as a page of its own with back; a short tap and scrolling do not open it.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('pdf', 'PDF-Reader', { machine: 'workstation' }),
            bot('cloud', 'Cloud Carlo', { conversations: [{ id: 'ee55', title: 'Old move', createdAt: '', archived: '2026-10-09T10:00:00Z' }] })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'pdf'], createdAt: '', updatedAt: '' }],
        onSend: async (f, push, z) => {
            if (f.type !== 'conversation_new') return;
            z.bots.find((b) => b.id === f.botId).conversations = [{ id: 'dd44', title: '', createdAt: '' }];
            await push({ type: 'bots', machine: 'desk', bots: z.bots, groups: z.groups, states: {}, activity: {}, activeChats: {}, approvals: [] });
            await push({ type: 'conversation_created', chatId: `${f.botId}~dd44` });
        },
    });
    const p = h.page;
    const middle = (name) => p.evaluate((name) => {
        const r = [...document.querySelectorAll('#chat-list li[data-chat]')].find((l) => l.querySelector('.name').textContent.startsWith(name)).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    const hold = async (name, ms, dy = 0) => {
        const m = await middle(name);
        await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [m] });
        if (dy) await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: m.x, y: m.y + dy }] });
        await h.wait(ms);
        await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await h.wait(200);
    };
    // the entries; the model and machine chips sit in rows of their own
    const entries = (sel) => p.evaluate((sel) => { const m = document.querySelector(sel); return m && !m.hidden ? [...m.querySelectorAll(':scope > button')].map((b) => b.textContent.trim() + (b.disabled ? ' (disabled)' : '')) : null; }, sel);
    const menu = () => entries('#row-menu');
    const chips = () => p.locator('#row-menu .model-switch .chip').allTextContents();
    const BOT = ['Open changes', 'Search in chat', 'New conversation', 'VS Code', 'Info, routines, knowledge', 'Mark as favorite', 'New session (clear context)', 'Delete bot'];
    const open = () => p.evaluate(() => document.getElementById('app').classList.contains('chat-open'));

    await hold('Skool Sven', 150);
    check('short tap: no menu, the chat opens', (await menu()) === null && await open());
    await p.click('[data-el=btn-back]');
    await h.wait(300);

    await hold('Skool Sven', 700, 30);
    check('finger moved (scrolling): no menu', (await menu()) === null);

    await hold('Team', 700);
    check('group: its menu', JSON.stringify(await menu()) === '["Search in chat","Edit group","Mark as favorite","Delete group"]', await menu());
    check('group: no model switch', (await chips()).length === 0);
    const page = await p.locator('#row-menu').boundingBox();
    check('phone: the menu is a page over the whole screen', page && page.x === 0 && page.y === 0 && page.width === 400 && page.height >= 858, page);
    check('page head with the chat\'s name', (await p.textContent('#row-menu .menu-head strong')) === 'Team');
    await p.mouse.click(200, 840);
    await h.wait(100);
    check('a tap on an empty spot leaves it open', (await menu()) !== null);
    await p.click('#row-menu .menu-back');
    await h.wait(100);
    check('back closes it, the list stays', (await menu()) === null && !(await open()));

    await hold('PDF-Reader', 700);
    check('sleeping bot: new conversation and changes disabled', JSON.stringify(await menu()) === JSON.stringify(BOT.map((e) => (e === 'Open changes' || e === 'New conversation' ? e + ' (disabled)' : e))), await menu());
    await h.swipe(60, 600, 360, 600);
    await h.wait(100);
    check('swipe to the right closes it', (await menu()) === null && !(await open()));

    await hold('Skool Sven', 700);
    const rowEntries = await menu();
    check('long press: the bot\'s menu with model switch', JSON.stringify(rowEntries) === JSON.stringify(BOT) && (await chips()).includes('Default'), rowEntries);
    check('releasing does not open the chat', !(await open()));
    const rowChips = await chips();
    await p.click('#row-menu .menu-back');
    await h.wait(100);
    await h.openChat('Skool Sven');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    const onPage = await entries('#info-actions');
    const pageChips = await p.locator('#info-switches .model-switch .chip').allTextContents();
    // the page shows open changes and the archive itself and is the info
    const extra = ['Open changes', 'Info, routines, knowledge'];
    check('the entries of the bot\'s page plus open changes and info', JSON.stringify(onPage) === JSON.stringify(rowEntries.filter((e) => !extra.includes(e)))
        && extra.every((e) => rowEntries.includes(e)) && JSON.stringify(pageChips) === JSON.stringify(rowChips), { onPage, pageChips, rowChips });
    await p.click('#info [data-page-back]');
    await h.wait(100);
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await hold('Skool Sven', 700);
    await p.locator('#row-menu button', { hasText: 'New conversation' }).click();
    await h.wait(300);
    const request = h.sent.find((f) => f.type === 'conversation_new');
    check('request to the bot\'s machine', request && request.botId === 'skool' && request.machine === 'desk', request);
    check('new conversation opened, menu closed', await open() && (await p.textContent('[data-el=chat-name]')) === 'New conversation' && (await menu()) === null);

    // bot with an archive: second entry, opens the list in the same menu; tapping brings the conversation back
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    check('archived conversation is not in the overview', await p.evaluate(() => !document.querySelector('#chat-list li[data-chat="cloud~ee55"]')));
    await hold('Cloud Carlo', 700);
    check('menu with archive and count', JSON.stringify(await menu()) === JSON.stringify([...BOT.slice(0, 3), 'Archive (1)', ...BOT.slice(3)]), await menu());
    await p.locator('#row-menu button', { hasText: 'Archive' }).click();
    await h.wait(100);
    check('archive shows title and date', JSON.stringify(await menu()) === '["Old move · 10/9/2026"]', await menu());
    await p.locator('#row-menu > button').click();
    await h.wait(300);
    const back = h.sent.find((f) => f.type === 'conversation_archive');
    check('brought back and opened', back && back.chatId === 'cloud~ee55' && back.on === false && (await p.textContent('[data-el=chat-name]')) === 'Old move' && (await menu()) === null, back);
}
