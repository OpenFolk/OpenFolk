// The vault (local/src/vault.ts): credentials for the bots' work. The list shows names, notes and which bots may use
// an entry; the value is write-only, as the API keys are: typed in, sent to a backend that is awake, never shown
// again. A backend answers every change with the list again; the form closes when it arrives.
import { el, node, state, toast } from './core.js';
import { locale, t } from './i18n.js';
import { send } from './e2e.js';
import { confirmDialog } from './dialogs.js';
import { closeSettingsDialog, openSettingsDialog } from './menus.js';

/** The name as the backend takes it: an environment variable. */
const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const VALUE_MIN = 6;

/** Id of the entry in the form, '' for a new one. */
let editing = '';
/** A save is on its way: the next list closes the form. */
let saving = false;

/** On a relay without accounts there is only the one person; otherwise the admins manage the vault. */
export const mayManageVault = () => !state.account || state.account.admin;

export function receiveVault(entries) {
    state.vault = entries;
    renderVault();
    if (saving) {
        saving = false;
        closeVaultForm();
        toast(t('settings.saved'));
    }
}

/** An error of a vault request: shown in the form, which stays open. */
export function vaultError(message) {
    saving = false;
    el.vaultSave.disabled = false;
    el.vaultError.textContent = message;
    el.vaultError.hidden = !message;
}

function botsText(bots) {
    if (!bots) return t('vault.allBots');
    const names = bots.map((id) => state.bots.find((b) => b.id === id)?.name ?? id);
    return names.length ? names.join(', ') : t('vault.noBot');
}

export function renderVault() {
    el.vaultBlock.hidden = !mayManageVault();
    if (el.vaultBlock.hidden) return;
    const asleep = !state.online.length;
    el.vaultAsleep.hidden = !asleep;
    el.vaultAdd.disabled = asleep;
    el.vaultList.replaceChildren();
    const entries = state.vault || [];
    if (!entries.length) el.vaultList.appendChild(node('li', 'empty-small', t('vault.none')));
    for (const e of entries) {
        const li = node('li');
        li.dataset.id = e.id;
        const text = node('div', 'd-text');
        const when = e.updatedAt ? new Date(e.updatedAt).toLocaleDateString(locale()) : '';
        text.append(node('strong', '', e.name), node('span', '', [e.note, botsText(e.bots), when].filter(Boolean).join(' · ')));
        const actions = node('div', 'account-actions');
        const edit = node('button', 'btn small', t('vault.edit'));
        edit.type = 'button';
        edit.disabled = asleep;
        edit.addEventListener('click', () => openVaultForm(e));
        const remove = node('button', 'btn small danger', t('common.delete'));
        remove.type = 'button';
        remove.disabled = asleep;
        remove.addEventListener('click', async () => {
            if (await confirmDialog(t('vault.deleteConfirm', { name: e.name }))) send({ type: 'vault_delete', id: e.id });
        });
        actions.append(edit, remove);
        li.append(text, actions);
        el.vaultList.appendChild(li);
    }
}

/** The bots to tick: every bot of the account, the ones of the entry ticked. */
function botChoices(chosen) {
    const legend = el.vaultBotList.querySelector('legend');
    el.vaultBotList.replaceChildren(legend);
    for (const b of state.bots) {
        const l = node('label', 'check');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = b.id;
        cb.checked = !!chosen && chosen.includes(b.id);
        l.append(cb, document.createTextNode(` ${b.name}${b.area || b.role ? ' – ' + (b.area || b.role) : ''}`));
        el.vaultBotList.appendChild(l);
    }
}

export function vaultBotsChanged() {
    el.vaultBotList.hidden = el.vaultBots.value !== 'some';
}

/** The form for a new entry, or for `entry`: its value stays unless a new one is typed. */
export function openVaultForm(entry = null) {
    editing = entry ? entry.id : '';
    el.vaultName.value = entry ? entry.name : '';
    el.vaultNote.value = entry ? entry.note : '';
    el.vaultValue.value = '';
    el.vaultValue.placeholder = t(entry ? 'vault.valueKeep' : 'vault.valueEnter');
    el.vaultBots.value = entry && entry.bots ? 'some' : 'all';
    botChoices(entry ? entry.bots : null);
    vaultBotsChanged();
    vaultError('');
    openSettingsDialog(t(entry ? 'vault.editTitle' : 'vault.addTitle'), el.vaultForm, true);
    (entry ? el.vaultValue : el.vaultName).focus();
}

export function closeVaultForm() {
    closeSettingsDialog(el.vaultForm);
    el.vaultForm.hidden = true;
    el.vaultValue.value = '';
    el.vaultSave.disabled = false;
    editing = '';
}

export function saveVaultEntry() {
    const name = el.vaultName.value.trim().toUpperCase();
    el.vaultName.value = name;
    if (!NAME.test(name)) { vaultError(t('vault.nameInvalid')); el.vaultName.focus(); return; }
    const value = el.vaultValue.value;
    if (!editing && value.length < VALUE_MIN || (value && value.length < VALUE_MIN)) { vaultError(t('vault.valueShort', { min: String(VALUE_MIN) })); el.vaultValue.focus(); return; }
    const bots = el.vaultBots.value === 'all' ? null : [...el.vaultBotList.querySelectorAll('input:checked')].map((cb) => /** @type {HTMLInputElement} */ (cb).value);
    vaultError('');
    saving = true;
    el.vaultSave.disabled = true;
    send({ type: 'vault_save', entry: { id: editing, name, note: el.vaultNote.value.trim(), bots, ...(value ? { value } : {}) } });
}
