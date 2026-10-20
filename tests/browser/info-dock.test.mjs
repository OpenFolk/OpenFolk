// Bot info on a wide screen: a column of its own next to the chat, without a backdrop; the chat stays usable,
// Escape in the input field does not close it. Narrow: an overlay as before.
import { bot } from './harness.mjs';

const columns = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.app')).gridTemplateColumns.split(' ').length);

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna')] });
    const p = h.page;
    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    await h.openChat('PDF');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('wide: info docks as a third column', await p.isVisible('#info-panel') && await p.evaluate(() => document.querySelector('.app').classList.contains('info-docked')) && (await columns(p)) === 3);
    check('no backdrop', await p.evaluate(() => getComputedStyle(document.getElementById('info')).position === 'static'));
    const box = await p.locator('#info-panel').boundingBox();
    check('the panel stands at the right edge', box && Math.round(box.x + box.width) === 1900 && box.width >= 398 && box.width <= 400, box);
    await p.fill('[data-el=text]', 'Still typing');
    await p.press('[data-el=text]', 'Enter');
    await h.wait(200);
    check('the chat stays usable next to it', h.sent.some((f) => f.type === 'send' && f.chatId === 'pdf' && f.text === 'Still typing'));
    await p.press('[data-el=text]', 'Escape');
    await h.wait(100);
    check('Escape in the chat does not close the docked panel', await p.isVisible('#info-panel'));
    check('only one pane fits next to the panel at 1900 px: no + strip', !(await p.isVisible('#pane-add')));
    await p.click('#info [data-close]');
    await h.wait(200);
    check('closing gives the width back', !(await p.isVisible('#info-panel')) && (await columns(p)) === 2 && await p.isVisible('#pane-add'));

    await p.setViewportSize({ width: 1100, height: 900 });
    await h.wait(200);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('narrower than chat and panel: an overlay as before', await p.isVisible('#info-panel') && await p.evaluate(() => !document.querySelector('.app').classList.contains('info-docked') && getComputedStyle(document.getElementById('info')).position === 'fixed'));
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('Escape closes the overlay', !(await p.isVisible('#info-panel')));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
