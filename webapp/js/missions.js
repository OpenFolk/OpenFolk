/* OpenFolk web app: Mission Control. One page in the page frame of the tabs (like Status) with three views: the
   overview of all missions, one mission (goal, team at work, tasks, approvals, metrics of its project, the log) and
   the builder, which turns a goal in plain words into a proposal the user edits before anything is made. What a
   mission is and does comes from its machine's backend (local/src/missions.ts); the page never decides for it. */
import { t, tn } from './i18n.js';
import { el, loadedAccount, node, relayScope, state, storage, toast } from './core.js';
import { bot, clockTime, fillAvatar, send, upper } from './e2e.js';
import { openChat } from './chat.js';
import { confirmDialog } from './dialogs.js';
import { lineChart, shortNumber } from './chart.js';

/** @typedef {{ kind: 'list' } | { kind: 'detail', id: string } | { kind: 'builder', id?: string }} View */

/** @type {View} */
let view = { kind: 'list' };
/** The builder: the proposal or mission being edited, whether the model is drafting, the last error. */
const builder = { draft: null, busy: false, error: '', machine: '', goal: '', folder: '', request: '', since: 0 };

// A new mission not saved yet is kept on this device (per relay and account): a reload of the page, a restart of the
// relay or the app sent to the background must not lose a proposal that took a minute and the edits made to it.
const DRAFT_KEY = `openfolk-mission-draft${relayScope}:${loadedAccount}`;
/** A proposal not answered after this long is taken as lost (the backend restarted meanwhile). */
const PROPOSAL_WAIT_MS = 5 * 60_000;

function keepDraft() {
    const unsaved = builder.draft && !builder.draft.id;
    if (!unsaved && !builder.goal.trim() && !builder.busy) return storage.remove(DRAFT_KEY);
    storage.set(DRAFT_KEY, JSON.stringify({
        goal: builder.goal, folder: builder.folder, machine: builder.machine, draft: unsaved ? builder.draft : null,
        request: builder.busy ? builder.request : '', since: builder.since,
    }));
}

(() => {
    try {
        const k = JSON.parse(storage.get(DRAFT_KEY) || 'null');
        if (!k) return;
        Object.assign(builder, { goal: k.goal || '', folder: k.folder || '', machine: k.machine || '', draft: k.draft || null });
        if (k.request && Date.now() - (k.since || 0) < PROPOSAL_WAIT_MS) Object.assign(builder, { busy: true, request: k.request, since: k.since });
    } catch { /* a broken entry: start empty */ }
})();
/** Filter of the log on the mission page. */
let logFilter = 'all';
let detailAsked = 0;

const ACTIVE = ['planning', 'running', 'waiting_approval'];
const OVER = ['completed', 'failed', 'cancelled'];
const STATUS_TEXT = {
    draft: 'missions.status.draft', planning: 'missions.status.planning', running: 'missions.status.running', waiting_approval: 'missions.status.waiting_approval',
    paused: 'missions.status.paused', blocked: 'missions.status.blocked', completed: 'missions.status.completed', failed: 'missions.status.failed', cancelled: 'missions.status.cancelled',
    killed: 'missions.killed',
};
const FILTER_TEXT = { all: 'missions.filter.all', decisions: 'missions.filter.decisions', critical: 'missions.filter.critical' };
const RISK_TEXT = { low: 'missions.risk.low', medium: 'missions.risk.medium', high: 'missions.risk.high' };
const TASK_TEXT = {
    open: 'missions.task.open', delegated: 'missions.task.delegated', running: 'missions.task.running', blocked: 'missions.task.blocked',
    done: 'missions.task.done', failed: 'missions.task.failed', cancelled: 'missions.task.cancelled',
};
const KIND_TEXT = {
    status: 'missions.kind.status', tick: 'missions.kind.tick', decision: 'missions.kind.decision', plan: 'missions.kind.plan', task: 'missions.kind.task',
    delegation: 'missions.kind.delegation', feedback: 'missions.kind.feedback', approval: 'missions.kind.approval', budget: 'missions.kind.budget',
    result: 'missions.kind.result', error: 'missions.kind.error', user: 'missions.kind.user', event: 'missions.kind.event',
};
const AUTONOMY_TEXT = { 1: 'missions.autonomy.1', 2: 'missions.autonomy.2', 3: 'missions.autonomy.3', 4: 'missions.autonomy.4' };
const PRIORITY_TEXT = { low: 'missions.priority.low', normal: 'missions.priority.normal', high: 'missions.priority.high' };

const mission = (id) => (state.missions || []).find((m) => m.id === id);
const who = (id) => (id === 'user' ? t('missions.byUser') : id === 'system' ? t('missions.bySystem') : (bot(id) || { name: id }).name);
const button = (label, cls, action) => {
    const b = node('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
};
const section = (title, ...children) => {
    const s = node('section', 'mission-section');
    s.append(node('h3', '', title), ...children.filter(Boolean));
    return s;
};
const pill = (status) => {
    const p = node('span', 'mission-status', t(STATUS_TEXT[status] || status));
    p.dataset.status = status;
    return p;
};
/** A bar like the plans' quota: share 0..1, red from the limit on. */
function bar(label, share, value) {
    const row = node('div', 'usage-bar' + (share >= 1 ? ' critical' : share >= 0.8 ? ' warning' : ''));
    const track = node('span', 'track');
    const fill = node('span', 'fill');
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
    track.append(fill);
    row.append(node('span', '', label), track, node('span', 'value', value));
    return row;
}
function avatarOf(id, cls = 'avatar mini') {
    const a = node('div', cls);
    fillAvatar(a, bot(id) || { name: id }, id);
    a.title = who(id);
    return a;
}

// ---------------------------------------------------------------- Frames

export function receiveMissions(list) {
    state.missions = list || [];
    renderMissionsBadge();
    if (el.missionsPage.hidden) return;
    if (view.kind === 'detail') {
        if (!mission(view.id)) view = { kind: 'list' };
        // the log comes with mission_open; asked again after changes, not more than every two seconds
        else if (Date.now() - detailAsked > 2000) askDetail(view.id);
    }
    if (view.kind !== 'builder' && !typing()) renderMissionsPage();
}

export function receiveMissionDetail(f) {
    state.missionDetail = { ...state.missionDetail, [f.id]: { events: f.events || [], metrics: f.metrics, metricsError: f.metricsError || '' } };
    if (!el.missionsPage.hidden && view.kind === 'detail' && view.id === f.id && !typing()) renderMissionsPage();
}

export function receiveProposal(p, id) {
    // Sent to every page of the account: only the one that asked (or reloaded since) takes it
    if (id && id !== builder.request) return;
    builder.busy = false;
    builder.request = '';
    builder.error = '';
    builder.draft = { ...p, id: '', folder: p.folder || builder.folder || suggestedFolder(p.name, builder.machine) };
    keepDraft();
    if (!el.missionsPage.hidden) renderMissionsPage();
}

export function missionSaved(id) {
    Object.assign(builder, { busy: false, draft: null, goal: '', folder: '', request: '' });
    keepDraft();
    if (!el.missionsPage.hidden) openMission(id);
}

/** An error of a mission frame: in the builder under the form, elsewhere as a notice. */
export function missionError(message) {
    if (!el.missionsPage.hidden && view.kind === 'builder') {
        builder.busy = false;
        builder.request = '';
        keepDraft();
        builder.error = message;
        renderMissionsPage();
        return;
    }
    toast(message, 5000);
}

/** The number on the tab: decisions waiting for the user in all missions. */
export function renderMissionsBadge() {
    const n = (state.missions || []).filter((m) => !OVER.includes(m.status)).reduce((s, m) => s + (m.approvals || []).length, 0);
    el.tabMissionsBadge.hidden = !n;
    el.tabMissionsBadge.textContent = n ? String(n) : '';
    el.tabMissionsBadge.title = n ? tn('missions.approvalsOpen', n) : '';
}

/** A bot's state changed: the team on the open mission shows what it does now (the builder keeps what is typed). */
export function refreshMissionsPage() {
    if (!el.missionsPage.hidden && view.kind !== 'builder' && !typing()) renderMissionsPage();
}

/** Someone types on the page (a task, a note to an approval): drawing it anew would take that away. */
function typing() {
    const a = document.activeElement;
    return !!a && el.missionsPage.contains(a) && a.matches('input, textarea, select');
}

function askDetail(id) {
    const m = mission(id);
    if (!m) return;
    detailAsked = Date.now();
    send({ type: 'mission_open', id }, m.machine);
}

// ---------------------------------------------------------------- Navigation

/** Set when the tab opens the page again: a builder still on the page is shown as it was, with what was typed. */
let resuming = false;

/**
 * The tab "Missions": back where the user left it. An unsaved mission lives only in the builder, so going back to the
 * overview here would hide it (and a proposal that arrived meanwhile); a mission gone meanwhile falls back to the list.
 */
export function showMissionList() {
    if (view.kind === 'detail' && !mission(view.id)) view = { kind: 'list' };
    if (view.kind === 'detail') askDetail(view.id);
    resuming = view.kind === 'builder';
    for (const m of new Set(state.online)) send({ type: 'missions' }, m);
}

/** An unsaved new mission waits in the builder (proposal drafting or ready, fields filled in). */
const draftWaiting = () => builder.busy || !!(builder.draft && !builder.draft.id) || !!builder.goal.trim();

export function openMission(id) {
    view = { kind: 'detail', id };
    logFilter = 'all';
    askDetail(id);
    renderMissionsPage();
    el.missionsPage.scrollTop = 0;
}

function openBuilder(edit) {
    view = edit ? { kind: 'builder', id: edit.id } : { kind: 'builder' };
    builder.error = '';
    builder.busy = false;
    builder.draft = edit ? editable(edit) : null;
    builder.machine = edit ? edit.machine : builder.machine && state.online.includes(builder.machine) ? builder.machine : state.online[0] || '';
    renderMissionsPage();
    el.missionsPage.scrollTop = 0;
}

/** "Back" in the page's header: from a mission or the builder to the overview; false = leave the page. */
export function missionsBack() {
    if (el.gitPage.hidden || el.gitPage.dataset.page !== 'missions' || view.kind === 'list') return false;
    if (view.kind === 'builder' && view.id) openMission(view.id);
    else {
        view = { kind: 'list' };
        renderMissionsPage();
    }
    return true;
}

/** The title of the page frame. */
export function missionsTitle() {
    if (view.kind === 'detail') return mission(view.id)?.name || t('tabs.missions');
    if (view.kind === 'builder') return t(view.id ? 'missions.editTitle' : 'missions.newTitle');
    return t('tabs.missions');
}

export function renderMissionsPage() {
    el.gitTitle.textContent = missionsTitle();
    const keep = resuming && view.kind === 'builder' && el.missionsPage.querySelector('.mission-form');
    resuming = false;
    if (keep) {
        el.gitSub.textContent = '';
        return;
    }
    const m = view.kind === 'detail' ? mission(view.id) : null;
    el.gitSub.textContent = m ? upper(m.machine) : '';
    if (view.kind === 'builder') el.missionsPage.replaceChildren(...renderBuilder());
    else if (m) el.missionsPage.replaceChildren(...renderDetail(m));
    else el.missionsPage.replaceChildren(...renderList());
}

// ---------------------------------------------------------------- Overview

function renderList() {
    const all = [...(state.missions || [])].sort((a, b) => rank(a) - rank(b) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const active = all.filter((m) => ACTIVE.includes(m.status));
    const teams = new Set(active.flatMap((m) => [m.supervisor, ...m.team.map((x) => x.botId)]));
    const working = [...teams].filter((id) => state.states[id] === 'thinking' || Object.keys(state.activeChats).some((k) => k.startsWith(id + '~') && state.states[k] === 'thinking')).length;
    const approvals = all.filter((m) => !OVER.includes(m.status)).reduce((s, m) => s + m.approvals.length, 0);
    const milestones = all.reduce((s, m) => s + m.milestones.filter((x) => x.status === 'done').length, 0);
    const critical = all.filter((m) => m.status === 'blocked' || m.killSwitch || m.loop.errors > 0).length;
    const tiles = node('div', 'mission-tiles');
    const tile = (n, label, warn = false) => {
        const d = node('div', 'mission-tile' + (warn && n ? ' warn' : ''));
        d.append(node('strong', '', String(n)), node('span', '', label));
        tiles.append(d);
    };
    tile(active.length, t('missions.tileActive'));
    tile(working, t('missions.tileWorking'));
    tile(approvals, t('missions.tileApprovals'), true);
    tile(milestones, t('missions.tileMilestones'));
    tile(critical, t('missions.tileCritical'), true);
    const head = node('div', 'mission-actions');
    // A begun new mission is not lost by going back to the overview: it waits here until saved or discarded
    if (draftWaiting()) {
        const goOn = button(t(builder.busy ? 'missions.draftRunning' : 'missions.draftContinue'), 'primary', () => {
            view = { kind: 'builder' };
            renderMissionsPage();
        });
        head.append(goOn);
    } else {
        const create = button(t('missions.new'), 'primary', () => openBuilder(null));
        create.disabled = !state.online.length;
        head.append(create);
    }
    const out = [tiles, head];
    if (!all.length) out.push(node('p', 'empty-small', t('missions.none')));
    for (const m of all) out.push(missionCard(m));
    return out;
}

const rank = (m) => (m.approvals.length && !OVER.includes(m.status) ? 0 : ACTIVE.includes(m.status) ? 1 : m.status === 'blocked' || m.status === 'paused' ? 2 : m.status === 'draft' ? 3 : 4);

function missionCard(m) {
    const card = node('button', 'mission-card');
    card.type = 'button';
    card.dataset.mission = m.id;
    card.addEventListener('click', () => openMission(m.id));
    const head = node('div', 'mission-card-head');
    head.append(node('strong', '', m.name), pill(m.status));
    if (m.killSwitch) head.append(pill('killed'));
    card.append(head);
    if (m.type) card.append(node('span', 'mission-type', m.type));
    card.append(node('p', 'mission-goal', m.goal));
    card.append(bar(t('missions.progress'), m.progress / 100, `${m.progress} %`));
    const facts = node('div', 'mission-card-facts');
    const team = node('span', 'mission-team-mini');
    for (const id of [m.supervisor, ...m.team.map((x) => x.botId).filter((x) => x !== m.supervisor)].slice(0, 6)) team.append(avatarOf(id));
    facts.append(team);
    const running = m.tasks.filter((x) => x.status === 'delegated' || x.status === 'running').length;
    if (running) facts.append(node('span', '', tn('missions.tasksRunning', running)));
    if (m.approvals.length && !OVER.includes(m.status)) facts.append(node('span', 'mission-warn', tn('missions.approvalsOpen', m.approvals.length)));
    if (m.loop.lastTick) facts.append(node('span', '', t('missions.lastCycle', { time: clockTime(m.loop.lastTick) })));
    card.append(facts);
    const budget = budgetBars(m, true);
    if (budget.length) card.append(...budget);
    return card;
}

// ---------------------------------------------------------------- One mission

function renderDetail(m) {
    const detail = (state.missionDetail || {})[m.id];
    const out = [];
    const head = node('div', 'mission-head');
    const title = node('div', 'mission-card-head');
    title.append(node('strong', '', m.name), pill(m.status));
    if (m.killSwitch) title.append(pill('killed'));
    head.append(title);
    if (m.type) head.append(node('span', 'mission-type', m.type + ' · ' + t(PRIORITY_TEXT[m.priority] || m.priority)));
    head.append(node('p', 'mission-goal full', m.goal));
    if (m.description) head.append(node('p', 'hint', m.description));
    head.append(bar(t('missions.progress'), m.progress / 100, `${m.progress} %`));
    const dates = [m.startAt && t('missions.started', { date: m.startAt }), m.dueAt && t('missions.due', { date: m.dueAt }), m.loop.ticks && tn('missions.cycles', m.loop.ticks)].filter(Boolean);
    if (dates.length) head.append(node('p', 'hint', dates.join(' · ')));
    out.push(head, controls(m));

    if (m.approvals.length) out.push(section(t('missions.approvals'), ...m.approvals.map((a) => approvalCard(m, a))));
    const metrics = metricsBlock(detail);
    if (metrics) out.push(section(t('missions.metrics'), ...metrics));
    out.push(section(t('missions.resources'), ...budgetBars(m, false), node('p', 'hint', t('missions.budgetHint'))));
    out.push(section(t('missions.team'), teamBlock(m, detail)));
    if (m.milestones.length) out.push(section(t('missions.milestones'), milestoneList(m)));
    out.push(section(t('missions.tasks'), taskList(m), taskForm(m)));
    if (m.results.length) out.push(section(t('missions.results'), resultList(m)));
    out.push(section(t('missions.log'), logBlock(m, detail)));
    out.push(section(t('missions.rules'), rulesBlock(m)));
    return out;
}

function controls(m) {
    const row = node('div', 'mission-actions');
    const act = (action) => send({ type: 'mission_control', id: m.id, action }, m.machine);
    const offline = !state.online.includes(m.machine);
    if (m.status === 'draft') row.append(button(t('missions.start'), 'primary', () => act('start')));
    if (ACTIVE.includes(m.status) && !m.killSwitch) {
        row.append(button(t('missions.pause'), 'btn', () => act('pause')));
        row.append(button(t('missions.cycleNow'), 'btn', () => act('tick')));
    }
    if (m.status === 'paused' || m.status === 'blocked') row.append(button(t(m.killSwitch ? 'missions.releaseKill' : 'missions.resume'), 'primary', () => act('resume')));
    if (!OVER.includes(m.status) && m.status !== 'draft') {
        row.append(button(t('missions.complete'), 'btn', async () => { if (await confirmDialog(t('missions.completeConfirm', { name: m.name }))) act('complete'); }));
        row.append(button(t('missions.stop'), 'btn danger', async () => { if (await confirmDialog(t('missions.stopConfirm', { name: m.name }))) act('cancel'); }));
    }
    if (!OVER.includes(m.status) && !m.killSwitch && m.status !== 'draft') {
        row.append(button(t('missions.kill'), 'primary danger mission-kill', async () => { if (await confirmDialog(t('missions.killConfirm', { name: m.name }))) act('kill'); }));
    }
    if (!OVER.includes(m.status)) row.append(button(t('missions.edit'), 'btn', () => openBuilder(m)));
    if (m.chatId) row.append(button(t('missions.openChat'), 'btn', () => openChat(m.chatId)));
    if (m.status === 'draft' || OVER.includes(m.status)) {
        row.append(button(t('missions.delete'), 'btn danger', async () => {
            if (!(await confirmDialog(t('missions.deleteConfirm', { name: m.name })))) return;
            send({ type: 'mission_delete', id: m.id }, m.machine);
            view = { kind: 'list' };
        }));
    }
    for (const b of row.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = offline && b.textContent !== t('missions.openChat');
    if (offline) row.append(node('p', 'hint', t('missions.machineAsleep', { machine: upper(m.machine) })));
    return row;
}

function approvalCard(m, a) {
    const card = node('div', 'mission-approval');
    card.dataset.approval = a.id;
    card.append(node('strong', '', a.title));
    if (a.detail) card.append(node('p', '', a.detail));
    card.append(node('span', 'hint', `${who(a.requestedBy)} · ${clockTime(a.createdAt)} · ${a.kind}`));
    const note = /** @type {HTMLInputElement} */ (node('input', ''));
    note.placeholder = t('missions.approvalNote');
    note.maxLength = 1000;
    const answer = (allow) => {
        send({ type: 'mission_approval_reply', missionId: m.id, id: a.id, allow, ...(note.value.trim() ? { message: note.value.trim() } : {}) }, m.machine);
        card.classList.add('sent');
    };
    const row = node('div', 'mission-actions');
    row.append(button(t('missions.deny'), 'btn', () => answer(false)), button(t('missions.allow'), 'primary', () => answer(true)));
    card.append(note, row);
    return card;
}

function budgetBars(m, compact) {
    const out = [];
    const b = m.budget || {};
    const s = m.spent || {};
    if (b.costUsd !== undefined) out.push(bar(t('missions.cost'), b.costUsd ? s.costUsd / b.costUsd : 1, `${s.costUsd.toFixed(2)} / ${b.costUsd} $`));
    else if (!compact) out.push(bar(t('missions.cost'), 0, `${(s.costUsd || 0).toFixed(2)} $`));
    if (b.turns !== undefined) out.push(bar(t('missions.turns'), b.turns ? s.turns / b.turns : 1, `${s.turns} / ${b.turns}`));
    else if (!compact) out.push(bar(t('missions.turns'), 0, String(s.turns || 0)));
    if (!compact && b.turnsPerDay !== undefined) {
        const todayCount = s.day === new Date().toLocaleDateString('sv') ? s.turnsToday : 0;
        out.push(bar(t('missions.turnsToday'), b.turnsPerDay ? todayCount / b.turnsPerDay : 1, `${todayCount} / ${b.turnsPerDay}`));
    }
    if (!compact && b.money) out.push(node('p', 'hint', t('missions.money', { amount: b.money.amount, currency: b.money.currency })));
    return out;
}

function metricsBlock(detail) {
    if (!detail) return null;
    const out = [];
    if (detail.metricsError) out.push(node('p', 'error', detail.metricsError));
    const mt = detail.metrics;
    if (!mt) return out.length ? out : [node('p', 'hint', t('missions.noMetrics'))];
    const kpis = Object.entries(mt.kpis || {});
    if (kpis.length) {
        const tiles = node('div', 'mission-tiles');
        for (const [key, k] of kpis) {
            const d = node('div', 'mission-tile');
            d.dataset.kpi = key;
            const value = typeof k.value === 'number' ? shortNumber(k.value) : k.value;
            d.append(node('strong', '', `${value}${k.unit ? ' ' + k.unit : ''}`), node('span', '', k.label));
            if (typeof k.value === 'number' && typeof k.target === 'number') {
                const reached = k.good === 'down' ? k.value <= k.target : k.value >= k.target;
                d.classList.add(reached ? 'good' : 'warn');
                d.append(node('span', 'hint', t('missions.target', { value: shortNumber(k.target) })));
            }
            tiles.append(d);
        }
        out.push(tiles);
    }
    for (const [key, s] of Object.entries(mt.series || {})) {
        const box = node('div', 'mission-chart');
        box.dataset.series = key;
        box.append(node('span', 'hint', s.label + (s.unit ? ` (${s.unit})` : '')), lineChart(s.points, { label: s.label }));
        out.push(box);
    }
    for (const [key, tb] of Object.entries(mt.tables || {})) {
        const wrap = node('div', 'mission-table');
        wrap.dataset.table = key;
        const table = node('table');
        const head = node('tr');
        for (const c of tb.columns) head.append(node('th', '', c));
        table.append(head);
        for (const r of tb.rows.slice(0, 100)) {
            const tr = node('tr');
            for (const c of r) tr.append(node('td', typeof c === 'number' ? 'num' : '', typeof c === 'number' ? shortNumber(c) : c));
            table.append(tr);
        }
        wrap.append(node('span', 'hint', tb.label), table);
        out.push(wrap);
    }
    if (mt.updatedAt) out.push(node('p', 'hint', t('missions.metricsAt', { time: clockTime(mt.updatedAt) })));
    return out;
}

/** The team at work: what each one does now, for which task, and what it delivered. */
function teamBlock(m, detail) {
    const list = node('div', 'mission-team');
    const ids = [m.supervisor, ...m.team.map((x) => x.botId).filter((x) => x !== m.supervisor)];
    const events = detail ? detail.events : [];
    for (const id of ids) {
        const b = bot(id);
        const row = node('button', 'mission-member');
        row.type = 'button';
        row.dataset.bot = id;
        const tasks = m.tasks.filter((x) => x.assignee === id);
        const current = tasks.find((x) => x.status === 'delegated' || x.status === 'running' || x.status === 'blocked');
        const chats = [id, ...(current?.chatId ? [current.chatId] : []), ...(id === m.supervisor ? [m.chatId] : [])];
        const busy = chats.find((c) => state.states[c] === 'thinking' || state.states[c] === 'waiting');
        const dot = node('i', 'dot ' + (busy ? state.states[busy] : 'idle'));
        const text = node('span', 'mission-member-text');
        const role = m.team.find((x) => x.botId === id)?.role || b?.role || '';
        text.append(node('strong', '', (b ? b.name : id) + (id === m.supervisor ? ` · ${t('missions.supervisor')}` : '')), node('span', 'hint', role));
        const now = busy ? (state.activity[busy] || t('status.thinking')) : current ? t('missions.onTask', { task: current.title, status: t(TASK_TEXT[current.status]) }) : t('missions.idle');
        text.append(node('span', 'mission-member-now', now));
        const last = events.findLast((e) => e.by === id);
        const facts = [tn('missions.tasksDone', tasks.filter((x) => x.status === 'done').length), last && t('missions.lastActive', { time: clockTime(last.ts) })].filter(Boolean);
        text.append(node('span', 'hint', facts.join(' · ')));
        row.append(avatarOf(id, 'avatar'), dot, text);
        row.addEventListener('click', () => openChat(current?.chatId || (id === m.supervisor ? m.chatId : id)));
        list.append(row);
    }
    if (!state.online.includes(m.machine)) list.append(node('p', 'hint', t('missions.machineAsleep', { machine: upper(m.machine) })));
    return list;
}

function milestoneList(m) {
    const ul = node('ul', 'mission-list');
    for (const x of m.milestones) {
        const li = node('li', 'mission-milestone' + (x.status === 'done' ? ' done' : ''));
        li.append(node('span', 'mission-check', x.status === 'done' ? '✓' : ''), node('span', '', x.title));
        if (x.dueAt || x.doneAt) li.append(node('span', 'hint', x.doneAt ? t('missions.reached', { date: x.doneAt.slice(0, 10) }) : t('missions.due', { date: x.dueAt })));
        ul.append(li);
    }
    return ul;
}

/** The tasks with who gave them to whom: the hand-overs of the team. */
function taskList(m) {
    const ul = node('ul', 'mission-list');
    const order = ['blocked', 'running', 'delegated', 'open', 'failed', 'done', 'cancelled'];
    const tasks = [...m.tasks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (!tasks.length) ul.append(node('li', 'empty-small', t('missions.noTasks')));
    for (const x of tasks.filter((y) => y.status !== 'cancelled').concat(tasks.filter((y) => y.status === 'cancelled').slice(0, 5))) {
        const li = node('li', 'mission-task');
        li.dataset.task = x.id;
        li.dataset.status = x.status;
        const head = node('div', 'mission-task-head');
        const flow = node('span', 'mission-flow');
        flow.append(avatarOf(x.createdBy === 'user' ? 'user' : m.supervisor), node('span', 'mission-arrow', '→'));
        if (x.assignee) flow.append(avatarOf(x.assignee));
        head.append(flow, node('strong', '', x.title), node('span', 'mission-task-status', t(TASK_TEXT[x.status] || x.status)));
        li.append(head);
        const meta = [x.assignee ? who(x.assignee) : t('missions.nobody'), x.dependsOn.length ? t('missions.after', { tasks: x.dependsOn.map((d) => m.tasks.find((y) => y.id === d)?.title || d).join(', ') }) : ''].filter(Boolean);
        li.append(node('span', 'hint', meta.join(' · ')));
        if (x.result) li.append(node('p', 'mission-result', x.result.length > 400 ? x.result.slice(0, 400) + ' …' : x.result));
        if (x.chatId) li.append(button(t('missions.toConversation'), 'link', () => openChat(x.chatId)));
        ul.append(li);
    }
    return ul;
}

function taskForm(m) {
    if (OVER.includes(m.status)) return null;
    const details = node('details', 'mission-task-form');
    details.append(node('summary', '', t('missions.addTask')));
    const title = /** @type {HTMLInputElement} */ (node('input'));
    title.placeholder = t('missions.taskTitle');
    title.maxLength = 200;
    const detail = /** @type {HTMLTextAreaElement} */ (node('textarea'));
    detail.rows = 3;
    detail.placeholder = t('missions.taskDetail');
    const assignee = /** @type {HTMLSelectElement} */ (node('select'));
    assignee.append(new Option(t('missions.nobody'), ''));
    for (const x of m.team.filter((y) => y.botId !== m.supervisor)) assignee.append(new Option(who(x.botId), x.botId));
    const add = button(t('missions.addTask'), 'primary small', () => {
        if (!title.value.trim()) return;
        send({ type: 'mission_task_save', missionId: m.id, task: { id: '', title: title.value.trim(), detail: detail.value.trim(), assignee: assignee.value } }, m.machine);
        details.open = false;
    });
    details.append(title, detail, assignee, add);
    return details;
}

function resultList(m) {
    const ul = node('ul', 'mission-list');
    for (const r of m.results.toReversed()) {
        const li = node('li', 'mission-log-entry');
        li.append(node('span', 'hint', `${clockTime(r.ts)} · ${who(r.botId)}`), node('p', '', r.text));
        if (r.file) li.append(node('code', '', r.file));
        ul.append(li);
    }
    return ul;
}

/** Decisions and events, newest first: what was decided, why and on which data; never the model's thoughts. */
function logBlock(m, detail) {
    const wrap = node('div', 'mission-log');
    const chips = node('div', 'chips');
    for (const f of ['all', 'decisions', 'critical']) {
        const c = button(t(FILTER_TEXT[f]), 'chip' + (logFilter === f ? ' on' : ''), () => {
            logFilter = f;
            renderMissionsPage();
        });
        chips.append(c);
    }
    wrap.append(chips);
    if (!detail) {
        wrap.append(node('p', 'hint', t('missions.loading')));
        return wrap;
    }
    const events = detail.events.toReversed().filter((e) => logFilter === 'all' || (logFilter === 'critical' ? e.critical : ['decision', 'approval', 'user', 'status'].includes(e.kind))).slice(0, 150);
    const ul = node('ul', 'mission-list');
    if (!events.length) ul.append(node('li', 'empty-small', t('missions.noEvents')));
    for (const e of events) {
        const li = node('li', 'mission-log-entry' + (e.critical ? ' critical' : ''));
        li.dataset.kind = e.kind;
        li.append(node('span', 'hint', `${clockTime(e.ts)} · ${t(KIND_TEXT[e.kind] || e.kind)} · ${who(e.by)}`), node('p', '', e.text));
        if (e.data) {
            const d = node('details');
            d.append(node('summary', '', t('missions.basis')), node('pre', '', e.data));
            li.append(d);
        }
        ul.append(li);
    }
    wrap.append(ul);
    return wrap;
}

function rulesBlock(m) {
    const dl = node('dl', 'facts mission-facts');
    const fact = (label, value) => {
        if (!value) return;
        dl.append(node('dt', '', label), typeof value === 'string' ? node('dd', '', value) : (() => { const dd = node('dd'); dd.append(value); return dd; })());
    };
    const lines = (l) => { const ul = node('ul'); for (const x of l) ul.append(node('li', '', x)); return ul; };
    fact(t('missions.f.success'), m.successCriteria.length && lines(m.successCriteria));
    fact(t('missions.f.abort'), m.abortCriteria.length && lines(m.abortCriteria));
    fact(t('missions.f.risks'), m.risks.length && lines(m.risks.map((r) => `[${t(RISK_TEXT[r.level] || RISK_TEXT.medium)}] ${r.text}${r.mitigation ? ` – ${r.mitigation}` : ''}`)));
    fact(t('missions.f.autonomy'), t(AUTONOMY_TEXT[m.autonomy]));
    const asks = m.approvalRules.filter((r) => m.autonomy <= r.upTo).map((r) => r.label || r.kind);
    fact(t('missions.f.asks'), asks.length ? lines(asks) : t('missions.asksNothing'));
    fact(t('missions.f.guardrails'), Object.keys(m.guardrails).length && lines(Object.entries(m.guardrails).map(([k, v]) => `${k} = ${v}`)));
    fact(t('missions.f.cadence'), m.cadence || t('missions.onEvents'));
    fact(t('missions.f.folder'), `${m.folder} (${upper(m.machine)})`);
    return dl;
}

// ---------------------------------------------------------------- Builder

/** A folder for the mission next to the bots of the machine: <folder for bots>/<name>. */
function suggestedFolder(name, machine) {
    const s = state.machineSettings[machine]?.settings || {};
    const root = (s.botFolder || state.machineSettings[machine]?.roots?.[0] || '').replace(/[\\/]+$/, '');
    const slug = String(name || 'mission').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mission';
    return root ? `${root}/${slug}` : '';
}

/** A mission as the builder edits it (MissionInput). */
function editable(m) {
    return {
        id: m.id, name: m.name, description: m.description, type: m.type, goal: m.goal, successCriteria: m.successCriteria, abortCriteria: m.abortCriteria,
        risks: m.risks, priority: m.priority, startAt: m.startAt, dueAt: m.dueAt, autonomy: m.autonomy, approvalRules: m.approvalRules, budget: m.budget,
        cadence: m.cadence, guardrails: m.guardrails, folder: m.folder, status: m.status,
        team: [m.supervisor, ...m.team.map((x) => x.botId).filter((x) => x !== m.supervisor)].map((id) => ({
            botId: id, name: who(id), role: m.team.find((x) => x.botId === id)?.role || '', supervisor: id === m.supervisor,
        })),
        milestones: m.milestones.map((x) => ({ id: x.id, title: x.title, dueAt: x.dueAt })),
    };
}

function emptyDraft() {
    return {
        id: '', name: '', description: '', type: '', goal: builder.goal, successCriteria: [], abortCriteria: [], risks: [], priority: 'normal', autonomy: 1,
        approvalRules: [], budget: {}, cadence: '', guardrails: {}, folder: builder.folder, milestones: [],
        team: [{ name: '', area: '', role: '', voice: 'female', supervisor: true }],
    };
}

function renderBuilder() {
    if (!builder.draft) return goalStep();
    return [builderForm(builder.draft)];
}

/** Step 1: the goal in plain words. */
function goalStep() {
    const form = node('form', 'mission-form');
    form.append(node('p', 'hint', t('missions.builderHint')));
    const goal = /** @type {HTMLTextAreaElement} */ (node('textarea'));
    goal.rows = 6;
    goal.required = true;
    goal.maxLength = 4000;
    goal.placeholder = t('missions.goalExample');
    goal.value = builder.goal;
    goal.dataset.field = 'goal';
    goal.addEventListener('input', () => { builder.goal = goal.value; keepDraft(); });
    form.append(labelled(t('missions.f.goal'), goal));
    const folder = /** @type {HTMLInputElement} */ (node('input'));
    folder.placeholder = t('missions.folderOptional');
    folder.value = builder.folder;
    folder.dataset.field = 'folder';
    folder.addEventListener('input', () => { builder.folder = folder.value.trim(); keepDraft(); });
    form.append(labelled(t('missions.f.folder'), folder, t('missions.folderHint')));
    const machine = machineSelect();
    if (machine) form.append(labelled(t('missions.f.machine'), machine));
    if (builder.error) form.append(node('p', 'error', builder.error));
    const row = node('div', 'mission-actions');
    const ask = button(builder.busy ? t('missions.drafting') : t('missions.propose'), 'primary', () => form.requestSubmit());
    ask.disabled = builder.busy || !state.online.length;
    const manual = button(t('missions.manual'), 'btn', () => {
        builder.goal = goal.value;
        builder.folder = folder.value.trim();
        builder.draft = emptyDraft();
        keepDraft();
        renderMissionsPage();
    });
    manual.disabled = builder.busy;
    row.append(manual, ask);
    form.append(row);
    if (builder.busy) form.append(node('p', 'hint', t('missions.draftingHint')));
    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (builder.busy || !goal.value.trim()) return;
        builder.goal = goal.value.trim();
        builder.folder = folder.value.trim();
        builder.busy = true;
        builder.error = '';
        builder.request = Math.random().toString(36).slice(2, 12);
        builder.since = Date.now();
        keepDraft();
        send({ type: 'mission_propose', text: builder.goal, id: builder.request, ...(builder.folder ? { folder: builder.folder } : {}) }, builder.machine || undefined);
        renderMissionsPage();
    });
    return [form];
}

function machineSelect() {
    if (state.online.length < 2) return null;
    const s = /** @type {HTMLSelectElement} */ (node('select'));
    for (const m of state.online) s.append(new Option(upper(m), m, false, m === builder.machine));
    s.addEventListener('change', () => { builder.machine = s.value; });
    return s;
}

function labelled(label, input, hint) {
    const l = node('label');
    l.append(node('span', '', label), input);
    if (hint) l.append(node('span', 'hint', hint));
    return l;
}

const textInput = (value, field, o = {}) => {
    const i = /** @type {HTMLInputElement} */ (node('input'));
    i.value = value == null ? '' : String(value);
    i.dataset.field = field;
    if (o.type) i.type = o.type;
    if (o.placeholder) i.placeholder = o.placeholder;
    if (o.disabled) i.disabled = true;
    return i;
};
const textArea = (value, field, rows = 3, placeholder = '') => {
    const a = /** @type {HTMLTextAreaElement} */ (node('textarea'));
    a.value = value || '';
    a.rows = rows;
    a.dataset.field = field;
    a.placeholder = placeholder;
    return a;
};
const select = (options, value, field) => {
    const s = /** @type {HTMLSelectElement} */ (node('select'));
    for (const [v, label] of options) s.append(new Option(label, String(v), false, String(v) === String(value)));
    s.dataset.field = field;
    return s;
};

/** Step 2: the proposal, or a mission being changed, as one form. */
function builderForm(d) {
    const form = node('form', 'mission-form');
    const editing = Boolean(d.id);
    const started = editing && d.status !== 'draft';
    if (!editing) form.append(node('p', 'hint', t('missions.proposalHint')));
    form.append(labelled(t('missions.f.name'), textInput(d.name, 'name')));
    const two = node('div', 'two-columns');
    two.append(labelled(t('missions.f.type'), textInput(d.type, 'type')), labelled(t('missions.f.priority'), select(Object.entries(PRIORITY_TEXT).map(([k, v]) => [k, t(v)]), d.priority, 'priority')));
    form.append(two);
    form.append(labelled(t('missions.f.goal'), textArea(d.goal, 'goal', 3)));
    form.append(labelled(t('missions.f.description'), textArea(d.description, 'description', 3)));
    form.append(labelled(t('missions.f.success'), textArea(d.successCriteria.join('\n'), 'successCriteria', 3), t('missions.linesHint')));
    form.append(labelled(t('missions.f.abort'), textArea(d.abortCriteria.join('\n'), 'abortCriteria', 3), t('missions.linesHint')));
    form.append(labelled(t('missions.f.risks'), textArea(d.risks.map((r) => `${r.level} | ${r.text}${r.mitigation ? ` | ${r.mitigation}` : ''}`).join('\n'), 'risks', 4), t('missions.risksHint')));

    form.append(node('h3', '', t('missions.team')));
    const team = node('div', 'mission-team-edit');
    const addRow = (x) => team.append(memberRow(x, started, team));
    for (const x of d.team) addRow(x);
    form.append(team);
    const adders = node('div', 'mission-actions');
    adders.append(button(t('missions.addNewBot'), 'btn small', () => addRow({ name: '', area: '', role: '', voice: 'female' })));
    const machine = d.machine || builder.machine || state.online[0];
    const others = state.bots.filter((b) => (b.machine || '') === machine);
    if (others.length) {
        const pick = /** @type {HTMLSelectElement} */ (node('select'));
        pick.append(new Option(t('missions.addExisting'), ''));
        for (const b of others) pick.append(new Option(b.name, b.id));
        pick.addEventListener('change', () => {
            const b = bot(pick.value);
            if (b && !team.querySelector(`[data-bot="${CSS.escape(b.id)}"]`)) addRow({ botId: b.id, name: b.name, role: b.role || '' });
            pick.value = '';
        });
        adders.append(pick);
    }
    form.append(adders);

    form.append(labelled(t('missions.f.milestones'), textArea(d.milestones.map((x) => `${x.title}${x.dueAt ? ` | ${x.dueAt}` : ''}`).join('\n'), 'milestones', 4), t('missions.milestonesHint')));
    const dates = node('div', 'two-columns');
    dates.append(labelled(t('missions.f.due'), textInput(d.dueAt, 'dueAt', { type: 'date' })), labelled(t('missions.f.cadence'), textInput(d.cadence, 'cadence', { placeholder: '0 9 * * 1-5' }), t('missions.cadenceHint')));
    form.append(dates);

    form.append(node('h3', '', t('missions.limits')));
    form.append(labelled(t('missions.f.autonomy'), select([1, 2, 3, 4].map((n) => [n, t(AUTONOMY_TEXT[n])]), d.autonomy, 'autonomy')));
    const rules = node('div', 'mission-rules-edit');
    const ruleRow = (r) => {
        const row = node('div', 'mission-rule');
        row.append(textInput(r.kind, 'kind', { placeholder: 'kind' }), textInput(r.label, 'label', { placeholder: t('missions.ruleLabel') }),
            select([1, 2, 3, 4].map((n) => [n, t('missions.upTo', { n })]), r.upTo, 'upTo'), button('×', 'round small', () => row.remove()));
        rules.append(row);
    };
    for (const r of d.approvalRules) ruleRow(r);
    const rulesField = node('div', 'mission-field');
    rulesField.append(node('span', '', t('missions.f.rules')), rules, node('span', 'hint', t('missions.rulesHint')));
    form.append(rulesField);
    form.append(button(t('missions.addRule'), 'btn small', () => ruleRow({ kind: '', label: '', upTo: 2 })));
    const budget = node('div', 'two-columns');
    const b = d.budget || {};
    budget.append(
        labelled(t('missions.f.costUsd'), textInput(b.costUsd, 'costUsd', { type: 'number' })),
        labelled(t('missions.f.turns'), textInput(b.turns, 'turns', { type: 'number' })),
        labelled(t('missions.f.turnsPerDay'), textInput(b.turnsPerDay, 'turnsPerDay', { type: 'number' })),
        labelled(t('missions.f.money'), textInput(b.money ? `${b.money.amount} ${b.money.currency}` : '', 'money', { placeholder: '1000 EUR' })),
    );
    form.append(budget, node('p', 'hint', t('missions.budgetHint')));
    form.append(labelled(t('missions.f.guardrails'), textArea(Object.entries(d.guardrails || {}).map(([k, v]) => `${k} = ${v}`).join('\n'), 'guardrails', 4), t('missions.guardrailsHint')));
    form.append(labelled(t('missions.f.folder'), textInput(d.folder, 'folder', { disabled: started, placeholder: suggestedFolder(d.name, machine) }), t('missions.folderCreateHint')));

    if (builder.error) form.append(node('p', 'error', builder.error));
    const row = node('div', 'mission-actions');
    const save = (start) => {
        const input = collect(form, d);
        if (!input) return;
        builder.busy = true;
        builder.error = '';
        send({ type: 'mission_save', mission: input, ...(start ? { start: true } : {}) }, editing ? mission(d.id)?.machine : machine);
        renderMissionsPage();
    };
    if (!editing) {
        row.append(button(t('missions.discard'), 'btn', () => {
            Object.assign(builder, { draft: null, goal: '', folder: '', error: '', request: '', busy: false });
            keepDraft();
            view = { kind: 'list' };
            renderMissionsPage();
        }));
    }
    row.append(button(t(editing ? 'missions.saveChanges' : 'missions.saveDraft'), editing ? 'primary' : 'btn', () => save(false)));
    if (!started) row.append(button(t('missions.saveStart'), 'primary', () => save(true)));
    for (const x of row.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = builder.busy;
    form.append(row);
    form.addEventListener('submit', (ev) => ev.preventDefault());
    // Every edit of a new mission is kept on the device, so a reload brings it back as it was
    if (!editing) {
        const keep = () => {
            const now = collect(form, d, true);
            if (now) builder.draft = { ...d, ...now, machine: d.machine };
            keepDraft();
        };
        form.addEventListener('input', keep);
        form.addEventListener('change', keep);
    }
    return form;
}

function memberRow(x, started, team) {
    const row = node('div', 'mission-member-edit');
    if (x.botId) row.dataset.bot = x.botId;
    const avatar = node('div', 'avatar mini');
    fillAvatar(avatar, x.botId ? bot(x.botId) || { name: x.name } : { name: x.name }, x.botId || x.name);
    const lead = /** @type {HTMLInputElement} */ (node('input'));
    lead.type = 'radio';
    lead.name = 'supervisor';
    lead.checked = !!x.supervisor;
    lead.disabled = started;
    lead.title = t('missions.supervisor');
    const fields = node('div', 'mission-member-fields');
    if (x.botId) fields.append(node('strong', '', x.name), textInput(x.role, 'role', { placeholder: t('missions.memberRole') }));
    else {
        const top = node('div', 'two-columns');
        top.append(textInput(x.name, 'name', { placeholder: t('missions.memberName') }), textInput(x.area, 'area', { placeholder: t('missions.memberArea') }));
        fields.append(top, textInput(x.role, 'role', { placeholder: t('missions.memberRole') }));
        const voice = select([['female', t('missions.voice.female')], ['male', t('missions.voice.male')]], x.voice || 'female', 'voice');
        const tone = node('details');
        tone.append(node('summary', '', t('missions.memberTone')), textArea(x.tone, 'tone', 4));
        fields.append(voice, tone);
    }
    const lab = node('label', 'mission-lead');
    lab.append(lead, node('span', '', t('missions.supervisor')));
    const remove = button('×', 'round small', () => { row.remove(); if (!team.querySelector('input[name=supervisor]:checked')) team.querySelector('input[name=supervisor]')?.click(); });
    remove.title = t('missions.removeMember');
    if (started && x.supervisor) remove.hidden = true;
    row.append(avatar, fields, lab, remove);
    return row;
}

/** The form as MissionInput; null (with the error shown) when something is missing; `quiet`: as far as filled in, for keeping it. */
function collect(form, d, quiet = false) {
    const v = (f) => /** @type {HTMLInputElement} */ (form.querySelector(`:scope > label [data-field="${f}"], :scope > .two-columns [data-field="${f}"]`))?.value?.trim() ?? '';
    const lines = (f) => v(f).split('\n').map((x) => x.trim()).filter(Boolean);
    const num = (f) => (v(f) === '' ? undefined : Math.max(0, Number(v(f))) || 0);
    const team = [...form.querySelectorAll('.mission-member-edit')].map((row) => {
        const r = /** @type {HTMLElement} */ (row);
        const field = (f) => /** @type {HTMLInputElement} */ (r.querySelector(`[data-field="${f}"]`))?.value?.trim() || '';
        const lead = /** @type {HTMLInputElement} */ (r.querySelector('input[name=supervisor]')).checked;
        return r.dataset.bot
            ? { botId: r.dataset.bot, name: r.querySelector('strong')?.textContent || '', role: field('role'), supervisor: lead }
            : { name: field('name'), area: field('area'), role: field('role'), tone: field('tone'), voice: field('voice') === 'male' ? 'male' : 'female', supervisor: lead };
    }).filter((x) => x.botId || x.name);
    const fail = (key) => {
        if (quiet) return null;
        builder.error = t(key);
        renderMissionsPage();
        return null;
    };
    if (!quiet) {
        if (!v('name')) return fail('missions.needName');
        if (!v('goal')) return fail('missions.needGoal');
        if (!team.length) return fail('missions.needTeam');
        if (!v('folder') && !d.folder) return fail('missions.needFolder');
    }
    const money = /^\s*([\d.,]+)\s*([A-Za-z]{3})?\s*$/.exec(v('money'));
    const guardrails = {};
    for (const line of lines('guardrails')) {
        const [k, ...rest] = line.split('=');
        const value = rest.join('=').trim();
        if (!k.trim()) continue;
        guardrails[k.trim()] = /^(true|false)$/i.test(value) ? value.toLowerCase() === 'true' : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    }
    const rules = [...form.querySelectorAll('.mission-rule')].map((row) => {
        const f = (x) => /** @type {HTMLInputElement} */ (row.querySelector(`[data-field="${x}"]`)).value.trim();
        return { kind: f('kind'), label: f('label'), upTo: Number(f('upTo')) || 1 };
    }).filter((r) => r.kind);
    return {
        id: d.id || '', name: v('name'), description: v('description'), type: v('type'), goal: v('goal'),
        successCriteria: lines('successCriteria'), abortCriteria: lines('abortCriteria'),
        risks: lines('risks').map((l) => {
            const [a, b, c] = l.split('|').map((x) => x.trim());
            const level = ['low', 'medium', 'high'].includes(a.toLowerCase()) ? a.toLowerCase() : '';
            return level ? { text: b || '', level, ...(c ? { mitigation: c } : {}) } : { text: a, level: 'medium', ...(b ? { mitigation: b } : {}) };
        }).filter((r) => r.text),
        priority: v('priority') || 'normal', ...(v('dueAt') ? { dueAt: v('dueAt') } : {}), autonomy: Number(v('autonomy')) || 1,
        approvalRules: rules,
        budget: {
            ...(num('costUsd') !== undefined ? { costUsd: num('costUsd') } : {}), ...(num('turns') !== undefined ? { turns: num('turns') } : {}),
            ...(num('turnsPerDay') !== undefined ? { turnsPerDay: num('turnsPerDay') } : {}),
            ...(money ? { money: { amount: Number(money[1].replace(',', '.')) || 0, currency: (money[2] || 'EUR').toUpperCase() } } : {}),
        },
        cadence: v('cadence'), guardrails, folder: v('folder') || d.folder || '', team,
        milestones: lines('milestones').map((l) => {
            const [title, due] = l.split('|').map((x) => x.trim());
            const old = (d.milestones || []).find((x) => x.title === title);
            return { ...(old?.id ? { id: old.id } : {}), title, ...(/^\d{4}-\d{2}-\d{2}$/.test(due || '') ? { dueAt: due } : {}) };
        }),
    };
}
