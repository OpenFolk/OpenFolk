// Old messages that were never marked as read or discarded (stopped before the mark, restart of the backend):
// if the bot has already read a later one, they no longer wait and stand in the history, instead of showing up as
// ghosts in the queue every time the bot works.
const history = {
    pdf: [
        { id: 'a1', role: 'user', from: 'me', text: 'Old question one', ts: '2026-10-08T05:00:00Z' },
        { id: 'a2', role: 'user', from: 'me', text: 'Old question two', ts: '2026-10-08T05:01:00Z' },
        { id: 'b1', role: 'assistant', botId: 'pdf', text: 'Stopped', ts: '2026-10-08T05:02:00Z' },
        { id: 'n1', role: 'user', from: 'me', text: 'New job', ts: '2026-10-08T05:05:00Z', readAt: '2026-10-08T05:05:00Z' },
    ],
};

export default async function ({ start, check }) {
    const h = await start({
        history, states: { pdf: 'thinking' }, activeChats: { pdf: 'pdf' }, activity: { pdf: 'thinking' },
        live: { pdf: [{ botId: 'pdf', text: 'I am working …', tools: [] }] },
    });
    const p = h.page;
    await h.openChat('PDF');
    await h.wait(150);
    check('overtaken messages are not in the queue', await p.evaluate(() => document.querySelector('[data-el=queue]').hidden));
    const old = p.locator('[data-el=messages] .bubble[data-id="a1"], [data-el=messages] .bubble[data-id="a2"]');
    check('overtaken ones stand in the history, with a grey tick', (await old.count()) === 2 && (await old.locator('.read-ticks.read').count()) === 0);
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'n2', role: 'user', from: 'me', text: 'Sent later', ts: '2026-10-08T05:06:00Z' } });
    await h.wait(150);
    await p.click('[data-el=queue-head]');
    const texts = await p.locator('[data-el=queue-list] .queue-text').allTextContents();
    check('a new message waits as usual, only it', texts.join('|') === 'Sent later', texts);
}
