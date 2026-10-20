// Overview sorted by the last message (for a bot its conversations count too), time of the last message per row.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const ago = (days, minutes = 0) => new Date(Date.now() - days * 864e5 - minutes * 6e4).toISOString();
    const answer = (id, ts) => [{ id: 'a-' + id + ts, role: 'assistant', botId: id.split('~')[0], text: 'Answer', ts }];
    const h = await start({
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
    const clock = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const day = new Date(ago(3)).toLocaleDateString('en-US', { weekday: 'short' });
    const date = new Date(ago(30)).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const z = await rows();
    check('bot with the newest conversation on top, conversations newest first, without a message at the end',
        z.join('|') === `Anna ${clock(ago(0, 2))}|↳New ${clock(ago(0, 2))}|↳Old ${day}|Bert Yesterday|Dora ${date}|Carl`, z);

    await h.push({ type: 'done', chatId: 'carl', botId: 'carl', entry: { id: 'c1', role: 'assistant', botId: 'carl', text: 'Fresh', ts: new Date().toISOString() }, durationMs: 1 });
    await h.wait(150);
    const n = await rows();
    check('new answer: Carl moves to the top, with the time', n[0] === `Carl ${clock(new Date().toISOString())}`, n);
    check('unread: time highlighted', await p.evaluate(() => document.querySelector('#chat-list li[data-chat="carl"]').classList.contains('unread')
        && getComputedStyle(document.querySelector('#chat-list li[data-chat="carl"] .time')).fontWeight === '600'));
}
