// Signing out and the choice of accounts: signing out keeps the keys and shows the accounts of this device, a tap signs
// in again; a key unused as the active account for 30 days is dropped and asks for the password; "Forget account" in
// a row's menu; an admin creates a new account and this device is signed in to it at once.
import { onDialog } from './harness.mjs';

const MAIN = { id: 'main', name: 'Alex', admin: true };
const WORK = { id: 'work', name: 'Work', admin: false };
const NEU = { id: 'neu', name: 'Neu', admin: false };
const DAY = 24 * 60 * 60_000;

const byDevice = (keys) => (f) => {
    if (f.device && keys[f.device]) return { type: 'auth', ok: true, account: keys[f.device] };
    return { type: 'auth', ok: false, code: 'device_logged_out', message: 'no', loggedOut: true };
};
/** Before the first load only: the accounts this device knows, and whether it is signed out. */
const knows = (list, signedOut = false) => `if (!sessionStorage.getItem('__accounts')) { sessionStorage.setItem('__accounts', '1'); localStorage.setItem('openfolk-accounts', ${JSON.stringify(JSON.stringify(list))}); ${signedOut ? "localStorage.setItem('openfolk-signed-out', '1');" : ''} }`;
const afterReload = async (h) => {
    await h.page.waitForLoadState('load');
    await h.wait(700);
};
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('openfolk-accounts') || '[]'));
const rowNames = (p) => p.locator('#login-accounts .login-pick strong').allTextContents();

export default async function ({ start, check }) {
    const now = Date.now();

    // ---- signing out at the bottom of the settings (the sidebar's menu has no "Sign out"): the choice, no sign-in with a key
    const h = await start({ auth: byDevice({ test: MAIN, 'w.key': WORK }), before: knows([{ ...MAIN, device: 'test', used: now }, { ...WORK, device: 'w.key', used: now }]) });
    const p = h.page;
    await p.click('#account-switch');
    check('the sidebar\'s account menu: no "Sign out"', await p.isVisible('#account-menu')
        && !(await p.locator('#account-menu').textContent()).includes('Sign out'));
    await p.keyboard.press('Escape');
    await p.evaluate(() => openSettings());
    check('settings: above "Sign out" the account signed in to', (await p.textContent('#settings-signed-in')).startsWith('Signed in as Alex'),
        await p.textContent('#settings-signed-in'));
    await p.click('#accounts-sign-out');
    await afterReload(h);
    const authsAfter = () => h.sent.filter((f) => f.type === 'auth').length;
    const before = authsAfter();
    check('signed out: the start page with both accounts', await p.isVisible('#login-choose') && JSON.stringify(await rowNames(p)) === '["Alex","Work"]', await rowNames(p));
    check('… the form waits behind "another account"', await p.isHidden('#login-token') && await p.isVisible('#login-choose-other'));
    check('… an admin among them: "Create a new account" offered', await p.isVisible('#login-choose-new'));
    check('… both keys kept', (await stored(p)).every((a) => a.device));
    await p.reload();
    await afterReload(h);
    check('reloaded: still signed out, no sign-in sent', await p.isVisible('#login-choose') && authsAfter() === before);
    await p.click('#login-choose-other');
    check('"another account": the form, and the way back', await p.isVisible('#login-token') && await p.isHidden('#login-choose') && await p.isVisible('#login-choose-back'));
    await p.click('#login-choose-back');
    check('back: the choice again', await p.isVisible('#login-choose'));
    await p.click('#login-accounts .login-pick[data-account="work"]');
    await afterReload(h);
    // The page's own sign-in comes first; the shared list's connection for the other account follows (others.js)
    check('a tap on an account: signed in with its key, without a password', h.sent.slice(before).find((f) => f.type === 'auth')?.device === 'w.key'
        && await p.evaluate(() => state.account?.id === 'work' && !localStorage.getItem('openfolk-signed-out')) && await p.isHidden('#login'));
    await h.close();

    // ---- a key unused for 30 days: dropped, the account stays and asks for its password
    const old = await start({
        device: 'w.key',
        auth: (f) => (f.token ? (f.account === 'Work' && f.token === 'work-password-1234'
            ? { type: 'auth', ok: true, device: { id: 'w2', token: 'w2.key', name: 'PC' }, account: WORK }
            : { type: 'auth', ok: false, code: 'wrong_password', message: 'Wrong password.' }) : byDevice({ test: MAIN, 'w2.key': WORK })(f)),
        before: knows([{ ...MAIN, device: 'test', used: now }, { ...WORK, device: 'w.key', used: now - 31 * DAY }]),
    });
    const o = old.page;
    check('expired: the key is gone, the entry stays', await o.evaluate(() => {
        const list = JSON.parse(localStorage.getItem('openfolk-accounts'));
        return list.find((a) => a.id === 'work').device === '' && list.find((a) => a.id === 'main').device === 'test' && !localStorage.getItem('openfolk-device');
    }));
    check('… no sign-in with the old key', !old.sent.some((f) => f.type === 'auth' && f.device === 'w.key'));
    check('… the choice, the account marked "password needed"', await o.isVisible('#login-choose')
        && (await o.textContent('#login-accounts .login-pick[data-account="work"]')).includes('Password needed'));
    await o.click('#login-accounts .login-pick[data-account="work"]');
    check('a tap: the form with the account filled in', await o.isVisible('#login-token') && await o.inputValue('#login-account') === 'Work'
        && (await o.textContent('#login-intro')).includes('30 days'));
    await o.fill('#login-token', 'work-password-1234');
    await o.click('#login-form button[type="submit"]');
    await afterReload(old);
    check('password sign-in: in the account, with a fresh key', await o.evaluate(() => state.account?.id === 'work' && localStorage.getItem('openfolk-device') === 'w2.key'
        && JSON.parse(localStorage.getItem('openfolk-accounts')).find((a) => a.id === 'work').device === 'w2.key'));
    await old.close();

    // ---- the menu of a row: "Forget account"
    const f = await start({ auth: byDevice({ test: MAIN, 'w.key': WORK }), before: knows([{ ...MAIN, device: 'test', used: now }, { ...WORK, device: 'w.key', used: now }], true) });
    const q = f.page;
    check('signed out on load: the choice', await q.isVisible('#login-choose'));
    await q.click('#login-accounts .login-pick[data-account="main"]');
    await afterReload(f);
    await q.evaluate(() => openSettings());
    check('settings: "Sign out" is the last block, naming the account', await q.isVisible('#accounts-sign-out')
        && (await q.textContent('#settings-signed-in')).includes('Alex')
        && await q.evaluate(() => document.getElementById('settings-sign-out') === document.getElementById('settings-sign-out').parentElement.lastElementChild));
    await q.click('#accounts-sign-out');
    await afterReload(f);
    check('… and leads to the choice', await q.isVisible('#login-choose'));
    await q.locator('#login-accounts li', { hasText: 'Work' }).locator('.login-more').click();
    check('the "…" menu holds "Forget account"', await q.locator('#login-accounts li', { hasText: 'Work' }).locator('.login-account-menu').isVisible());
    await onDialog(q, (d) => d.accept());
    await q.locator('#login-accounts li', { hasText: 'Work' }).locator('.login-account-menu button').click();
    await f.wait(200);
    check('forgotten: gone from the choice and from the device', JSON.stringify(await rowNames(q)) === '["Alex"]' && (await stored(q)).map((a) => a.id).join() === 'main');
    await f.close();

    // ---- a new account from the choice: into the admin account, create, redeem the invitation here
    const n = await start({
        secure: true,
        auth: (x) => (x.pair === 'tok-neu' ? { type: 'auth', ok: true, device: { id: 'n', token: 'n.key', name: 'PC' }, account: NEU } : byDevice({ test: MAIN, 'n.key': NEU })(x)),
        before: knows([{ ...MAIN, device: 'test', used: now }], true),
        onSend: async (x, push) => {
            if (x.type === 'account_create') await push({ type: 'account_created', account: { ...NEU, created: '2026-11-10T08:00:00Z' }, pair: { token: 'tok-neu', expiresAt: '2026-11-10T08:15:00Z' } });
            if (x.type === 'pair_link') await push({ type: 'pair_link', machine: 'desk', url: `https://test.local/#pair=${x.token}&e2e=${Buffer.alloc(32, 7).toString('base64url')}`, expiresAt: '2026-11-10T08:15:00Z', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', e2e: true });
        },
    });
    const r = n.page;
    await r.click('#login-choose-new');
    await r.fill('#text-input', 'Neu');
    await r.click('#text-submit');
    await afterReload(n);
    await n.wait(800);
    check('new account: created by the admin account', n.sent.some((x) => x.type === 'account_create' && x.name === 'Neu' && x.admin === false));
    check('… its invitation redeemed on this device', n.sent.some((x) => x.type === 'auth' && x.pair === 'tok-neu'));
    check('… and the page in the new account, the admin account kept', await r.evaluate(() => state.account?.id === 'neu'
        && JSON.parse(localStorage.getItem('openfolk-accounts')).map((a) => a.id).sort().join() === 'main,neu') && await r.isHidden('#settings-dialog'));
    await n.close();
}
