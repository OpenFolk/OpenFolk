// The desktop app's setup page (desktop/setup.html, setup.js): the three ways explained, a question before this
// computer is left without a backend of its own, and every text of the page in both languages of desktop/main.js.
// The page runs without Electron here; a stand-in for the bridge of preload.js records what the page asks for.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = pathToFileURL(path.join(ROOT, 'desktop', 'setup.html')).href;

/** The keys of the text blocks of desktop/main.js (TEXTS: en first, then de). */
function textKeys() {
    const lines = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').split('\n');
    const en = lines.findIndex((l) => l === '    en: {');
    const de = lines.findIndex((l) => l === '    de: {');
    const keys = (from, to) => new Set(lines.slice(from, to).flatMap((l) => { const m = /^\s{8}(\w+): /.exec(l); return m ? [m[1]] : []; }));
    return { en: keys(en, de), de: keys(de, lines.length), blocks: en >= 0 && de > en ? 2 : 0 };
}

export default async function ({ check }) {
    const html = fs.readFileSync(path.join(ROOT, 'desktop', 'setup.html'), 'utf8');
    const used = [...html.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]);
    const { en, de, blocks } = textKeys();
    check('setup page: every text exists in English and in German', blocks === 2 && used.every((k) => en.has(k) && de.has(k)),
        used.filter((k) => !en.has(k) || !de.has(k)));

    const texts = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').split('\n');
    const stale = texts.filter((l) => /setup\w+: /.test(l) && /\b(use|nimm stattdessen|usually|meist) [123]\b|\b[123] (or|oder) [123]\b/.test(l));
    check('setup page: the texts point at letters, not at numbers', stale.length === 0, stale);
    const all = texts.join('\n');
    check('setup page: the texts name the ways A, B and C', /usually A or B/.test(all) && /use C instead/.test(all) && /meist A oder B/.test(all) && /nimm stattdessen C/.test(all));
    const serverWords = texts.filter((l) => /^\s+(setup\w+|https|unreachable|too_old): /.test(l) && /\b[Ss]erver\b/.test(l.replace(/Relay-Server|[Rr]elay server|“[^”]*”|„[^“]*“/g, "")));
    check('setup page: where the relay is meant the texts say relay server', serverWords.length === 0, serverWords);

    const browser = await chromium.launch();
    try {
        const open = async (mode, answer = {}) => {
            const context = await browser.newContext({ bypassCSP: true });
            await context.addInitScript(`
                window.__calls = [];
                window.openfolkDesktop = {
                    info: async () => ({ mode: ${JSON.stringify(mode)}, language: 'en', version: '0.0.0', texts: { setupHint: 'OpenFolk {version}', invalidAddress: 'Please enter a server URL.' } }),
                    saveAddress: async (url) => { window.__calls.push(url); return ${JSON.stringify(answer)}; },
                    chooseLocal: async () => ({}), joinServer: async () => ({}),
                };`);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(PAGE);
            await page.waitForFunction(() => document.getElementById('info').textContent !== '');
            return { page, context, errors, calls: () => page.evaluate(() => window.__calls) };
        };

        // First start: nothing chosen yet
        let s = await open('');
        const p = s.page;
        const shown = (sel) => p.isVisible(sel);
        check('setup page: says which way fits where bots should work', (await p.textContent('.where')).includes('A or B'));
        const badges = await p.$$eval('.option .badge', (n) => n.map((x) => x.textContent));
        check('setup page: the three ways are lettered A, B, C', badges.join() === 'A,B,C', badges);
        const order = await p.$$eval('.option', (n) => n.map((x) => (x.querySelector('#local') ? 'local' : x.querySelector('#join-form') ? 'join' : x.querySelector('#form') ? 'relay' : '?')));
        check('setup page: order is this computer, this computer plus relay server, display only', order.join() === 'local,join,relay', order);

        // The words, folded away until asked for
        check('setup page: the explanation of the words is folded at first', (await p.isVisible('.terms summary')) && !(await p.isVisible('.terms dl')));
        await p.click('.terms summary');
        const terms = await p.$$eval('.terms dt', (n) => n.map((x) => x.textContent));
        check('setup page: unfolded it explains bot, backend and relay server', (await p.isVisible('.terms dl')) && terms.join() === 'Bot,Backend,Relay server', terms);
        await p.click('.terms summary');

        const fills = await p.$$eval('.option > button, .option form > button', (n) => n.map((x) => getComputedStyle(x).backgroundColor !== 'rgba(0, 0, 0, 0)'));
        check('setup page: only A, "Start on this computer", has the filled button; B and C are outlined', fills.join() === 'true,false,false', fills);

        // Alternatives, not steps: always one below the other, each as wide as the page allows (at most 820 px)
        const tops = () => p.$$eval('.option', (n) => n.map((x) => { const r = x.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width) }; }));
        await p.setViewportSize({ width: 1600, height: 900 });
        let boxes = await tops();
        const page = await p.$eval('main', (n) => Math.round(n.getBoundingClientRect().width));
        check('setup page: in a wide window the ways stand one below the other, not side by side', boxes.every((b) => b.x === boxes[0].x) && new Set(boxes.map((b) => b.y)).size === 3, boxes);
        check('setup page: every way uses the full width of the page, which stops at 820 px', page === 820 && boxes.every((b) => b.width === boxes[0].width && b.width >= page - 2 * 28 - 1), { page, boxes });
        await p.setViewportSize({ width: 520, height: 900 });
        boxes = await tops();
        check('setup page: in a narrow window they stand one below the other as well', boxes.every((b) => b.x === boxes[0].x) && new Set(boxes.map((b) => b.y)).size === 3, boxes);
        check('setup page: nothing sticks out sideways when narrow', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
        await p.setViewportSize({ width: 1280, height: 720 });
        check('setup page: the server way warns that no backend runs here', await shown('#form') && (await p.textContent('.option .warn')).includes('no backend on this computer'));

        await p.click('#form button');
        check('setup page: an empty address is refused without asking', (await p.textContent('#error')) === 'Please enter a server URL.' && !(await shown('#relay-confirm')) && (await s.calls()).length === 0);

        await p.fill('#url', 'https://openfolk.example.test');
        await p.click('#form button');
        check('setup page: connecting asks first; nothing is saved yet', await shown('#relay-confirm') && (await s.calls()).length === 0);
        check('setup page: the question names the consequence, the button says it', (await p.textContent('#relay-confirm .warn')).includes('no bots run on this computer')
            && (await p.textContent('#relay-confirm-yes')) === 'Yes, no bots run on this computer');
        check('setup page: while asking, the address cannot change and "Connect" is out of the way', await p.isDisabled('#url') && !(await shown('#form button')));

        await p.click('#relay-confirm-no');
        check('setup page: "Back" returns to the form, nothing saved', !(await shown('#relay-confirm')) && await p.isEnabled('#url') && await shown('#form button') && (await s.calls()).length === 0);

        await p.click('#form button');
        await p.click('#relay-confirm-yes');
        check('setup page: after "Yes" the address is saved, once', JSON.stringify(await s.calls()) === '["https://openfolk.example.test"]', await s.calls());
        check('setup page: no script errors', s.errors.length === 0, s.errors);
        await s.context.close();

        // A refused address: back at the form with the reason
        s = await open('', { error: 'The server needs HTTPS.' });
        await s.page.fill('#url', 'http://x.test');
        await s.page.click('#form button');
        await s.page.click('#relay-confirm-yes');
        await s.page.waitForFunction(() => document.getElementById('error').textContent !== '');
        check('setup page: a refused address shows the reason in the form', (await s.page.textContent('#error')) === 'The server needs HTTPS.' && !(await s.page.isVisible('#relay-confirm')) && await s.page.isEnabled('#url'));
        await s.context.close();

        // Already connected to a server: changing the address changes nothing for the backend, so no question
        s = await open('relay');
        await s.page.fill('#url', 'https://other.example.test');
        await s.page.click('#form button');
        await s.page.waitForFunction(() => window.__calls.length > 0);
        check('setup page: from the server way to another address: saved at once', !(await s.page.isVisible('#relay-confirm')) && (await s.calls())[0] === 'https://other.example.test');
        await s.context.close();
    } finally {
        await browser.close();
    }
}
