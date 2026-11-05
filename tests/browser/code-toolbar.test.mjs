// Code blocks in answers have a bar of their own above the code: the language on the left, "copy this block" and "wrap
// lines" on the right. The bar stays in view while the block is, copying takes only this block, lines wrap by default
// and the choice is remembered. The message menu's "Copy" still copies the whole message.
import { bot } from './harness.mjs';

const LONG = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
const TEXT = 'Two blocks:\n\n```js\nconst answer = 42;\n```\n\n```\nplain text without a language that goes on and on and on and on and on and on and on and on and on and on\n```\n\nAnd a tall one:\n\n```python\n' + LONG + '\n```';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        history: { pdf: [{ id: 'a1', role: 'assistant', botId: 'pdf', text: TEXT, ts: '2026-10-10T10:00:00Z' }] },
        before: () => {
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { (window.__copied ||= []).push(text); } } });
        },
    });
    const p = h.page;
    await h.openChat('PDF-Reader');
    await h.wait(300);
    const blocks = p.locator('[data-el=messages] .code-block');
    check('a bar above each of the three blocks', (await blocks.count()) === 3);
    const langs = await p.locator('.code-block .code-lang').allTextContents();
    check('language on the left, none when none is given', JSON.stringify(langs) === '["js","","python"]', langs);
    await p.evaluate(() => { document.querySelector('[data-el=messages]').scrollTop = 0; });
    await h.wait(100);
    const layout = await p.evaluate(() => [...document.querySelectorAll('.code-block')].map((b) => {
        const bar = b.querySelector('.code-bar').getBoundingClientRect();
        const pre = b.querySelector('pre').getBoundingClientRect();
        const buttons = [...b.querySelectorAll('.code-button')].map((k) => k.getBoundingClientRect());
        return { barAbove: Math.round(bar.bottom) <= Math.round(pre.top) + 1, buttonsRight: buttons.every((k) => k.left > bar.left + bar.width / 2), noneInPre: !b.querySelector('pre .code-button') };
    }));
    check('the bar is a strip above the code, buttons on the right, nothing inside the code', layout.every((l) => l.barAbove && l.buttonsRight && l.noneInPre), layout);

    // copy: only this block
    await blocks.nth(0).locator('.code-button').first().click();
    await blocks.nth(1).locator('.code-button').first().click();
    const copied = await p.evaluate(() => window.__copied);
    check('copy takes only the code of its own block', copied.length === 2 && copied[0].trim() === 'const answer = 42;' && copied[1].startsWith('plain text without') && !copied[1].includes('const'), copied);
    check('a check mark confirms, then the icon returns', (await blocks.nth(1).locator('.code-button').first().getAttribute('aria-label')) === 'Copied');
    await h.wait(1700);
    check('back to "Copy code"', (await blocks.nth(1).locator('.code-button').first().getAttribute('aria-label')) === 'Copy code');

    // wrap
    const ws = () => p.evaluate(() => [...document.querySelectorAll('.code-block > pre')].map((pre) => getComputedStyle(pre).whiteSpace));
    const scrolls = () => p.evaluate(() => { const pre = document.querySelectorAll('.code-block > pre')[1]; return pre.scrollWidth > pre.clientWidth; });
    check('lines wrap by default, no sideways scrolling', JSON.stringify(await ws()) === '["pre-wrap","pre-wrap","pre-wrap"]' && !(await scrolls()), await ws());
    await blocks.nth(1).locator('.code-wrap').click();
    check('the switch scrolls sideways instead, for every block', JSON.stringify(await ws()) === '["pre","pre","pre"]' && (await scrolls()), await ws());
    check('pressed state and the choice are kept', (await blocks.nth(0).locator('.code-wrap').getAttribute('aria-pressed')) === 'false' && (await p.evaluate(() => localStorage.getItem('openfolk-code-wrap'))) === 'off');
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('PDF-Reader');
    await h.wait(300);
    check('drawn again: the choice holds', JSON.stringify(await ws()) === '["pre","pre","pre"]');
    await blocks.nth(0).locator('.code-wrap').click();
    check('back to wrapping', (await ws())[0] === 'pre-wrap' && (await p.evaluate(() => localStorage.getItem('openfolk-code-wrap'))) === 'on');

    // sticky: scrolled into the tall block, its bar is still at the top of the messages
    const sticky = await p.evaluate(() => {
        const messages = document.querySelector('[data-el=messages]');
        const block = document.querySelectorAll('.code-block')[2];
        messages.scrollTop = messages.scrollTop + block.getBoundingClientRect().top - messages.getBoundingClientRect().top + 200;
        return new Promise((resolve) => setTimeout(() => {
            const frame = messages.getBoundingClientRect();
            const bar = block.querySelector('.code-bar').getBoundingClientRect();
            resolve({ blockTop: Math.round(block.getBoundingClientRect().top - frame.top), barTop: Math.round(bar.top - frame.top), barBottom: Math.round(bar.bottom - frame.top), frame: Math.round(frame.height) });
        }, 100));
    });
    check('block scrolled past its top: the bar stays at the top edge', sticky.blockTop < 0 && sticky.barTop >= 0 && sticky.barTop <= 16 && sticky.barBottom > 0, sticky);

    // the message menu still copies the whole message
    await p.evaluate(() => { window.__copied = []; });
    await p.locator('[data-el=messages] .bubble.bot .more').first().click();
    await p.locator('#message-menu button', { hasText: 'Copy' }).click();
    const whole = await p.evaluate(() => window.__copied);
    check('"Copy" in the message menu: the whole message', whole.length === 1 && whole[0] === TEXT, whole.map((x) => x.length));
    await h.close();
}
