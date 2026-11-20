/* OpenFolk web app: the sign-in as a small wizard. First the setup method, then only the fields of that method: the
   elements of the start card name their methods in `data-for` ("url" stands for the relay's address, which the password
   needs, and the QR code in the apps while they know no relay). */
import { t } from './i18n.js';
import { el } from './core.js';
import { bundled, canScanQr, relayAddress } from './platform.js';

/** What the relay offers right now (qr-login.js): a QR code to show, the code of a first device from a backend's log. */
const offers = { qr: !!(window.crypto && crypto.subtle), first: false };

/** @param {{ qr?: boolean, first?: boolean }} change */
export function setOffers(change) {
    const before = `${offers.qr}${offers.first}`;
    Object.assign(offers, change);
    if (`${offers.qr}${offers.first}` !== before) renderMethods();
}

/** The methods this device can use here, in the order of the choice. */
function methods() {
    const list = ['invite', 'password'];
    if (offers.qr) list.push('qr');
    if (canScanQr()) list.push('scan');
    if (offers.first) list.push('first');
    return list;
}

const LABELS = { invite: 'login.methodInvite', qr: 'login.methodQr', scan: 'login.methodScan', first: 'login.methodFirst' };

/** Builds the choice (texts in the current language) and keeps the method chosen, as long as it is still offered. */
export function renderMethods() {
    const select = /** @type {HTMLSelectElement} */ (el.loginMethod);
    const current = select.value;
    const list = methods();
    const placeholder = new Option(t('login.method'), '');
    placeholder.disabled = true;
    // In the browser the page comes from the relay, so the URL is already known and only the password is asked
    const label = (m) => t(m === 'password' ? (bundled ? 'login.methodPassword' : 'login.methodPasswordOnly') : LABELS[m]);
    select.replaceChildren(placeholder, ...list.map((m) => new Option(label(m), m)));
    select.value = list.includes(current) ? current : '';
    applyMethod();
}

/** Shows the elements of the chosen method and hides the others; nothing but the choice while none is chosen. */
export function applyMethod() {
    const m = el.loginMethod.value;
    const tags = new Set(m ? [m] : []);
    // The QR code shows at once where the relay is known; the apps ask for its address only before their first sign-in
    if (m === 'password' || (m === 'qr' && bundled && !relayAddress())) tags.add('url');
    for (const n of el.loginForm.querySelectorAll('[data-for]')) {
        n.classList.toggle('method-off', !(/** @type {HTMLElement} */ (n).dataset.for || '').split(' ').some((x) => tags.has(x)));
    }
}

/** Chooses a method for the user (an expired key asks for the password again); ignored when it is not offered. */
export function chooseMethod(m) {
    if (!methods().includes(m)) return;
    el.loginMethod.value = m;
    applyMethod();
}

/** The focus on the first field of the chosen method, on the choice while there is none. */
export function focusMethod() {
    const m = el.loginMethod.value;
    const needsUrl = bundled && !el.loginRelay.value && (m === 'password' || (m === 'qr' && !relayAddress()));
    const target = needsUrl ? el.loginRelay
        : m === 'invite' ? el.loginInvite
        : m === 'password' ? (!el.loginTotpField.hidden && el.loginToken.value ? el.loginTotp : el.loginToken)
        : m === 'first' ? el.loginFirstCode
        : m === 'scan' ? el.loginScan
        : el.loginMethod;
    target.focus();
}

/** Asked once per page: the desktop app hands over the password typed on its setup page. */
let passwordAsked = false;

/** The desktop app: the password from its setup page ("URL and password") signs in at once, without asking again. */
export async function takeDesktopPassword() {
    const desktop = /** @type {any} */ (window).openfolkDesktop;
    if (passwordAsked || !bundled || !desktop || typeof desktop.takePassword !== 'function') return;
    passwordAsked = true;
    const password = await desktop.takePassword(relayAddress());
    if (!password || el.login.hidden) return;
    chooseMethod('password');
    el.loginToken.value = password;
    el.loginForm.requestSubmit();
}
