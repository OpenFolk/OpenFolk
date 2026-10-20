// Dragging a chat from the list with the mouse: onto the + strip it opens in a new pane, onto a pane it replaces
// that pane's chat, and a chat that is open elsewhere swaps places with it. Touch screens have no dragging.
import { bot } from './harness.mjs';

/** Runs in the page before the app: a mouse instead of the harness' touch screen. */
function finePointer() {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(pointer: fine)' ? /** @type {any} */ ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) : original(q));
}

const shown = (page) => page.evaluate(() => window.panes.map((p) => p.chatId).join());

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna'), bot('carl', 'Carl')], before: finePointer });
    const p = h.page;
    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    await h.openChat('PDF');
    await h.wait(300);
    const row = (name) => p.locator('#chat-list li', { hasText: name }).first();
    check('rows can be dragged with a mouse', await row('Anna').getAttribute('draggable') === 'true');

    await row('Anna').dragTo(p.locator('#pane-add'));
    await h.wait(500);
    check('onto the + strip: a new pane', (await shown(p)) === 'pdf,anna', await shown(p));

    await row('Carl').dragTo(p.locator('.pane').nth(0).locator('[data-el=messages]'));
    await h.wait(500);
    check('onto a pane: it replaces that chat', (await shown(p)) === 'carl,anna', await shown(p));

    await row('Anna').dragTo(p.locator('.pane').nth(0).locator('[data-el=messages]'));
    await h.wait(500);
    check('a chat open elsewhere swaps places', (await shown(p)) === 'anna,carl', await shown(p));
    check('the pane it was dropped on is active', await p.evaluate(() => window.activePane() === window.panes[0]));
    check('no drop mark left over', (await p.locator('.drop-target').count()) === 0);
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();

    const phone = await start({ bots: [bot('pdf', 'PDF-Reader')] });
    check('touch screen: rows are not draggable', await phone.page.locator('#chat-list li').first().getAttribute('draggable') !== 'true');
    await phone.close();
}
