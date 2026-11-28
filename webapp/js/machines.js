/* OpenFolk web app: machines and waking. */
import { t, tn } from './i18n.js';
import { el, node, state } from './core.js';
import { clockTime, colorOf, group, responsibleMachine, send, upper } from './e2e.js';
import { renderHeaders } from './chat.js';
import { textHeight } from './queue.js';
import { connectionVia, relayHost } from './platform.js';
import { VERSION } from './release.js';

/** @typedef {import('./panes.js').Pane} Pane */
import { renderSettings } from './settings.js';
import { confirmDialog } from './dialogs.js';
import { setupCard, signInLost } from './welcome.js';
import { reposBadge } from './menus.js';

// ---------------------------------------------------------------- Machines and waking

/** After this time without a backend a running machine counts as stuck (restarting the backend takes seconds). */
export const BACKEND_GONE_MS = 3 * 60000;

/** What the machine's settings allow; unknown (older backend) counts as allowed. */
export function machineCan(host, what) {
    const c = state.capabilities[host];
    return !c || c[what] !== false;
}

/** Text for a machine that runs according to the wake service, but whose backend is not connected. */
function runsWithoutBackend(host) {
    const gone = state.goneSince[host];
    if (!gone || Date.now() - gone < BACKEND_GONE_MS) return ' ' + t('machine.runsBotsNotThere');
    return ' ' + t(state.shutdownPlanned[host] ? 'machine.shutdownStuck' : 'machine.backendGone', { time: clockTime(gone) });
}

/**
 * The line under a machine on the status page: its backend's version, its bots and what they do, the engines ready there, the backend's
 * start and setup, its open repos. Only what the web app already knows; a machine that is off has only its bots.
 */
/** Display names like ENGINE_NAMES in shared/protocol.ts (the web app has no build and does not load it). */
const ENGINE_NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot', antigravity: 'Antigravity', opencode: 'OpenCode' };

function machineDetails(host, connected) {
    const parts = [];
    const bots = state.bots.filter((b) => (b.machine || responsibleMachine(b)) === host);
    if (bots.length) parts.push(tn('status.bots', bots.length));
    if (!connected) return parts;
    const per = state.perMachine[host];
    if (per) {
        const working = bots.filter((b) => per.states[b.id] === 'thinking' || per.states[b.id] === 'waiting').length;
        if (working) parts.push(tn('status.working', working));
        let queued = 0;
        for (const perChat of Object.values(per.queues || {})) for (const n of Object.values(perChat)) queued += n;
        if (queued) parts.push(tn('status.queued', queued));
    }
    const setup = state.setupPerMachine[host];
    if (setup) {
        const ready = Object.entries(setup.engines || {}).filter(([, s]) => s === 'ready').map(([e]) => ENGINE_NAMES[e] || e);
        if (ready.length) parts.push(ready.join(', '));
        if (setup.container) parts.push(t('status.container'));
        if (setup.relay === 'embedded') parts.push(t('status.relayEmbedded'));
    }
    const backend = state.backendPerMachine[host];
    if (backend) {
        // An older backend (before 0.2.1) sends no version
        if (backend.version) parts.unshift(backend.version);
        parts.push(t('status.backendSince', { time: clockTime(backend.since) }));
        if ((backend.changed || []).length) parts.push(t('status.outdated'));
    }
    const repos = Object.values(state.gitPerMachine[host] || {}).flat().filter((r) => r.files.length || r.more || r.ahead || r.behind || r.error).length;
    if (repos) parts.push(tn('status.openRepos', repos));
    return parts;
}

/** The details under the machines change with many frames; while the status page is open they are redrawn. */
export function refreshMachinesPage() {
    renderStatusBadge();
    if (!el.machinesPage.hidden) renderMachines();
}

/** The first OpenFolk whose relay tells its version (relay_hello); a relay without one is older than this. */
export const RELAY_VERSION_SINCE = '0.9.0';

/** [major, minor] of "1.2.3" (patch and pre-release left out: a relay one patch behind is no reason to warn); null if it is no version. */
function majorMinor(v) {
    const m = /^(\d+)\.(\d+)/.exec(v || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Whether major.minor of a is lower than that of b. */
function olderMinor(a, b) {
    const x = majorMinor(a);
    const y = majorMinor(b);
    return Boolean(x && y && (x[0] < y[0] || (x[0] === y[0] && x[1] < y[1])));
}

/**
 * What is known of the relay this device is connected to: its version (relayVersion of the backends' backend_status; the
 * relay is one for all machines online) and, if it is older than this app or a connected backend (major.minor only),
 * the newest of those as `older`: { text, version }. A backend that sends no version of its own is from before the field
 * and says nothing about the relay; one that does and gets none says the relay is older than RELAY_VERSION_SINCE.
 * Null while nothing is known.
 * @returns {{ version: string, unknown: boolean, older: { text: string, version: string } | null } | null}
 */
export function relayStatus() {
    const backends = state.online.map((m) => [m, state.backendPerMachine[m]]).filter(([, b]) => b && b.version);
    const version = (backends.find(([, b]) => b.relayVersion) || [])[1]?.relayVersion || '';
    const unknown = !version && backends.some(([, b]) => !olderMinor(b.version, RELAY_VERSION_SINCE));
    if (!version && !unknown) return null;
    // Without a version the relay is known to be older than RELAY_VERSION_SINCE: older than whatever has reached it
    const behind = (v) => (version ? olderMinor(version, v) : !olderMinor(v, RELAY_VERSION_SINCE));
    const others = [{ version: VERSION, text: t('status.relayThisApp', { version: VERSION }) },
        ...backends.map(([m, b]) => ({ version: b.version, text: t('status.relayBackend', { machine: upper(m), version: b.version }) }))]
        .filter((o) => behind(o.version))
        .sort((a, b) => (olderMinor(a.version, b.version) ? 1 : olderMinor(b.version, a.version) ? -1 : 0));
    return { version, unknown, older: others[0] || null };
}

/** The line above the machines: the relay's address and version, and what to do when it is older (no popup). */
function renderRelayLine() {
    const r = relayStatus();
    const via = relayHost();
    el.machinesRelay.hidden = !r || !via;
    if (!r || !via) return;
    const what = r.version || t('status.relayUnknown', { since: RELAY_VERSION_SINCE });
    const rows = [node('div', '', t('status.relayLine', { host: via.local ? t('status.viaLocal') : via.host, version: what }))];
    if (r.older) rows.push(node('div', 'relay-old', relayOutdatedText(r)));
    el.machinesRelay.replaceChildren(...rows);
}

/** "The relay (version 0.8.0) is older than this app (0.9.0). Update the relay." */
function relayOutdatedText(r) {
    return t(r.version ? 'status.relayOutdated' : 'status.relayOutdatedUnknown', { relay: r.version, other: r.older.text });
}

/**
 * The badge of the status tab: the number of repos with open changes (menus.js renderGitTotal), "!" for a hint, while
 * a machine that runs bots lost its sign-in or while the relay is older than the app or a backend; the page says which and how.
 */
export function renderStatusBadge() {
    const lost = signInLost();
    const relay = relayStatus();
    const old = Boolean(relay && relay.older);
    el.tabStatusBadge.hidden = !lost && !old && !reposBadge.count && !reposBadge.hint;
    el.tabStatusBadge.textContent = reposBadge.count && !lost && !old ? String(reposBadge.count) : '!';
    el.tabStatus.title = [lost ? t('status.signInLost') : '', old ? relayOutdatedText(relay) : '', reposBadge.title].filter(Boolean).join(' · ');
}

export function renderMachines() {
    renderStatusBadge();
    renderRelayLine();
    const card = setupCard(true);
    el.machinesSignin.replaceChildren(...(card ? [card] : []));
    el.machinesSignin.hidden = !card;
    const st = state.machineStatus;
    const hosts = new Set([...state.online, ...(st ? Object.keys(st.hosts || {}) : [])]);
    el.machines.innerHTML = '';
    el.machines.hidden = hosts.size === 0;
    el.machinesNone.hidden = hosts.size > 0;
    for (const h of [...hosts].sort()) {
        const info = (st && st.hosts && st.hosts[h]) || {};
        const connected = state.online.includes(h);
        const waking = state.waking[h];
        const off = connected && state.shuttingDown[h];
        const row = node('div', 'machine-row');
        const dot = node('i', 'dot ' + (off ? 'thinking' : connected ? 'on' : waking ? 'thinking' : info.active ? 'half' : 'off'));
        const text = node('span', 'machine-text');
        text.append(node('strong', '', upper(h)), node('span', '',
            off ? ' ' + t(state.restarting[h] ? 'machine.restartsAt' : 'machine.shutsDownAt', { time: clockTime(off) })
                : connected ? ' ' + t('machine.connected') + connectionVia() : waking ? ' ' + t('machine.waking') : info.error ? ` ${info.error}` : info.active ? runsWithoutBackend(h) : ' ' + t('machine.off')));
        row.append(dot, text);
        const button = (label, action) => {
            const k = node('button', 'link', label);
            k.type = 'button';
            k.addEventListener('click', action);
            row.appendChild(k);
        };
        if (off) { if (machineCan(h, 'cancelShutdown')) button(t('machine.cancel'), () => send({ type: 'machine_shutdown', cancel: true }, h)); }
        else if (connected) {
            // only when the backend says so: an older one ignores "restart" and would shut down
            if (state.capabilities[h] && state.capabilities[h].restart === true) button(t('machine.restart'), () => askShutdown(h, true));
            if (machineCan(h, 'shutdown')) button(t('machine.shutDown'), () => askShutdown(h));
        }
        else if (canWake(h)) button(t('machine.wake'), () => wake(h));
        el.machines.appendChild(row);
        const details = machineDetails(h, connected);
        if (details.length) el.machines.appendChild(node('div', 'machine-details', details.join(' · ')));
    }
    if (st && st.error) el.machines.appendChild(node('div', 'machines-error', st.error));
    if (!el.settings.hidden) renderSettings();
}

async function askShutdown(host, restart = false) {
    const busy = Object.entries(state.perMachine[host] ? state.perMachine[host].states : {}).filter(([, s]) => s === 'thinking' || s === 'waiting');
    const hint = busy.length ? '\n\n' + tn('machine.shutdownBusy', busy.length, { machine: upper(host) }) : '';
    const c = state.capabilities[host];
    const seconds = c && Number.isFinite(c.shutdownSeconds) ? c.shutdownSeconds : 60;
    if (!(await confirmDialog(t(restart ? 'machine.restartConfirm' : 'machine.shutdownConfirm', { machine: upper(host), seconds }) + hint))) return;
    send(restart ? { type: 'machine_shutdown', restart: true } : { type: 'machine_shutdown' }, host);
}

/** Question and request to exactly this machine; true if it is being switched. */
export async function askAutologon(host, on) {
    if (!(await confirmDialog(t(on ? 'machine.autologonOnConfirm' : 'machine.autologonOffConfirm', { machine: upper(host) })))) return false;
    send({ type: 'machine_autologon', on }, host);
    return true;
}

/** A machine that is off and the wake service can start (the button on the status page, the palette's action). */
export function canWake(host) {
    const st = state.machineStatus;
    const info = (st && st.hosts && st.hosts[host]) || {};
    return !state.online.includes(host) && !state.waking[host] && !info.active && !!st && !!st.configured && !info.error;
}

/** Machines the wake service knows that can be woken now. */
export function wakeableMachines() {
    const st = state.machineStatus;
    return Object.keys((st && st.hosts) || {}).filter(canWake).sort();
}

export function wake(host) {
    if (!host || host === '?') return;
    state.waking[host] = Date.now();
    send({ type: 'wake', host });
    renderMachines();
    renderHeaders();
    scheduleWakePoll();
}

let wakeTimer = null;
/** Status every 10 s while a machine is being woken, otherwise every 60 s (only with a visible page). */
export function scheduleWakePoll() {
    if (wakeTimer) clearTimeout(wakeTimer);
    // give up wake attempts after 6 minutes
    for (const [h, ts] of Object.entries(state.waking)) if (Date.now() - ts > 6 * 60000) delete state.waking[h];
    const fast = Object.keys(state.waking).length > 0;
    wakeTimer = setTimeout(() => {
        if (!document.hidden && state.signedIn) send({ type: 'wake_status' });
        scheduleWakePoll();
        renderMachines();
        renderHeaders();
    }, fast ? 10000 : 60000);
}

/** Chips of the group members (@id) above the input field of a pane. @param {Pane} p */
export function renderMembers(p) {
    const members = p.el.members;
    const g = group(p.chatId);
    members.hidden = !g;
    members.innerHTML = '';
    if (!g) return;
    for (const id of [...g.members, 'all']) {
        const button = node('button', 'chip', '@' + id);
        button.type = 'button';
        if (id !== 'all') button.style.borderColor = colorOf(id);
        button.addEventListener('click', () => {
            const text = p.el.text;
            text.value = (text.value && !text.value.endsWith(' ') ? text.value + ' ' : text.value) + '@' + id + ' ';
            text.focus();
            textHeight(p);
        });
        members.appendChild(button);
    }
}
