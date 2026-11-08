/* OpenFolk web app: questions and notices as HTML dialogs instead of the browser's confirm() and alert(). */
import { t } from './i18n.js';

// No import of core.js: platform.js uses these dialogs, and core.js imports platform.js
function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

/** Dialogs wait for each other: a second notice opens when the first is answered, never on top of it. */
let queue = Promise.resolve();

/**
 * Shows a modal dialog and resolves with whether it was confirmed. `build` fills the form and returns the element that
 * gets the focus. Submitting the form confirms; Escape and a click beside the dialog decline (a notice has nothing to
 * decline: there they confirm). Tab stays inside, focus returns afterwards, Escape does not reach the dialogs below.
 * @param {(form: HTMLFormElement) => HTMLElement} build
 * @param {boolean} [notice] one button only
 * @returns {Promise<boolean>}
 */
function present(build, notice = false) {
    const shown = queue.then(() => new Promise((resolve) => {
        const before = document.activeElement;
        const overlay = node('div', 'overlay ask');
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        const form = node('form', 'dialog');
        form.noValidate = true;
        overlay.append(form);
        const focus = build(form);
        const done = (answer) => {
            overlay.remove();
            if (before instanceof HTMLElement && before.isConnected) before.focus();
            resolve(answer);
        };
        form.addEventListener('submit', (ev) => { ev.preventDefault(); done(true); });
        form.addEventListener('click', (ev) => {
            if (ev.target instanceof HTMLElement && ev.target.dataset.cancel) done(false);
        });
        let pressedOnBackdrop = false;
        overlay.addEventListener('pointerdown', (ev) => { pressedOnBackdrop = ev.target === overlay; });
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay && pressedOnBackdrop) done(notice);
            pressedOnBackdrop = false;
        });
        overlay.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.stopPropagation();
                ev.preventDefault();
                done(notice);
            } else if (ev.key === 'Tab') {
                const fields = [...form.querySelectorAll('input, button')].filter((f) => !(/** @type {HTMLButtonElement} */ (f).disabled));
                const i = fields.indexOf(/** @type {HTMLElement} */ (document.activeElement));
                ev.preventDefault();
                fields[(i + (ev.shiftKey ? fields.length - 1 : 1)) % fields.length].focus();
            }
        });
        document.body.append(overlay);
        focus.focus();
    }));
    queue = shown.then(() => undefined, () => undefined);
    return shown;
}

/**
 * Instead of confirm(): resolves true on "OK", false on "Cancel", Escape or a click beside the dialog.
 * @param {string} message
 * @param {{ ok?: string, cancel?: string }} [o] other button labels
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, o = {}) {
    return present((form) => {
        const cancel = node('button', 'btn', o.cancel || t('common.cancel'));
        cancel.type = 'button';
        cancel.dataset.cancel = '1';
        const ok = node('button', 'primary', o.ok || t('common.ok'));
        ok.type = 'submit';
        form.append(askText(message), actions(cancel, ok));
        return ok;
    });
}

/**
 * Instead of alert(): resolves when the notice is closed. Callers that do not need to wait just call it.
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function alertDialog(message) {
    await present((form) => {
        const ok = node('button', 'primary', t('common.ok'));
        ok.type = 'submit';
        form.append(askText(message), actions(ok));
        return ok;
    }, true);
}

/**
 * The "danger zone" for something that cannot be brought back: a warning with what goes, an optional name to type
 * and a red button named after the action that stays disabled until the name matches exactly.
 * @param {{ title: string, items: string[], notes?: string[], name?: string, action: string }} o `items`: what is
 *   deleted; `notes`: what stays, or other hints; `name`: what to type to confirm (none for a smaller loss)
 * @returns {Promise<boolean>}
 */
export function dangerDialog(o) {
    return present((form) => {
        const zone = node('div', 'danger-zone');
        zone.append(node('strong', '', t('danger.warning')));
        if (o.items.length) {
            zone.append(node('span', '', t('danger.willDelete')));
            const list = node('ul');
            for (const item of o.items) list.append(node('li', '', item));
            zone.append(list);
        }
        for (const note of o.notes || []) zone.append(node('span', 'danger-note', note));
        const cancel = node('button', 'btn', t('common.cancel'));
        cancel.type = 'button';
        cancel.dataset.cancel = '1';
        const go = node('button', 'primary danger', o.action);
        go.type = 'submit';
        form.append(node('h2', '', o.title), zone);
        /** @type {HTMLElement} */
        let focus = go;
        if (o.name) {
            const label = node('label');
            const name = node('strong', 'danger-name', o.name);
            label.append(node('span', '', t('danger.typeName')), name);
            const field = document.createElement('input');
            field.autocomplete = 'off';
            field.spellcheck = false;
            field.setAttribute('aria-label', t('danger.typeName') + ' ' + o.name);
            go.disabled = true;
            field.addEventListener('input', () => { go.disabled = field.value.trim() !== o.name; });
            label.append(field);
            form.append(label);
            focus = field;
        }
        form.append(actions(cancel, go));
        return focus;
    });
}

const askText = (message) => node('p', 'ask-text', String(message));

function actions(...buttons) {
    const row = node('div', 'actions');
    row.append(...buttons);
    return row;
}
