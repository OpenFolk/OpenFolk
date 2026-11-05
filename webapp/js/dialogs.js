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
 * Shows `message` with the given buttons; resolves with whether the primary one was pressed. Enter presses it, Escape and
 * a click beside the dialog press the other one (or the only one). Focus stays inside and returns afterwards.
 * @param {string} message
 * @param {{ ok?: string, cancel?: string | null }} [o] `cancel: null`: a notice with one button
 * @returns {Promise<boolean>}
 */
function ask(message, o = {}) {
    const shown = queue.then(() => new Promise((resolve) => {
        const before = document.activeElement;
        const overlay = node('div', 'overlay ask');
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        const form = node('form', 'dialog');
        const text = node('p', 'ask-text', String(message));
        text.id = 'ask-text';
        overlay.setAttribute('aria-describedby', text.id);
        const actions = node('div', 'actions');
        const cancel = o.cancel === null ? null : node('button', 'btn', o.cancel || t('common.cancel'));
        if (cancel) cancel.type = 'button';
        const ok = node('button', 'primary', o.ok || t('common.ok'));
        ok.type = 'submit';
        actions.append(...(cancel ? [cancel, ok] : [ok]));
        form.append(text, actions);
        overlay.append(form);

        const done = (answer) => {
            overlay.remove();
            if (before instanceof HTMLElement && before.isConnected) before.focus();
            resolve(answer);
        };
        form.addEventListener('submit', (ev) => { ev.preventDefault(); done(true); });
        if (cancel) cancel.addEventListener('click', () => done(false));
        let pressedOnBackdrop = false;
        overlay.addEventListener('pointerdown', (ev) => { pressedOnBackdrop = ev.target === overlay; });
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay && pressedOnBackdrop) done(!cancel);
            pressedOnBackdrop = false;
        });
        overlay.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                // the dialogs below must not close with it
                ev.stopPropagation();
                ev.preventDefault();
                done(!cancel);
            } else if (ev.key === 'Tab') {
                const buttons = [...actions.querySelectorAll('button')];
                const i = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
                ev.preventDefault();
                buttons[(i + (ev.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
            }
        });
        document.body.append(overlay);
        ok.focus();
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
export function confirmDialog(message, o) {
    return ask(message, o);
}

/**
 * Instead of alert(): resolves when the notice is closed. Callers that do not need to wait just call it.
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function alertDialog(message) {
    await ask(message, { cancel: null });
}
