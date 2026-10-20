// Accounts: a device signed in to several, switching in the sidebar, adding one by invitation link or password,
// and managing them (an admin creates one and gets the invitation from a backend).

const KEY = Buffer.alloc(32, 7).toString('base64url');
const MAIN = { id: 'main', name: 'Alex', admin: true };
const WORK = { id: 'work', name: 'Work', admin: false };
const KUNDE = { id: 'kunde', name: 'Kunde', admin: false };

/** The relay's answer by device key: each key belongs to one account. */
const byDevice = (keys) => (f) => {
    if (f.device && keys[f.device]) return { type: 'auth', ok: true, account: keys[f.device] };
    return { type: 'auth', ok: false, code: 'device_logged_out', message: 'no', loggedOut: true };
};
/** Before the first load only: the accounts this device knows. */
const knows = (list) => `if (!sessionStorage.getItem('__accounts')) { sessionStorage.setItem('__accounts', '1'); localStorage.setItem('openfolk-accounts', ${JSON.stringify(JSON.stringify(list))}); }`;
const afterReload = async (h) => {
    await h.page.waitForLoadState('load');
    await h.wait(700);
};

export default async function ({ start, check }) {
    // ---- a relay without accounts: nothing new to see
    const old = await start({});
    check('relay without accounts: no switch, no accounts block', await old.page.isHidden('#account-switch') && await old.page.evaluate(() => document.getElementById('settings-accounts').hidden));
    await old.close();

    // ---- only main: the page exists, the switch does not
    const one = await start({ auth: byDevice({ test: MAIN }) });
    check('only main: no switch in the sidebar', await one.page.isHidden('#account-switch'));
    check('… and remembered with its key', await one.page.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((a) => `${a.id}:${a.device}`).join() === 'main:test'));
    await one.close();

    // ---- the login: the account field only on request
    const fresh = await start({ device: null });
    check('login: no account field at first, a link to it', await fresh.page.isHidden('#login-account') && await fresh.page.isVisible('#login-other-account'));
    await fresh.page.click('#login-other-account');
    check('… the link shows it', await fresh.page.isVisible('#login-account') && await fresh.page.isHidden('#login-other-account'));
    await fresh.close();

    // ---- two accounts on this device: switching
    const h = await start({ auth: byDevice({ test: MAIN, 'w.key': WORK }), before: knows([{ ...MAIN, device: 'test' }, { ...WORK, device: 'w.key' }]) });
    const p = h.page;
    check('switch shows the current account', await p.isVisible('#account-switch') && (await p.textContent('#account-switch')).trim() === 'Alex');
    await p.click('#account-switch');
    const entries = await p.locator('#account-menu button').allTextContents();
    check('menu: both accounts, adding, managing', entries.length === 4 && entries[0].includes('Alex') && entries[1].includes('Work'), entries);
    check('current account marked', (await p.getAttribute('#account-menu button[data-account="main"]', 'class') || '').includes('current'));
    await p.click('#account-menu button[data-account="work"]');
    await afterReload(h);
    const auths = h.sent.filter((f) => f.type === 'auth');
    check('after switching: signed in with the other key', auths.some((f) => f.device === 'w.key') && await p.evaluate(() => state.account?.id === 'work' && localStorage.getItem('openfolk-device') === 'w.key'), auths);
    check('the switch names the other account', (await p.textContent('#account-switch')).trim() === 'Work');
    check('what the device keeps per chat is kept per account', await p.evaluate(() => loadedAccount === 'work' && SEEN_KEY === 'openfolk-seen:work' && PANES_KEY === 'openfolk-panes:work'));

    await h.close();

    // ---- a notification of another account: the page opens in that one
    const note = await start({ path: '?chat=pdf&account=work', auth: byDevice({ test: MAIN, 'w.key': WORK }), before: knows([{ ...MAIN, device: 'test' }, { ...WORK, device: 'w.key' }]) });
    check('link with ?account: signed in to that account', note.sent.find((f) => f.type === 'auth')?.device === 'w.key');
    check('… the account leaves the address, the chat stays', await note.page.evaluate(() => !location.search.includes('account') && location.search.includes('chat=pdf')));
    await note.close();
    const h2 = await start({ auth: byDevice({ test: MAIN, 'w.key': WORK }), before: knows([{ ...MAIN, device: 'test' }, { ...WORK, device: 'w.key' }]) });

    // ---- logged out from one account: on to the other, not to the login
    await h2.page.evaluate(() => window.__ws.onclose({ code: 4004 }));
    await afterReload(h2);
    check('logged out of one account: the other one takes over', h2.sent.findLast((f) => f.type === 'auth')?.device === 'w.key' && await h2.page.isHidden('#login'));
    check('… and the logged out one is forgotten', await h2.page.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((a) => a.id).join() === 'work'));
    await h2.close();

    // ---- an invitation link opened on a device already signed in: adds the account
    const inv = await start({
        secure: true, path: `#pair=inv-1&e2e=${KEY}`, before: knows([{ ...MAIN, device: 'test' }]),
        auth: (f) => (f.pair === 'inv-1' ? { type: 'auth', ok: true, device: { id: 'k', token: 'k.key', name: 'Phone' }, account: KUNDE } : byDevice({ test: MAIN, 'k.key': KUNDE })(f)),
    });
    await afterReload(inv);
    const invAuths = inv.sent.filter((f) => f.type === 'auth');
    check('invitation on a signed-in device: the link is used, not the old key', invAuths[0]?.pair === 'inv-1', invAuths);
    check('then the page loads in the new account', await inv.page.evaluate(() => state.account?.id === 'kunde' && localStorage.getItem('openfolk-device') === 'k.key') && (await inv.page.textContent('#account-switch')).trim() === 'Kunde');
    check('both accounts known to the device', await inv.page.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((a) => a.id).sort().join() === 'kunde,main'));
    await inv.close();

    // ---- an invitation that no longer works: stays in the account it was in
    const stale = await start({
        path: '#pair=used', before: knows([{ ...MAIN, device: 'test' }]),
        auth: (f) => (f.pair ? { type: 'auth', ok: false, code: 'pairing_invalid', message: 'This pairing link is no longer valid.' } : byDevice({ test: MAIN })(f)),
    });
    stale.page.on('dialog', (d) => d.accept());
    await stale.wait(400);
    check('stale invitation: back in the account so far, no login', stale.sent.findLast((f) => f.type === 'auth')?.device === 'test' && await stale.page.isHidden('#login'));
    await stale.close();

    // ---- adding an account with its name and password
    const add = await start({
        auth: (f) => (f.token ? (f.account === 'Kunde' && f.token === 'kunde-password-123'
            ? { type: 'auth', ok: true, device: { id: 'k', token: 'k.key', name: 'Phone' }, account: KUNDE }
            : { type: 'auth', ok: false, code: 'wrong_password', message: 'Wrong password.' }) : byDevice({ test: MAIN, 'k.key': KUNDE })(f)),
        onSend: async (f, push) => { if (f.type === 'accounts') await push({ type: 'accounts', list: [{ ...MAIN, created: '' }], current: 'main' }); },
    });
    const a = add.page;
    await a.click('#btn-settings');
    await add.wait(200);
    await a.click('#accounts-add');
    check('adding: the login with the account field and a way back', await a.isVisible('#login') && await a.isVisible('#login-account') && await a.isVisible('#login-cancel'));
    await a.fill('#login-account', 'Kunde');
    await a.fill('#login-token', 'kunde-password-123');
    await a.click('#login-form button[type="submit"]');
    await afterReload(add);
    const pw = add.sent.find((f) => f.type === 'auth' && f.token);
    check('password sign-in names the account', pw?.account === 'Kunde', pw);
    check('signed in to the added account, the first one kept', (await a.textContent('#account-switch')).trim() === 'Kunde'
        && await a.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((x) => x.id).sort().join() === 'kunde,main'));
    await add.close();

    const cancel = await start({ auth: byDevice({ test: MAIN }) });
    await cancel.page.evaluate(() => addAccount());
    await cancel.wait(100);
    await cancel.page.click('#login-cancel');
    await afterReload(cancel);
    check('cancelled adding: back in the account so far', cancel.sent.findLast((f) => f.type === 'auth')?.device === 'test' && await cancel.page.isHidden('#login'));
    await cancel.page.evaluate(() => addAccount());
    await cancel.wait(100);
    await cancel.page.reload();
    await afterReload(cancel);
    check('reloaded while adding: still in the account so far', cancel.sent.findLast((f) => f.type === 'auth')?.device === 'test' && await cancel.page.isHidden('#login'));
    await cancel.close();

    // ---- managing as an admin: create and invite
    const list = [{ ...MAIN, created: '' }, { ...WORK, created: '2026-10-01T08:00:00Z' }];
    let oldBackend = false;
    const admin = await start({
        auth: byDevice({ test: MAIN }),
        onSend: async (f, push) => {
            if (f.type === 'accounts') await push({ type: 'accounts', list, current: 'main' });
            if (f.type === 'account_create') await push({ type: 'account_created', account: { ...KUNDE, created: '2026-10-16T08:00:00Z' }, pair: { token: 'tok-kunde', expiresAt: '2026-10-16T08:15:00Z' } });
            if (f.type === 'account_invite') await push({ type: 'account_invite', account: { ...WORK, created: '2026-10-01T08:00:00Z' }, pair: { token: 'tok-work', expiresAt: '2026-10-16T08:15:00Z' } });
            if (f.type === 'account_update') await push({ type: 'error', code: 'not_allowed', request: 'account_update', message: 'This account may not do that.' });
            if (f.type === 'pair_link') await push({ type: 'pair_link', machine: 'desk', url: `https://relay.example.com/#pair=${oldBackend ? 'other' : f.token}&e2e=abc`, expiresAt: '2026-10-16T08:15:00Z', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', e2e: true });
        },
    });
    const m = admin.page;
    await m.evaluate(() => openAccounts());
    await admin.wait(200);
    check('admin: all accounts listed', await m.isVisible('#accounts-admin') && (await m.locator('#accounts-list li').count()) === 2);
    check('own account: password belongs to the relay setup', await m.isHidden('#accounts-password'));
    check('others: invite, admin and delete; main and oneself untouched', (await m.locator('#accounts-list li').nth(1).locator('button').count()) === 3
        && (await m.locator('#accounts-list li').nth(0).locator('button').count()) === 0);
    await m.fill('#accounts-new-name', 'Kunde');
    await m.click('#accounts-create');
    await admin.wait(300);
    check('create goes to the relay', admin.sent.some((f) => f.type === 'account_create' && f.name === 'Kunde' && f.admin === false));
    const wrap = admin.sent.find((f) => f.type === 'pair_link');
    check('a backend wraps the relay\'s token, it mints none', wrap?.token === 'tok-kunde', wrap);
    check('invitation with link and QR code', await m.isVisible('#invite-box') && (await m.inputValue('#invite-box input')).includes('pair=tok-kunde') && (await m.textContent('#invite-box')).includes('Kunde'));
    oldBackend = true;
    await m.locator('#accounts-list li').nth(1).locator('button').first().click();
    await admin.wait(300);
    check('new invitation for an existing account', admin.sent.some((f) => f.type === 'account_invite' && f.id === 'work'));
    check('a backend that ignores the token: no link for main to a stranger', (await m.textContent('#accounts-error')).includes('too old'), await m.textContent('#accounts-error'));
    await m.fill('#accounts-own-name', 'Alex K.');
    await m.click('#accounts-own-save');
    await admin.wait(200);
    check('refusal of the relay shown on the page', (await m.textContent('#accounts-error')).includes('may not'), await m.textContent('#accounts-error'));
    await admin.close();
}
