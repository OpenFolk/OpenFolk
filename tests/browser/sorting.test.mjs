// Overview sorted by the last message (for a bot its conversations count too), time of the last message per row.
// The page's clock is fixed at noon: run near midnight, "two minutes ago" would be yesterday and the days off by one.
import { bot } from './harness.mjs';

const NOW = new Date(2026, 10, 4, 12, 0, 0);

export default async function ({ start, check }) {
    const ago = (days, minutes = 0) => new Date(NOW.getTime() - days * 864e5 - minutes * 6e4).toISOString();
    const answer = (id, ts) => [{ id: 'a-' + id + ts, role: 'assistant', botId: id.split('~')[0], text: 'Answer', ts }];
    const h = await start({
        now: NOW,
        bots: [bot('anna', 'Anna', { conversations: [{ id: 'u1', title: 'Old', createdAt: '' }, { id: 'u2', title: 'New', createdAt: '' }] }),
            bot('bert', 'Bert'), bot('carl', 'Carl'), bot('dora', 'Dora')],
        history: {
            anna: answer('anna', ago(30)),
            'anna~u1': answer('anna~u1', ago(3)),
            'anna~u2': answer('anna~u2', ago(0, 2)),
            bert: answer('bert', ago(1)),
            dora: answer('dora', ago(30)),
        },
    });
    const p = h.page;
    const rows = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li[data-chat]')].map((l) => {
        const z = l.querySelector('.time');
        return `${l.classList.contains('sub') ? '↳' : ''}${l.querySelector('.name').firstChild.textContent.trim()}${z ? ' ' + z.textContent : ''}`;
    }));
    // Formatted in the page, in its time zone, as the list does it
    const clock = (ts) => p.evaluate((t) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), ts);
    const day = await p.evaluate((t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short' }), ago(3));
    const date = await p.evaluate((t) => new Date(t).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' }), ago(30));
    const z = await rows();
    check('bot with the newest conversation on top, conversations newest first, without a message at the end',
        z.join('|') === `Anna ${await clock(ago(0, 2))}|↳New ${await clock(ago(0, 2))}|↳Old ${day}|Bert Yesterday|Dora ${date}|Carl`, z);

    // After the page's start, so it counts as unread (seen._since)
    const fresh = new Date(NOW.getTime() + 60e3).toISOString();
    await h.push({ type: 'done', chatId: 'carl', botId: 'carl', entry: { id: 'c1', role: 'assistant', botId: 'carl', text: 'Fresh', ts: fresh }, durationMs: 1 });
    await h.wait(150);
    const n = await rows();
    check('new answer: Carl moves to the top, with the time', n[0] === `Carl ${await clock(fresh)}`, n);
    check('unread: time highlighted', await p.evaluate(() => document.querySelector('#chat-list li[data-chat="carl"]').classList.contains('unread')
        && getComputedStyle(document.querySelector('#chat-list li[data-chat="carl"] .time')).fontWeight === '600'));
}
