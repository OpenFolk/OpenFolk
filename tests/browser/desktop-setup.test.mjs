// The desktop app's setup page (desktop/setup.html, setup.js), built like the web app's sign-in: the invitation link
// first, then the QR code, the server URL with a password and "on this computer"; a question before this computer is
// left without a backend of its own, and every text of the page in both languages of desktop/main.js.
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
    const serverWords = texts.filter((l) => /^\s+(setup\w+|https|unreachable|too_old): /.test(l) && /\b[Ss]erver\b/.test(l.replace(/Relay-Server|[Rr]elay server|“[^”]*”|„[^“]*“/g, "")));
    check('setup page: where the relay is meant the texts say relay server', serverWords.length === 0, serverWords);

    const browser = await chromium.launch();
    try {
        const open = async (mode, answer = {}) => {
            const context = await browser.newContext({ bypassCSP: true });
            await context.addInitScript(`
                window.__calls = [];
                window.openfolkDesktop = {
                    info: async () => ({ mode: ${JSON.stringify(mode)}, language: 'en', version: '0.0.0', texts: { setupHint: 'OpenFolk {version}', invalidAddress: 'Please enter a server URL.', setupInviteEmpty: 'Paste the link you were sent.', foldersSetupHint: 'Hint {default}', foldersDefault: 'Own folder {default}', foldersDefaultTag: 'default', foldersAdd: 'Add folder …', foldersRemove: 'Remove', foldersLastRemoved: '{default} applies.', foldersWide: '{folder} is very wide.', foldersEnvWarn: 'ALLOWED_ROOTS ({value})' } }),
                    saveAddress: async (url) => { window.__calls.push(url); return ${JSON.stringify(answer)}; },
                    chooseLocal: async () => ({}), joinServer: async (link) => { window.__joined.push(link); return {}; },
                    qrJoinStart: async (url) => { window.__qr.push(url); return {}; },
                    qrJoinStop: async () => { window.__qr.push('stop'); },
                    onQrJoin: (handler) => { window.__qrEvent = handler; },
                };
                window.__qr = []; window.__joined = [];`);
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
        const order = await p.$$eval('#choice > *', (n) => n.filter((x) => x.id).map((x) => x.id));
        check('setup page: the invitation link first, then the QR code, the password and this computer', order.join() === 'join-form,relay-confirm,qr-form,qr-box,password-way,local-way', order);
        check('setup page: the cursor waits in the invitation field', await p.evaluate(() => document.activeElement?.id === 'join'));
        check('setup page: no lettered ways and no glossary any more', !(await p.$('.badge')) && !(await p.$('.terms')));
        const filled = await p.$$eval('button', (n) => n.filter((x) => x.offsetParent && getComputedStyle(x).backgroundColor !== 'rgba(0, 0, 0, 0)').map((x) => x.textContent));
        check('setup page: only "Continue" of the invitation has the filled button', filled.length === 1 && filled[0] === (await p.textContent('#join-form button')), filled);
        check('setup page: the server URL with a password is folded away', !(await shown('#form')));

        // The invitation field: whatever was sent goes to the main process, which tells the links apart
        await p.click('#join-form button');
        check('setup page: an empty invitation field says what to paste', (await p.textContent('#join-error')) === 'Paste the link you were sent.' && (await p.evaluate(() => window.__joined)).length === 0);
        await p.fill('#join', ' https://relay.example.test/#setup=abc&e2e=key ');
        await p.click('#join-form button');
        check('setup page: a link goes to the main process as it is', JSON.stringify(await p.evaluate(() => window.__joined)) === '["https://relay.example.test/#setup=abc&e2e=key"]');

        // B by QR code: the phone scans what the main process draws (desktop/qr-join.js)
        await p.click('#qr-form button');
        check('setup page: QR code: an empty address is refused', (await p.textContent('#qr-error')) === 'Please enter a server URL.' && (await p.evaluate(() => window.__qr)).length === 0);
        await p.fill('#qr-relay', 'openfolk.example.test');
        await p.click('#qr-form button');
        check('setup page: QR code: asks the main process with the address', JSON.stringify(await p.evaluate(() => window.__qr)) === '["openfolk.example.test"]');
        await p.evaluate(() => window.__qrEvent({ state: 'code', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1h-1z"/></svg>' }));
        check('setup page: QR code: shown instead of the form, with a hint', await shown('#qr-code svg') && !(await shown('#qr-form')) && (await p.textContent('#qr-hint')).length > 0);
        await p.evaluate(() => window.__qrEvent({ state: 'error', reason: 'closed', message: 'x' }));
        check('setup page: QR code: a failure brings the form back with the reason', !(await shown('#qr-box')) && await shown('#qr-form') && (await p.textContent('#qr-error')) === 'x');
        await p.click('#qr-form button');
        await p.evaluate(() => window.__qrEvent({ state: 'code', svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
        await p.click('#qr-cancel');
        check('setup page: QR code: "Cancel" drops the request and brings the form back', (await p.evaluate(() => window.__qr)).at(-1) === 'stop' && await shown('#qr-form') && !(await shown('#qr-box')));

        // The card of the web app's sign-in: at most 400 px wide, nothing sticking out in a narrow window
        await p.setViewportSize({ width: 1600, height: 900 });
        const card = await p.$eval('main', (n) => Math.round(n.getBoundingClientRect().width));
        check('setup page: one card like the sign-in, at most 400 px wide', card === 400, card);
        await p.setViewportSize({ width: 360, height: 900 });
        check('setup page: nothing sticks out sideways when narrow', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
        await p.setViewportSize({ width: 1280, height: 720 });
        await p.click('#password-way summary');
        check('setup page: unfolded, the server way warns that no backend runs here', await shown('#form') && (await p.textContent('#password-way .warn')).includes('no backend on this computer'));

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
        await s.page.click('#password-way summary');
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
        check('setup page: on the server way, the page opens with that way unfolded', await s.page.isVisible('#form'));
        await s.context.close();

        // On this computer: an invitation into an account leaves it without bots, so the page asks first
        s = await open('local');
        await s.page.fill('#join', 'https://relay.example.test/#pair=tok&e2e=key');
        await s.page.click('#join-form button');
        check('setup page: an invitation on a computer with its own backend asks first', await s.page.isVisible('#relay-confirm') && (await s.page.evaluate(() => window.__joined)).length === 0 && await s.page.isDisabled('#join'));
        await s.page.click('#relay-confirm-yes');
        await s.page.waitForFunction(() => window.__joined.length > 0);
        check('setup page: after "Yes" the invitation goes to the main process', JSON.stringify(await s.page.evaluate(() => window.__joined)) === '["https://relay.example.test/#pair=tok&e2e=key"]' && !(await s.page.isVisible('#relay-confirm')));
        await s.page.fill('#join', 'https://relay.example.test/#setup=abc&e2e=key');
        await s.page.click('#join-form button');
        check('setup page: a setup link is not asked here (the main process asks)', (await s.page.evaluate(() => window.__joined)).length === 2 && !(await s.page.isVisible('#relay-confirm')));
        await s.context.close();
    } finally {
        await browser.close();
    }
}
