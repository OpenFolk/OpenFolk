// The chat list: running or waiting bots at the very top, finished ones with something unread below them, then the rest.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('anna', 'Anna'), bot('bert', 'Bert'), bot('cleo', 'Cleo')] });
    const p = h.page;
    const sections = () => p.evaluate(() => [...document.querySelectorAll('#chat-list > li:not(.fav-strip)')].map((l) => l.classList.contains('section') ? `[${l.textContent}]` : l.querySelector('.name').firstChild.textContent.trim()).join(' '));
    await h.push({ type: 'done', machine: 'desk', chatId: 'bert', botId: 'bert', entry: { id: 'b1', role: 'assistant', botId: 'bert', text: 'Finished', ts: new Date().toISOString() } });
    await h.push({ type: 'state', machine: 'desk', botId: 'anna', state: 'thinking', chatId: 'anna' });
    await h.wait(200);
    check('running first, then finished and unread, then the rest', (await sections()) === '[Running now] Anna [Done, unread] Bert [All] Cleo', await sections());
    await h.push({ type: 'state', machine: 'desk', botId: 'cleo', state: 'waiting', chatId: 'cleo' });
    await h.wait(150);
    check('waiting for you counts as running', (await sections()).startsWith('[Running now] ') && (await sections()).includes('[Done, unread] Bert'), await sections());
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
