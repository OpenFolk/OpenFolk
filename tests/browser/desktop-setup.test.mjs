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
        const open = async (mode, answer = {}, query = '') => {
            const context = await browser.newContext({ bypassCSP: true });
            await context.addInitScript(`
                window.__calls = [];
                window.openfolkDesktop = {
                    info: async () => ({ mode: ${JSON.stringify(mode)}, url: ${JSON.stringify(mode === 'relay' ? 'https://known.example.test' : '')}, language: 'en', version: '0.0.0', texts: { setupHint: 'OpenFolk {version}', invalidAddress: 'Please enter a server URL.', setupInviteEmpty: 'Paste the link you were sent.', foldersSetupHint: 'Hint {default}', foldersDefault: 'Own folder {default}', foldersDefaultTag: 'default', foldersAdd: 'Add folder …', foldersRemove: 'Remove', foldersLastRemoved: '{default} applies.', foldersWide: '{folder} is very wide.', foldersEnvWarn: 'ALLOWED_ROOTS ({value})', setupAiBrowser: 'The browser shows it.', setupAiFailed: 'Failed: {message}', setupAiCode: 'Enter the code at {url}:', setupAiSignIn: { claude: 'Sign in to Claude', codex: 'Sign in to Codex', copilot: 'Sign in to Copilot' } } }),
                    saveAddress: async (url, password) => { window.__calls.push(url); window.__passwords.push(password); return ${JSON.stringify(answer)}; },
                    chooseLocal: async (list) => { window.__machine.push(['local', list]); return {}; },
                    machineSetup: async (list) => { window.__machine.push(['setup', list]); return window.__machineAnswer || {}; },
                    machineDrop: async () => { window.__machine.push(['drop']); },
                    joinServer: async (link) => { window.__joined.push(link); return window.__joinAnswer || {}; },
                    qrJoinStart: async (url) => { window.__qr.push(url); return {}; },
                    qrJoinStop: async () => { window.__qr.push('stop'); },
                    onQrJoin: (handler) => { window.__qrEvent = handler; },
                    aiStatus: async () => window.__aiStatus,
                    aiLogin: async (engine) => { window.__ai.push(['login', engine]); },
                    onAiState: (handler) => { window.__aiEvent = handler; },
                    aiKey: async (key) => { window.__ai.push(['key', key]); return window.__aiKeyAnswer || {}; },
                    aiTry: async () => { window.__ai.push('try'); return {}; },
                    aiSkip: async () => { window.__ai.push('skip'); },
                    aiCancel: async () => { window.__ai.push('cancel'); },
                };
                window.__qr = []; window.__joined = []; window.__passwords = []; window.__machine = []; window.__ai = [];
                window.__aiStatus = ${JSON.stringify(answer.aiStatus ?? { ok: true, known: true, ready: false })};`);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(PAGE + query);
            await page.waitForFunction(() => document.getElementById('info').textContent !== '');
            return { page, context, errors, calls: () => page.evaluate(() => window.__calls) };
        };

        // First start: nothing chosen yet
        let s = await open('');
        const p = s.page;
        const shown = (sel) => p.isVisible(sel);
        const methods = await p.$$eval('#method option', (n) => n.map((x) => x.value));
        check('setup page: a small wizard: the invitation link, the password, the QR code, this computer', methods.join() === ',invite,password,qr,local', methods);
        check('setup page: nothing but the choice until a method is chosen, the cursor on it', await p.evaluate(() => document.activeElement?.id === 'method')
            && await p.$$eval('#choice input, #choice button', (n) => n.every((x) => !x.offsetParent)));
        check('setup page: no lettered ways and no glossary any more', !(await p.$('.badge')) && !(await p.$('.terms')));
        await p.selectOption('#method', 'invite');
        const filled = await p.$$eval('button', (n) => n.filter((x) => x.offsetParent && getComputedStyle(x).backgroundColor === 'rgb(217, 119, 87)').map((x) => x.textContent));
        check('setup page: the invitation: its field and "Continue", in the orange of the web app', filled.length === 1 && filled[0] === (await p.textContent('#join-form button')) && await shown('#join') && !(await shown('#url')), filled);
        check('setup page: the cursor in the invitation field', await p.evaluate(() => document.activeElement?.id === 'join'));

        // The invitation field: whatever was sent goes to the main process, which tells the links apart
        await p.click('#join-form button');
        check('setup page: an empty invitation field says what to paste', (await p.textContent('#join-error')) === 'Paste the link you were sent.' && (await p.evaluate(() => window.__joined)).length === 0);
        await p.fill('#join', ' https://relay.example.test/#setup=abc&e2e=key ');
        await p.click('#join-form button');
        check('setup page: a link goes to the main process as it is', JSON.stringify(await p.evaluate(() => window.__joined)) === '["https://relay.example.test/#setup=abc&e2e=key"]');

        // By QR code: the phone scans what the main process draws (desktop/qr-join.js)
        await p.selectOption('#method', 'qr');
        check('setup page: the QR code: the URL and its button, not "Connect"', await shown('#url') && await shown('#qr-form button') && !(await shown('#form button')) && !(await shown('#join')));
        await p.click('#qr-form button');
        check('setup page: QR code: an empty address is refused', (await p.textContent('#qr-error')) === 'Please enter a server URL.' && (await p.evaluate(() => window.__qr)).length === 0);
        await p.fill('#url', 'openfolk.example.test');
        await p.click('#qr-form button');
        check('setup page: QR code: asks the main process with the address', JSON.stringify(await p.evaluate(() => window.__qr)) === '["openfolk.example.test"]');
        await p.evaluate(() => window.__qrEvent({ state: 'code', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1h-1z"/></svg>' }));
        check('setup page: QR code: shown instead of the form, without a hint', await shown('#qr-code svg') && !(await shown('#qr-form')) && (await p.textContent('#qr-hint')) === '');
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
        await p.selectOption('#method', 'password');
        await p.fill('#url', '');
        check('setup page: URL and password: the URL, the password and "Connect", no QR button, no hint text', await shown('#url') && await shown('#password') && await shown('#form button') && !(await shown('#qr-form')) && !(await p.$('#form .warn, #form .hint')));

        await p.click('#form button');
        check('setup page: an empty address is refused without asking', (await p.textContent('#error')) === 'Please enter a server URL.' && !(await shown('#relay-confirm')) && (await s.calls()).length === 0);

        await p.fill('#url', 'https://openfolk.example.test');
        await p.fill('#password', 'pw-123');
        await p.click('#form button');
        check('setup page: connecting asks first; nothing is saved yet', await shown('#relay-confirm') && (await s.calls()).length === 0);
        check('setup page: the question names the consequence, the button says it', (await p.textContent('#relay-confirm .warn')).includes('works for the account there')
            && (await p.textContent('#relay-confirm-yes')) === 'Yes, connect');
        check('setup page: while asking, the address cannot change and "Connect" is out of the way', await p.isDisabled('#url') && !(await shown('#form button')));

        await p.click('#relay-confirm-no');
        check('setup page: "Back" returns to the form, nothing saved', !(await shown('#relay-confirm')) && await p.isEnabled('#url') && await shown('#form button') && (await s.calls()).length === 0);

        await p.click('#form button');
        await p.click('#relay-confirm-yes');
        check('setup page: after "Yes" the address is saved, once, with the password for the web app', JSON.stringify(await s.calls()) === '["https://openfolk.example.test"]' && JSON.stringify(await p.evaluate(() => window.__passwords)) === '["pw-123"]', await s.calls());
        check('setup page: no script errors', s.errors.length === 0, s.errors);
        await s.context.close();

        // A refused address: back at the form with the reason
        s = await open('', { error: 'The server needs HTTPS.' });
        await s.page.selectOption('#method', 'password');
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
        check('setup page: on the server way, the page opens with that method chosen', await s.page.inputValue('#method') === 'password' && await s.page.isVisible('#form'));
        await s.page.fill('#url', 'https://known.example.test');
        await s.page.selectOption('#method', 'qr');
        await s.page.waitForFunction(() => window.__qr.length > 0);
        check('setup page: QR code with a known URL: asked at once, no URL field', JSON.stringify(await s.page.evaluate(() => window.__qr)) === '["https://known.example.test"]' && !(await s.page.isVisible('#url')));
        await s.page.evaluate(() => window.__qrEvent({ state: 'error', reason: 'closed', message: 'gone' }));
        check('setup page: QR code failed: the URL field back, to correct it', await s.page.isVisible('#url') && (await s.page.textContent('#qr-error')) === 'gone');
        await s.context.close();

        // On this computer: an invitation into an account leaves it without bots, so the page asks first
        s = await open('local');
        await s.page.selectOption('#method', 'invite');
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

        // "Without setup": no relay, the second step right away, which starts backend and relay on this computer
        s = await open('');
        check('setup page: step 1 has its title', (await s.page.textContent('#method-title')) === 'Step 1: setup method' && await s.page.isVisible('#method-title'));
        check('setup page: the last method is "Without setup"', (await s.page.textContent('#method option[value="local"]')) === 'Without setup');
        await s.page.selectOption('#method', 'local');
        check('setup page: without setup: the second step, with the way back by the choice, nothing to skip', await s.page.isVisible('#machine-title') && await s.page.isVisible('#method') && await s.page.isVisible('#local')
            && (await s.page.textContent('#local')) === 'Set up this computer');
        await s.page.click('#local');
        check('setup page: … starts on this computer', JSON.stringify(await s.page.evaluate(() => window.__machine)) === '[["local",[]]]', await s.page.evaluate(() => window.__machine));
        await s.context.close();

        // The second step after a sign-in at a relay: no choice any more, this computer joins that relay
        s = await open('relay', {}, '?step=machine&method=invite');
        check('setup page: step 2 after a sign-in: every step in sight, step 1 with the method that signed in, step 2 below', await s.page.isVisible('#method-title') && await s.page.isVisible('#method')
            && await s.page.inputValue('#method') === 'invite' && await s.page.isVisible('#join') && await s.page.isVisible('#machine-title') && await s.page.isVisible('#setup-folders .folder-add')
            && await s.page.evaluate(() => document.getElementById('method').getBoundingClientRect().bottom <= document.getElementById('machine-title').getBoundingClientRect().top));
        await s.page.evaluate(() => { window.__machineAnswer = { error: 'The invitation is used up.' }; });
        await s.page.click('#local');
        await s.page.waitForFunction(() => document.getElementById('machine-error').textContent !== '');
        check('setup page: step 2 hands the folders to the main process and shows why it failed', JSON.stringify(await s.page.evaluate(() => window.__machine)) === '[["setup",[]]]' && (await s.page.textContent('#machine-error')) === 'The invitation is used up.' && await s.page.isEnabled('#local'));
        check('setup page: step 2 has no "Not now"', (await s.page.locator('#machine-skip').count()) === 0);
        check('setup page: no script errors in the second step', s.errors.length === 0, s.errors);
        await s.context.close();

        // An invitation into an account: the app signs in out of sight, the page stays and says so, its fields off
        s = await open('');
        await s.page.evaluate(() => { window.__joinAnswer = { signingIn: true }; });
        await s.page.selectOption('#method', 'invite');
        await s.page.fill('#join', 'https://relay.example.test/#pair=abc&e2e=key');
        await s.page.click('#join-form button');
        await s.page.waitForSelector('#signing-in', { state: 'visible' });
        check('setup page: signing in out of sight: the page stays, says so and takes no other way meanwhile', !(await s.page.isEnabled('#method')) && !(await s.page.isEnabled('#join')));
        await s.context.close();

        // Step 3 right below step 2, as soon as "Set up this computer" worked: the sign-in to an AI provider, no page between
        /** The setup page at step 2 ("Without setup"), set up: step 3 opens. */
        const atStep3 = async (answer = {}) => {
            const x = await open('', answer);
            await x.page.selectOption('#method', 'local');
            await x.page.click('#local');
            await x.page.waitForSelector('#ai-way', { state: 'visible' });
            return x;
        };
        s = await atStep3();
        check('setup page: step 3 opens below step 2; steps 1 and 2 stay open', (await s.page.textContent('#ai-way h2')) === 'Step 3: sign in to an AI provider'
            && await s.page.isVisible('#machine-title') && await s.page.isEnabled('#local') && await s.page.isEnabled('#method')
            && await s.page.evaluate(() => document.getElementById('local-way').getBoundingClientRect().bottom <= document.getElementById('ai-way').getBoundingClientRect().top));
        const aiShown = () => s.page.evaluate(() => ['ai-login', 'ai-key', 'ai-try'].filter((id) => document.getElementById(id).offsetParent));
        check('setup page: step 3: first the choice of one provider, nothing else, no way past it', await s.page.isVisible('#ai-provider') && await s.page.inputValue('#ai-provider') === ''
            && JSON.stringify(await aiShown()) === '[]' && !(await s.page.$('#ai-skip')), await aiShown());
        check('setup page: step 3: the providers, Claude with the subscription and with a key apart, and none', JSON.stringify(await s.page.evaluate(() => [...document.querySelectorAll('#ai-provider option')].map((o) => o.value)))
            === '["","claude","claude-key","codex","copilot","free"]');
        await s.page.selectOption('#ai-provider', 'claude');
        check('setup page: step 3: Claude subscription: its button only, and nothing that explains it', JSON.stringify(await aiShown()) === '["ai-login"]' && (await s.page.textContent('#ai-login')) === 'Sign in to Claude'
            && await s.page.evaluate(() => [...document.querySelectorAll('#ai-way p')].every((p) => !p.textContent.trim())), await aiShown());
        await s.page.click('#ai-login');
        await s.page.evaluate(() => window.__aiEvent({ state: 'browser' }));
        check('setup page: step 3: Claude signs in in the browser, said on the page', JSON.stringify((await s.page.evaluate(() => window.__ai)).at(-1)) === '["login","claude"]' && (await s.page.textContent('#ai-state')) === 'The browser shows it.');
        await s.page.evaluate(() => window.__aiEvent({ state: 'failed', message: 'cancelled' }));
        check('setup page: step 3: a failed sign-in says why', (await s.page.textContent('#ai-error')) === 'Failed: cancelled' && (await s.page.textContent('#ai-state')) === '');
        await s.page.selectOption('#ai-provider', 'codex');
        check('setup page: step 3: another provider: its own button, the message of the last one gone', (await s.page.textContent('#ai-login')) === 'Sign in to Codex' && (await s.page.textContent('#ai-error')) === '');
        await s.page.click('#ai-login');
        await s.page.evaluate(() => window.__aiEvent({ state: 'code', url: 'https://auth.example.test/device', code: 'ABCD-1234' }));
        check('setup page: step 3: Codex with a device code: the link and the code', JSON.stringify((await s.page.evaluate(() => window.__ai)).at(-1)) === '["login","codex"]' && await s.page.isVisible('#ai-code')
            && (await s.page.getAttribute('#ai-code a', 'href')) === 'https://auth.example.test/device' && (await s.page.textContent('#ai-code-value')) === 'ABCD-1234');
        await s.page.selectOption('#ai-provider', 'claude-key');
        check('setup page: step 3: Claude with an API key: the field only', JSON.stringify(await aiShown()) === '["ai-key"]' && !(await s.page.isVisible('#ai-code')), await aiShown());
        await s.page.evaluate(() => { window.__aiKeyAnswer = { error: 'Anthropic does not know this key.' }; });
        await s.page.fill('#ai-key', 'sk-ant-test');
        await s.page.click('#ai-key-form button');
        await s.page.waitForFunction(() => document.getElementById('ai-key-error').textContent !== '');
        check('setup page: step 3: the key goes to the main process, a refused one is said and the choice stays usable', JSON.stringify((await s.page.evaluate(() => window.__ai)).at(-1)) === '["key","sk-ant-test"]'
            && (await s.page.textContent('#ai-key-error')) === 'Anthropic does not know this key.' && await s.page.isEnabled('#ai-provider'));
        await s.page.selectOption('#ai-provider', 'free');
        check('setup page: step 3: no provider: the free models, one button', JSON.stringify(await aiShown()) === '["ai-try"]', await aiShown());
        await s.page.click('#ai-try');
        await s.page.waitForFunction(() => window.__ai.includes('try'));
        check('setup page: step 3: starting for free switches the choice off until the app comes', !(await s.page.isEnabled('#ai-provider')));
        check('setup page: no script errors in the third step', s.errors.length === 0, s.errors);
        await s.context.close();

        // Back to step 1 from step 3: another method closes step 3; "Without setup" again opens it anew
        s = await atStep3();
        await s.page.selectOption('#ai-provider', 'claude');
        await s.page.selectOption('#method', 'invite');
        check('setup page: step 1 changed at step 3: step 3 closes, the main process ends it, the fields of that method show', !(await s.page.isVisible('#ai-way'))
            && (await s.page.evaluate(() => window.__ai)).at(-1) === 'cancel' && await s.page.isVisible('#join'));
        await s.page.selectOption('#method', 'local');
        await s.page.click('#local');
        await s.page.waitForSelector('#ai-way', { state: 'visible' });
        check('setup page: … and set up again, step 3 opens anew, its choice empty', await s.page.inputValue('#ai-provider') === '' && JSON.stringify((await s.page.evaluate(() => window.__machine)).map((m) => m[0])) === '["local","local"]');
        await s.page.selectOption('#ai-provider', 'free');
        await s.page.click('#ai-try');
        await s.page.waitForFunction(() => window.__ai.includes('try'));
        check('setup page: while a way is under way steps 1 and 2 are off too', !(await s.page.isEnabled('#method')) && !(await s.page.isEnabled('#local')));
        check('setup page: no script errors going back', s.errors.length === 0, s.errors);
        await s.context.close();

        s = await atStep3({ aiStatus: { ok: true, known: true, ready: true } });
        await s.page.waitForFunction(() => window.__ai.includes('skip'));
        check('setup page: step 3: an engine ready already goes on to the app by itself', !(await s.page.isEnabled('#ai-provider')));
        await s.context.close();

        // After a sign-in (?step=machine) the same: step 3 below "Set up this computer"
        // Another method in step 1 after a sign-in: the invitation for this computer is dropped, that way shows
        s = await open('relay', {}, '?step=machine&method=password');
        check('setup page: after a sign-in with the password, step 1 shows that way', await s.page.inputValue('#method') === 'password' && await s.page.isVisible('#url') && await s.page.isVisible('#local'));
        await s.page.selectOption('#method', 'local');
        await s.page.click('#local');
        await s.page.waitForSelector('#ai-way', { state: 'visible' });
        check('setup page: … switched to "Without setup": the invitation dropped, this computer set up without it', JSON.stringify(await s.page.evaluate(() => window.__machine.map((m) => m[0]))) === '["drop","local"]', await s.page.evaluate(() => window.__machine));
        await s.context.close();

        // The sign-in at the relay refused (a used link): step 1 again with the way used and the reason, all of the wizard
        s = await open('relay', {}, '?method=invite&refused=' + encodeURIComponent('This pairing link is no longer valid.'));
        check('setup page: a refused sign-in: step 1 with the invitation link and the reason below it', await s.page.isVisible('#method-title') && await s.page.inputValue('#method') === 'invite'
            && await s.page.isVisible('#join') && (await s.page.textContent('#join-error')) === 'This pairing link is no longer valid.' && (await s.page.locator('#method option[value=local]').count()) === 1);
        await s.context.close();
        s = await open('relay', {}, '?method=password&refused=' + encodeURIComponent('Wrong password.'));
        check('setup page: … a wrong password: the URL and password way, the reason under it', await s.page.inputValue('#method') === 'password' && await s.page.isVisible('#password') && (await s.page.textContent('#error')) === 'Wrong password.');
        await s.context.close();

        s = await open('relay', {}, '?step=machine&method=qr');
        await s.page.click('#local');
        await s.page.waitForSelector('#ai-way', { state: 'visible' });
        check('setup page: after a QR code all three steps are in sight', await s.page.isVisible('#method') && await s.page.inputValue('#method') === 'qr' && await s.page.isVisible('#machine-title'));
        check('setup page: step 3 follows the second step after a sign-in too; that step is done, its invitation redeemed', await s.page.isVisible('#machine-title') && !(await s.page.isEnabled('#local')));
        await s.context.close();
    } finally {
        await browser.close();
    }
}
