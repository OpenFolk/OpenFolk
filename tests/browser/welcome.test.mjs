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
    check('fields carry labels', await dp.evaluate(() => [...document.querySelectorAll('#login-form label')].filter((l) => l.offsetParent !== null).map((l) => l.querySelector('span').textContent).join('|')) === 'Server-URL|Passwort|Name dieses Geräts (optional)');
    check('server URL not editable in the browser', await dp.isVisible('#login-relay') && !(await dp.isEditable('#login-relay')));
    check('password field has the focus', await dp.evaluate(() => document.activeElement?.id === 'login-token'));
    check('no code field while the relay asks for none', !(await dp.isVisible('#login-totp')));
    await de.close();

    // ---- a relay with a second factor: its /health says so, the code field shows without a refused sign-in first
    const tw = await start({ device: null, language: null, locale: 'de-DE', health: { ok: true, totp: true } });
    await tw.wait(200);
    check('relay with TOTP: code field shown, without "(falls eingerichtet)"', await tw.page.isVisible('#login-totp')
        && (await tw.page.textContent('#login-totp-field span')) === 'Code aus der Authenticator-App');
    await tw.close();

    const en = await start({ device: null, language: null, locale: 'fr-FR' });
    check('other languages: English', (await en.page.textContent('#login-form button[type="submit"]')) === 'Sign in' && (await en.page.getAttribute('html', 'lang')) === 'en');
    check('help link for newcomers', (await en.page.textContent('.start-help[data-i18n-html="login.help"]')).includes('set it up'));
    await en.close();

    // ---- first steps: no machine, no bot
    const h = await start({ bots: [], online: [], device: 'test' });
    const p = h.page;
    const steps = () => p.evaluate(() => [...document.querySelectorAll('.welcome-steps li')].map((li) => `${li.classList.contains('done') ? '✓' : '·'} ${li.querySelector('strong').textContent}`).join('|'));
    check('welcome instead of an empty list', await p.evaluate(() => !!document.querySelector('#chat-list .welcome h2')));
    check('no machine: all steps open, the backend command shown', (await steps()) === '· Connect a machine|· Sign in to an AI provider|· Create your first bot|· Add your phone and notifications' && (await p.textContent('.welcome-steps code')) === 'npm start', await steps());
    check('no bot button while no machine is connected', !(await p.isVisible('.welcome-steps button')));

    await h.push({ type: 'agents', online: ['desk'] });
    await h.wait(100);
    check('machine connected: first step done; a backend without setup_status counts as signed in', (await steps()).startsWith('✓ Connect a machine|✓ Sign in to an AI provider|· Create your first bot') && (await p.textContent('.welcome-steps li:nth-child(1) .welcome-body span')).includes('DESK'), await steps());

    // ---- the sign-in step from setup_status: Claude missing on this computer, Codex installed but not signed in
    const step2 = '.welcome-steps li:nth-child(2)';
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'sign_in', codex: 'sign_in', copilot: 'missing' } });
    await h.wait(100);
    check('not signed in: step open with the command for a terminal', (await steps()).startsWith('✓ Connect a machine|· Sign in to an AI provider') && (await p.textContent(`${step2} code`)) === 'claude', await steps());
    check('device code offered only for an installed engine', (await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((x) => x.textContent).join('|'), `${step2} button`)) === 'Use Codex instead');
    check('embedded relay: the devices step names a relay on a server', (await p.textContent('.welcome-steps li:nth-child(4) .welcome-body span')).includes('relay of your own on a server'));
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

    // ---- Claude with the machine's own terminal and, for the main account, an API key instead
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'sign_in' }, claudeTerminal: true });
    await h.wait(500);
    const buttons = () => p.evaluate((sel) => [...document.querySelectorAll(`${sel} button.primary`)].map((x) => x.textContent).join('|'), step2);
    check('terminal offered: a button instead of the command', !(await p.isVisible(`${step2} code`)) && (await buttons()) === 'Open a terminal for the sign-in', await buttons());
    h.sent.length = 0;
    await p.click(`${step2} button.primary`);
    await h.wait(500);
    check('the button asks that machine for the terminal', h.sent.some((x) => x.type === 'claude_sign_in' && x.machine === 'desk'), h.sent);
    check('while it opens, the button waits', await p.isDisabled(`${step2} button.primary`));
    await h.push({ type: 'claude_sign_in', machine: 'desk' });
    await h.wait(500);
    check('terminal open: says where to sign in', (await p.textContent(`${step2} .welcome-extra`)).includes('terminal is open on DESK') && !(await p.isDisabled(`${step2} button.primary`)));
    await p.click(`${step2} button.primary`);
    await h.push({ type: 'error', machine: 'desk', request: 'claude_sign_in', message: 'No desktop app answered.' });
    await h.wait(500);
    check('terminal failed: the reason in the step', (await p.textContent(`${step2} .welcome-extra .error`)).includes('No desktop app answered.'));

    const keyInput = `${step2} .welcome-key input`;
    check('main account: an API key field for Claude', await p.isVisible(keyInput));
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

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: { claude: 'ready', codex: 'sign_in' } });
    await h.wait(500);
    check('signed in: step done, no command, no relay hint', (await steps()).startsWith('✓ Connect a machine|✓ Sign in to an AI provider|· Create your first bot') && !(await p.isVisible(`${step2} code`))
        && !(await p.textContent('.welcome-steps li:nth-child(4) .welcome-body span')).includes('relay of your own'), await steps());

    await p.click('.welcome-steps li:nth-child(3) button');
    await h.wait(100);
    check('bot button opens the editor for a new bot', await p.isVisible('#editor') && (await p.textContent('#editor-title')) === 'New bot');
    await p.evaluate(() => closeDialog(document.getElementById('editor')));

    await p.click('.welcome-steps li:nth-child(4) button');
    await h.wait(100);
    check('devices button opens the settings at the devices block', await p.isVisible('#settings-devices')
        && await p.evaluate(() => { const r = document.getElementById('settings-devices').getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; }));
    await p.evaluate(() => closeDialog(document.getElementById('settings')));

    h.state.bots = [BOT];
    await h.sendBots();
    // the list re-renders only once the tap lock of the last click has released (350 ms)
    await h.wait(600);
    check('first bot: the list replaces the welcome', !(await p.evaluate(() => !!document.querySelector('#chat-list .welcome'))) && (await p.textContent('#chat-list')).includes('PDF-Reader'));
}
