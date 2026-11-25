// While a bot works, the composer offers "Afterwards": pressed, the next message goes out with `later` and waits
// behind the running job; otherwise it goes into the job. Not shown while the bot is idle.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader')] });
    const p = h.page;
    await h.openChat('PDF');
    check('idle: no "Afterwards"', await p.isHidden('[data-el=btn-later]'));
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'thinking', chatId: 'pdf' });
    await h.wait(150);
    check('working: "Afterwards" shown, not pressed', await p.isVisible('[data-el=btn-later]') && (await p.getAttribute('[data-el=btn-later]', 'aria-pressed')) === 'false');
    await p.fill('[data-el=text]', 'Also add tests');
    await p.click('[data-el=btn-send]');
    await h.wait(100);
    const first = h.sent.findLast((f) => f.type === 'send');
    check('sent without "later": into the running job', first && first.text === 'Also add tests' && !first.later, first);
    await p.click('[data-el=btn-later]');
    check('pressed', (await p.getAttribute('[data-el=btn-later]', 'aria-pressed')) === 'true');
    await p.fill('[data-el=text]', 'Then deploy');
    await p.click('[data-el=btn-send]');
    await h.wait(100);
    const second = h.sent.findLast((f) => f.type === 'send');
    check('with "Afterwards": later, and the button is released', second && second.text === 'Then deploy' && second.later === true && (await p.getAttribute('[data-el=btn-later]', 'aria-pressed')) === 'false', second);
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'idle' });
    await h.wait(150);
    check('idle again: gone', await p.isHidden('[data-el=btn-later]'));
}
