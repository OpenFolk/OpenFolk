// The backend empties the queue (stop, new session), but the bot keeps working: the discarded messages
// leave the queue right away and stand in the history, instead of waiting as ghosts.
const history = { pdf: [{ id: 'u1', role: 'user', from: 'me', text: 'First question', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' }] };

export default async function ({ start, check }) {
    const h = await start({
        history, states: { pdf: 'thinking' }, activeChats: { pdf: 'pdf' }, activity: { pdf: 'thinking' },
        live: { pdf: [{ botId: 'pdf', text: 'I am working …', tools: [] }] },
    });
    const p = h.page;
    const texts = () => p.locator('[data-el=queue-list] .queue-text').allTextContents();
    await h.openChat('PDF');
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u2', role: 'user', from: 'me', text: 'Second question', ts: '2026-10-08T05:01:00Z' } });
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u3', role: 'user', from: 'me', text: 'Third question', ts: '2026-10-08T05:02:00Z' } });
    await h.wait(150);
    await p.click('[data-el=queue-head]');
    check('two messages wait', (await texts()).length === 2, await texts());
    await h.push({ type: 'discarded', chatId: 'pdf', entryIds: ['u2'], ts: '2026-10-08T05:03:00Z' });
    await h.wait(150);
    check('the discarded one leaves the queue although the bot still works', (await texts()).join('|') === 'Third question', await texts());
    const bubble = p.locator('[data-el=messages] .bubble[data-id="u2"]');
    check('the discarded one stands in the history, with a grey tick', (await bubble.count()) === 1 && (await bubble.locator('.read-ticks.read').count()) === 0);
}
