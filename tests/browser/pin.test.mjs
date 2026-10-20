// Message menu via "⋯" (and right click), pinning with a bar, jump, several, unpin;
// text stays selectable, a long press opens no menu.
const history = {
    pdf: Array.from({ length: 12 }, (_, i) => i % 2
        ? { id: 'a' + i, role: 'assistant', botId: 'pdf', text: i === 1 ? 'The **deploy command** is `npm run deploy`.' : `Answer ${i} `.repeat(10), ts: `2026-10-08T05:${10 + i}:00Z` }
        : { id: 'u' + i, role: 'user', from: 'me', text: `Question ${i}`, ts: `2026-10-08T05:${10 + i}:00Z`, readAt: `2026-10-08T05:${10 + i}:30Z` }),
};

export default async function ({ start, check }) {
    let pinned = [];
    const h = await start({
        history,
        onSend: async (f, push) => {
            if (f.type !== 'pin') return;
            pinned = f.on ? [f.entry, ...pinned.filter((x) => x.id !== f.entry.id)].slice(0, 3) : pinned.filter((x) => x.id !== f.entry.id);
            await push({ type: 'pinned', chatId: f.chatId, entries: pinned });
        },
    });
    const p = h.page;
    const menu = () => p.evaluate(() => document.getElementById('message-menu').hidden ? '' : [...document.querySelectorAll('#message-menu button')].map((b) => b.textContent).join('|'));
    const bar = () => p.evaluate(() => document.querySelector('[data-el=pinned-bar]').hidden ? '' : document.querySelector('[data-el=fx-text] .fx-content').textContent + (document.querySelector('[data-el=fx-text] .fx-count')?.textContent ?? ''));
    const more = async (eid) => {
        await p.evaluate((eid) => document.querySelector(`.bubble[data-eid="${eid}"]`).scrollIntoView({ block: 'center' }), eid);
        await p.click(`.bubble[data-eid="${eid}"] .more`);
        await h.wait(150);
    };
    await h.openChat('PDF');

    await more('a1');
    check('"⋯" opens the menu', (await menu()) === 'Reply|Pin|Read aloud|Copy', await menu());
    await p.locator('#message-menu button', { hasText: 'Pin' }).click();
    await h.wait(200);
    check('bar shows the pinned answer', (await bar()).includes('PDF-Reader: The deploy command is npm run deploy.'), await bar());
    const request = h.sent.find((f) => f.type === 'pin');
    check('request with a copy of text and sender', request && request.entry.id === 'a1' && request.entry.from === 'pdf' && request.on === true, request);

    await p.evaluate(() => { const n = document.querySelector('[data-el=messages]'); n.scrollTop = n.scrollHeight; });
    await p.click('[data-el=fx-text]');
    await h.wait(700);
    check('tapping the bar jumps there and highlights', await p.evaluate(() => { const b = document.querySelector('.bubble[data-eid="a1"]'); const r = b.getBoundingClientRect(); return b.classList.contains('highlighted') && r.top > 0 && r.bottom < innerHeight; }));

    await more('u4');
    await p.locator('#message-menu button', { hasText: 'Pin' }).click();
    await h.wait(200);
    check('second pinned: counter 1/2', (await bar()).endsWith('1/2'), await bar());
    await p.click('[data-el=fx-unpin]');
    await h.wait(200);
    check('× unpins the one shown', (await bar()).includes('deploy command') && !(await bar()).includes('1/'), await bar());

    await p.evaluate(() => { const b = document.querySelector('.bubble[data-eid="a1"]'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10 })); });
    await h.wait(150);
    check('right click opens the menu with "Unpin"', (await menu()).startsWith('Reply|Unpin'), await menu());
    await p.evaluate(() => { document.getElementById('message-menu').hidden = true; });

    const selection = await p.evaluate(() => {
        const content = document.querySelector('.bubble[data-eid="a1"] .content');
        const r = document.createRange();
        r.selectNodeContents(content);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        const text = getSelection().toString();
        getSelection().removeAllRanges();
        return { userSelect: getComputedStyle(content).userSelect, text };
    });
    check('text in answers selectable', selection.userSelect !== 'none' && selection.text.startsWith('The deploy command'), selection);
    const r = await p.evaluate(() => { const q = document.querySelector('.bubble[data-eid="a1"]').getBoundingClientRect(); return { x: q.x + 30, y: q.y + 15 }; });
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [r] });
    await h.wait(700);
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await h.wait(200);
    check('a long press opens no menu (stays with text selection)', (await menu()) === '');
}
