// Links in messages: no system long-press preview (iOS loaded the target page for it and the app went down, e.g. with a
// card scanner link); "Copy link" in the message's ⋯ menu instead, only for messages with links.
import fs from 'node:fs';

const history = {
    pdf: [
        { id: 'a1', role: 'assistant', botId: 'pdf', text: 'Scan the card here: [card scan](https://scan.example.com/card?id=7)', ts: '2026-10-08T05:10:00Z' },
        { id: 'a2', role: 'assistant', botId: 'pdf', text: 'No link in here.', ts: '2026-10-08T05:11:00Z' },
    ],
};

export default async function ({ start, check }) {
    const h = await start({ history });
    const p = h.page;
    // The test page has no clipboard of its own: catch what goes there
    await p.evaluate(() => { window.copied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (x) => { window.copied = x; return Promise.resolve(); } } }); });
    const menu = () => p.evaluate(() => document.getElementById('message-menu').hidden ? '' : [...document.querySelectorAll('#message-menu button')].map((b) => b.textContent).join('|'));
    await h.openChat('PDF');
    await h.wait(200);

    // Only WebKit knows the property, Chromium drops it from the page's styles: the rule is read from the file
    const css = fs.readFileSync(new URL('../../webapp/chat.css', import.meta.url), 'utf8');
    check('a link in a message: no system long-press preview', css.includes('.messages a { -webkit-touch-callout: none; }'));

    await p.click('.bubble[data-eid="a1"] .more');
    check('the menu of a message with a link offers "Copy link"', (await menu()).endsWith('Copy|Copy link|Forward|Report'), await menu());
    await p.locator('#message-menu button', { hasText: 'Copy link' }).click();
    await h.wait(150);
    const copied = await p.evaluate(() => window.copied);
    check('… which copies the address', copied === 'https://scan.example.com/card?id=7', copied);

    await p.click('.bubble[data-eid="a2"] .more');
    check('a message without links: no such entry', !(await menu()).includes('Copy link'), await menu());
    check('no page errors', h.errors.length === 0, h.errors);
}
