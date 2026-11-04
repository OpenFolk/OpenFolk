// Opening a chat leaves the input field alone, also on a wide screen: typing starts with a tap into it.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader'), bot('cloud', 'Cloud Carlo')] });
    const p = h.page;
    await p.setViewportSize({ width: 1200, height: 860 });
    await h.wait(200);
    const focused = () => p.evaluate(() => document.activeElement && document.activeElement.dataset.el === 'text');
    await h.openChat('PDF');
    check('wide screen: opening a chat does not focus the input field', !(await focused()));
    await h.openChat('Cloud Carlo');
    check('… nor switching to another chat', !(await focused()));
}
