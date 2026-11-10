/* OpenFolk web app: setting a person up (setup links). An admin chooses for an account its bots (each with a repository,
   a token and how far it may go), whom the person can write to and whom the bots hand over to; the backend keeps that
   and sends it to the person's computer, which joins with the setup link and makes the bots from it. The page a setup
   link opens in a browser only points to the desktop app: a setup needs a computer that runs the bots. */
import { locale, t } from './i18n.js';
import { el, node, startParams, toast } from './core.js';
import { send } from './e2e.js';
import { closeSettingsDialog, openSettingsDialog } from './menus.js';
import { confirmDialog } from './dialogs.js';

/** @typedef {{ key: string, name: string, role: string, tone: string, approval: string, repo: string, gitUser: string, model?: string, token: boolean | string }} SetupBotRow */
/** @typedef {{ account: string, bots: SetupBotRow[], handover: string, updatedAt?: string }} SetupView */
/** @typedef {{ id: string, name: string, admin: boolean, reach?: string, contacts?: string[], setupBy?: string }} AccountRow */

/** What the backend last sent ("setups"). @type {SetupView[]} */
let setups = [];
/** The account whose setup is open, the accounts of the relay as the dialog was opened, and the link on display. */
let open = /** @type {{ account: AccountRow, accounts: AccountRow[], me: string, forget?: () => void, link?: { url: string, expiresAt: string } } | null} */ (null);
/** The bots as edited in the dialog (rendered from this, so adding and removing keep what was typed). @type {SetupBotRow[]} */
let rows = [];
/** Keys of the bots whose card is open; the others show only their head. @type {Set<string>} */
let expanded = new Set();

const APPROVALS = ['read', 'risky', 'write', 'never'];

/** The two bots a setup starts with: one that answers from the code, one that changes it. */
function defaultBots() {
    return [
        { key: 'support', name: t('setup.supportName'), role: t('setup.supportRole'), tone: '', approval: 'read', repo: '', gitUser: '', token: '' },
        { key: 'dev', name: t('setup.devName'), role: t('setup.devRole'), tone: '', approval: 'risky', repo: '', gitUser: '', token: '' },
    ];
}

/**
 * The setup dialog for an account of this relay (admins only): the account itself (name, admin, reach, delete) and,
 * for an account that is no admin, its bots on the person's own computer.
 * @param {AccountRow} account
 * @param {AccountRow[]} accounts everyone the relay listed
 * @param {string} me the admin's own account
 * @param {{ forget?: () => void }} [hooks] `forget`: the account is signed in on this device, removing it from here
 */
export function openSetup(account, accounts, me, hooks = {}) {
    const known = setups.find((s) => s.account === account.id);
    open = { account, accounts, me, forget: hooks.forget };
    rows = known ? known.bots.map((b) => ({ ...b, token: '' })) : defaultBots();
    // A stored setup's bots closed; a new setup's open, they are to be filled in
    expanded = new Set(known ? [] : rows.map((r) => r.key));
    render();
    openSettingsDialog(t('setup.title', { name: account.name }), el.setupBox, true);
    send({ type: 'setups' });
}

/** "setups" from the backend. @param {SetupView[]} list */
export function receiveSetups(list) {
    const before = open && setups.find((s) => s.account === open.account.id);
    setups = Array.isArray(list) ? list : [];
    // A setup that arrives for the open dialog fills it, unless the admin typed into it already
    const now = open && setups.find((s) => s.account === open.account.id);
    if (open && now && !before && rows.every((r) => !r.repo)) {
        rows = now.bots.map((b) => ({ ...b, token: '' }));
        expanded = new Set();
    }
    if (open && !el.setupBox.hidden) render();
}

/**
 * "accounts" from the relay while the dialog is open: a renamed or changed account shows so, a deleted one closes it.
 * @param {AccountRow[]} list
 */
export function setupAccountsChanged(list) {
    if (!open) return;
    const now = list.find((a) => a.id === open.account.id);
    if (!now) {
        closeSetup();
        return;
    }
    const keys = ['name', 'admin', 'reach', 'setupBy'];
    const changed = keys.some((k) => now[k] !== open.account[k]) || JSON.stringify(now.contacts || []) !== JSON.stringify(open.account.contacts || []);
    open.accounts = list;
    if (!changed) return;
    open.account = { ...now };
    render();
    openSettingsDialog(t('setup.title', { name: now.name }), el.setupBox, true);
}

function closeSetup() {
    open = null;
    closeSettingsDialog(el.setupBox);
}

/** "setup_link": the link to send, or none after revoking. @param {{ account: string, url?: string, expiresAt?: string }} f */
export function receiveSetupLink(f) {
    if (!open || f.account !== open.account.id) return;
    open.link = f.url && f.expiresAt ? { url: f.url, expiresAt: f.expiresAt } : undefined;
    if (!f.url) toast(t('setup.revoked'));
    render();
}

/** @param {string} label @param {HTMLElement} field */
function labelled(label, field) {
    const l = node('label');
    l.append(node('span', '', label), field);
    return l;
}

/** @param {string} value @param {(v: string) => void} change @param {Partial<HTMLInputElement>} [props] */
function input(value, change, props = {}) {
    const i = /** @type {HTMLInputElement} */ (node('input'));
    Object.assign(i, { autocomplete: 'off', spellcheck: false, ...props });
    i.value = value;
    i.addEventListener('input', () => change(i.value));
    return i;
}

/** @param {string} label @param {string} cls @param {() => void} run */
function button(label, cls, run) {
    const b = node('button', `btn${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
}

function render() {
    if (!open) return;
    const { account, accounts, me } = open;
    const stored = setups.find((s) => s.account === account.id);
    const box = el.setupBox;
    box.replaceChildren();
    box.appendChild(accountPart(account));
    // Bots on the person's own computer only for an account that is no admin, on a relay that knows reaches
    if (account.admin || !account.reach) {
        const actions = node('div', 'actions left');
        actions.appendChild(button(t('common.close'), '', closeSetup));
        box.appendChild(actions);
        return;
    }
    box.appendChild(node('h4', '', t('setup.ownComputer')));
    box.appendChild(node('p', 'hint', t(account.setupBy ? 'setup.introSetUp' : 'setup.intro', { name: account.name })));

    // Whom the person can write to; the admin who sets up is ticked from the start
    const others = accounts.filter((a) => a.id !== account.id);
    const chosen = new Set(account.reach === 'listed' ? account.contacts || [] : [me]);
    box.appendChild(node('h4', '', t('setup.contacts', { name: account.name })));
    const contacts = node('div', 'setup-contacts');
    for (const a of others) {
        const l = node('label', 'check');
        const c = /** @type {HTMLInputElement} */ (node('input'));
        c.type = 'checkbox';
        c.value = a.id;
        c.checked = chosen.has(a.id);
        c.addEventListener('change', () => fillHandover());
        l.append(c, node('span', '', ` ${a.name}`));
        contacts.appendChild(l);
    }
    box.appendChild(contacts);
    const handover = /** @type {HTMLSelectElement} */ (node('select'));
    const fillHandover = () => {
        const ticked = [...contacts.querySelectorAll('input:checked')].map((c) => /** @type {HTMLInputElement} */ (c).value);
        const was = handover.value || stored?.handover || me;
        handover.replaceChildren(node('option', '', t('setup.handoverNone')));
        /** @type {HTMLOptionElement} */ (handover.firstChild).value = '';
        for (const a of others.filter((x) => ticked.includes(x.id))) {
            const o = /** @type {HTMLOptionElement} */ (node('option', '', a.name));
            o.value = a.id;
            handover.appendChild(o);
        }
        handover.value = ticked.includes(was) ? was : '';
    };
    fillHandover();
    box.appendChild(labelled(t('setup.handover'), handover));

    box.appendChild(node('h4', '', t('setup.bots')));
    /** The card of each bot by key: closed, with name, repository and level in its head (a failed save opens it). */
    const cards = new Map();
    rows.forEach((r, i) => {
        const card = /** @type {HTMLDetailsElement} */ (node('details', 'setup-bot'));
        card.open = expanded.has(r.key);
        card.addEventListener('toggle', () => { if (card.open) expanded.add(r.key); else expanded.delete(r.key); });
        const head = node('summary');
        const title = node('strong');
        const sub = node('span', 'setup-bot-sub');
        head.append(title, sub);
        const fillHead = () => {
            title.textContent = r.name.trim() || t('setup.unnamed');
            sub.textContent = [repoName(r.repo), t(`approval.policy.${r.approval}`)].filter(Boolean).join(' · ');
        };
        fillHead();
        const level = /** @type {HTMLSelectElement} */ (node('select'));
        for (const a of APPROVALS) {
            const o = /** @type {HTMLOptionElement} */ (node('option', '', t(`approval.policy.${a}`)));
            o.value = a;
            level.appendChild(o);
        }
        level.value = r.approval;
        level.addEventListener('change', () => { r.approval = level.value; fillHead(); });
        const hasToken = stored?.bots.some((b) => b.key === r.key && b.token === true);
        const fields = node('div', 'setup-bot-fields');
        fields.append(
            labelled(t('setup.botName'), input(r.name, (v) => { r.name = v; fillHead(); }, { maxLength: 60 })),
            labelled(t('setup.botRole'), input(r.role, (v) => { r.role = v; }, { maxLength: 200 })),
            labelled(t('setup.repo'), input(r.repo, (v) => { r.repo = v; fillHead(); }, { placeholder: 'https://git.example.com/team/dashboard.git', type: 'url' })),
            labelled(t('setup.gitUser'), input(r.gitUser, (v) => { r.gitUser = v; }, { maxLength: 200 })),
            labelled(t('setup.token'), input(String(r.token || ''), (v) => { r.token = v; }, { type: 'password', autocomplete: 'new-password', placeholder: hasToken ? t('setup.tokenStored') : '' })),
            labelled(t('setup.approval'), level),
        );
        if (rows.length > 1) fields.appendChild(button(t('setup.removeBot'), ' small danger', () => { rows.splice(i, 1); expanded.delete(r.key); render(); }));
        card.append(head, fields);
        cards.set(r.key, card);
        box.appendChild(card);
    });
    if (rows.length < 10) box.appendChild(button(t('setup.addBot'), ' small', () => {
        let n = rows.length + 1;
        while (rows.some((x) => x.key === `bot-${n}`)) n++;
        rows.push({ key: `bot-${n}`, name: '', role: '', tone: '', approval: 'read', repo: '', gitUser: '', token: '' });
        // A new bot is to be filled in: open
        expanded.add(`bot-${n}`);
        render();
    }));

    const error = node('p', 'error');
    error.hidden = true;
    const actions = node('div', 'actions left');
    actions.append(
        button(t('setup.save'), '', () => {
            const ticked = [...contacts.querySelectorAll('input:checked')].map((c) => /** @type {HTMLInputElement} */ (c).value);
            const { problem, key } = check(stored);
            error.textContent = problem;
            error.hidden = !problem;
            if (problem) {
                // The bot with what is missing opens
                const card = cards.get(key);
                if (card) card.open = true;
                return;
            }
            // Whom the person reaches is the relay's; the setup with the tokens the backend's
            send({ type: 'account_update', id: account.id, reach: 'listed', contacts: ticked });
            account.reach = 'listed';
            account.contacts = ticked;
            send({ type: 'setup_save', setup: { account: account.id, handover: handover.value, bots: rows.map((r) => ({ ...r, name: r.name.trim(), repo: r.repo.trim(), token: String(r.token || '') })) } });
            toast(t('setup.saved'));
        }),
        button(t('setup.makeLink'), '', () => {
            if (!stored) {
                error.textContent = t('setup.saveFirst');
                error.hidden = false;
                return;
            }
            send({ type: 'setup_link', account: account.id });
        }),
        button(t('common.close'), '', closeSetup),
    );
    box.append(error, actions);

    if (open.link) {
        const link = open.link;
        const url = /** @type {HTMLInputElement} */ (node('input'));
        url.type = 'text';
        url.readOnly = true;
        url.value = link.url;
        url.addEventListener('focus', () => url.select());
        const copy = button(t('pair.copy'), ' small', () => {
            if (navigator.clipboard) navigator.clipboard.writeText(link.url).then(() => { copy.textContent = t('pair.copied'); }, () => undefined);
        });
        const row = node('div', 'pair-url');
        row.append(url, copy);
        const until = new Date(link.expiresAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
        box.append(node('h4', '', t('setup.link')), row, node('p', 'hint', t('setup.linkHint', { name: account.name, until })));
        box.appendChild(button(t('setup.revoke'), ' small danger', () => send({ type: 'setup_link', account: account.id, revoke: true })));
    }
    if (stored) {
        box.appendChild(button(t('setup.delete'), ' small danger', async () => {
            if (!(await confirmDialog(t('setup.deleteConfirm', { name: account.name })))) return;
            send({ type: 'setup_delete', account: account.id });
            rows = defaultBots();
        }));
    }
}

/**
 * The account itself: its name, admin rights, whom it reaches, and deleting it (or removing it from this device).
 * @param {AccountRow} account
 */
function accountPart(account) {
    const part = node('div', 'setup-account');
    const name = input(account.name, (v) => { rename.disabled = !v.trim() || v.trim() === account.name; }, { maxLength: 60 });
    const rename = button(t('setup.rename'), ' small', () => send({ type: 'account_update', id: account.id, name: name.value.trim() }));
    rename.disabled = true;
    name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !rename.disabled) rename.click(); });
    const row = node('div', 'setup-name');
    row.append(name, rename);
    part.append(node('h4', '', t('setup.account')), labelled(t('accounts.name'), row));
    const actions = node('div', 'actions left');
    // An account set up runs on someone else's machine: it is no admin (the relay refuses it)
    if (!account.setupBy) {
        actions.appendChild(button(t(account.admin ? 'accounts.removeAdmin' : 'accounts.makeAdmin'), ' small', () => send({ type: 'account_update', id: account.id, admin: !account.admin })));
    }
    // Whom the person can chat with; an admin reaches everyone anyway. Missing reach: a relay from before person chats.
    // Chosen contacts ('listed') are the setup's
    if (!account.admin && account.reach && account.reach !== 'listed') {
        const customer = account.reach === 'admins';
        actions.appendChild(button(t(customer ? 'accounts.makeTeam' : 'accounts.makeCustomer'), ' small', () => send({ type: 'account_update', id: account.id, reach: customer ? 'all' : 'admins' })));
    }
    const forget = open?.forget;
    if (forget) {
        actions.appendChild(button(t('relays.remove'), ' small danger', async () => {
            if (!(await confirmDialog(t('accounts.forgetConfirm', { name: account.name })))) return;
            forget();
            closeSetup();
        }));
    }
    actions.appendChild(button(t('accounts.delete'), ' small danger', async () => {
        if (!(await confirmDialog(t('accounts.deleteConfirm', { name: account.name })))) return;
        send({ type: 'account_delete', id: account.id });
        closeSetup();
    }));
    part.appendChild(actions);
    return part;
}

/** What is missing before saving and in which bot; '' when nothing is. @param {SetupView | undefined} stored */
function check(stored) {
    for (const r of rows) {
        if (!r.name.trim() || !/^https:\/\/[^\s@]+$/.test(r.repo.trim())) return { problem: t('setup.missing'), key: r.key };
        const hasToken = stored?.bots.some((b) => b.key === r.key && b.token === true);
        if (!hasToken && !String(r.token || '').trim()) return { problem: t('setup.missingToken', { name: r.name.trim() }), key: r.key };
    }
    return { problem: '', key: '' };
}

/** "dashboard" of https://git.example.com/team/dashboard.git, for the head of a bot's card. @param {string} repo */
function repoName(repo) {
    return repo.trim().replace(/\/+$/, '').replace(/\.git$/, '').split('/').pop() || '';
}

// ---------------------------------------------------------------- The page of a setup link in a browser

/**
 * A setup link opened in a browser: OpenFolk sets itself up in the desktop app, so this page only hands the link over
 * (openfolk://setup) or says where the app is. True when it is shown; the page then does not sign in.
 */
export function showSetupLanding() {
    const token = startParams.get('setup');
    if (!token) return false;
    const key = startParams.get('e2e');
    const link = `${location.origin}/#setup=${token}${key ? `&e2e=${key}` : ''}`;
    const page = node('div', 'start');
    const card = node('div', 'start-card');
    const icon = /** @type {HTMLImageElement} */ (node('img'));
    icon.src = 'icons/icon.svg';
    icon.alt = '';
    icon.width = icon.height = 84;
    const openApp = /** @type {HTMLAnchorElement} */ (node('a', 'primary', t('setupLanding.open')));
    openApp.href = `openfolk://setup?link=${encodeURIComponent(link)}`;
    const download = /** @type {HTMLAnchorElement} */ (node('a', 'btn', t('setupLanding.download')));
    download.href = 'https://openfolk.app';
    download.target = '_blank';
    download.rel = 'noopener';
    const copy = button(t('pair.copy'), '', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => { copy.textContent = t('pair.copied'); }, () => undefined);
    });
    const actions = node('div', 'actions');
    actions.append(openApp, download, copy);
    card.append(icon, node('h1', '', t('setupLanding.title')), node('p', 'start-intro', t('setupLanding.text')), actions,
        node('p', 'hint', t('setupLanding.paste')));
    page.appendChild(card);
    document.body.appendChild(page);
    return true;
}
