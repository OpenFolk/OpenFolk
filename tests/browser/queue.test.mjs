// Messages that arrive while the bot works: collapsed above the input field, they move to the right place when the
// bot starts on them (read), after stopping with a grey tick; "To new conversation".
const history = { pdf: [{ id: 'u1', role: 'user', from: 'me', text: 'First question', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' }] };

export default async function ({ start, check }) {
    const h = await start({
        history, states: { pdf: 'thinking' }, activeChats: { pdf: 'pdf' }, activity: { pdf: 'thinking' },
        live: { pdf: [{ botId: 'pdf', text: 'I am working …', tools: [] }] },
    });
    const look = () => h.page.evaluate(() => ({
        bar: document.querySelector('[data-el=queue]').hidden ? '' : document.querySelector('[data-el=queue-head]').textContent,
        history: [...document.querySelectorAll('[data-el=messages] > *')].map((n) => n.classList.contains('live') ? 'LIVE'
            : n.classList.contains('answer') ? 'BOT:' + n.querySelector('.content').textContent.trim()
                : (n.querySelector('.text') || n).textContent.trim().replace(/\d\d:\d\d.*$/, '') + (n.querySelector('.read-ticks.read') ? ' ✓✓' : n.querySelector('.read-ticks') ? ' ✓' : '')),
    }));
    await h.openChat('PDF');
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u2', role: 'user', from: 'me', text: 'Second question', ts: '2026-10-08T05:01:00Z' } });
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u3', role: 'user', from: 'me', text: 'Third question', ts: '2026-10-08T05:02:00Z' } });
    await h.wait(150);
    let b = await look();
    check('two messages in the bar', b.bar.includes('2 messages in the queue'), b.bar);
    check('not in the history', b.history.join('|') === 'First question ✓✓|LIVE', b.history);
    await h.page.click('[data-el=queue-head]');
    check('expanded with both texts', (await h.page.locator('[data-el=queue-list] .queue-text').allTextContents()).join('|') === 'Second question|Third question');

    // this is how the backend reports: end of job 1, start of job 2
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'idle' });
    await h.push({ type: 'done', chatId: 'pdf', botId: 'pdf', entry: { id: 'a1', role: 'assistant', botId: 'pdf', text: 'Answer one', ts: '2026-10-08T05:03:00Z' }, durationMs: 1 });
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'thinking', chatId: 'pdf' });
    await h.push({ type: 'read', chatId: 'pdf', id: 'u2', ts: '2026-10-08T05:03:01Z' });
    await h.wait(200);
    b = await look();
    check('the started message stands after the previous answer with ✓✓', b.history.join('|') === 'First question ✓✓|BOT:Answer one|Second question ✓✓', b.history);
    check('the bar counts down', b.bar.includes('1 message in the queue'), b.bar);

    // stop: nothing runs any more, the third moves up after a second with a grey tick
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'idle' });
    await h.push({ type: 'done', chatId: 'pdf', botId: 'pdf', entry: { id: 'a2', role: 'assistant', botId: 'pdf', text: 'Answer two', ts: '2026-10-08T05:04:00Z' }, durationMs: 1 });
    await h.wait(200);
    check('right after the end still in the bar', (await look()).bar.includes('1 message'));
    await h.wait(1300);
    b = await look();
    check('after 1 s of quiet in the history with a grey tick', b.history.at(-1) === 'Third question ✓' && b.bar === '', b);
}
