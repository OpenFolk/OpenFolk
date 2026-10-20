// Status line while working (word, running time, no emoji star), stop there instead of next to send, "Waiting for you".
export default async function ({ start, check }) {
    const h = await start({ history: { pdf: [{ id: 'a', role: 'user', from: 'me', text: 'Build the feature', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' }] } });
    const p = h.page;
    const line = () => p.evaluate(() => { const a = document.querySelector('[data-el=working]'); return a.hidden ? '' : a.textContent.replace(/\s+/g, ' ').trim(); });
    const state = (s) => h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: s, chatId: s === 'idle' ? undefined : 'pdf', activity: 'thinking' });
    await h.openChat('PDF');
    check('free: no line', (await line()) === '');
    await state('thinking');
    await h.wait(200);
    const a = await line();
    check('working: star, word, running time and stop', /^[·✢✶✻✽]\p{L}+ … \(0 s\) Stop$/u.test(a), a);
    check('no emoji star (✳ has an emoji variant)', !/✳/.test(a));
    await h.wait(3900);
    const b = await line();
    check('the word changes, the time runs', b.split(' … ')[0] !== a.split(' … ')[0] && b.includes('(4 s)'), [a, b]);
    check('no stop button in the input field', (await p.locator('[data-el=composer] [data-el=btn-stop]').count()) === 0);
    await p.click('[data-el=btn-stop]');
    check('stop sends the interrupt', h.sent.some((f) => f.type === 'interrupt' && f.chatId === 'pdf'));
    await state('waiting');
    await h.wait(150);
    check('waiting for approval: "Waiting for you" with stop', (await line()) === 'Waiting for you Stop', await line());
    await state('idle');
    await h.wait(150);
    check('done: no line', (await line()) === '');
}
