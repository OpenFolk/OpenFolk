// Accounts: a device signed in to several, switching in the sidebar, adding one by invitation link or password,
// and managing them (an admin creates one and gets the invitation from a backend).
import { onDialog } from './harness.mjs';

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
    await old.page.evaluate(() => openSettings());
    await old.wait(100);
    check('relay without accounts: no switch, nothing of one\'s own to edit, but where this device is signed in', await old.page.isHidden('#account-switch')
        && await old.page.isHidden('#accounts-own') && (await old.page.locator('#accounts-list li').count()) === 2 && await old.page.isHidden('#settings-all-accounts-field'));
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
    check('menu: both accounts and the way to the settings', entries.length === 3 && entries[0].includes('Alex') && entries[1].includes('Work'), entries);
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
    await onDialog(stale.page, (d) => d.accept());
    await stale.wait(400);
    check('stale invitation: back in the account so far, no login', stale.sent.findLast((f) => f.type === 'auth')?.device === 'test' && await stale.page.isHidden('#login'));
    await stale.close();

    // ---- adding an account with its name and password
    let signedInAs = 'main';
    const add = await start({
        auth: (f) => (f.token ? (f.account === 'Kunde' && f.token === 'kunde-password-123'
            ? { type: 'auth', ok: true, device: { id: 'k', token: 'k.key', name: 'Phone' }, account: KUNDE }
            : { type: 'auth', ok: false, code: 'wrong_password', message: 'Wrong password.' }) : byDevice({ test: MAIN, 'k.key': KUNDE })(f)),
        // the relay lists the own account only (Kunde is no admin)
        onSend: async (f, push) => { if (f.type === 'accounts') await push({ type: 'accounts', list: [signedInAs === 'main' ? { ...MAIN, created: '' } : { ...KUNDE, created: '2026-10-16T08:00:00Z' }], current: signedInAs }); },
    });
    const a = add.page;
    await a.click('[data-tab=settings]');
    await add.wait(200);
    const signedIn = () => a.evaluate(() => [...document.querySelectorAll('#accounts-list li')].map((li) => `${li.querySelector('strong').firstChild.textContent}${li.querySelector('.tag') ? ' *' : ''}: ${[...li.querySelectorAll('button')].map((b) => b.textContent).join(',')}`));
    check('the list: the relay, then the account, marked, nothing to remove', JSON.stringify(await signedIn()) === JSON.stringify(['test.local: Rename', 'Alex *: ']), await signedIn());
    // "Add" (an admin: the form) with the address of this relay: the login with the account field
    await a.click('#accounts-join');
    await a.fill('#accounts-link', 'http://test.local');
    await a.click('#accounts-link-go');
    await add.wait(200);
    check('adding: the login with the account field and a way back', await a.isVisible('#login') && await a.isVisible('#login-account') && await a.isVisible('#login-cancel'));
    await a.fill('#login-account', 'Kunde');
    await a.fill('#login-token', 'kunde-password-123');
    signedInAs = 'kunde';
    await a.click('#login-form button[type="submit"]');
    await afterReload(add);
    const pw = add.sent.find((f) => f.type === 'auth' && f.token);
    check('password sign-in names the account', pw?.account === 'Kunde', pw);
    check('signed in to the added account, the first one kept', (await a.textContent('#account-switch')).trim() === 'Kunde'
        && await a.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((x) => x.id).sort().join() === 'kunde,main'));
    await a.evaluate(() => openSettings());
    await add.wait(200);
    check('both in the list, the first one with switch and remove', JSON.stringify(await signedIn()) === JSON.stringify(['test.local: Rename', 'Alex *: Switch,Remove', 'Kunde *: ']), await signedIn());
    check('… and the setting for one list offered', await a.isVisible('#settings-all-accounts'));
    await onDialog(a, (d) => void d.accept());
    await a.locator('#accounts-list li', { hasText: 'Alex' }).locator('button.danger').click();
    await add.wait(100);
    check('removed: only this device forgets it', JSON.stringify(await signedIn()) === JSON.stringify(['test.local: Rename', 'Kunde *: '])
        && await a.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((x) => x.id).join() === 'kunde') && !add.sent.some((f) => f.type === 'device_logout'));
    await add.close();

    // ---- "Add" with an invitation into another account of this relay: the token signs in, the first account stays
    const paste = await start({
        secure: true, before: knows([{ ...MAIN, device: 'test' }]),
        auth: (f) => (f.pair === 'inv-2' ? { type: 'auth', ok: true, device: { id: 'k', token: 'k.key', name: 'Phone' }, account: KUNDE } : byDevice({ test: MAIN, 'k.key': KUNDE })(f)),
    });
    await paste.page.evaluate(() => openSettings());
    await paste.wait(100);
    await paste.page.click('#accounts-join');
    await paste.page.fill('#accounts-link', `http://test.local/#pair=inv-2&e2e=${KEY}`);
    await paste.page.click('#accounts-link-go');
    await afterReload(paste);
    check('pasted invitation: signed in with its token', paste.sent.some((f) => f.type === 'auth' && f.pair === 'inv-2'));
    check('… in the new account, both known to the device', await paste.page.evaluate(() => state.account?.id === 'kunde' && JSON.parse(localStorage.getItem('openfolk-accounts')).map((x) => x.id).sort().join() === 'kunde,main'));
    await paste.close();

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
    const rows = () => m.evaluate(() => [...document.querySelectorAll('#accounts-list li')].map((li) => `${li.querySelector('strong').firstChild.textContent}${li.querySelector('.tag') ? ' *' : ''}: ${[...li.querySelectorAll('button')].map((b) => b.textContent).join(',')}`));
    check('admin: the relay, then every account on it; the one not signed in here gets the invitation, admin and delete, main and oneself nothing',
        JSON.stringify(await rows()) === JSON.stringify(['test.local: Rename', 'Alex *: ', 'Work: Create invitation link,Make admin,Delete']), await rows());
    check('main: nothing of its own to edit (its password is the relay setup)', await m.isHidden('#accounts-own'));
    check('the admin\'s form waits behind "Add"', await m.isHidden('#accounts-new-form') && await m.isVisible('#accounts-join'));
    await m.click('#accounts-join');
    check('… and opens with it in the settings dialog: a link to redeem, a new person', await m.isVisible('#settings-dialog') && await m.evaluate(() => document.getElementById('accounts-new-form').parentElement.id === 'settings-dialog-body')
        && await m.isVisible('#accounts-link') && await m.isVisible('#accounts-new-name') && await m.isHidden('#settings-dialog-actions'));
    await m.fill('#accounts-new-name', 'Kunde');
    await m.click('#accounts-create');
    await admin.wait(300);
    check('created: the form is back in its block, hidden', await m.isHidden('#accounts-new-form') && await m.evaluate(() => document.getElementById('accounts-new-form').parentElement.id === 'settings-accounts'));
    check('create goes to the relay', admin.sent.some((f) => f.type === 'account_create' && f.name === 'Kunde' && f.admin === false));
    const wrap = admin.sent.find((f) => f.type === 'pair_link');
    check('a backend wraps the relay\'s token, it mints none', wrap?.token === 'tok-kunde', wrap);
    check('invitation with link and QR code in the dialog, with a Close row', await m.isVisible('#invite-box') && (await m.inputValue('#invite-box input')).includes('pair=tok-kunde') && (await m.textContent('#invite-box')).includes('Kunde')
        && (await m.textContent('#settings-dialog-title')) === 'Invitation for Kunde' && await m.isVisible('#settings-dialog-actions'));
    await m.click('#settings-dialog [data-close]');
    await admin.wait(100);
    check('closed: the box is back in its block, hidden', await m.isHidden('#settings-dialog') && await m.isHidden('#invite-box') && await m.evaluate(() => document.getElementById('invite-box').parentElement.id === 'settings-accounts'));
    oldBackend = true;
    await m.locator('#accounts-list li').nth(2).locator('button').first().click();
    await admin.wait(300);
    check('new invitation for an existing account', admin.sent.some((f) => f.type === 'account_invite' && f.id === 'work'));
    check('a backend that ignores the token: no link for main to a stranger', (await m.textContent('#accounts-error')).includes('too old'), await m.textContent('#accounts-error'));
    await m.locator('#accounts-list li').nth(2).locator('button').nth(1).click();
    await admin.wait(200);
    check('refusal of the relay shown on the page', (await m.textContent('#accounts-error')).includes('may not'), await m.textContent('#accounts-error'));
    await admin.close();

    // ---- another account edits its own name and password
    const own = await start({
        device: 'w.key', auth: byDevice({ 'w.key': WORK }), before: knows([{ ...WORK, device: 'w.key' }]),
        onSend: async (f, push) => { if (f.type === 'accounts') await push({ type: 'accounts', list: [{ ...WORK, created: '2026-10-01T08:00:00Z' }], current: 'work' }); },
    });
    await own.page.evaluate(() => openAccounts());
    await own.wait(200);
    check('other account: name and password of its own', await own.page.isVisible('#accounts-own') && await own.page.isVisible('#accounts-password'));
    await own.page.fill('#accounts-own-name', 'Work 2');
    await own.page.click('#accounts-own-save');
    await own.wait(200);
    check('the change goes to the relay', own.sent.some((f) => f.type === 'account_update' && f.id === 'work' && f.name === 'Work 2'));
    await own.close();
}
