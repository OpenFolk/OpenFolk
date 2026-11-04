// The colour of the own messages: green by default, chosen in the settings among a few colours (the orange of the logo with
// white text is a deliberate exception to the contrast rule below), kept per device in the browser's storage only (nothing
// goes to the backend), readable in light and dark.
import { bot } from './harness.mjs';

const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader')] });
    const p = h.page;
    const mine = () => p.evaluate(() => {
        const probe = document.createElement('div');
        probe.className = 'bubble me';
        probe.innerHTML = '<span class="time">11:46</span><button class="more">⋯</button>';
        document.body.append(probe);
        const s = getComputedStyle(probe);
        const r = { bg: s.backgroundColor, text: s.color, time: getComputedStyle(probe.querySelector('.time')).color, more: getComputedStyle(probe.querySelector('.more')).color };
        probe.remove();
        return r;
    });
    const first = await mine();
    check('default is the green with the text colour of the theme', first.bg === 'rgb(217, 253, 211)' && first.text !== 'rgb(255, 255, 255)' && first.time !== 'rgb(255, 255, 255)', first);

    await p.click('[data-tab=settings]');
    await h.wait(100);
    const names = await p.$$eval('#settings-bubble .swatch', (n) => n.map((x) => x.dataset.bubble));
    check('eight colours to choose from, the default first and marked', names.length === 8 && names[0] === 'green' && (await p.getAttribute('#settings-bubble [data-bubble=green]', 'aria-checked')) === 'true', names);
    const sentBefore = h.sent.length;

    const seen = {};
    for (const name of names) {
        await p.click(`#settings-bubble [data-bubble=${name}]`);
        await h.wait(50);
        seen[name] = {};
        for (const theme of ['light', 'dark']) {
            await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
            const c = await mine();
            seen[name][theme] = { bg: c.bg, ratio: Number(contrast(parse(c.bg), parse(c.text)).toFixed(1)), time: Number(contrast(parse(c.bg), parse(c.time)).toFixed(1)) };
        }
    }
    // The orange of the logo (#d97757) with white text reaches about 3.1:1 and stays on purpose: it is the brand colour of the
    // accent and the microphone button. Every other colour, the darker orange included, keeps 4.5:1.
    const limit = (name) => (name === 'logo' ? 3 : 4.5);
    const weak = Object.entries(seen).flatMap(([n, v]) => Object.entries(v).filter(([, x]) => x.ratio < limit(n) || (n.includes('orange') || n === 'logo') && x.time < limit(n)).map(([t, x]) => `${n}/${t}: ${x.ratio}/${x.time}`));
    check('text on every colour readable in light and dark (4.5 and more, the logo orange 3 and more), time and dots white on the oranges as well', weak.length === 0, weak.length ? weak : seen);
    check('the logo orange is the same in light and dark', seen.logo.light.bg === seen.logo.dark.bg && seen.logo.light.bg === 'rgb(217, 119, 87)' && seen.orangedark.light.bg === 'rgb(184, 90, 58)', seen);
    check('every colour differs from the others, in light and in dark', new Set(Object.values(seen).map((v) => v.light.bg)).size === 8 && new Set(Object.values(seen).map((v) => v.dark.bg)).size === 8, seen);

    await p.click('#settings-bubble [data-bubble=blue]');
    await h.wait(50);
    check('choice kept in the browser only', await p.evaluate(() => localStorage.getItem('openfolk-bubble') === 'blue' && document.documentElement.dataset.bubble === 'blue'));
    check('nothing sent to a backend', h.sent.length === sentBefore || h.sent.slice(sentBefore).every((f) => !JSON.stringify(f).includes('blue')), h.sent.slice(sentBefore));
    check('the chosen swatch is marked', (await p.getAttribute('#settings-bubble [data-bubble=blue]', 'aria-checked')) === 'true' && (await p.getAttribute('#settings-bubble [data-bubble=green]', 'aria-checked')) === 'false');

    await p.reload();
    await h.wait(500);
    check('applied again after a reload, before the app starts', await p.evaluate(() => document.documentElement.dataset.bubble === 'blue'));

    await p.evaluate(() => localStorage.setItem('openfolk-bubble', 'nonsense'));
    await p.reload();
    await h.wait(500);
    check('an unknown name falls back to the default colour', (await mine()).bg === 'rgb(217, 253, 211)');
    await h.close();
}
