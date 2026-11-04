/* OpenFolk web app: machines and waking. */
import { t, tn } from './i18n.js';
import { el, node, state } from './core.js';
import { clockTime, colorOf, group, responsibleMachine, send, upper } from './e2e.js';
import { renderHeaders } from './chat.js';
import { textHeight } from './queue.js';
import { connectionVia } from './platform.js';

/** @typedef {import('./panes.js').Pane} Pane */
import { renderSettings } from './settings.js';

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
 * The line under a machine on the status page: its bots and what they do, the engines ready there, the backend's
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
        parts.push(t('status.backendSince', { time: clockTime(backend.since) }));
        if ((backend.changed || []).length) parts.push(t('status.outdated'));
    }
    const repos = Object.values(state.gitPerMachine[host] || {}).flat().filter((r) => r.files.length || r.more || r.ahead || r.behind || r.error).length;
    if (repos) parts.push(tn('status.openRepos', repos));
    return parts;
}

/** The details under the machines change with many frames; while the status page is open they are redrawn. */
export function refreshMachinesPage() {
    if (!el.machinesPage.hidden) renderMachines();
}

export function renderMachines() {
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
        else if (!waking && !info.active && st && st.configured && !info.error) button(t('machine.wake'), () => wake(h));
        el.machines.appendChild(row);
        const details = machineDetails(h, connected);
        if (details.length) el.machines.appendChild(node('div', 'machine-details', details.join(' · ')));
    }
    if (st && st.error) el.machines.appendChild(node('div', 'machines-error', st.error));
    if (!el.settings.hidden) renderSettings();
}

function askShutdown(host, restart = false) {
    const busy = Object.entries(state.perMachine[host] ? state.perMachine[host].states : {}).filter(([, s]) => s === 'thinking' || s === 'waiting');
    const hint = busy.length ? '\n\n' + tn('machine.shutdownBusy', busy.length, { machine: upper(host) }) : '';
    const c = state.capabilities[host];
    const seconds = c && Number.isFinite(c.shutdownSeconds) ? c.shutdownSeconds : 60;
    if (!confirm(t(restart ? 'machine.restartConfirm' : 'machine.shutdownConfirm', { machine: upper(host), seconds }) + hint)) return;
    send(restart ? { type: 'machine_shutdown', restart: true } : { type: 'machine_shutdown' }, host);
}

/** Question and request to exactly this machine; true if it is being switched. */
export function askAutologon(host, on) {
    if (!confirm(t(on ? 'machine.autologonOnConfirm' : 'machine.autologonOffConfirm', { machine: upper(host) }))) return false;
    send({ type: 'machine_autologon', on }, host);
    return true;
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
