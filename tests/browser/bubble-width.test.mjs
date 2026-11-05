// Answers of a bot use the whole width of the answer column, however little they say: a single line or only a code
// block is as wide as a long text. Your own messages stay as wide as their content.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        history: { pdf: [
            { id: 'u1', role: 'user', from: 'me', text: 'Hi', ts: '2026-10-10T09:59:00Z' },
            { id: 'a1', role: 'assistant', botId: 'pdf', text: 'Done.', ts: '2026-10-10T10:00:00Z' },
            { id: 'a2', role: 'assistant', botId: 'pdf', text: '```\nnpm test\n```', ts: '2026-10-10T10:01:00Z' },
            { id: 'a3', role: 'assistant', botId: 'pdf', text: 'A long answer. '.repeat(80), ts: '2026-10-10T10:02:00Z' },
        ] },
    });
    const p = h.page;
    await p.setViewportSize({ width: 1100, height: 800 });
    await h.openChat('PDF-Reader');
    await h.wait(300);
    const widths = await p.evaluate(() => [...document.querySelectorAll('[data-el=messages] > .answer, [data-el=messages] > .bubble.me')].map((n) => {
        const b = n.classList.contains('bubble') ? n : n.querySelector('.bubble');
        return { kind: n.classList.contains('bubble') ? 'me' : 'bot', bubble: Math.round(b.getBoundingClientRect().width), column: Math.round(n.getBoundingClientRect().width) };
    }));
    const bots = widths.filter((w) => w.kind === 'bot');
    check('three answers and my message', bots.length === 3 && widths.length === 4, widths);
    check('short answer: as wide as the column', bots[0].bubble === bots[0].column, bots[0]);
    check('code block only: as wide as the column', bots[1].bubble === bots[1].column, bots[1]);
    check('long answer: unchanged, the column', bots[2].bubble === bots[2].column, bots[2]);
    check('all answers equally wide', new Set(bots.map((w) => w.bubble)).size === 1, bots);
    const mine = widths.find((w) => w.kind === 'me');
    check('my short message stays as wide as its content', mine.bubble < 300, mine);
    await h.close();
}
