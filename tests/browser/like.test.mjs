// Likes in a person chat: the menu of the other person's message offers "Like", the heart appears once the backend
// stored it (frame "liked"), "Unlike" takes it away; a like of the other person shows on one's own message; a history
// that carries likes shows them; own messages and bot chats offer no like.
import { bot } from './harness.mjs';

const people = [{ id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'admins' }];

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('anna', 'Anna')],
        history: {
            anna: [{ id: 'a1', role: 'assistant', botId: 'anna', text: 'Done.', ts: '2026-11-05T09:00:05Z' }],
            'p:kunde': [
                { id: 'k1', role: 'user', from: 'person:kunde', text: 'The invoice is paid', ts: '2026-11-05T09:00:00Z' },
                { id: 'm1', role: 'user', from: 'me', text: 'Thanks a lot', ts: '2026-11-05T09:01:00Z' },
                { id: 'k2', role: 'user', from: 'person:kunde', text: 'See you', ts: '2026-11-05T09:02:00Z', like: { on: true, at: '2026-11-05T09:03:00Z' } },
            ],
        },
        onSend: async (f, push, z, reply) => {
            if (f.type === 'auth' || f.type === 'people') await reply({ type: 'people', machine: 'desk', list: people, chats: [{ id: 'kunde', updatedAt: '2026-11-05T09:00:00Z' }] });
            if (f.type === 'like') await push({ type: 'liked', machine: 'desk', chatId: f.chatId, entryId: f.entryId, on: f.on });
        },
    });
    const p = h.page;
    await h.openChat('Kunde Müller');
    await h.wait(200);
    const heart = (id) => p.evaluate((i) => {
        const b = document.querySelector(`.bubble[data-eid="${i}"]`);
        const m = b && b.querySelector('.like-mark');
        return m ? m.title : b ? '' : null;
    }, id);
    const menu = async (id) => {
        await p.click(`.bubble[data-eid="${id}"] .more`);
        return p.locator('#message-menu button').allTextContents();
    };
    const close = () => p.evaluate(() => { document.getElementById('message-menu').hidden = true; });

    check('a like from the history shows as a heart', (await heart('k2')) === 'You like this', await heart('k2'));
    check('no heart on a message nobody liked', (await heart('k1')) === '' && (await heart('m1')) === '');

    const theirs = await menu('k1');
    check('the other person\'s message offers "Like"', theirs.includes('Like') && !theirs.includes('Unlike'), theirs);
    await p.locator('#message-menu button', { hasText: /^Like$/ }).click();
    await h.wait(200);
    const sent = h.sent.find((f) => f.type === 'like');
    check('the like goes to the backend', sent && sent.chatId === 'p:kunde' && sent.entryId === 'k1' && sent.on === true, sent);
    check('the heart appears on the message', (await heart('k1')) === 'You like this', await heart('k1'));
    const mark = await p.evaluate(() => {
        const m = document.querySelector('.bubble[data-eid="k1"] .like-mark');
        const b = m.parentElement.getBoundingClientRect(), r = m.getBoundingClientRect();
        const next = document.querySelector('.bubble[data-eid="m1"]').getBoundingClientRect();
        return { onEdge: r.top < b.bottom && r.bottom > b.bottom, clear: r.bottom <= next.top, size: r.width };
    });
    check('it sits on the bubble\'s lower edge without covering the next message', mark.onEdge && mark.clear && mark.size > 15, mark);

    const liked = await menu('k1');
    check('a liked message offers "Unlike"', liked.includes('Unlike') && !liked.includes('Like'), liked);
    await p.locator('#message-menu button', { hasText: 'Unlike' }).click();
    await h.wait(200);
    check('taking it back goes to the backend and removes the heart', h.sent.findLast((f) => f.type === 'like').on === false && (await heart('k1')) === '');

    const mine = await menu('m1');
    check('one\'s own message offers no like', !mine.includes('Like'), mine);
    await close();
    await h.push({ type: 'liked', machine: 'desk', chatId: 'p:kunde', entryId: 'm1', on: true });
    await h.wait(200);
    check('the other person\'s like shows on one\'s own message, with their name', (await heart('m1')) === 'Kunde Müller likes this', await heart('m1'));
    await h.push({ type: 'liked', machine: 'desk', chatId: 'p:kunde', entryId: 'm1', on: false });
    await h.wait(200);
    check('… and goes when they take it back', (await heart('m1')) === '');

    await p.click('[data-el=btn-back]');
    await h.openChat('Anna');
    await h.wait(200);
    const bots = await menu('a1');
    check('a bot\'s answer offers no like', bots.length > 0 && !bots.includes('Like'), bots);
}
