// "To new conversation" from the queue: sends the request, the bar empties, a hint opens the conversation.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        history: { pdf: [{ id: 'u1', role: 'user', from: 'me', text: 'Long task', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:01Z' }] },
        states: { pdf: 'thinking' }, activeChats: { pdf: 'pdf' },
        onSend: async (f, push, z) => {
            if (f.type !== 'queue_to_conversation') return;
            z.bots[0].conversations = [{ id: 'cc33', title: 'Quick question on the side', createdAt: '' }];
            z.states['pdf~cc33'] = 'thinking';
            await push({ type: 'bots', machine: 'desk', bots: z.bots, groups: [], states: z.states, activity: {}, activeChats: { pdf: 'pdf', 'pdf~cc33': 'pdf~cc33' }, approvals: [] });
            await push({ type: 'moved', chatId: f.chatId, entryId: f.entryId, to: 'pdf~cc33' });
        },
    });
    await h.openChat('PDF');
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u2', role: 'user', from: 'me', text: 'Quick question on the side', ts: '2026-10-08T05:01:00Z' } });
    await h.wait(150);
    await h.page.click('[data-el=queue-head]');
    check('button hidden on the phone (swiping there)', (await h.page.locator('.queue-parallel').count()) === 1 && !(await h.page.locator('.queue-parallel').isVisible()));
    const z = await h.page.evaluate(() => { const r = document.querySelector('[data-el=queue-list] li').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; });
    await h.swipe(z.x, z.y, z.x + 60, z.y, 6, 20);
    await h.wait(300);
    check('briefly to the right: springs back, chat stays open, no request', !h.sent.some((f) => f.type === 'queue_to_conversation') && await h.page.evaluate(() => document.getElementById('app').classList.contains('chat-open')));
    await h.swipe(z.x, z.y, z.x + 160, z.y, 10, 20);
    await h.wait(400);
    const request = h.sent.find((f) => f.type === 'queue_to_conversation');
    check('request with chatId and entry to the bot\'s machine', request && request.chatId === 'pdf' && request.entryId === 'u2' && request.machine === 'desk', request);
    check('queue empty', await h.page.evaluate(() => document.querySelector('[data-el=queue]').hidden));
    check('hint in the history', (await h.page.locator('.event.moved').textContent()).includes('Quick question on the side'));
    await h.page.click('.event.moved');
    await h.wait(300);
    check('the hint opens the conversation', (await h.page.evaluate(() => new URL(location.href).searchParams.get('chat'))) === 'pdf~cc33');
}
