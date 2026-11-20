// Start page and first steps: the sign-in is a page of its own (no dialog over the app) in the device's language;
// with nothing to list yet, the chat list shows the four first steps and ticks them off as machines, their sign-ins
// and bots appear.
const BOT = { id: 'pdf', name: 'PDF-Reader', role: 'Test', avatar: '', folder: 'C:/www/pdf', model: 'default', approval: 'risky', tone: '', machine: '' };

export default async function ({ start, check }) {
    // ---- sign-in page, German device
    const de = await start({ device: null, language: null, locale: 'de-DE' });
    const dp = de.page;
    check('sign-in is a page, not an overlay', await dp.evaluate(() => {
        const l = document.getElementById('login');
        return !l.hidden && l.classList.contains('start') && !l.classList.contains('overlay') && getComputedStyle(l).backgroundColor !== 'rgba(0, 0, 0, 0.45)';
    }));
    check('German device: German texts and html lang', (await dp.textContent('#login-form button[type="submit"]')) === 'Anmelden' && (await dp.getAttribute('html', 'lang')) === 'de');
    check('a small wizard: first the choice of the setup method, focused, nothing else', await dp.evaluate(() => document.activeElement?.id === 'login-method' && document.getElementById('login-method').selectedOptions[0].textContent === 'Setupmethode wählen'
        && [...document.querySelectorAll('#login-form label')].every((l) => l.offsetParent === null)));
    check('the methods in the browser (no QR code without a secure page)', await dp.evaluate(() => [...document.querySelectorAll('#login-method option')].map((o) => o.textContent).join('|')) === 'Setupmethode wählen|Einladungslink|Passwort');
    await dp.selectOption('#login-method', 'password');
    check('fields carry labels', await dp.evaluate(() => [...document.querySelectorAll('#login-form label')].filter((l) => l.offsetParent !== null).map((l) => l.querySelector('span').textContent).join('|')) === 'URL|Passwort|Name dieses Geräts (optional)');
    check('server URL not editable in the browser', await dp.isVisible('#login-relay') && !(await dp.isEditable('#login-relay')));
    check('password field has the focus', await dp.evaluate(() => document.activeElement?.id === 'login-token'));
    check('no code field while the relay asks for none', !(await dp.isVisible('#login-totp')));
    await de.close();

    // ---- a relay with a second factor: its /health says so, the code field shows without a refused sign-in first
    const tw = await start({ device: null, language: null, locale: 'de-DE', health: { ok: true, totp: true } });
    await tw.wait(200);
    await tw.page.selectOption('#login-method', 'password');
    check('relay with TOTP: code field shown, without "(falls eingerichtet)"', await tw.page.isVisible('#login-totp')
        && (await tw.page.textContent('#login-totp-field span')) === 'Code aus der Authenticator-App');
    await tw.close();

    const en = await start({ device: null, language: null, locale: 'fr-FR' });
    check('other languages: English', (await en.page.textContent('#login-form button[type="submit"]')) === 'Sign in' && (await en.page.getAttribute('html', 'lang')) === 'en');
    await en.close();

    // ---- loading: nothing flashes up in the list while the machines and their bots are on their way
    const ld = await start({ bots: [], agentsLater: true, botsLater: true, device: 'test' });
    await ld.wait(200);
    const loading = () => ld.page.evaluate(() => !!document.querySelector('#chat-list .list-loading'));
    check('before the machine list: loading', await loading());
    await ld.push({ type: 'agents', online: ['desk'] });
    await ld.wait(100);
    check('machine there, its bots not yet: still loading', await loading());
    await ld.push({ type: 'bots', machine: 'desk', bots: [], groups: [], categories: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
    await ld.wait(100);
    check('bots there, none yet: an empty list, no first steps in it', await ld.page.evaluate(() => !document.querySelector('#chat-list .list-loading') && !document.querySelector('#chat-list .welcome-steps') && document.querySelectorAll('#chat-list > *').length === 0));
    await ld.close();

    // ---- another account (an invitation) while none of its machines is awake: a note in the list
    const inv = await start({ bots: [], online: [], device: 'test', auth: () => ({ type: 'auth', ok: true, account: { id: 'erik', name: 'Erik', admin: false } }) });
    await inv.wait(200);
    // Right after the start a machine may still be on its way (the desktop app's own backend after its setup)
    check('invited account, no machine yet right after the start: the loading bar, not "no machine"', await inv.page.evaluate(() => !!document.querySelector('#chat-list .list-loading') && !document.querySelector('#chat-list .welcome')));
    await inv.page.evaluate(() => { const real = Date.now; Date.now = () => real() + 60_000; });
    await inv.push({ type: 'agents', online: [] });
    await inv.wait(100);
    check('invited account, still no machine after a while: a note that no machine is reachable', (await inv.page.textContent('#chat-list .welcome h2')) === 'No machine reachable yet', await inv.page.textContent('#chat-list'));
    await inv.push({ type: 'agents', online: ['desk'] });
    await inv.push({ type: 'bots', machine: 'desk', bots: [], groups: [], categories: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
    await inv.wait(100);
    check('machine awake: the note goes, no steps instead', await inv.page.evaluate(() => !document.querySelector('#chat-list .welcome')));
    await inv.close();

    // ---- the start view: the sign-in to an AI provider while no engine of a connected machine is ready
    const h = await start({ bots: [], online: [], device: 'test' });
    const p = h.page;
    // A phone (the harness' size) shows it at the top of the list, a wide window in the start view
    const step2 = '#chat-list .start-setup';
    const setupShown = () => p.isVisible(step2);
    check('no machine: no sign-in in the start view, no steps in the list', !(await setupShown()) && !(await p.evaluate(() => !!document.querySelector('.welcome-steps'))));
    await h.push({ type: 'agents', online: ['desk'] });
    await h.wait(100);
    check('machine connected, a backend without setup_status: counts as signed in, nothing shown', !(await setupShown()));

    // ---- the sign-in from setup_status: Claude missing on this computer, Codex installed but not signed in
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'sign_in', codex: 'sign_in', copilot: 'missing' } });
    await h.wait(100);
    check('not signed in: the start view shows the sign-in with the command for a terminal', await setupShown() && (await p.textContent(`${step2} strong`)) === 'Sign in to an AI provider' && (await p.textContent(`${step2} code`)) === 'claude');
    check('… on a phone the only card at the top of the list, no steps', await p.evaluate(() => document.querySelector('#chat-list > li')?.classList.contains('start-setup') && !document.querySelector('.welcome-steps')));
    const widths = await p.evaluate(() => {
        const card = document.querySelector('#chat-list .start-setup');
        return { card: card.getBoundingClientRect().width, body: card.querySelector('.welcome-body').getBoundingClientRect().width };
    });
    check('… its text runs across the card, not a word a line in a narrow column', widths.body > widths.card * 0.8, widths);
    await p.setViewportSize({ width: 1280, height: 800 });
    await h.wait(100);
    check('… in a wide window in the start view next to the list, not in the list', await p.isVisible('#chat-empty #chat-setup') && !(await p.isVisible(step2))
        && (await p.textContent('#chat-setup code')) === 'claude');
    await p.setViewportSize({ width: 400, height: 860 });
    await h.wait(100);
    check('device code offered only for an installed engine', (await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((x) => x.textContent).join('|'), `${step2} button`)) === 'Use Codex instead');
    h.sent.length = 0;
    await p.click(`${step2} button`);
    await h.wait(100);
    check('the button asks that machine for a device code', h.sent.some((x) => x.type === 'engine_login' && x.engine === 'codex' && x.machine === 'desk'), h.sent);
    await h.push({ type: 'engine_login', machine: 'desk', engine: 'codex', state: 'code', url: 'https://auth.openai.com/codex/device', code: 'AB12-CD34E' });
    await h.wait(100);
    check('device code: link and code shown', (await p.getAttribute(`${step2} .welcome-login a`, 'href')) === 'https://auth.openai.com/codex/device' && (await p.textContent(`${step2} .welcome-login code`)) === 'AB12-CD34E');
    await h.push({ type: 'engine_login', machine: 'desk', engine: 'codex', state: 'code', url: 'javascript:alert(1)', code: 'X' });
    await h.wait(100);
    check('a link that is not https is not made clickable', !(await p.isVisible(`${step2} .welcome-login a`)));
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: true, engines: { claude: 'sign_in' } });
    await h.wait(100);
    check('in a container: the docker compose command', (await p.textContent(`${step2} code`)).startsWith('docker compose') && (await p.textContent(`${step2} code`)).endsWith('exec -u node local claude'));

    // ---- a new installation: no engine on until the main account ticks its own
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: {}, noEngine: true });
    await h.wait(100);
    check('no engine on, without the machine settings: waits for the main account', (await p.textContent(`${step2} .welcome-body span`)).includes('main account')
        && !(await p.isVisible(`${step2} .welcome-engines`)));
    await h.push({
        type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: false, shutdownMethod: 'script', offers: { shutdown: true, ide: true, terminal: true, voice: true },
        settings: { disabledEngines: ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'] },
    });
    await h.wait(100);
    const pick = `${step2} .welcome-engines`;
    check('main account: a tick per engine, none ticked, the button waits', (await p.evaluate((sel) => [...document.querySelectorAll(`${sel} input`)].map((b) => `${b.dataset.engine}:${b.checked}`).join(), pick))
        === 'claude:false,codex:false,cursor:false,copilot:false,antigravity:false,opencode:false' && await p.isDisabled(`${pick} button`));
    const tryButton = `${step2} .welcome-try button`;
    check('the choice offers a try without signing in, naming the training', await p.isVisible(tryButton)
        && (await p.textContent(`${step2} .welcome-try`)).includes('training'));
    h.sent.length = 0;
    await p.click(tryButton);
    await h.wait(100);
    const tried = h.sent.find((x) => x.type === 'machine_settings_save');
    check('… which switches on OpenCode alone, on that machine', tried?.machine === 'desk'
        && JSON.stringify(tried.settings.disabledEngines) === '["claude","codex","cursor","copilot","antigravity"]', tried);
    await p.click(`${pick} input[data-engine="codex"]`);
    await p.click(`${pick} input[data-engine="copilot"]`);
    h.sent.length = 0;
    await p.click(`${pick} button`);
    await h.wait(100);
    const picked = h.sent.find((x) => x.type === 'machine_settings_save');
    check('the button switches on the ticked engines only, on that machine', picked?.machine === 'desk'
        && JSON.stringify(picked.settings.disabledEngines) === '["claude","cursor","antigravity","opencode"]', picked);
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: { codex: 'sign_in', copilot: 'sign_in' } });
    // after a tap the list waits 350 ms before it renders again
    await h.wait(500);
    check('without Claude: no Claude command, the device codes of the picked ones', !(await p.isVisible(`${step2} code`))
        && (await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((x) => x.textContent).join('|'), `${step2} button`)) === 'Sign in to Codex|Sign in to Copilot');

    // ---- Claude signed in by the machine itself (browser or terminal there) and, for the main account, an API key instead
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'sign_in' }, claudeTerminal: true });
    await h.wait(500);
    const buttons = () => p.evaluate((sel) => [...document.querySelectorAll(`${sel} button.primary`)].map((x) => x.textContent).join('|'), step2);
    check('sign-in offered: a button instead of the command', !(await p.isVisible(`${step2} code`)) && (await buttons()) === 'Sign in to Claude', await buttons());
    h.sent.length = 0;
    await p.click(`${step2} button.primary`);
    await h.wait(500);
    check('the button asks that machine for the sign-in', h.sent.some((x) => x.type === 'claude_sign_in' && x.machine === 'desk'), h.sent);
    check('while it starts, the button waits', await p.isDisabled(`${step2} button.primary`));
    await h.push({ type: 'claude_sign_in', machine: 'desk', via: 'browser' });
    await h.wait(500);
    check('browser open: says where to sign in, the button starts over', (await p.textContent(`${step2} .welcome-extra`)).includes('browser on DESK shows the Claude sign-in')
        && !(await p.isDisabled(`${step2} button.primary`)));
    await p.click(`${step2} button.primary`);
    await h.push({ type: 'claude_sign_in', machine: 'desk' });
    await h.wait(500);
    check('terminal open (no desktop there, or an older backend): says where to sign in', (await p.textContent(`${step2} .welcome-extra`)).includes('terminal is open on DESK')
        && !(await p.isDisabled(`${step2} button.primary`)));
    await p.click(`${step2} button.primary`);
    await h.push({ type: 'error', machine: 'desk', request: 'claude_sign_in', message: 'No desktop app answered.' });
    await h.wait(500);
    check('sign-in failed: the reason in the step', (await p.textContent(`${step2} .welcome-extra .error`)).includes('No desktop app answered.'));

    const keyInput = `${step2} .welcome-key input`;
    check('main account: an API key field for Claude', await p.isVisible(keyInput));
    check('… with a link to the Console page for keys, opening outside', (await p.getAttribute(`${step2} .welcome-extra p a`, 'href')) === 'https://platform.claude.com/settings/keys'
        && (await p.getAttribute(`${step2} .welcome-extra p a`, 'target')) === '_blank');
    check('… and what it costs: the check nothing, the use the Console credit', (await p.textContent(`${step2} .welcome-extra`)).includes('costs nothing')
        && (await p.textContent(`${step2} .welcome-extra`)).includes('credit'));
    await p.fill(keyInput, 'sk-ant-test');
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'sign_in', codex: 'missing' }, claudeTerminal: true });
    await h.wait(100);
    const kept = { value: await p.inputValue(keyInput), focused: await p.evaluate((sel) => document.activeElement === document.querySelector(sel), keyInput) };
    check('a new state while typing keeps the key and the focus', kept.value === 'sk-ant-test' && kept.focused, kept);
    h.sent.length = 0;
    await p.click(`${step2} .welcome-key button`);
    await h.wait(100);
    const saved = h.sent.find((x) => x.type === 'machine_settings_save');
    check('saving sends the key and switches Claude to it, on that machine', saved?.machine === 'desk' && saved.anthropicKey === 'sk-ant-test' && saved.settings.claudeAuth === 'apikey', saved);
    h.sent.length = 0;
    await p.click(`${step2} .welcome-try button`);
    await h.wait(100);
    const added = h.sent.find((x) => x.type === 'machine_settings_save');
    check('Claude not signed in: trying without signing in adds OpenCode to what is on', added?.machine === 'desk'
        && JSON.stringify(added.settings.disabledEngines) === '["claude","codex","cursor","copilot","antigravity"]', added);

    // ---- OpenCode ready, Claude not: the sign-in goes and a new bot starts on OpenCode
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: { claude: 'sign_in', opencode: 'ready' } });
    await h.wait(500);
    check('OpenCode ready: the sign-in leaves the start view', !(await setupShown()));
    await p.evaluate(() => openEditor(null));
    await h.wait(100);
    check('… and a new bot starts on OpenCode', (await p.inputValue('#editor-model')) === 'opencode', await p.inputValue('#editor-model'));
    await p.evaluate(() => closeDialog(document.getElementById('editor')));

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: { claude: 'ready', codex: 'sign_in' } });
    await h.wait(500);
    check('signed in: nothing in the start view', !(await setupShown()));
    await p.evaluate(() => openEditor(null));
    await h.wait(100);
    check('a new bot starts on Claude', await p.isVisible('#editor') && (await p.inputValue('#editor-model')) === 'default');
    await p.evaluate(() => closeDialog(document.getElementById('editor')));

    h.state.bots = [BOT];
    await h.sendBots();
    await h.wait(600);
    check('first bot: in the list', (await p.textContent('#chat-list')).includes('PDF-Reader'));
}
