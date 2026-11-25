// The favorite tiles move like the list: a bot that works or waits jumps to the front, finished ones with something
// unread come next, the rest after them, each newest message first.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: ['anna', 'bert', 'cleo'].map((id) => bot(id, id[0].toUpperCase() + id.slice(1), { favorite: true })),
        history: {
            anna: [{ id: 'a1', role: 'assistant', botId: 'anna', text: 'Old', ts: '2026-10-10T08:00:00Z' }],
            bert: [{ id: 'b1', role: 'assistant', botId: 'bert', text: 'Middle', ts: '2026-10-10T09:00:00Z' }],
            cleo: [{ id: 'c1', role: 'assistant', botId: 'cleo', text: 'New', ts: '2026-10-10T10:00:00Z' }],
        },
    });
    const p = h.page;
    const tiles = () => p.locator('#chat-list .fav-tile .fav-name').allTextContents();
    const order = async () => (await tiles()).join(' ');
    await h.wait(200);
    check('nothing runs: newest message first', (await order()) === 'Cleo Bert Anna', await order());
    await h.push({ type: 'state', machine: 'desk', botId: 'anna', state: 'thinking', chatId: 'anna' });
    await h.wait(150);
    check('Anna works: in front', (await order()) === 'Anna Cleo Bert', await order());
    await h.push({ type: 'state', machine: 'desk', botId: 'bert', state: 'waiting', chatId: 'bert' });
    await h.wait(150);
    check('Bert waits for you: in front too', (await order()).split(' ').slice(0, 2).sort().join(' ') === 'Anna Bert', await order());
    await h.push({ type: 'state', machine: 'desk', botId: 'anna', state: 'idle' });
    await h.push({ type: 'state', machine: 'desk', botId: 'bert', state: 'idle' });
    await h.push({ type: 'done', machine: 'desk', chatId: 'anna', botId: 'anna', entry: { id: 'a2', role: 'assistant', botId: 'anna', text: 'Done', ts: new Date().toISOString() } });
    await h.wait(200);
    check('Anna done with a new answer: in front of the rest', (await order()).startsWith('Anna'), await order());
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
