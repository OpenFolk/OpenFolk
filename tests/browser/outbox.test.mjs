// A message to a bot stays in the app until its machine stored it: meanwhile "Sending …" in the chat, after a reconnect
// it goes again with the same cid, the machine's answer (the stored entry) ends it, and a copy of that answer shows once.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('bruno', 'Bruno')] });
    const p = h.page;
    await h.openChat('Bruno');
    await p.fill('.pane:not([hidden]) [data-el=text]', 'Here are the photos');
    await p.click('.pane:not([hidden]) [data-el=btn-send]');
    await h.wait(200);
    const sends = () => h.sent.filter((f) => f.type === 'send');
    const cid = sends()[0]?.cid;
    const waiting = () => p.evaluate(() => [...document.querySelectorAll('.pane:not([hidden]) .bubble.outbox')].map((b) => b.textContent));
    check('sent with a cid, "Sending …" in the chat until the machine stored it', typeof cid === 'string' && cid.length > 8 && (await waiting()).join() === 'Here are the photosSending …', [cid, await waiting()]);

    // the relay restarted: the machines come back, the message goes again with the same cid
    await h.push({ type: 'agents', online: ['desk'] });
    await h.wait(200);
    check('after a reconnect it goes again, same cid', sends().length === 2 && sends()[1].cid === cid && sends()[1].text === 'Here are the photos', sends().map((f) => f.cid));

    const entry = { id: 'e1', role: 'user', from: 'me', text: 'Here are the photos', cid, ts: new Date().toISOString() };
    await h.push({ type: 'user', machine: 'desk', chatId: 'bruno', entry });
    await h.push({ type: 'user', machine: 'desk', chatId: 'bruno', entry });
    await h.wait(200);
    const shown = await p.evaluate(() => [...document.querySelectorAll('.pane:not([hidden]) .messages .bubble.me')].map((b) => b.querySelector('.text')?.textContent));
    check('stored: "Sending …" gone, the message once in the chat', (await waiting()).length === 0 && shown.filter((x) => x === 'Here are the photos').length === 1, shown);
    await h.push({ type: 'agents', online: ['desk'] });
    await h.wait(150);
    check('nothing goes again once stored', sends().length === 2);

    // An error of the machine for the chat ends the attempts too (it answered)
    await p.fill('.pane:not([hidden]) [data-el=text]', 'Second');
    await p.click('.pane:not([hidden]) [data-el=btn-send]');
    await h.wait(100);
    await h.push({ type: 'error', machine: 'desk', chatId: 'bruno', message: 'Bot not found' });
    await h.wait(150);
    check('an error for the chat: no more attempts', (await waiting()).length === 0);
    // photos on their way show as their previews
    await p.setInputFiles('.pane:not([hidden]) [data-el=file-input]', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await h.wait(400);
    await p.click('.pane:not([hidden]) [data-el=btn-send]');
    await h.wait(200);
    check('photos on their way: their previews in the "Sending …" bubble', await p.evaluate(() => document.querySelectorAll('.pane:not([hidden]) .bubble.outbox .outbox-thumbs img').length === 1));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
