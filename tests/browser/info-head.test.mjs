// The bot's page keeps its head (back arrow or cross, avatar, name, edit and close buttons) at the top while the
// rest scrolls; the head's pencil opens the same editor as "Edit bot" in the page's menu. On the phone and docked on a PC.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader')] });
    const p = h.page;
    const geometry = () => p.evaluate(() => {
        const panel = document.getElementById('info-panel');
        const top = (e) => Math.round(e.getBoundingClientRect().top - panel.getBoundingClientRect().top);
        const last = [...panel.children].findLast((e) => e.getClientRects().length);
        return { scrolls: panel.scrollHeight > panel.clientHeight + 50, scrollTop: panel.scrollTop, head: top(panel.querySelector('.panel-top')), name: top(panel.querySelector('#info-name')), end: top(last) };
    });
    const scrolledDown = async () => {
        await p.evaluate(() => { const panel = document.getElementById('info-panel'); panel.scrollTop = panel.scrollHeight; });
        await h.wait(100);
        return geometry();
    };

    for (const [label, size] of [['phone', { width: 400, height: 500 }], ['PC', { width: 1900, height: 500 }]]) {
        await p.setViewportSize(size);
        await h.wait(200);
        await h.openChat('PDF');
        await p.click('[data-el=chat-title]');
        await h.wait(200);
        await p.evaluate(() => { document.getElementById('info-panel').scrollTop = 0; });
        await h.wait(50);
        const before = await geometry();
        check(`${label}: the page is longer than the screen`, before.scrolls, before);
        const after = await scrolledDown();
        check(`${label}: scrolled down, the head stays at the top`, after.scrollTop > 0 && after.head === 0 && await p.isVisible('#info-name') && await p.isVisible('#info-avatar'), after);
        check(`${label}: the content moved under it`, after.end < before.end, [before, after]);
        check(`${label}: pencil with tooltip in the head`, await p.isVisible('#info-edit-top') && (await p.getAttribute('#info-edit-top', 'aria-label')) === 'Edit bot' && (await p.getAttribute('#info-edit-top', 'title')) === 'Edit bot');
        await p.click('#info-edit-top');
        await h.wait(200);
        check(`${label}: the pencil opens the editor of this bot`, await p.isVisible('#editor') && (await p.inputValue('#editor-name')) === 'PDF-Reader');
        await p.locator('#editor [data-close], #editor [data-page-back]').locator('visible=true').first().click();
        await h.wait(200);
        if (await p.isVisible('#info')) await p.keyboard.press('Escape');
        await h.wait(100);
    }
    await h.close();
}
