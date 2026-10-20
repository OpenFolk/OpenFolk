/* OpenFolk web app: moving from the relay embedded in a backend to a relay of one's own on a server. The backend claims
   it with the setup code from its log ("relay_claim"), answers with a pairing link there and moves over; this page
   then opens the link and is signed in at the new relay, with the end-to-end key. */
import { t } from './i18n.js';
import { node, state } from './core.js';
import { send, upper } from './e2e.js';

/** What is typed: the forms render anew with every state that arrives and must not lose it. */
const draft = { address: '', code: '', focus: '' };
/** The claim on its way, done, or why it failed. */
let claim = /** @type {{ machine: string, state: 'sent' | 'done' | 'failed', message?: string } | null} */ (null);
/** The places that show the form (first steps, settings), rendered again when the claim moves on. */
const places = new Set();
const rerender = () => { for (const render of places) render(); };

/** The machine whose backend runs the relay itself and whose settings this account may change; '' if none. */
export function embeddedMachine() {
    return state.online.find((m) => state.setupPerMachine[m]?.relay === 'embedded' && state.machineSettings[m]) || '';
}

/**
 * The form: address and setup code of the new relay. Null when no machine runs an embedded relay this account may move.
 * @param {() => void} onChange renders the place again
 * @returns {HTMLFormElement | null}
 */
export function relayClaimForm(onChange) {
    const machine = embeddedMachine();
    if (!machine) return null;
    places.add(onChange);
    const form = /** @type {HTMLFormElement} */ (node('form', 'relay-claim'));
    form.append(node('p', 'hint', t('relayClaim.intro', { machine: upper(machine) })));
    /** @param {'address' | 'code'} name */
    const field = (name, placeholder) => {
        const label = node('label', '');
        const input = /** @type {HTMLInputElement} */ (node('input'));
        input.name = name;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = placeholder;
        input.value = draft[name];
        input.addEventListener('input', () => { draft[name] = input.value; });
        input.addEventListener('focus', () => { draft.focus = name; });
        // Taking the field off the page blurs it too; only a field still on the page lost the focus to the user
        input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected && draft.focus === name) draft.focus = ''; }));
        label.append(node('span', '', t(`relayClaim.${name}`)), input);
        form.append(label);
        if (draft.focus === name) queueMicrotask(() => input.focus());
        return input;
    };
    field('address', 'relay.example.com');
    field('code', 'ABCDE-FGHJK');
    const busy = claim?.machine === machine && (claim.state === 'sent' || claim.state === 'done');
    const button = /** @type {HTMLButtonElement} */ (node('button', 'primary small', t('relayClaim.button')));
    button.type = 'submit';
    button.disabled = busy;
    form.append(button);
    if (claim?.machine === machine && claim.state === 'done') form.append(node('p', 'hint', t('relayClaim.moving')));
    if (claim?.machine === machine && claim.state === 'failed') form.append(node('p', 'error', claim.message || ''));
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy || !draft.address.trim() || !draft.code.trim()) return;
        claim = { machine, state: 'sent' };
        send({ type: 'relay_claim', address: draft.address.trim(), code: draft.code.trim() }, machine);
        rerender();
    });
    return form;
}

/**
 * The backend's answer: the relay is claimed, the link signs this device in there.
 * @param {string} machine
 * @param {string} url
 */
export function relayClaimed(machine, url) {
    if (!claim || claim.machine !== machine || !/^https?:\/\//.test(url)) return;
    claim = { machine, state: 'done' };
    draft.address = draft.code = '';
    rerender();
    // A moment to read what happens; the backend moves over shortly after its answer
    setTimeout(() => location.assign(url), 1200);
}

/**
 * @param {string} machine
 * @param {string} message
 */
export function relayClaimFailed(machine, message) {
    if (!claim || claim.machine !== machine) return;
    claim = { machine, state: 'failed', message };
    rerender();
}
