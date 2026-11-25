// The sidebar's search on a desktop has the same chips as on the phone: messages, bots, files and routines.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('cloud', 'Cloud Carlo')],
        context: { viewport: { width: 1400, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
    });
    const p = h.page;
    await p.setViewportSize({ width: 1400, height: 900 });
    await h.wait(200);
    await p.click('#search');
    await h.wait(300);
    const chips = await p.evaluate(() => [...document.querySelectorAll('#search-filters .chip')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.textContent));
    check('desktop: chips for messages, bots, files and routines', chips.join('|') === 'Messages|Bots|Files|Routines', chips);
    const inside = await p.evaluate(() => { const b = document.getElementById('search-box').getBoundingClientRect(); const f = document.getElementById('search-filters').getBoundingClientRect(); return f.bottom <= b.bottom + 1 && f.top >= b.top; });
    check('desktop: the chips fit into the search box', inside);
    await p.click('#search-filters [data-filter=bots]');
    await p.fill('#search', 'sv');
    await h.wait(400);
    const hits = await p.evaluate(() => [...document.querySelectorAll('#search-results li')].map((l) => l.querySelector('.s-head')?.firstChild?.textContent ?? l.textContent));
    check('desktop, bots: found by name without the backend', hits.join('|') === 'Skool Sven' && !h.sent.some((f) => f.type === 'search'), hits);
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
