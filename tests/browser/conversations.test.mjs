// Several conversations per bot: list, opening with title, the conversation's page, creating new ones, state per conversation, sending.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven', { conversations: [{ id: 'aa11', title: 'Webstore release', createdAt: '' }] }), bot('cloud', 'Cloud Carlo')],
        history: { 'skool~aa11': [{ id: 'h1', role: 'user', from: 'me', text: 'Please prepare the release', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' }] },
        onSend: async (f, push, z) => {
            if (f.type !== 'conversation_new') return;
            z.bots[0].conversations.push({ id: 'bb22', title: '', createdAt: '' });
            await push({ type: 'bots', machine: 'desk', bots: z.bots, groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
            await push({ type: 'conversation_created', chatId: 'skool~bb22' });
        },
    });
    const p = h.page;
    const list = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li:not(.section)')].map((l) => (l.classList.contains('sub') ? '↳' : '') + l.querySelector('.name').firstChild.textContent.trim()));
    const head = () => p.evaluate(() => `${document.querySelector('[data-el=chat-name]').textContent} / ${document.querySelector('[data-el=chat-sub]').textContent}`);
    check('conversation indented below its bot', (await list()).join('|') === 'Skool Sven|↳Webstore release|Cloud Carlo', await list());
    await p.locator('#chat-list li.sub').first().click();
    await h.wait(300);
    check('header shows title and bot', (await head()).startsWith('Webstore release / Skool Sven'), await head());
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    const items = await p.locator('#info-actions button').allTextContents();
    check('the conversation\'s page: its title and entries', (await p.locator('#info-switches .menu-info strong').first().textContent()) === 'Webstore release' && ['New conversation', 'To the main chat of Skool Sven', 'Rename conversation', 'New session (clear context)', 'Archive', 'Delete permanently'].every((x) => items.includes(x)), items);
    await p.click('#info-actions button[data-action="conversation_new"]');
    await h.wait(300);
    check('new conversation created and opened, the page left', (await head()).startsWith('New conversation') && await p.isHidden('#info'), await head());
    check('request to the bot\'s machine', h.sent.some((f) => f.type === 'conversation_new' && f.botId === 'skool' && f.machine === 'desk'));
    await h.push({ type: 'state', machine: 'desk', botId: 'skool~bb22', state: 'thinking', chatId: 'skool~bb22', activity: 'Bash: npm test' });
    await h.wait(150);
    check('the state applies only to this conversation', (await head()).endsWith('Bash: npm test'), await head());
    await p.fill('[data-el=text]', 'Test the build');
    await p.evaluate(() => document.querySelector('[data-el=composer]').requestSubmit());
    await h.wait(100);
    const send = h.sent.find((f) => f.type === 'send');
    check('the message goes out with the chatId of the conversation', send && send.chatId === 'skool~bb22' && send.machine === 'desk', send);
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    check('a running conversation takes the bot along under "Running now"', (await p.locator('#chat-list li.section').first().textContent()) === 'Running now');
    const collapse = p.locator('#chat-list .collapse');
    check('collapse button only at the bot with conversations, with count', (await collapse.count()) === 1 && (await collapse.textContent()) === '2', await collapse.count());
    await collapse.click();
    await h.wait(100);
    const closed = await list();
    check('collapsed: conversations hidden', closed.join('|') === 'Skool Sven|Cloud Carlo', closed);
    check('the chat does not open, the state is remembered', await p.evaluate(() => !document.getElementById('app').classList.contains('chat-open') && localStorage.getItem('openfolk-collapsed') === '["skool"]'));
    check('collapsed with a running conversation: dot on the button', await p.evaluate(() => document.querySelector('#chat-list .collapse').classList.contains('important')));
    await p.locator('#chat-list li', { hasText: 'Cloud Carlo' }).first().click();
    await h.wait(300);
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    check('after another chat: stays collapsed', (await list()).filter((x) => x.startsWith('↳')).length === 0, await list());
    await collapse.click();
    await h.wait(100);
    check('expanded again', (await list()).filter((x) => x.startsWith('↳')).length === 2 && await p.evaluate(() => localStorage.getItem('openfolk-collapsed') === '[]'), await list());

    // swipe a conversation to the left: grey strip, releasing puts it into the archive without asking
    const row = () => p.evaluate(() => { const r = [...document.querySelectorAll('#chat-list li.sub')].find((l) => l.textContent.includes('Webstore release')).getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; });
    const requests = (type) => h.sent.filter((f) => f.type === type);
    const z = await row();
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: z.x + z.w - 40, y: z.y }] });
    for (let i = 1; i <= 8; i++) {
        await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: z.x + z.w - 40 - i * 16, y: z.y }] });
        await h.wait(20);
    }
    const strip = await p.evaluate(() => { const s = document.querySelector('.swipe-favorite'); return s ? `${s.textContent}${s.classList.contains('swipe-archive') && s.classList.contains('ready') ? ' (ready)' : ''}` : ''; });
    check('strip "Archive" appears', strip === '🗄 Archive (ready)', strip);
    let question = '';
    p.once('dialog', (d) => { question = d.message(); d.dismiss(); });
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await h.wait(500);
    const a = requests('conversation_archive');
    check('releasing archives without asking, to the bot\'s machine', !question && a.length === 1 && a[0].chatId === 'skool~aa11' && a[0].on === true && a[0].machine === 'desk', a);
    check('nothing deleted, no favorite', requests('conversation_delete').length === 0 && requests('favorite').length === 0);
    check('row gone from the overview, chat stays closed', !(await list()).includes('↳Webstore release') && await p.evaluate(() => !document.getElementById('app').classList.contains('chat-open')), await list());
    check('collapse button counts only the remaining ones', (await p.locator('#chat-list .collapse').textContent()) === '1');

    // bring it back via the bot's page
    await p.locator('#chat-list li[data-chat="skool"]').click();
    await h.wait(300);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    const inArchive = await p.locator('#info-archive button').allTextContents();
    check('the bot\'s page lists the archive', await p.isVisible('#info-archive-head') && inArchive.length === 1 && inArchive[0].startsWith('Webstore release'), inArchive);
    await p.locator('#info-archive button').first().click();
    await h.wait(300);
    const b = requests('conversation_archive');
    check('tapping brings it back, opens it and leaves the page', b.length === 2 && b[1].on === false && (await head()).startsWith('Webstore release') && await p.isHidden('#info'), await head());
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    check('in the overview again', (await list()).includes('↳Webstore release'), await list());

    // rename with a long press (with the mouse: right click), only for conversations
    const rowItems = () => p.locator('#row-menu button').allTextContents();
    await p.locator('#chat-list li[data-chat="skool"]').click({ button: 'right' });
    check('bot row: no rename', !(await rowItems()).includes('Rename conversation'), await rowItems());
    await p.mouse.click(5, 5);
    await p.locator('#chat-list li[data-chat="skool~aa11"]').click({ button: 'right' });
    check('conversation: rename offered', (await rowItems()).includes('Rename conversation'), await rowItems());
    await p.locator('#row-menu button', { hasText: 'Rename conversation' }).click();
    await h.wait(100);
    const field = await p.evaluate(() => {
        const f = document.getElementById('text-input');
        return { open: !document.getElementById('text-dialog').hidden, value: f.value, focus: document.activeElement === f, from: f.selectionStart, to: f.selectionEnd };
    });
    check('dialog with the previous title, focused and fully selected', field.open && field.value === 'Webstore release' && field.focus && field.from === 0 && field.to === field.value.length, field);
    await p.keyboard.type('  Release 3.2  ');
    await p.keyboard.press('Enter');
    await h.wait(200);
    const u = requests('conversation_rename');
    check('new title trimmed to the bot\'s machine', u.length === 1 && u[0].chatId === 'skool~aa11' && u[0].title === 'Release 3.2' && u[0].machine === 'desk', u);
    check('the overview shows the new title right away, menu and dialog closed', (await list()).includes('↳Release 3.2')
        && await p.evaluate(() => document.getElementById('row-menu').hidden && document.getElementById('text-dialog').hidden), await list());
    await p.locator('#chat-list li[data-chat="skool~aa11"]').click({ button: 'right' });
    await p.locator('#row-menu button', { hasText: 'Rename conversation' }).click();
    await p.keyboard.type('Discarded');
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('Escape cancels, nothing sent', requests('conversation_rename').length === 1 && await p.evaluate(() => document.getElementById('text-dialog').hidden));
}
