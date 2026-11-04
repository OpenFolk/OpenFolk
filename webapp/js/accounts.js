/* OpenFolk web app: accounts – everything that is a sign-in. Where this device is signed in (accounts and relays, one
   list), adding one with any link or an address, switching, one's own account, and managing the accounts of the relay. */
import { locale, t } from './i18n.js';
import { ACCOUNTS_KEY, DEVICE_KEY, deviceAccounts, deviceRelays, el, loadedAccount, node, relayEntry, state, storage } from './core.js';
import { adoptPairingLink, clockTime, send, upper } from './e2e.js';
import { askText, closeSettingsDialog, menuButton, openSettingsDialog } from './menus.js';
import { connect, showLogin } from './connection.js';
import { openSettingsAt, renderPairLink } from './settings.js';
import { closeSettings } from './panes.js';
import { bundled, canScanQr, parsePairingLink, scanQrCode } from './platform.js';
import { currentRelayName, goToRelay, isCurrentRelay, otherRelays, ownRelayAddress, removeRelay, renameRelay, switchRelay } from './relays.js';
import { accountsOf, openOtherChat, showAllAccounts } from './others.js';

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

/** Another account's key no longer works (others.js), or the user removes it here: it leaves this device's list. */
export function forgetAccount(id) {
    save(deviceAccounts().filter((a) => a.id !== id || a.device === storage.get(DEVICE_KEY)));
    renderAccountSwitch();
    renderAccountList();
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
            head: false, relay: here, own: true, id, name: a.name, admin: !!a.admin, created: known.get(id)?.created,
            signedIn: !!d, current: !!d && d.device === device, manageable: admin && id !== current && id !== 'main',
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
    el.accountsIntro.textContent = t(bundled ? 'accounts.intro' : 'accounts.introBrowser');
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
            if (r.current) name.appendChild(node('span', 'tag', t('accounts.current')));
            const sub = r.id === 'main' ? t('accounts.mainAccount')
                : r.created ? t('accounts.created', { date: new Date(r.created).toLocaleDateString(locale()) }) : '';
            text.append(name, node('span', '', [sub, r.signedIn || r.current ? '' : t('accounts.notHere')].filter(Boolean).join(' · ')));
            if (!r.current && r.signedIn) button(t('relays.switch'), '', () => (r.own ? switchAccount(r.id) : openOtherChat(r.relay, r.id)));
            // Not signed in here: the invitation is the way in, for this device or the person's
            if (r.manageable && !r.signedIn) button(t('accounts.invite'), '', () => { accountError(''); send({ type: 'account_invite', id: r.id }); });
            if (r.manageable) button(t(r.admin ? 'accounts.removeAdmin' : 'accounts.makeAdmin'), '', () => send({ type: 'account_update', id: r.id, admin: !r.admin }));
            // "Remove" forgets the sign-in on this device; "Delete" is the admin's, for everyone. The current sign-in
            // has no "remove": signing out is in the devices block.
            if (!r.current && r.signedIn && r.own) button(t('relays.remove'), ' danger', () => { if (confirm(t('accounts.forgetConfirm', { name: r.name }))) forgetAccount(r.id); });
            if (r.manageable) button(t('accounts.delete'), ' danger', () => { if (confirm(t('accounts.deleteConfirm', { name: r.name }))) send({ type: 'account_delete', id: r.id }); });
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
    const accounts = !!current && (deviceAccounts().length > 1 || current.id !== 'main');
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
        const b = menuButton(a.device === device ? 'check' : 'person', a.name, a.device === device ? 'current' : undefined);
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
    el.accountMenu.replaceChildren(...entries, manage);
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
    el.accountsLink.value = '';
    showNewAccountForm(false);
    el.accountsOwnName.value = state.account ? state.account.name : '';
    el.accountsOwn.hidden = !state.account || state.account.id === 'main';
    el.accountsOwnHint.textContent = t('accounts.passwordHint');
    relayAccounts = [];
    renderAccountList();
    if (state.account) send({ type: 'accounts' });
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
    // The owner's password is the relay's setup and its name shows nowhere but here: nothing of its own to edit
    el.accountsOwn.hidden = current === 'main';
    relayAccounts = list;
    renderAccountList();
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

/** The admin's form behind "Add" (a link to redeem, a new person) in the settings dialog; an invitation on display goes away with it. */
export function showNewAccountForm(on) {
    if (!on) {
        closeSettingsDialog(el.accountsNewForm);
        return;
    }
    el.inviteBox.hidden = true;
    el.inviteBox.replaceChildren();
    openSettingsDialog(t('accounts.joinTitle'), el.accountsNewForm, true);
    el.accountsLink.focus();
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
    showNewAccountForm(false);
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
    openSettingsDialog(t('accounts.inviteTitle', { name: invite.name }), el.inviteBox);
    send({ type: 'accounts' });
    return true;
}
