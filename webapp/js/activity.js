/* OpenFolk web app: telling the backends whether this device is looking and, on a desktop, in use. A phone stays
   quiet while a desktop is in use (docs/internals/push.md). Nothing runs while the desktop is idle: input only
   records a time, and the one timer exists only while the desktop counts as in use. */
import { state } from './core.js';
import { send } from './e2e.js';
import { deviceForm } from './platform.js';

/** Without input for this long a desktop is no longer in use. */
const IDLE_MS = 2 * 60_000;
/** While in use, a fresh report at most this often: a backend forgets a report after three minutes. */
const REFRESH_MS = 60_000;

let form = '';
const isDesktop = () => (form ||= deviceForm()) === 'desktop';
/** No input yet: a desktop app that starts with the computer is not in use until someone touches it. */
let lastInput = 0;
let lastSent = 0;
/** What the backends were last told. */
let active = false;
let idleTimer = 0;
/** Machines that have the current report; a machine that comes (back) gets it once. */
const told = new Set();

const inUse = () => !document.hidden && Date.now() - lastInput < IDLE_MS;

function frame() {
    return { type: 'presence', visible: !document.hidden, desktop: isDesktop(), ...(isDesktop() ? { active } : {}) };
}

/** Sends the current state to every machine awake: a bot's push is decided on its own machine. */
export function reportPresence() {
    active = isDesktop() && inUse();
    lastSent = Date.now();
    told.clear();
    const f = frame();
    for (const m of state.online) {
        send(f, m);
        told.add(m);
    }
    clearTimeout(idleTimer);
    if (active) idleTimer = window.setTimeout(checkIdle, lastInput + IDLE_MS - Date.now());
}

function checkIdle() {
    if (inUse()) idleTimer = window.setTimeout(checkIdle, lastInput + IDLE_MS - Date.now());
    else reportPresence();
}

/** After a new list of machines awake: the ones that do not have the report yet get it. */
export function presenceToNewMachines() {
    for (const m of told) if (!state.online.includes(m)) told.delete(m);
    const f = frame();
    for (const m of state.online) {
        if (told.has(m)) continue;
        send(f, m);
        told.add(m);
    }
}

/** After signing in on a new connection: no machine has heard from this page yet. */
export function presenceUnknown() {
    told.clear();
}

/** Keyboard, mouse or touch (start.js wires it): reports only when the desktop becomes in use or the last report ages. */
export function noteInput() {
    lastInput = Date.now();
    if (!isDesktop() || document.hidden) return;
    if (!active || lastInput - lastSent >= REFRESH_MS) reportPresence();
}
