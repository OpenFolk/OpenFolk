// What is typed and not sent stays with its chat as a draft: switching chats empties the field for the other chat,
// coming back brings the text again, the list shows "Draft: …" for the chat not open, sending clears it, a reload keeps it.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('anna', 'Anna', { conversations: [{ id: 'aa11', title: 'Side', createdAt: '' }] }), bot('bert', 'Bert')] });
    const p = h.page;
    const field = () => p.inputValue('.pane:not([hidden]) [data-el=text]');
    const row = (id) => p.evaluate((id) => document.querySelector(`#chat-list li[data-chat="${id}"] .last`)?.textContent ?? '', id);
    await p.evaluate(() => openChat('anna'));
    await h.wait(200);
    await p.fill('.pane:not([hidden]) [data-el=text]', 'Half a thought');
    await p.evaluate(() => openChat('bert'));
    await h.wait(200);
    check('another chat: the field is empty', (await field()) === '', await field());
    check('the list shows the draft of the chat left', (await row('anna')) === 'Draft: Half a thought', await row('anna'));
    await p.evaluate(() => openChat('anna~aa11'));
    await h.wait(200);
    check('a conversation of the same bot: empty as well', (await field()) === '');
    await p.evaluate(() => openChat('anna'));
    await h.wait(200);
    check('back: the draft is in the field again', (await field()) === 'Half a thought', await field());
    await p.click('.pane:not([hidden]) [data-el=btn-send]');
    await h.wait(200);
    await p.evaluate(() => openChat('bert'));
    await h.wait(200);
    check('sent: no draft any more', !(await row('anna')).startsWith('Draft') && h.sent.some((f) => f.type === 'send' && f.text === 'Half a thought'), await row('anna'));
    await p.fill('.pane:not([hidden]) [data-el=text]', 'For later');
    await p.evaluate(() => openChat('anna'));
    await h.wait(200);
    await p.reload();
    await h.wait(800);
    await p.evaluate(() => openChat('bert'));
    await h.wait(300);
    check('after a reload the draft is still there', (await field()) === 'For later', await field());
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
