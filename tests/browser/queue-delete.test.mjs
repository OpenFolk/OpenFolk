// Delete a waiting message: swipe to the left (briefly springs back, far deletes); request to the backend, the confirmation removes it.
const history = { pdf: [{ id: 'u1', role: 'user', from: 'me', text: 'First question', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' }] };

export default async function ({ start, check }) {
    const h = await start({
        history, states: { pdf: 'thinking' }, activeChats: { pdf: 'pdf' }, activity: { pdf: 'thinking' },
        live: { pdf: [{ botId: 'pdf', text: 'I am working …', tools: [] }] },
        onSend: async (f, push) => {
            if (f.type === 'queue_delete') await push({ type: 'deleted', chatId: f.chatId, entryId: f.entryId });
        },
    });
    const p = h.page;
    const texts = () => p.locator('[data-el=queue-list] .queue-text').allTextContents();
    await h.openChat('PDF');
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u2', role: 'user', from: 'me', text: 'Second question', ts: '2026-10-08T05:01:00Z' } });
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u3', role: 'user', from: 'me', text: 'Third question', ts: '2026-10-08T05:02:00Z' } });
    await h.wait(150);
    await p.click('[data-el=queue-head]');
    check('delete button hidden on the phone (swiping there)', !(await p.locator('[data-el=queue-list] .queue-delete').first().isVisible()));
    const row = async (text) => p.evaluate((t) => { const r = [...document.querySelectorAll('[data-el=queue-list] li')].find((l) => l.textContent.includes(t)).getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + r.height / 2 }; }, text);
    let z = await row('Second question');
    await h.swipe(z.x, z.y, z.x - 50, z.y, 6, 20);
    await h.wait(300);
    check('swiped briefly: stays, no request', (await texts()).length === 2 && !h.sent.some((f) => f.type === 'queue_delete'), await texts());
    z = await row('Second question');
    await h.swipe(z.x, z.y, z.x - 160, z.y, 10, 20);
    await h.wait(300);
    const request = h.sent.find((f) => f.type === 'queue_delete');
    check('swiped far: request with chat and message to the bot\'s machine', request && request.chatId === 'pdf' && request.entryId === 'u2' && request.machine === 'desk', request);
    check('deleted: only the third left in the queue', (await texts()).join('|') === 'Third question' && (await p.locator('[data-el=queue-head]').textContent()).includes('1 message'), await texts());
    check('no red strip left behind', (await p.locator('.swipe-delete').count()) === 0);
    // the bot is done: the deleted one does not move into the history, the third does
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'idle' });
    await h.push({ type: 'done', chatId: 'pdf', botId: 'pdf', entry: { id: 'a1', role: 'assistant', botId: 'pdf', text: 'Answer', ts: '2026-10-08T05:03:00Z' }, durationMs: 1 });
    await h.wait(1500);
    const inHistory = await p.evaluate(() => document.querySelector('[data-el=messages]').textContent);
    check('the deleted message does not show up in the history', !inHistory.includes('Second question') && inHistory.includes('Third question'));
}
