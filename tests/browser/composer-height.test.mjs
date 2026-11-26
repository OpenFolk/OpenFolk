// The input field keeps the height of one line when empty, also when its height was measured while it was hidden
// (during a recording, in a parked pane): it was squeezed to a sliver with the placeholder cut off.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('anna', 'Anna'), bot('bert', 'Bert')] });
    const p = h.page;
    await h.openChat('Anna');
    const height = () => p.evaluate(() => Math.round(document.querySelector('.pane:not([hidden]) [data-el=text]').getBoundingClientRect().height));
    const normal = await height();
    check('an empty field: one line', normal >= 30, normal);
    // measured while hidden, as during a recording
    await p.evaluate(() => { const f = document.querySelector('.pane:not([hidden]) [data-el=text]'); f.hidden = true; f.dispatchEvent(new Event('input', { bubbles: true })); f.hidden = false; });
    await h.wait(100);
    check('measured while hidden: still one line', (await height()) === normal, [await height(), normal]);
    await p.fill('.pane:not([hidden]) [data-el=text]', 'one\ntwo\nthree');
    await h.wait(100);
    check('three lines: taller', (await height()) > normal);
    await p.fill('.pane:not([hidden]) [data-el=text]', '');
    await h.wait(100);
    check('emptied again: one line', (await height()) === normal, await height());
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
