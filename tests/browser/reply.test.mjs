// Replying to a message: "Reply" in the ⋯ menu, quote above the input field, goes out with the message,
// stands at the top of the bubble and jumps to the original message.
const history = {
    pdf: Array.from({ length: 12 }, (_, i) => i % 2
        ? { id: 'a' + i, role: 'assistant', botId: 'pdf', text: i === 1 ? 'The **build** is green, 42 tests passed.' : `Answer ${i} `.repeat(10), ts: `2026-10-08T05:${10 + i}:00Z` }
        : { id: 'u' + i, role: 'user', from: 'me', text: `Question ${i}`, ts: `2026-10-08T05:${10 + i}:00Z`, readAt: `2026-10-08T05:${10 + i}:30Z` }),
};

export default async function ({ start, check }) {
    const h = await start({ history });
    const p = h.page;
    await h.openChat('PDF');
    await p.evaluate(() => document.querySelector('.bubble[data-eid="a1"]').scrollIntoView({ block: 'center' }));
    await p.click('.bubble[data-eid="a1"] .more');
    check('"Reply" is in the ⋯ menu', (await p.locator('#message-menu button').first().textContent()) === 'Reply');
    await p.locator('#message-menu button', { hasText: 'Reply' }).click();
    const bar = () => p.evaluate(() => document.querySelector('[data-el=reply-bar]').hidden ? '' : `${document.querySelector('[data-el=rb-who]').textContent} | ${document.querySelector('[data-el=rb-text]').textContent}`);
    check('quote above the input field, without Markdown', (await bar()) === 'PDF-Reader | The build is green, 42 tests passed.', await bar());
    await p.click('[data-el=rb-cancel]');
    check('× cancels', (await bar()) === '');

    await p.click('.bubble[data-eid="a1"] .more');
    await p.locator('#message-menu button', { hasText: 'Reply' }).click();
    await p.fill('[data-el=text]', 'Then deploy please');
    await p.evaluate(() => document.querySelector('[data-el=composer]').requestSubmit());
    await h.wait(100);
    const send = h.sent.find((f) => f.type === 'send');
    check('quote goes out with the message', send && send.replyTo && send.replyTo.id === 'a1' && send.replyTo.from === 'pdf' && send.replyTo.text.startsWith('The build is green'), send);
    check('after sending the bar is gone', (await bar()) === '');

    // this is how the message comes back from the backend
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'new', role: 'user', from: 'me', text: 'Then deploy please', ts: new Date().toISOString(), replyTo: send.replyTo } });
    await h.wait(150);
    check('quote at the top of the own bubble', (await p.locator('.bubble[data-eid="new"] .quote').textContent()).startsWith('PDF-ReaderThe build is green'));
    await p.click('.bubble[data-eid="new"] .quote');
    await h.wait(400);
    check('tapping the quote jumps to the original message', await p.evaluate(() => { const b = document.querySelector('.bubble[data-eid="a1"]'); const r = b.getBoundingClientRect(); return b.classList.contains('highlighted') && r.top > 0 && r.bottom < innerHeight; }));
    await p.click('.bubble[data-eid="a1"] .more');
    await p.locator('#message-menu button', { hasText: 'Reply' }).click();
    await p.click('[data-el=btn-back]');
    await h.openChat('PDF');
    check('switching chats discards the quote', (await bar()) === '');
}
