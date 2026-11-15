// Forwarding a message: "Forward" in the ⋯ menu, a page with the chats, the chosen chat opens with the message above
// its input field, goes out with or without words of its own, stands in the bubble and leads back to its chat.
import { bot } from './harness.mjs';

const answer = 'Deploy plan:\n1. build\n2. push the **image**';
const history = {
    pdf: [
        { id: 'u1', role: 'user', from: 'me', text: 'How do we deploy?', ts: '2026-10-08T05:10:00Z', readAt: '2026-10-08T05:10:30Z' },
        { id: 'a1', role: 'assistant', botId: 'pdf', text: answer, ts: '2026-10-08T05:11:00Z' },
    ],
};

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader'), bot('cloud', 'Cloud Carlo', { conversations: [{ id: 'aa11', title: 'Webstore release', createdAt: '' }] })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['pdf', 'cloud'] }],
        history,
    });
    const p = h.page;
    await h.openChat('PDF');
    await p.click('.bubble[data-eid="a1"] .more');
    check('"Forward" is in the ⋯ menu', await p.locator('#message-menu button', { hasText: 'Forward' }).count() === 1);
    await p.locator('#message-menu button', { hasText: 'Forward' }).click();
    await h.wait(100);
    const targets = () => p.locator('#forward-list button > span').allTextContents();
    check('the page lists the other chats, not the one the message is in', (await targets()).sort().join('|') === 'Cloud Carlo|Cloud Carlo · Webstore release|Team', await targets());
    await p.fill('#forward-search', 'web');
    check('the search narrows the list', (await targets()).join('|') === 'Cloud Carlo · Webstore release', await targets());
    await p.fill('#forward-search', '');
    await p.locator('#forward-list button', { has: p.locator('span', { hasText: /^Cloud Carlo$/ }) }).click();
    await h.wait(200);
    check('the page closes', await p.evaluate(() => document.getElementById('forward').hidden));
    const head = await p.evaluate(() => document.querySelector('.pane:not([hidden]) [data-el=chat-name]').textContent);
    check('the chosen chat opens', head.startsWith('Cloud Carlo'), head);
    const bar = () => p.evaluate(() => { const r = document.querySelector('.pane:not([hidden]) [data-el=reply-bar]'); return r.hidden ? '' : `${r.querySelector('[data-el=rb-who]').textContent} | ${r.querySelector('[data-el=rb-text]').textContent}`; });
    check('the message above the input field, marked as forwarded', (await bar()) === `Forwarded · PDF-Reader | ${answer}`, await bar());
    check('send button instead of the microphone, without text', await p.evaluate(() => !document.querySelector('.pane:not([hidden]) [data-el=btn-send]').hidden));
    await p.click('.pane:not([hidden]) [data-el=reply-bar] .quote');
    check('a tap on the bar above the input shows the whole text', await p.evaluate(() => document.querySelector('.pane:not([hidden]) [data-el=reply-bar]').classList.contains('open')));

    await p.fill('.pane:not([hidden]) [data-el=text]', 'Please take this over');
    await p.evaluate(() => document.querySelector('.pane:not([hidden]) [data-el=composer]').requestSubmit());
    await h.wait(100);
    let send = h.sent.findLast((f) => f.type === 'send');
    const q = send && send.replyTo;
    check('goes to the chosen chat with the own words', send && send.chatId === 'cloud' && send.text === 'Please take this over', send);
    check('the whole message along, with origin', q && q.forwarded === true && q.id === 'a1' && q.from === 'pdf' && q.text === answer && q.origin === 'PDF-Reader' && q.originChat === 'pdf', q);
    check('after sending the bar is gone', (await bar()) === '');

    // how the message comes back from the backend
    await h.push({ type: 'user', chatId: 'cloud', entry: { id: 'f1', role: 'user', from: 'me', text: 'Please take this over', ts: new Date().toISOString(), replyTo: q } });
    await h.wait(150);
    const quote = await p.locator('.bubble[data-eid="f1"] .quote').textContent();
    check('the bubble shows the forward with sender and origin', quote.startsWith('Forwarded · PDF-Reader') && quote.includes('1. build') && quote.endsWith('from PDF-Reader'), quote);
    const lines = () => p.evaluate(() => { const s = document.querySelector('.bubble[data-eid="f1"] .quote span'); return Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight || '18')); });
    await p.click('.bubble[data-eid="f1"] .quote strong');
    await h.wait(150);
    const name = () => p.evaluate(() => document.querySelector('.pane:not([hidden]) [data-el=chat-name]').textContent);
    check('a tap on the forward opens its whole text in place', await p.evaluate(() => document.querySelector('.bubble[data-eid="f1"] .quote').classList.contains('open')) && (await name()).startsWith('Cloud Carlo'), await name());
    check('the whole text shows, all lines', (await lines()) >= 3, await lines());
    await p.click('.bubble[data-eid="f1"] .quote strong');
    check('a second tap closes it again', !(await p.evaluate(() => document.querySelector('.bubble[data-eid="f1"] .quote').classList.contains('open'))));
    await p.click('.bubble[data-eid="f1"] .quote-origin');
    await h.wait(400);
    check('the origin line opens the chat it came from', (await name()).startsWith('PDF-Reader'), await name());

    // without words of its own
    await p.click('.bubble[data-eid="a1"] .more');
    await p.locator('#message-menu button', { hasText: 'Forward' }).click();
    await p.locator('#forward-list button', { hasText: 'Team' }).click();
    await h.wait(200);
    await p.evaluate(() => document.querySelector('.pane:not([hidden]) [data-el=composer]').requestSubmit());
    await h.wait(100);
    send = h.sent.findLast((f) => f.type === 'send');
    check('a forward goes out without own words', send && send.chatId === 'g:team' && send.text === '' && send.replyTo && send.replyTo.forwarded === true, send);
}
