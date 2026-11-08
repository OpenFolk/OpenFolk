// The sign-in page is centered, but a window lower than its card (a small desktop window, a large text size) must
// still reach the top: centering with auto margins instead of align-items cut the logo off above the window, where
// no scrolling gets to.

export default async function ({ start, check }) {
    const h = await start({ device: null });
    const p = h.page;
    const card = () => p.evaluate(() => {
        const s = document.getElementById('login');
        const c = s.querySelector('.start-card').getBoundingClientRect();
        return { shown: !s.hidden, top: Math.round(c.top), bottom: Math.round(c.bottom), height: s.clientHeight, scrollable: s.scrollHeight > s.clientHeight, docScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight };
    });

    await p.setViewportSize({ width: 1000, height: 1100 });
    await h.wait(200);
    let m = await card();
    check('tall window: the card is centered', m.shown && m.top > 24 && Math.abs(m.top - (m.height - m.bottom)) <= 1 && !m.scrollable, m);

    await p.setViewportSize({ width: 1000, height: 400 });
    await h.wait(200);
    m = await card();
    check('low window: the top of the card is in reach, not above the window', m.top >= 0 && m.scrollable && !m.docScrolls, m);
    await p.evaluate(() => { document.getElementById('login').scrollTop = 1e6; });
    const submit = await p.evaluate(() => { const r = document.querySelector('#login-form button[type=submit]').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inside: r.bottom <= innerHeight }; });
    check('scrolled down, the sign-in button is fully in view', submit.inside, submit);

    await p.setViewportSize({ width: 400, height: 860 });
    await h.wait(200);
    m = await card();
    check('phone: the card stays at the top', m.top < 40, m);
    await h.close();
}
