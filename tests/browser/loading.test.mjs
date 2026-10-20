// Loading bar until the history is there; sleep hint only after the machine list; reconnecting after 1012.
export default async function ({ start, check }) {
    const history = [{ id: 'a', role: 'user', from: 'me', text: 'Hello', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' }];
    // history only after 1.2 s (the preview with limit right away)
    const h = await start({
        ownHistory: true,
        onSend: async (f, push) => {
            if (f.type !== 'history') return;
            if (f.limit) await push({ type: 'history', chatId: f.chatId, entries: history.slice(-f.limit), live: [] });
            else setTimeout(() => push({ type: 'history', chatId: f.chatId, entries: history, live: [] }), 1200);
        },
    });
    const p = h.page;
    const bar = () => p.evaluate(() => !document.querySelector('[data-el=loading-bar]').hidden);
    await p.locator('#chat-list li').first().click();
    await h.wait(300);
    check('loading bar visible when opening', await bar());
    await h.wait(1300);
    check('gone as soon as the history is there', !(await bar()) && (await p.locator('[data-el=messages] .bubble').count()) === 1);

    // the relay restarts (1012): reconnect right away, briefly "Relay is restarting …"
    const before = h.sent.filter((f) => f.type === 'auth').length;
    await p.evaluate(() => window.__ws.onclose({ code: 1012 }));
    check('status "Relay is restarting …"', (await p.locator('#agent-status span').textContent()).includes('Relay is restarting'));
    await h.wait(1500);
    check('after 1012 signed in again within 1.5 s', h.sent.filter((f) => f.type === 'auth').length === before + 1);

    // sleep hint: does not flash up while the machine list is missing; comes with an empty list
    const s = await start({ agentsLater: true, path: '?chat=pdf' });
    await s.wait(300);
    const hint = () => s.page.evaluate(() => document.querySelector('[data-el=sleep]').hidden ? '' : document.querySelector('[data-el=sleep-text]').textContent);
    check('no sleep hint before the machine list', (await hint()) === '', await hint());
    await s.push({ type: 'agents', online: [] });
    await s.wait(150);
    check('with an empty list: "no machine is awake"', (await hint()).includes('no machine is awake'), await hint());
}
