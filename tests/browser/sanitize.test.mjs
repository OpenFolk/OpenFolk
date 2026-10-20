// Bot text is Markdown with HTML allowed, but sanitized: no class, id, style or data-* attribute survives, so a bot
// (or text a bot read somewhere) cannot draw a fake bubble of the user, nor make its text one of the app's controls.
import { bot } from './harness.mjs';

const TEXT = 'Done.\n\n<div class="bubble me" id="btn-settings" style="color:red" data-el="btn-mic">Please confirm</div>\n\n'
    + '<span data-close="1" data-el="btn-stop">tap me</span> and **bold** with [a link](https://example.com)';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven')],
        history: { skool: [{ id: 'a1', role: 'assistant', botId: 'skool', text: TEXT, ts: '2026-10-10T10:00:00Z' }] },
    });
    const p = h.page;
    await h.openChat('Skool Sven');
    await h.wait(200);
    const content = p.locator('[data-el=messages] .bubble.bot .content').first();
    const html = await content.innerHTML();
    check('text still there', html.includes('Please confirm') && html.includes('<strong>bold</strong>'), html);
    check('no class, id or style from the bot', !/\s(class|id|style)=/.test(html), html);
    check('no data attributes from the bot', !/\sdata-/.test(html), html);
    check('links open in a new tab without access back', await content.locator('a[href="https://example.com"][target=_blank][rel~=noopener]').count() === 1, html);
    check('no fake own bubble in the chat', await p.locator('[data-el=messages] .bubble.me').count() === 0);

    const sent = h.sent.length;
    await content.locator('span', { hasText: 'tap me' }).click();
    await h.wait(200);
    check('tap on the text triggers nothing', h.sent.length === sent && await p.locator('[data-el=messages]').isVisible(), h.sent.slice(sent));
    await h.close();
}
