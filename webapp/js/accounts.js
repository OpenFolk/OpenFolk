/* OpenFolk web app: accounts – the ones this device is signed in to, switching between them, managing them. */
import { locale, t } from './i18n.js';
import { ACCOUNTS_KEY, DEVICE_KEY, deviceAccounts, el, loadedAccount, node, state, storage } from './core.js';
import { clockTime, send, upper } from './e2e.js';
import { menuButton } from './menus.js';
import { showLogin } from './connection.js';
import { openSettingsAt, renderPairLink } from './settings.js';
import { closeSettings } from './panes.js';

/** Passwords of accounts other than main; the relay requires as many characters. */
const MIN_PASSWORD = 16;

/** @param {{ id: string, name: string, admin: boolean, device: string }[]} list */
function save(list) {
    storage.set(ACCOUNTS_KEY, JSON.stringify(list));
}

/**
 * After a sign-in: remember the account with this device's key for it. True when it is another account than the
 * page was loaded for; then the page loads again, so everything it keeps per account belongs to the new one.
 * @param {{ id: string, name: string, admin: boolean } | undefined} account missing for a relay without accounts
 */
export function rememberAccount(account) {
    state.account = account || null;
    state.stashedDevice = '';
    el.loginCancel.hidden = true;
    const device = storage.get(DEVICE_KEY);
    if (account && device) {
        const known = deviceAccounts();
        const at = known.findIndex((a) => a.id === account.id || a.device === device);
        const list = known.filter((a) => a.id !== account.id && a.device !== device);
        // In its place, so the order in the menu does not change with every sign-in
        list.splice(at < 0 ? list.length : at, 0, { id: account.id, name: account.name, admin: account.admin, device });
        save(list);
    }
    renderAccountSwitch();
    return !!account && account.id !== loadedAccount;
}

/** The current account's key no longer works (device logged out, account deleted): on to another one, if any. */
export function dropCurrentAccount() {
    const device = storage.get(DEVICE_KEY);
    const rest = deviceAccounts().filter((a) => a.device !== device);
    save(rest);
    storage.remove(DEVICE_KEY);
    if (!rest.length) return false;
    storage.set(DEVICE_KEY, rest[0].device);
    location.reload();
    return true;
}

/** Another account's key no longer works (others.js): it leaves this device's list. */
export function forgetAccount(id) {
    save(deviceAccounts().filter((a) => a.id !== id || a.device === storage.get(DEVICE_KEY)));
    renderAccountSwitch();
}

/** @param {string} id */
export function switchAccount(id) {
    const a = deviceAccounts().find((x) => x.id === id);
    if (!a || a.device === storage.get(DEVICE_KEY)) return;
    storage.set(DEVICE_KEY, a.device);
    location.reload();
}

/**
 * Sign in to one more account (name and password, or its invitation link); the current one stays signed in. Its key
 * stays stored and is only skipped meanwhile, so going back, a reload or closing the app all end up in it again.
 */
export function addAccount() {
    state.stashedDevice = storage.get(DEVICE_KEY);
    const ws = state.ws;
    state.ws = null;
    state.signedIn = false;
    if (ws) ws.close();
    closeSettings();
    showLogin();
    el.loginIntro.textContent = t('accounts.addIntro');
    el.loginCancel.hidden = false;
    showAccountField();
}

/** The account field of the login, which stays hidden as long as main is all there is. */
export function showAccountField() {
    el.loginAccount.hidden = false;
    el.loginOtherAccount.hidden = true;
    el.loginAccount.focus();
}

export function cancelAddAccount() {
    location.reload();
}

// ---------------------------------------------------------------- Switching in the sidebar

/** The name of the account in the sidebar; only when there is more than main to tell apart. */
export function renderAccountSwitch() {
    const current = state.account;
    const show = !!current && (deviceAccounts().length > 1 || current.id !== 'main');
    el.accountSwitch.hidden = !show;
    el.settingsAccounts.hidden = !current;
    if (show) {
        el.accountSwitch.querySelector('span').textContent = current.name;
        el.accountSwitch.title = t('accounts.switchTitle');
    }
}

export function openAccountMenu() {
    const device = storage.get(DEVICE_KEY);
    const entries = deviceAccounts().map((a) => {
        const b = menuButton(a.device === device ? 'check' : 'person', a.name, a.device === device ? 'current' : undefined);
        b.dataset.account = a.id;
        return b;
    });
    const add = menuButton('add', t('accounts.add'));
    add.dataset.accountAction = 'add';
    const manage = menuButton('sliders', t('accounts.manage'));
    manage.dataset.accountAction = 'manage';
    el.accountMenu.replaceChildren(...entries, add, manage);
    el.accountMenu.hidden = false;
}

// ---------------------------------------------------------------- Managing (the accounts block of the settings)

/** The token of the invitation being made: the link a backend sends back must carry it. */
let pendingInvite = null;

export function openAccounts() {
    openSettingsAt(el.settingsAccounts);
}

/** The accounts block, its fields emptied and the list fresh from the relay. */
export function loadAccounts() {
    el.accountsError.hidden = true;
    el.inviteBox.hidden = true;
    el.inviteBox.replaceChildren();
    el.accountsPassword.value = '';
    el.accountsNewName.value = '';
    el.accountsNewAdmin.checked = false;
    el.accountsOwnName.value = state.account ? state.account.name : '';
    el.accountsAdmin.hidden = true;
    el.accountsList.replaceChildren(node('li', 'empty-small', t('common.loading')));
    send({ type: 'accounts' });
}

/**
 * The relay's answer "accounts": all of them for an admin, otherwise the own one.
 * @param {{ id: string, name: string, admin: boolean, created: string }[]} list
 * @param {string} current
 */
export function renderAccounts(list, current) {
    const own = list.find((a) => a.id === current);
    if (own) {
        state.account = { id: own.id, name: own.name, admin: own.admin };
        // The name may have changed: also in the list of this device's accounts
        save(deviceAccounts().map((a) => (a.id === own.id ? { ...a, name: own.name, admin: own.admin } : a)));
        renderAccountSwitch();
        if (document.activeElement !== el.accountsOwnName) el.accountsOwnName.value = own.name;
    }
    const main = current === 'main';
    // The owner's password is the relay's setup, nothing to change here
    /** @type {HTMLElement} */ (el.accountsPassword.closest('label')).hidden = main;
    el.accountsOwnHint.textContent = t(main ? 'accounts.mainPasswordHint' : 'accounts.passwordHint');
    el.accountsAdmin.hidden = !own || !own.admin;
    el.accountsList.replaceChildren();
    for (const a of list) {
        const li = node('li', a.id === current ? 'current-device' : '');
        const text = node('div', 'd-text');
        const name = node('strong', '', a.name);
        if (a.admin) name.appendChild(node('span', 'tag', t('accounts.admin')));
        if (a.id === current) name.appendChild(node('span', 'tag', t('accounts.thisAccount')));
        text.append(name, node('span', '', a.created ? t('accounts.created', { date: new Date(a.created).toLocaleDateString(locale()) }) : t('accounts.mainAccount')));
        li.append(text);
        // Nobody changes their own rights or deletes their own account; main always stays
        if (a.id !== current && a.id !== 'main') {
            const invite = node('button', 'btn small', t('accounts.invite'));
            invite.type = 'button';
            invite.addEventListener('click', () => {
                accountError('');
                send({ type: 'account_invite', id: a.id });
            });
            const admin = node('button', 'btn small', t(a.admin ? 'accounts.removeAdmin' : 'accounts.makeAdmin'));
            admin.type = 'button';
            admin.addEventListener('click', () => send({ type: 'account_update', id: a.id, admin: !a.admin }));
            const remove = node('button', 'btn small danger', t('accounts.delete'));
            remove.type = 'button';
            remove.addEventListener('click', () => {
                if (confirm(t('accounts.deleteConfirm', { name: a.name }))) send({ type: 'account_delete', id: a.id });
            });
            const actions = node('div', 'account-actions');
            actions.append(invite, admin, remove);
            li.append(actions);
        }
        el.accountsList.appendChild(li);
    }
}

/** @param {string} message */
export function accountError(message) {
    el.accountsError.textContent = message;
    el.accountsError.hidden = !message;
}

export function saveOwnAccount() {
    if (!state.account) return;
    accountError('');
    const name = el.accountsOwnName.value.trim();
    const password = el.accountsPassword.value;
    if (password && password.length < MIN_PASSWORD) {
        accountError(t('accounts.passwordShort', { count: MIN_PASSWORD }));
        return;
    }
    const change = {};
    if (name && name !== state.account.name) change.name = name;
    if (password) change.password = password;
    if (!Object.keys(change).length) return;
    send({ type: 'account_update', id: state.account.id, ...change });
    el.accountsPassword.value = '';
}

export function createAccount() {
    accountError('');
    const name = el.accountsNewName.value.trim();
    if (!name) {
        el.accountsNewName.focus();
        return;
    }
    el.accountsCreate.disabled = true;
    send({ type: 'account_create', name, admin: el.accountsNewAdmin.checked });
}

/**
 * "account_created" and "account_invite": a backend wraps the token with the end-to-end key and the QR code (the key
 * never leaves the backends and paired devices, this page cannot export it).
 * @param {{ account: { id: string, name: string }, pair: { token: string, expiresAt: string } }} f
 */
export function receiveAccountCreated(f) {
    el.accountsCreate.disabled = false;
    el.accountsNewName.value = '';
    el.accountsNewAdmin.checked = false;
    pendingInvite = { token: f.pair.token, name: f.account.name };
    send({ type: 'pair_link', token: f.pair.token, expiresAt: f.pair.expiresAt });
}

/**
 * A pairing link from a backend: the invitation, if one is being made. A backend from before accounts ignores the
 * token and sends a link to the main account instead; that one must not go to someone else.
 * @param {{ url: string, expiresAt: string, svg: string, e2e: boolean, machine?: string }} link
 * @returns {boolean} whether it was the invitation
 */
export function receiveInvite(link) {
    if (!pendingInvite) return false;
    const invite = pendingInvite;
    pendingInvite = null;
    if (!link.url.includes(`pair=${invite.token}`)) {
        accountError(t('accounts.inviteOld', { machine: upper(link.machine || '') }));
        return true;
    }
    renderPairLink(link, el.inviteBox, t('accounts.inviteHint', { name: invite.name, until: clockTime(link.expiresAt) }));
    send({ type: 'accounts' });
    return true;
}
