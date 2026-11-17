// The favorites strip at the top: a tap on a bot goes where something waits for the user, which may be one of its
// conversations (finished and unread, or asking), otherwise its main chat.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('anna', 'Anna', { favorite: true, conversations: [{ id: 'aa11', title: 'Release', createdAt: '' }, { id: 'bb22', title: 'Docs', createdAt: '' }] })],
    });
    const p = h.page;
    const opened = () => p.evaluate(() => activePane().chatId);
    const tap = async () => {
        await p.locator('.fav-tile[data-chat="anna"]').click();
        await h.wait(250);
    };
    const leave = async () => { await p.evaluate(() => closeChat()); await h.wait(150); };

    check('the bot is in the favorites strip', await p.isVisible('.fav-tile[data-chat="anna"]'));
    await tap();
    check('nothing waits: the main chat', (await opened()) === 'anna', await opened());
    await leave();

    // Both conversations finished with something new; the newer one wins
    await p.evaluate(() => {
        const old = new Date(Date.now() - 60_000).toISOString();
        const now = new Date().toISOString();
        state.incoming['anna~aa11'] = old;
        state.lastTs['anna~aa11'] = old;
        state.incoming['anna~bb22'] = now;
        state.lastTs['anna~bb22'] = now;
        renderChatList();
    });
    await tap();
    check('a finished conversation with something new: the tap opens it', (await opened()) === 'anna~bb22', await opened());
    await leave();

    // An open question beats everything
    await h.push({ type: 'approval', machine: 'desk', approval: { id: 'q1', botId: 'anna', chatId: 'anna~aa11', tool: 'Bash', summary: 'rm -rf build', ts: new Date().toISOString() } });
    await h.wait(150);
    await tap();
    check('an open question: the tap opens that conversation', (await opened()) === 'anna~aa11', await opened());
    check('no page errors', h.errors.length === 0, h.errors);
}
