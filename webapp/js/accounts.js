/* OpenFolk web app: accounts – everything that is a sign-in. Where this device is signed in (accounts and relays, one
   list), adding one with any link or an address, switching, one's own account, and managing the accounts of the relay. */
import { locale, t } from './i18n.js';
import { ACCOUNTS_KEY, DEVICE_KEY, SIGNED_OUT_KEY, deviceAccounts, deviceRelays, el, loadedAccount, node, relayEntry, state, storage, toast } from './core.js';
import { adoptPairingLink, clockTime, send, upper } from './e2e.js';
import { ICONS, askText, closeSettingsDialog, menuButton, openSettingsDialog } from './menus.js';
import { connect, showLogin } from './connection.js';
import { openSettingsAt, renderPairLink } from './settings.js';
import { closeSettings } from './panes.js';
import { bundled, canScanQr, parsePairingLink, scanQrCode } from './platform.js';
import { currentRelayName, goToRelay, isCurrentRelay, otherRelays, ownRelayAddress, removeRelay, renameRelay, switchRelay } from './relays.js';
import { accountsOf, openOtherChat, showAllAccounts } from './others.js';
import { confirmDialog } from './dialogs.js';
import { openSetup, setupAccountsChanged } from './setups.js';

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
    storage.remove(SIGNED_OUT_KEY);
    const device = storage.get(DEVICE_KEY);
    if (account && device) {
        const known = deviceAccounts();
        const at = known.findIndex((a) => a.id === account.id || a.device === device);
        const list = known.filter((a) => a.id !== account.id && a.device !== device);
        // In its place, so the order in the menu does not change with every sign-in
        list.splice(at < 0 ? list.length : at, 0, { id: account.id, name: account.name, admin: account.admin, device, used: Date.now() });
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
    const next = rest.find((a) => a.device);
    if (!next) return false;
    storage.set(DEVICE_KEY, next.device);
    location.reload();
    return true;
}

/** Another account's key no longer works (others.js), or the user removes it here: it leaves this device's list. */
export function forgetAccount(id) {
    save(deviceAccounts().filter((a) => a.id !== id || a.device === storage.get(DEVICE_KEY)));
    renderAccountSwitch();
    renderAccountList();
}

/** @param {string} id */
export function switchAccount(id) {
    const a = deviceAccounts().find((x) => x.id === id);
    if (!a || (a.device && a.device === storage.get(DEVICE_KEY))) return;
    // Its key expired: the start page with the form for it
    if (!a.device) {
        storage.set(SIGNED_OUT_KEY, '1');
        sessionSet(LOGIN_FOR_KEY, a.id);
    } else {
        storage.set(DEVICE_KEY, a.device);
    }
    location.reload();
}

// ---------------------------------------------------------------- Signing out, and the choice of accounts

/** The account the form is for after a tap on one whose key expired; survives the load in between. */
const LOGIN_FOR_KEY = 'openfolk-login-for';
/** The name of the account to create once signed in as an admin; survives the load in between. */
const CREATE_KEY = 'openfolk-create-account';
const sessionGet = (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } };
const sessionSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
const sessionRemove = (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } };

/** The form instead of the choice: "Sign in to another account", or an account whose key expired. */
let formWanted = false;

/** Back to the choice of accounts; the keys stay, a tap on an account signs in again. */
export function signOut() {
    storage.set(SIGNED_OUT_KEY, '1');
    location.reload();
}

/** Whether the start page shows the accounts of this device rather than the form. */
function choosing() {
    if (formWanted || state.stashedDevice || state.pairToken) return false;
    return deviceAccounts().length > 0 && (!!storage.get(SIGNED_OUT_KEY) || !storage.get(DEVICE_KEY));
}

/** The start page's choice (connection.js showLogin): a row per account, its "…" menu, new account, another account. */
export function renderChooser() {
    const wanted = sessionGet(LOGIN_FOR_KEY);
    sessionRemove(LOGIN_FOR_KEY);
    const pending = wanted && deviceAccounts().find((a) => a.id === wanted);
    if (pending) {
        loginFor(pending);
        return;
    }
    const show = choosing();
    el.loginChoose.hidden = !show;
    el.loginForm.classList.toggle('choosing', show);
    el.loginChooseBack.hidden = show || !formWanted || !deviceAccounts().length;
    if (!show) return;
    el.loginIntro.textContent = t('login.chooseIntro');
    const list = deviceAccounts();
    el.loginAccounts.replaceChildren(...list.map((a) => {
        const li = node('li');
        const pick = node('button', 'login-pick');
        pick.type = 'button';
        pick.dataset.account = a.id;
        pick.append(node('strong', '', a.name || 'Main'), node('span', '', a.device ? (a.admin ? t('accounts.admin') : '') : t('login.choosePassword')));
        pick.addEventListener('click', () => pickAccount(a));
        const more = node('button', 'login-more');
        more.type = 'button';
        more.title = t('login.chooseMore');
        more.setAttribute('aria-label', t('login.chooseMore'));
        more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
        const menu = node('div', 'menu login-account-menu');
        menu.hidden = true;
        const forget = node('button', 'danger');
        forget.type = 'button';
        forget.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.delete}</svg>`;
        forget.appendChild(node('span', '', t('login.forget')));
        forget.addEventListener('click', () => void forgetOnDevice(a));
        menu.appendChild(forget);
        more.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const open = menu.hidden;
            closeChooserMenus();
            menu.hidden = !open;
        });
        li.append(pick, more, menu);
        return li;
    }));
    el.loginChooseNew.hidden = !list.some((a) => a.admin && a.device);
}

export function closeChooserMenus() {
    for (const m of el.loginAccounts.querySelectorAll('.login-account-menu')) /** @type {HTMLElement} */ (m).hidden = true;
}

/** @param {{ id: string, name: string, device: string }} a */
function pickAccount(a) {
    if (!a.device) {
        loginFor(a);
        return;
    }
    storage.remove(SIGNED_OUT_KEY);
    storage.set(DEVICE_KEY, a.device);
    location.reload();
}

/**
 * The form for one account whose key expired, its name filled in (main: the relay's password, no name).
 * @param {{ id: string, name: string }} a
 */
function loginFor(a) {
    formWanted = true;
    renderChooser();
    el.loginIntro.textContent = t('login.chooseExpired', { name: a.name || 'Main' });
    if (a.id !== 'main') showAccountField();
    el.loginAccount.value = a.id === 'main' ? '' : a.name;
    el.loginToken.focus();
}

/** "Sign in to another account": the form as it always was. */
export function showLoginForm() {
    formWanted = true;
    el.loginAccount.value = '';
    renderChooser();
    el.loginIntro.textContent = t(bundled ? 'login.introApp' : 'login.intro');
    el.loginToken.focus();
}

/** "Back to the accounts" below the form. */
export function backToChooser() {
    formWanted = false;
    el.loginError.hidden = true;
    renderChooser();
}

/**
 * "Forget account" in a row's menu: the entry and its key leave this device. The key stays valid on the relay until it
 * expires there; signing it out would need a connection with it.
 * @param {{ id: string, name: string, device: string }} a
 */
async function forgetOnDevice(a) {
    closeChooserMenus();
    if (!(await confirmDialog(t('accounts.forgetConfirm', { name: a.name || 'Main' })))) return;
    const rest = deviceAccounts().filter((x) => x.id !== a.id);
    save(rest);
    if (a.device && a.device === storage.get(DEVICE_KEY)) storage.remove(DEVICE_KEY);
    if (!rest.length) {
        storage.remove(SIGNED_OUT_KEY);
        showLoginForm();
        return;
    }
    renderChooser();
}

/** A new account of this relay, this device signed in to it at once; only an admin may create one. */
export function newAccount() {
    askText({
        title: t('login.newTitle'), hint: t('login.newHint'), submit: t('accounts.createButton'), maxLength: 60,
        done: (name) => {
            if (state.signedIn && state.account && state.account.admin) {
                createForThisDevice(name);
                return;
            }
            // From the start page: first into an admin account of this device, then on (continueNewAccount)
            const admin = deviceAccounts().find((a) => a.admin && a.device);
            if (!admin) return;
            sessionSet(CREATE_KEY, name);
            storage.remove(SIGNED_OUT_KEY);
            storage.set(DEVICE_KEY, admin.device);
            location.reload();
        },
    });
}

/** After a sign-in: an account to create that the start page asked for. */
export function continueNewAccount() {
    const name = sessionGet(CREATE_KEY);
    if (!name) return;
    sessionRemove(CREATE_KEY);
    if (state.account && state.account.admin) createForThisDevice(name);
}

/** The invitation of the account being created goes to this device, not on display (receiveInvite). */
let selfInvite = false;

/** @param {string} name */
function createForThisDevice(name) {
    selfInvite = true;
    send({ type: 'account_create', name, admin: false });
}

/**
 * A refused account_create of createForThisDevice: a toast, since the settings' error line may not be in sight.
 * @param {string} message
 */
export function newAccountFailed(message) {
    if (!selfInvite) return false;
    selfInvite = false;
    toast(message);
    return true;
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

// ---------------------------------------------------------------- "Add": any link, or an address

/**
 * What the user was given: an invitation into another account of this relay, a pairing link of another relay, or just
 * an address. The link decides; an address alone asks for account and password.
 * @param {string} text
 */
async function takeAny(text) {
    const link = parsePairingLink(text);
    if (!link) {
        accountError(t('login.relayInvalid'));
        return;
    }
    // The admin's form sits in the settings dialog: out of the way before the login or the other relay's page
    closeSettingsDialog();
    if (link.address !== ownRelayAddress()) {
        goToRelay(text);
        return;
    }
    if (!link.params.get('pair')) {
        addAccount();
        return;
    }
    // An invitation into another account of this relay: the token signs in, the account so far stays (credentials())
    closeSettings();
    await adoptPairingLink(link.params);
    if (state.ws) state.ws.close(); else connect();
}

/** "Add": an admin gets the form (a link to redeem, or a new person on this relay), anyone else the question for the link. */
export function joinAny() {
    accountError('');
    if (state.account && state.account.admin) {
        showNewAccountForm(true);
        return;
    }
    askText({ title: t('accounts.joinTitle'), hint: t('accounts.joinHint'), submit: t('accounts.join'), done: (text) => void takeAny(text) });
}

/** The link field of the form. */
export function redeemLink() {
    const text = el.accountsLink.value.trim();
    if (!text) {
        el.accountsLink.focus();
        return;
    }
    el.accountsLink.value = '';
    void takeAny(text);
}

export async function scanAny() {
    accountError('');
    const text = await scanQrCode(t('accounts.scanHint'));
    if (text) await takeAny(text);
}

// ---------------------------------------------------------------- The one list: relays, and the accounts on them

/** What the relay last answered to "accounts": all of them for an admin, otherwise the own one; [] before or without accounts. */
let relayAccounts = [];

/**
 * Rows grouped by relay: a head per relay, then its accounts. On the page's own relay every account this device is
 * signed in to or the relay listed (an admin sees them all), elsewhere only the accounts of this device. The browser's
 * page belongs to its relay; other relays are links there.
 */
function accountRows() {
    const device = storage.get(DEVICE_KEY);
    const current = state.account ? state.account.id : 'main';
    const admin = !!state.account && state.account.admin;
    // The browser's page keeps its own relay in the list too, so the links of other relays have something to sit next to
    const here = relayEntry(ownRelayAddress());
    const relays = deviceRelays();
    const rows = [];
    const head = (r) => rows.push({ head: true, relay: r, current: isCurrentRelay(r) });
    head(here);
    const signedIn = new Map(deviceAccounts().map((a) => [a.id, a]));
    const known = new Map(relayAccounts.map((a) => [a.id, a]));
    // A relay without accounts answers nothing: the device key alone, as main
    if (!signedIn.size && !known.size) signedIn.set('main', { id: 'main', name: state.account ? state.account.name : 'Main', admin: true, device });
    // The sign-ins of this device first, in their order, then the rest the relay lists
    for (const id of new Set([...signedIn.keys(), ...known.keys()])) {
        const a = known.get(id) || signedIn.get(id);
        const d = signedIn.get(id);
        rows.push({
            head: false, relay: here, own: true, id, name: a.name, admin: !!a.admin, created: known.get(id)?.created, reach: known.get(id)?.reach,
            setupBy: known.get(id)?.setupBy,
            signedIn: !!d, current: !!d && !!d.device && d.device === device, manageable: admin && id !== current && id !== 'main',
        });
    }
    for (const r of relays) {
        if (isCurrentRelay(r)) continue;
        head(r);
        // In the browser the other relays are links, nothing of their accounts is stored here
        if (bundled) for (const a of accountsOf(r)) rows.push({ head: false, relay: r, own: false, id: a.id, name: a.name, admin: !!a.admin, signedIn: true, current: false, manageable: false });
    }
    return rows;
}

/** The list with its buttons, the switch for the shared list below it. */
export function renderAccountList() {
    el.accountsScan.hidden = !canScanQr();
    const rows = accountRows();
    const several = deviceRelays().length > 1;
    el.settingsAllAccountsField.hidden = rows.filter((r) => !r.head && r.signedIn).length < 2;
    el.settingsAllAccounts.checked = showAllAccounts();
    el.accountsList.replaceChildren();
    for (const r of rows) {
        const li = node('li', r.head ? 'relay-head' : r.current ? 'current-device' : '');
        const text = node('div', 'd-text');
        const actions = node('div', 'account-actions');
        const button = (label, cls, run) => {
            const b = node('button', `btn small${cls}`, label);
            b.type = 'button';
            b.addEventListener('click', run);
            actions.appendChild(b);
        };
        if (r.head) {
            text.append(node('strong', '', r.relay.name), node('span', '', r.relay.url));
            if (!r.current && !bundled) button(t('relays.open'), '', () => switchRelay(r.relay.url));
            if (several || !bundled) button(t('relays.rename'), '', () => renameRelay(r.relay.url));
            if (!r.current) button(t('relays.remove'), ' danger', () => void removeRelay(r.relay.url));
        } else {
            const name = node('strong', '', r.name);
            if (r.admin && r.own) name.appendChild(node('span', 'tag', t('accounts.admin')));
            if (!r.admin && r.own && r.reach === 'admins') name.appendChild(node('span', 'tag', t('accounts.customer')));
            if (!r.admin && r.own && r.reach === 'listed') name.appendChild(node('span', 'tag', t('accounts.listed')));
            if (r.own && r.setupBy) name.appendChild(node('span', 'tag', t('accounts.setUpTag')));
            if (r.current) name.appendChild(node('span', 'tag', t('accounts.current')));
            const sub = r.id === 'main' ? t('accounts.mainAccount')
                : r.created ? t('accounts.created', { date: new Date(r.created).toLocaleDateString(locale()) }) : '';
            text.append(name, node('span', '', [sub, r.signedIn || r.current ? '' : t('accounts.notHere')].filter(Boolean).join(' · ')));
            // At most two buttons: the way in (switch, or the invitation when not signed in here) and the settings of the
            // account ("Set up": name, admin, reach, delete and the bots on the person's own computer, setups.js)
            if (!r.current && r.signedIn) button(t('relays.switch'), '', () => (r.own ? switchAccount(r.id) : openOtherChat(r.relay, r.id)));
            if (r.manageable && !r.signedIn) button(t('accounts.invite'), '', () => { accountError(''); send({ type: 'account_invite', id: r.id }); });
            if (r.manageable) button(t('accounts.setUp'), '', () => {
                const account = relayAccounts.find((a) => a.id === r.id);
                const forget = !r.current && r.signedIn && r.own ? () => forgetAccount(r.id) : undefined;
                if (account) openSetup(account, relayAccounts, state.account ? state.account.id : 'main', { forget });
            });
            // "Remove" forgets the sign-in on this device (for an account managed here it sits in "Set up"). The current
            // sign-in has none: signing out is at the bottom of the settings.
            else if (!r.current && r.signedIn && r.own) button(t('relays.remove'), ' danger', async () => { if (await confirmDialog(t('accounts.forgetConfirm', { name: r.name }))) forgetAccount(r.id); });
        }
        li.append(text, actions);
        el.accountsList.appendChild(li);
    }
}

// ---------------------------------------------------------------- Switching in the sidebar

/** The relay's and the account's name in the sidebar; only when there is more than one relay or more than main to tell apart. */
export function renderAccountSwitch() {
    const current = state.account;
    const relay = currentRelayName();
    // With accounts on the relay always: its menu is where one switches (signing out is at the bottom of the settings)
    const accounts = !!current;
    el.accountSwitch.hidden = !accounts && !relay;
    if (el.accountSwitch.hidden) return;
    const name = [relay, accounts ? current.name : ''].filter(Boolean).join(' · ');
    el.accountSwitch.querySelector('span').textContent = name;
    el.accountSwitch.title = t(relay ? 'relays.switchTitle' : 'accounts.switchTitle', { name });
}

/** The same rows as the list in the settings, and "Accounts …" to get there. */
export function openAccountMenu() {
    const device = storage.get(DEVICE_KEY);
    const entries = deviceAccounts().map((a) => {
        const current = !!a.device && a.device === device;
        const b = menuButton(current ? 'check' : 'person', a.device ? a.name : `${a.name} · ${t('login.choosePassword')}`, current ? 'current' : undefined);
        b.dataset.account = a.id;
        return b;
    });
    // The other relays below the accounts of this one: a tap loads the page for that relay
    for (const r of otherRelays()) {
        const b = menuButton('monitor', r.name);
        b.dataset.relay = r.url;
        entries.push(b);
    }
    const manage = menuButton('sliders', t('accounts.menu'));
    manage.dataset.accountAction = 'manage';
    const extra = [];
    if (state.account && state.account.admin) {
        const add = menuButton('add', t('login.newTitle'));
        add.dataset.accountAction = 'new';
        extra.push(add);
    }
    el.accountMenu.replaceChildren(...entries, ...extra, manage);
    el.accountMenu.hidden = false;
}

// ---------------------------------------------------------------- Managing (the accounts block of the settings)

/** The token of the invitation being made: the link a backend sends back must carry it. */
let pendingInvite = null;

export function openAccounts() {
    openSettingsAt(el.settingsAccounts);
}

/** The accounts block, its fields emptied and the list fresh from the relay (relays without accounts know no account frames). */
export function loadAccounts() {
    el.accountsError.hidden = true;
    el.inviteBox.hidden = true;
    el.inviteBox.replaceChildren();
    el.accountsPassword.value = '';
    el.accountsNewName.value = '';
    el.accountsNewAdmin.checked = false;
    el.accountsNewCustomer.checked = false;
    el.accountsLink.value = '';
    showNewAccountForm(false);
    el.accountsOwnName.value = state.account ? state.account.name : '';
    el.accountsOwn.hidden = !state.account || state.account.id === 'main';
    el.settingsSignOut.hidden = !state.account;
    renderSignedIn();
    relayAccounts = [];
    showCustomerChoice();
    renderAccountList();
    if (state.account) send({ type: 'accounts' });
}

/** Above "Sign out": which account this device is signed in to, and on which relay when there are several. */
function renderSignedIn() {
    if (!state.account) return;
    const relay = currentRelayName();
    el.settingsSignedIn.textContent = relay
        ? t('accounts.signedInAt', { name: state.account.name, relay })
        : t('accounts.signedIn', { name: state.account.name });
}

/**
 * The relay's answer "accounts": all of them for an admin, otherwise the own one.
 * @param {{ id: string, name: string, admin: boolean, created: string, reach?: string }[]} list
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
    // The owner's password is the relay's setup and its name shows nowhere but here: nothing of its own to edit
    el.accountsOwn.hidden = current === 'main';
    el.settingsSignOut.hidden = false;
    renderSignedIn();
    relayAccounts = list;
    showCustomerChoice();
    renderAccountList();
    setupAccountsChanged(list);
}

/**
 * "Customer" only on a relay that names the reach: one from before person chats drops it silently, and after its
 * update the account would reach everyone.
 */
function showCustomerChoice() {
    const known = relayAccounts.some((a) => a.reach !== undefined);
    /** @type {HTMLElement} */ (el.accountsNewCustomer.closest('label')).hidden = !known;
    if (!known) el.accountsNewCustomer.checked = false;
}

/** @param {string} message */
export function accountError(message) {
    el.accountsError.textContent = message;
    el.accountsError.hidden = !message;
    // The dialog of an account covers the error line
    if (message && !el.setupBox.hidden) toast(message, 5000);
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

/** The admin's form behind "Add" (a link to redeem, a new person) in the settings dialog; an invitation on display goes away with it. */
export function showNewAccountForm(on) {
    if (!on) {
        closeSettingsDialog(el.accountsNewForm);
        return;
    }
    el.inviteBox.hidden = true;
    el.inviteBox.replaceChildren();
    openSettingsDialog(t('accounts.joinTitle'), el.accountsNewForm, true);
    el.accountsNewName.focus();
}

export function createAccount() {
    accountError('');
    const name = el.accountsNewName.value.trim();
    if (!name) {
        el.accountsNewName.focus();
        return;
    }
    el.accountsCreate.disabled = true;
    send({ type: 'account_create', name, admin: el.accountsNewAdmin.checked, ...(el.accountsNewCustomer.checked ?{ reach: 'admins' } : {}) });
}

/**
 * "account_created" and "account_invite": a backend wraps the token with the end-to-end key and the QR code (the key
 * never leaves the backends and paired devices, this page cannot export it).
 * @param {{ type: string, account: { id: string, name: string }, pair: { token: string, expiresAt: string } }} f
 */
export function receiveAccountCreated(f) {
    el.accountsCreate.disabled = false;
    el.accountsNewName.value = '';
    el.accountsNewAdmin.checked = false;
    el.accountsNewCustomer.checked = false;
    showNewAccountForm(false);
    // Created for someone else: only the list; the invitation link is made from the account's row when it is needed
    // (a setup link replaces it for a person set up on their own computer)
    if (f.type === 'account_created' && !selfInvite) {
        toast(t('accounts.createdToast', { name: f.account.name }));
        send({ type: 'accounts' });
        return;
    }
    pendingInvite = { token: f.pair.token, name: f.account.name, self: selfInvite };
    selfInvite = false;
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
        if (invite.self) toast(t('accounts.inviteOld', { machine: upper(link.machine || '') }));
        else accountError(t('accounts.inviteOld', { machine: upper(link.machine || '') }));
        return true;
    }
    // Created for this device: it redeems the invitation itself (with the end-to-end key) and loads in the new account
    if (invite.self) {
        const parsed = parsePairingLink(link.url);
        if (parsed && parsed.params.get('pair')) void adoptPairingLink(parsed.params).then(connect);
        return true;
    }
    renderPairLink(link, el.inviteBox, t('accounts.inviteHint', { name: invite.name, until: clockTime(link.expiresAt) }));
    openSettingsDialog(t('accounts.inviteTitle', { name: invite.name }), el.inviteBox);
    send({ type: 'accounts' });
    return true;
}
