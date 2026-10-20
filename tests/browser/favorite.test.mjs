// Overview: swiping a row to the left makes the bot a favorite (and back again); short or vertical swipes do not.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('anna', 'Anna'), bot('cloud', 'Cloud Carlo')] });
    const p = h.page;
    const row = (name) => p.evaluate((name) => { const r = [...document.querySelectorAll('#chat-list li[data-chat]')].find((l) => l.textContent.includes(name)).getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; }, name);
    const sections = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li')].map((l) => l.classList.contains('section') ? `[${l.textContent}]` : l.querySelector('.name').firstChild.textContent.trim()).join(' '));
    const favRequests = () => h.sent.filter((f) => f.type === 'favorite');
    const open = () => p.evaluate(() => document.getElementById('app').classList.contains('chat-open'));

    let z = await row('Cloud Carlo');
    await h.swipe(z.x + z.w - 40, z.y, z.x + z.w - 80, z.y, 6, 20);
    check('short swipe (40 px) changes nothing', favRequests().length === 0 && !(await open()));
    await h.swipe(z.x + 150, z.y - 30, z.x + 160, z.y + 120, 8, 20);
    check('vertical swipe changes nothing', favRequests().length === 0);
    // pulling down opened the search box at the top: rows have moved
    await h.wait(300);
    z = await row('Cloud Carlo');

    // long swipe: check in the middle that the strip appears
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: z.x + z.w - 40, y: z.y }] });
    for (let i = 1; i <= 8; i++) {
        await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: z.x + z.w - 40 - i * 16, y: z.y }] });
        await h.wait(20);
    }
    const middle = await p.evaluate(() => { const s = document.querySelector('.swipe-favorite'); return s ? `${s.textContent}${s.classList.contains('ready') ? ' (ready)' : ''}` : ''; });
    check('strip "★ Favorite" appears and is ready from 80 px', middle === '★ Favorite (ready)', middle);
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await h.wait(600);
    const a = favRequests();
    check('releasing makes Cloud Carlo a favorite', a.length === 1 && a[0].chatId === 'cloud' && a[0].on === true, a);
    check('swiping does not open the chat', !(await open()));
    check('Cloud Carlo is under favorites', (await sections()) === '[Favorites] Cloud Carlo [All] Anna', await sections());
    check('row sprang back, strip gone', await p.evaluate(() => !document.querySelector('.swipe-favorite') && [...document.querySelectorAll('#chat-list li[data-chat]')].every((l) => !l.style.transform)));

    z = await row('Cloud Carlo');
    await h.swipe(z.x + z.w - 40, z.y, z.x + z.w - 170, z.y, 8, 20);
    const b = favRequests();
    check('swiping again takes it out', b.length === 2 && b[1].on === false, b);
    check('list without favorites', (await sections()) === 'Anna Cloud Carlo', await sections());
    check('no star in the overview any more', (await p.locator('#chat-list .star').count()) === 0);

    // to the right: mark as unread and back
    const isUnread = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li[data-chat]')].find((l) => l.textContent.includes('Anna')).classList.contains('unread'));
    z = await row('Anna');
    await h.swipe(z.x + 40, z.y, z.x + 170, z.y, 8, 20);
    await h.wait(300);
    check('swiped to the right: marked as unread, chat stays closed', await isUnread() && !(await open()) && favRequests().length === 2);
    check('unread stays after re-rendering', await p.evaluate(() => { renderChatList(); return [...document.querySelectorAll('#chat-list li.unread')].length === 1; }));
    z = await row('Anna');
    await h.swipe(z.x + 40, z.y, z.x + 170, z.y, 8, 20);
    await h.wait(300);
    check('to the right again: read again', !(await isUnread()));

    // queue: hourglass with count as long as something waits
    const badge = () => p.evaluate(() => { const m = [...document.querySelectorAll('#chat-list li[data-chat]')].find((l) => l.textContent.includes('Cloud Carlo')).querySelector('.queue-badge'); return m ? m.textContent : ''; });
    await h.push({ type: 'state', machine: 'desk', botId: 'cloud', state: 'thinking', chatId: 'cloud', queue: { cloud: 2 } });
    await h.wait(150);
    check('two waiting messages: hourglass with 2', (await badge()) === '2', await badge());
    await h.push({ type: 'state', machine: 'desk', botId: 'cloud', state: 'idle', queue: {} });
    await h.wait(150);
    check('queue empty: no hourglass', (await badge()) === '', await badge());

    await p.locator('#chat-list li', { hasText: 'Anna' }).click();
    await h.wait(300);
    check('a normal tap still opens the chat', await open());
}
