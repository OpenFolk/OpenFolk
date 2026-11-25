// Jumping into a chat (palette, tab, notification) scrolls the chat list on the left to its row, just far enough;
// a conversation under a folded bot shows the bot's row.
import { bot } from './harness.mjs';

const WIDE = { viewport: { width: 1400, height: 700 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

export default async function ({ start, check }) {
    const bots = Array.from({ length: 40 }, (_, i) => bot(`b${i}`, `Bot ${String(i).padStart(2, '0')}`));
    bots[39].conversations = [{ id: 'aa11', title: 'Side', createdAt: '' }];
    const h = await start({ bots, context: WIDE });
    const p = h.page;
    await h.wait(300);
    const visible = (id) => p.evaluate((id) => {
        const list = document.getElementById('chat-list').getBoundingClientRect();
        const li = document.querySelector(`#chat-list > li[data-chat="${id}"]`);
        if (!li) return null;
        const r = li.getBoundingClientRect();
        return r.top >= list.top - 1 && r.bottom <= list.bottom + 1;
    }, id);
    const last = await p.evaluate(() => [...document.querySelectorAll('#chat-list > li[data-chat]')].at(-1).dataset.chat);
    check('the last row is out of view at first', (await visible(last)) === false, last);
    await p.evaluate((id) => openChat(id), last);
    await h.wait(300);
    check('opening its chat scrolls the list to it', (await visible(last)) === true);
    await p.evaluate(() => { document.getElementById('chat-list').scrollTop = 0; });
    await p.evaluate(() => openChat('b39~aa11'));
    await h.wait(300);
    check('a conversation: its row (or its bot\'s) comes into view', (await visible('b39~aa11')) === true || (await visible('b39')) === true);
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
