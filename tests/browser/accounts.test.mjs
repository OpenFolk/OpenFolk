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

    // ---- only main: the switch is there all the same, it holds signing out
    const one = await start({ auth: byDevice({ test: MAIN }) });
    check('only main: the switch names the account', await one.page.isVisible('#account-switch') && (await one.page.textContent('#account-switch')).trim() === 'Alex');
    check('… and remembered with its key', await one.page.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts')).map((a) => `${a.id}:${a.device}`).join() === 'main:test'));
    await one.close();

    // ---- the login: the account field only on request
    const fresh = await start({ device: null });
    await fresh.page.selectOption('#login-method', 'password');
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
    check('menu: both accounts, new account (admin) and the settings, no signing out', entries.length === 4 && entries[0].includes('Alex') && entries[1].includes('Work') && entries[2].includes('New account') && entries[3].includes('Accounts') && !entries.some((e) => e.includes('Sign out')), entries);
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
    check('the list: the relay, then the account, marked, nothing to remove, only edit', JSON.stringify(await signedIn()) === JSON.stringify(['test.local: Rename', 'Alex *: Edit']), await signedIn());
    // "Add" (an admin: the form) with the address of this relay: the login with the account field
    await a.click('#accounts-join');
    await a.fill('#accounts-link', 'http://test.local');
    await a.click('#accounts-link-go');
    await add.wait(200);
    check('adding: the login with the password method, the account field and a way back', await a.inputValue('#login-method') === 'password' && await a.isVisible('#login') && await a.isVisible('#login-account') && await a.isVisible('#login-cancel'));
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
    check('both in the list, the first one with switch and remove', JSON.stringify(await signedIn()) === JSON.stringify(['test.local: Rename', 'Alex *: Switch,Remove', 'Kunde *: Edit']), await signedIn());
    check('… and the setting for one list offered', await a.isVisible('#settings-all-accounts'));
    await onDialog(a, (d) => void d.accept());
    await a.locator('#accounts-list li', { hasText: 'Alex' }).locator('button.danger').click();
    await add.wait(100);
    check('removed: only this device forgets it', JSON.stringify(await signedIn()) === JSON.stringify(['test.local: Rename', 'Kunde *: Edit'])
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
    check('admin: the relay, then every account on it; the one not signed in here gets the invitation and "Edit", main (oneself) "Edit"',
        JSON.stringify(await rows()) === JSON.stringify(['test.local: Rename', 'Alex *: Edit', 'Work: Create invitation link,Edit']), await rows());
    check('… on a phone the buttons go below the text, which keeps its width', await m.evaluate(() => {
        const li = document.querySelectorAll('#accounts-list li')[2];
        const text = li.querySelector('.d-text').getBoundingClientRect();
        const actions = li.querySelector('.account-actions').getBoundingClientRect();
        return actions.top >= text.bottom - 1 && text.width >= 180;
    }));
    check('… a row with one button keeps it beside the text', await m.evaluate(() => {
        const li = document.querySelectorAll('#accounts-list li')[1];
        const text = li.querySelector('.d-text').getBoundingClientRect();
        const actions = li.querySelector('.account-actions').getBoundingClientRect();
        return actions.left >= text.right - 1 && Math.abs(actions.top - text.top) < text.height;
    }));    check('main: its form waits behind "Edit"', await m.isHidden('#accounts-own'));
    await m.locator('#accounts-list li').nth(1).locator('button', { hasText: 'Edit' }).click();
    check('main: "Edit" opens its name in the dialog, no password (that is the relay setup)', await m.isVisible('#settings-dialog') && (await m.textContent('#settings-dialog-title')) === 'Edit Alex'
        && await m.locator('#accounts-own-name').inputValue() === 'Alex' && await m.isHidden('#accounts-password'));
    // The own picture: chosen in the dialog, made small and sent to the relay at once
    check('… with its picture field: initials, "Choose picture", no "Remove" yet', await m.isVisible('#accounts-own-avatar .avatar') && await m.isVisible('#accounts-own-avatar button:has-text("Choose picture")')
        && await m.isHidden('#accounts-own-avatar button:has-text("Remove picture")'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
    await m.setInputFiles('#accounts-own-avatar input[type=file]', { name: 'me.png', mimeType: 'image/png', buffer: png });
    await admin.wait(300);
    const picked = admin.sent.findLast((f) => f.type === 'account_update' && 'avatar' in f);
    check('… a picture goes to the relay for the own account, as a small JPEG', picked?.id === 'main' && String(picked.avatar).startsWith('data:image/jpeg;base64,') && picked.avatar.length < 150_000, picked && { id: picked.id, start: String(picked.avatar).slice(0, 30) });
    check('… shown in the dialog with "Remove"', await m.isVisible('#accounts-own-avatar .avatar img') && await m.isVisible('#accounts-own-avatar button:has-text("Remove picture")'));
    await m.click('#accounts-own-avatar button:has-text("Remove picture")');
    await admin.wait(100);
    check('… "Remove" sends null', admin.sent.findLast((f) => f.type === 'account_update' && 'avatar' in f)?.avatar === null);
    check('… no save or close button, it saves as a field is left', await m.locator('#accounts-own button').allTextContents().then((b) => JSON.stringify(b) === JSON.stringify(['Choose picture', 'Remove picture'])));
    await m.fill('#accounts-own-name', 'Alex B.');
    await m.press('#accounts-own-name', 'Enter');
    await admin.wait(100);
    check('… Enter renames main at the relay, the dialog stays', admin.sent.some((f) => f.type === 'account_update' && f.id === 'main' && f.name === 'Alex B.' && !('password' in f)) && await m.isVisible('#settings-dialog'));
    await m.keyboard.press('Escape');
    await admin.wait(100);
    check('the admin\'s form waits behind "Add"', await m.isHidden('#accounts-new-form') && await m.isVisible('#accounts-join'));
    await m.click('#accounts-join');
    check('… and opens with it in the settings dialog: a link to redeem, a new person', await m.isVisible('#settings-dialog') && await m.evaluate(() => document.getElementById('accounts-new-form').parentElement.id === 'settings-dialog-body')
        && await m.isVisible('#accounts-link') && await m.isVisible('#accounts-new-name') && await m.isHidden('#settings-dialog-actions'));
    check('… the name comes first and has the focus', await m.evaluate(() => {
        const name = document.getElementById('accounts-new-name');
        const link = document.getElementById('accounts-link');
        return document.activeElement === name && !!(name.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    await m.fill('#accounts-new-name', 'Kunde');
    await m.click('#accounts-create');
    await admin.wait(300);
    check('created: the form is back in its block, hidden', await m.isHidden('#accounts-new-form') && await m.evaluate(() => document.getElementById('accounts-new-form').parentElement.id === 'settings-accounts'));
    check('create goes to the relay', admin.sent.some((f) => f.type === 'account_create' && f.name === 'Kunde' && f.admin === false));
    check('… no invitation popping up: no link asked for, no dialog, the list fresh', !admin.sent.some((f) => f.type === 'pair_link')
        && await m.isHidden('#settings-dialog') && await m.isHidden('#invite-box') && admin.sent.filter((f) => f.type === 'accounts').length >= 2);
    // The invitation from the account's row
    await m.locator('#accounts-list li').nth(2).locator('button').first().click();
    await admin.wait(300);
    const wrap = admin.sent.find((f) => f.type === 'pair_link');
    check('a backend wraps the relay\'s token, it mints none', wrap?.token === 'tok-work', wrap);
    check('invitation with link and QR code in the dialog, with a Close row', await m.isVisible('#invite-box') && (await m.inputValue('#invite-box input')).includes('pair=tok-work') && (await m.textContent('#invite-box')).includes('Work')
        && (await m.textContent('#settings-dialog-title')) === 'Invitation for Work' && await m.isVisible('#settings-dialog-actions'));
    await m.click('#settings-dialog-actions [data-close]');
    await admin.wait(100);
    check('closed: the box is back in its block, hidden', await m.isHidden('#settings-dialog') && await m.isHidden('#invite-box') && await m.evaluate(() => document.getElementById('invite-box').parentElement.id === 'settings-accounts'));
    oldBackend = true;
    await m.locator('#accounts-list li').nth(2).locator('button').first().click();
    await admin.wait(300);
    check('new invitation for an existing account', admin.sent.some((f) => f.type === 'account_invite' && f.id === 'work'));
    check('a backend that ignores the token: no link for main to a stranger', (await m.textContent('#accounts-error')).includes('too old'), await m.textContent('#accounts-error'));
    // "Edit" of an account without reach (a relay from before person chats): the account itself, no bots
    await m.locator('#accounts-list li').nth(2).locator('button', { hasText: 'Edit' }).click();
    await admin.wait(200);
    const setupButtons = await m.locator('#setup-box button').allTextContents();
    check('"Edit": name, admin and delete in the dialog, delete at the bottom, no bots without reach', await m.isVisible('#setup-box') && await m.locator('#setup-box .setup-account .setup-name input').inputValue() === 'Work'
        && JSON.stringify(setupButtons) === JSON.stringify(['Choose picture', 'Remove picture', 'Make admin', 'Delete']) && await m.locator('#setup-box .setup-bot').count() === 0, setupButtons);
    // An admin gives another account a picture
    await m.setInputFiles('#setup-box .account-avatar input[type=file]', { name: 'work.png', mimeType: 'image/png', buffer: png });
    await admin.wait(300);
    const theirs = admin.sent.findLast((f) => f.type === 'account_update' && 'avatar' in f);
    check('an admin sets another account\'s picture', theirs?.id === 'work' && String(theirs.avatar).startsWith('data:image/jpeg;base64,'), theirs && theirs.id);
    await m.locator('#setup-box button', { hasText: 'Make admin' }).click();
    await admin.wait(200);
    check('refusal of the relay shown above the dialog', (await m.textContent('#toast')).includes('may not'), await m.textContent('#toast'));
    await m.fill('#setup-box .setup-account .setup-name input', 'Werk');
    await m.press('#setup-box .setup-account .setup-name input', 'Enter');
    await admin.wait(100);
    check('the name of another account changes from there as the field is left', admin.sent.some((f) => f.type === 'account_update' && f.id === 'work' && f.name === 'Werk'));
    await m.keyboard.press('Escape');

    // A relay from before person chats names no reach and would drop "customer": the choice is not offered
    await m.click('#accounts-join');
    await admin.wait(100);
    check('relay without reach: no "Customer" choice', await m.isHidden('#accounts-new-customer'));
    await m.click('#accounts-new-cancel');

    // Person chats: a customer reaches only the admins; a relay that names the reach gets the switch in the list
    list[1] = { ...WORK, created: '2026-10-01T08:00:00Z', reach: 'admins' };
    await m.evaluate(() => send({ type: 'accounts' }));
    await admin.wait(200);
    check('a customer account: tagged, with the same two buttons', (await rows())[2] === 'Work *: Create invitation link,Edit', await rows());
    await m.locator('#accounts-list li').nth(2).locator('button', { hasText: 'Edit' }).click();
    await admin.wait(200);
    check('… "Reaches everyone" in its dialog, and the bots below', await m.locator('#setup-box button', { hasText: 'Reaches everyone' }).isVisible() && await m.locator('#setup-box .setup-bot').count() === 2);
    await m.locator('#setup-box button', { hasText: 'Reaches everyone' }).click();
    await admin.wait(100);
    check('… which goes to the relay as reach "all"', admin.sent.some((f) => f.type === 'account_update' && f.id === 'work' && f.reach === 'all'));
    await onDialog(m, (d) => d.accept());
    await m.locator('#setup-box button', { hasText: 'Delete' }).click();
    await admin.wait(200);
    check('"Delete" in the dialog: to the relay, the dialog closed', admin.sent.some((f) => f.type === 'account_delete' && f.id === 'work') && await m.isHidden('#setup-box'));
    await m.click('#accounts-join');
    await m.fill('#accounts-new-name', 'Shop');
    await m.check('#accounts-new-customer');
    await m.click('#accounts-create');
    await admin.wait(300);
    check('a new customer: created with reach "admins"', admin.sent.some((f) => f.type === 'account_create' && f.name === 'Shop' && f.reach === 'admins'));
    await admin.close();

    // ---- another account edits its own name and password
    const own = await start({
        device: 'w.key', auth: byDevice({ 'w.key': WORK }), before: knows([{ ...WORK, device: 'w.key' }]),
        onSend: async (f, push) => { if (f.type === 'accounts') await push({ type: 'accounts', list: [{ ...WORK, created: '2026-10-01T08:00:00Z' }], current: 'work' }); },
    });
    await own.page.evaluate(() => openAccounts());
    await own.wait(200);
    await own.page.locator('#accounts-list li.current-device button', { hasText: 'Edit' }).click();
    check('other account: name and password of its own behind "Edit"', await own.page.isVisible('#accounts-own') && await own.page.isVisible('#accounts-password'));
    await own.page.fill('#accounts-own-name', 'Work 2');
    await own.page.press('#accounts-own-name', 'Enter');
    await own.wait(200);
    check('the change goes to the relay', own.sent.some((f) => f.type === 'account_update' && f.id === 'work' && f.name === 'Work 2'));
    await own.close();
}
