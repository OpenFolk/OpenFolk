/* OpenFolk web app: the relays this device is signed in to – one per customer, each with its own end-to-end key,
   devices, accounts and machines. The page belongs to one relay at a time (core.js picks its scope while loading);
   switching loads the page again, like switching accounts. The mobile apps and the desktop app hold several relays;
   the browser loads the web app from its relay and knows only that one. The settings show them in the accounts block
   (accounts.js), one list with the accounts. */
import { t } from './i18n.js';
import { RELAY_KEYS, deviceRelays, relayEntry, relayScope, saveRelays, storage } from './core.js';
import { forgetKey } from './e2e.js';
import { bundled, parsePairingLink, relayAddress, setRelayAddress } from './platform.js';
import { askText } from './menus.js';
import { renderAccountList, renderAccountSwitch } from './accounts.js';
import { closeOthers, connectOthers } from './others.js';
import { renderChatList } from './list.js';
import { confirmDialog } from './dialogs.js';

/**
 * Several relays are possible here (see above). The browser keeps the other relays only as links: its page belongs
 * to one relay, and that relay's security policy keeps it there.
 */
export const relaysPossible = () => bundled;

/** The relay this page belongs to: the stored address in the apps, the page's origin in the browser. */
export const ownRelayAddress = () => (bundled ? relayAddress() : location.origin);
/** @param {{ url: string, scope: string }} r */
export const isCurrentRelay = (r) => (bundled ? r.scope === relayScope : r.url === location.origin);

/**
 * Loads the page for the relay in the stored address, with what a pairing link brought behind '#' (sign-in, key):
 * core.js and e2e.js take it over while loading, in that relay's scope.
 * @param {URLSearchParams} [params]
 */
export function openRelay(params) {
    try { history.replaceState(null, '', location.pathname + (params && params.size ? `#${params}` : '')); } catch { /* ignore */ }
    location.reload();
}

/** @param {string} url */
export function switchRelay(url) {
    if (url === relayAddress() || !deviceRelays().some((r) => r.url === url)) return;
    if (!bundled) {
        // The browser: that relay's own page
        location.assign(url);
        return;
    }
    setRelayAddress(url);
    openRelay();
}

/** The name of the current relay, for the switch in the sidebar; '' while there is only one. */
export function currentRelayName() {
    const list = deviceRelays();
    if (!relaysPossible() || list.length < 2) return '';
    return (list.find((r) => r.scope === relayScope) || { name: '' }).name;
}

/** The other relays, for the switch in the sidebar and the list of sign-ins. */
export const otherRelays = () => (relaysPossible() ? deviceRelays().filter((r) => r.scope !== relayScope) : []);

/**
 * A relay's address or a pairing link from it (typed, pasted, scanned, or from a relay claimed by a backend): it joins
 * the list and the page loads for it, where the pairing link signs this device in, otherwise the start page asks for
 * the password. False if it is no address.
 * @param {string} text
 */
export function goToRelay(text) {
    const link = parsePairingLink(text);
    if (!link) return false;
    relayEntry(link.address);
    if (!bundled) {
        // The browser remembers the relay as a link and opens its page, with the pairing link's part behind '#'
        location.assign(link.params.size ? `${link.address}/#${link.params}` : link.address);
        return true;
    }
    setRelayAddress(link.address);
    // The relay in the address too, as the desktop app opens its page: it reads there which relay a pairing link signed in at
    link.params.set('relay', link.address);
    openRelay(link.params);
    return true;
}

/** @param {string} url */
export function renameRelay(url) {
    const r = deviceRelays().find((x) => x.url === url);
    if (!r) return;
    askText({
        title: t('relays.renameTitle'), value: r.name, maxLength: 60,
        done: (name) => {
            saveRelays(deviceRelays().map((x) => (x.url === url ? { ...x, name } : x)));
            renderAccountList();
            renderAccountSwitch();
        },
    });
}

/**
 * Forgets a relay on this device: its device keys, accounts, what was seen and its end-to-end key. The relay itself
 * keeps listing this device until someone signs it out there (settings, devices).
 * @param {string} url
 */
export async function removeRelay(url) {
    const r = deviceRelays().find((x) => x.url === url);
    if (!r || isCurrentRelay(r)) return;
    if (!bundled) {
        // Only a link here; nothing of that relay is stored on this page
        saveRelays(deviceRelays().filter((x) => x.url !== url));
        renderAccountList();
        return;
    }
    if (!(await confirmDialog(t('accounts.forgetConfirm', { name: r.name })))) return;
    const names = [];
    try { for (let i = 0; i < localStorage.length; i++) names.push(localStorage.key(i) || ''); } catch { /* ignore */ }
    // The base name with the relay's scope, also with an account behind it (':<id>'), never another relay's '@<n>'
    for (const name of names) if (RELAY_KEYS.some((base) => name === base + r.scope || name.startsWith(`${base}${r.scope}:`))) storage.remove(name);
    await forgetKey('e2e' + r.scope);
    saveRelays(deviceRelays().filter((x) => x.url !== url));
    // Its rows in the shared list go with it
    closeOthers();
    connectOthers();
    renderChatList();
    renderAccountList();
    renderAccountSwitch();
}
