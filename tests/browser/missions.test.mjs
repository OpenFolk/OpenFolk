// Mission Control (webapp/js/missions.js): the tab with the overview, one mission with its team, tasks, approvals, the
// project's figures and the log, the controls that go to the mission's machine, and the builder from a goal in plain
// words to a started mission. Back goes from a mission to the overview, then out of the page.
import { bot } from './harness.mjs';

const now = new Date().toISOString();
const mission = (extra = {}) => ({
    id: 'm1', name: 'Shop launch', description: '', type: 'SaaS', goal: 'First 10 paying customers', successCriteria: ['10 customers'], abortCriteria: ['Budget used up'],
    risks: [{ text: 'No demand', level: 'high', mitigation: 'Interviews first' }], priority: 'normal', status: 'waiting_approval', progress: 40, autonomy: 2,
    approvalRules: [{ kind: 'delegate', label: 'Delegating', upTo: 1 }, { kind: 'external', label: 'Outside effects', upTo: 2 }],
    budget: { costUsd: 20, turns: 100, money: { amount: 500, currency: 'EUR' } }, spent: { costUsd: 18.5, turns: 12, day: '', turnsToday: 0 },
    cadence: '0 9 * * 1-5', guardrails: { live_payments: false, max_ad_eur: 20 }, killSwitch: false, folder: 'C:/www/shop', machine: 'desk',
    supervisor: 'sara', chatId: 'sara~aa11', team: [{ botId: 'sara', role: 'Lead' }, { botId: 'max', role: 'Research' }],
    milestones: [{ id: 'ms1', title: 'Landing page', status: 'done', doneAt: now }, { id: 'ms2', title: 'First customer', status: 'open' }],
    tasks: [
        { id: 't1', title: 'Interview ten shop owners', detail: '', assignee: 'max', dependsOn: [], status: 'delegated', chatId: 'max~bb22', createdBy: 'supervisor', createdAt: now, updatedAt: now },
        { id: 't2', title: 'Write the offer', detail: '', assignee: 'max', dependsOn: ['t1'], status: 'done', result: 'Offer is in offer.md', createdBy: 'supervisor', createdAt: now, updatedAt: now },
    ],
    approvals: [{ id: 'a1', kind: 'external', title: 'Send the newsletter to 200 contacts', detail: 'Costs nothing, reaches people', requestedBy: 'sara', createdAt: now }],
    results: [], loop: { ticks: 3, errors: 0, lastTick: now, pending: [] }, createdAt: now, updatedAt: now, ...extra,
});
const detail = {
    type: 'mission_detail', id: 'm1', events: [
        { id: 'e1', ts: now, kind: 'decision', by: 'sara', text: 'Start with interviews', data: 'Reason: no data on demand' },
        { id: 'e2', ts: now, kind: 'error', by: 'system', text: 'A source failed', critical: true },
        { id: 'e3', ts: now, kind: 'delegation', by: 'sara', text: '"Interview ten shop owners" delegated to Max' },
    ],
    metrics: {
        kpis: { revenue: { label: 'Revenue', value: 120, unit: 'EUR', target: 1000 } },
        series: { equity: { label: 'Equity', points: [['2026-11-01', 100], ['2026-11-02', 98], ['2026-11-03', 104]] } },
        tables: { orders: { label: 'Orders', columns: ['Id', 'Sum'], rows: [['o1', 49], ['o2', 71]] } },
    },
};

export default async function ({ start, check }) {
    let missions = [mission()];
    const h = await start({
        bots: [bot('sara', 'Sara', { machine: 'desk' }), bot('max', 'Max', { machine: 'desk' })], online: ['desk'], recordDialogs: true,
        onSend: (f, push) => {
            if (f.type === 'missions') push({ type: 'missions', machine: 'desk', missions });
            if (f.type === 'mission_open') push({ ...detail, machine: 'desk' });
            if (f.type === 'mission_propose') {
                push({
                    type: 'mission_proposal', machine: 'desk', proposal: {
                        name: 'Trading', type: 'Trading', description: '', goal: f.text, successCriteria: ['Average 1000 EUR a month'], abortCriteria: ['Loss over 10 %'],
                        risks: [{ text: 'Overfitting', level: 'high', mitigation: 'Out-of-sample tests' }], priority: 'normal', autonomy: 1,
                        approvalRules: [{ kind: 'delegate', label: 'Delegating', upTo: 1 }, { kind: 'limit', label: 'Limits', upTo: 4 }], budget: { costUsd: 10, turns: 50, turnsPerDay: 10 },
                        cadence: '0 9 * * 1-5', guardrails: { mode: 'paper', live: false }, milestones: [{ title: 'Backtests', dueAt: '2026-12-09' }],
                        team: [{ name: 'Tina', area: 'Lead', role: 'Leads', voice: 'female', supervisor: true }, { name: 'Quentin', area: 'Quant', role: 'Strategies', voice: 'male', supervisor: false }],
                    },
                });
            }
        },
    });
    const p = h.page;
    await h.push({ type: 'missions', machine: 'desk', missions });
    await h.wait(100);
    check('the tab shows the open decision', (await p.textContent('#tab-missions-badge')) === '1' && await p.isVisible('#tab-missions-badge'));

    await p.click('[data-tab=missions]');
    await h.wait(200);
    check('the tab opens the overview', await p.isVisible('#missions-page') && (await p.textContent('#git-title')) === 'Missions');
    check('tiles: one active mission, one decision open', (await p.locator('.mission-tile').first().textContent()).startsWith('1') && (await p.locator('.mission-tile', { hasText: 'decisions open' }).textContent()).startsWith('1'));
    const card = p.locator('.mission-card[data-mission=m1]');
    check('the mission card: name, status, progress, open decision', (await card.textContent()).includes('Shop launch') && (await card.textContent()).includes('Waiting for approval')
        && (await card.textContent()).includes('40 %') && (await card.textContent()).includes('1 decision open'));
    check('the budget near its limit is marked', await card.locator('.usage-bar.warning').count() === 1);

    await card.click();
    await h.wait(200);
    check('the mission opens with its name as title and asks for its log at its machine', (await p.textContent('#git-title')) === 'Shop launch' && h.sent.some((f) => f.type === 'mission_open' && f.id === 'm1' && f.machine === 'desk'));
    const page = await p.textContent('#missions-page');
    check('goal, milestones and risks are shown', page.includes('First 10 paying customers') && page.includes('Landing page') && page.includes('No demand'));
    check('the team at work: Max on his task', (await p.textContent('.mission-member[data-bot=max]')).includes('Interview ten shop owners'));
    check('the hand-over: supervisor to Max on the task', await p.locator('.mission-task[data-task=t1] .mission-flow .avatar').count() === 2);
    check('a finished task shows its result', (await p.textContent('.mission-task[data-task=t2]')).includes('Offer is in offer.md'));
    check('the project\'s figures: a tile, a chart, a table', await p.locator('.mission-tile[data-kpi=revenue]').count() === 1 && await p.locator('.mission-chart svg path.line').count() === 1
        && await p.locator('.mission-table tr').count() === 3);
    check('the log: decision with its basis, the critical event marked', await p.locator('.mission-log-entry[data-kind=decision] details').count() === 1 && await p.locator('.mission-log-entry.critical').count() === 1);
    await p.click('.mission-log .chip:has-text("Critical")');
    await h.wait(100);
    check('the filter shows only critical events', await p.locator('.mission-log-entry').count() === 1);
    check('rules: what needs approval now at level 2', (await p.textContent('.mission-facts')).includes('Outside effects') && !(await p.textContent('.mission-facts')).includes('Delegating'));

    await p.fill('.mission-approval input', 'Only to customers who agreed');
    await p.click('.mission-approval button:has-text("Allow")');
    await h.wait(100);
    const reply = h.sent.find((f) => f.type === 'mission_approval_reply');
    check('allowing goes to the mission\'s machine with the note', reply?.allow === true && reply.id === 'a1' && reply.missionId === 'm1' && reply.message === 'Only to customers who agreed' && reply.machine === 'desk', reply);

    await p.click('.mission-actions button:has-text("Kill switch")');
    await h.wait(200);
    const kill = h.sent.find((f) => f.type === 'mission_control' && f.action === 'kill');
    check('the kill switch asks, then goes to the machine', !!kill && kill.id === 'm1' && kill.machine === 'desk' && (await p.evaluate(() => window.__dialogs || [])).some((d) => d.includes('Stop "Shop launch" at once')));
    missions = [mission({ status: 'paused', killSwitch: true, approvals: [] })];
    await h.push({ type: 'missions', machine: 'desk', missions });
    await h.wait(200);
    check('killed: shown, the way back is "Release kill switch"', (await p.textContent('.mission-head')).includes('Kill switch on') && await p.isVisible('.mission-actions button:has-text("Release kill switch")')
        && !(await p.isVisible('.mission-actions button:has-text("Pause")')));
    check('no decision open: the tab badge is gone', await p.isHidden('#tab-missions-badge'));

    await p.click('#git-back');
    await h.wait(200);
    check('back: from the mission to the overview', await p.isVisible('.mission-card') && (await p.textContent('#git-title')) === 'Missions');

    // ---- The builder: goal → proposal → start
    await p.click('.mission-actions button:has-text("New mission")');
    await h.wait(100);
    await p.fill('[data-field=goal]', 'Average 1000 EUR a month from trading strategies');
    await p.click('.mission-actions button:has-text("Create proposal")');
    await h.wait(300);
    const asked = h.sent.find((f) => f.type === 'mission_propose');
    check('the goal goes to a machine for a proposal', asked?.text === 'Average 1000 EUR a month from trading strategies');
    check('the proposal is a form with the team to edit', await p.locator('.mission-member-edit').count() === 2 && (await p.inputValue('.mission-member-edit [data-field=name] >> nth=0')) === 'Tina');
    await p.fill('.mission-form > label [data-field=folder]', 'C:/www/missions/trading');
    await p.fill('.mission-form > label [data-field=guardrails]', 'mode = paper\nlive = false\nmax_daily_loss_eur = 50');
    await p.click('.mission-actions button:has-text("Start mission")');
    await h.wait(200);
    const save = h.sent.find((f) => f.type === 'mission_save');
    check('start: the mission is saved and started on the machine', save?.start === true && save.machine === 'desk' && save.mission.name === 'Trading', save);
    check('… with the team, one supervisor', save?.mission.team.length === 2 && save.mission.team.filter((x) => x.supervisor).length === 1 && save.mission.team[1].voice === 'male');
    check('… guardrails typed, milestones with dates, rules kept', save?.mission.guardrails.max_daily_loss_eur === 50 && save.mission.guardrails.live === false
        && save.mission.milestones[0].dueAt === '2026-12-09' && save.mission.approvalRules.some((r) => r.kind === 'limit' && r.upTo === 4), save?.mission);
    missions = [...missions, mission({ id: 'm2', name: 'Trading', status: 'planning', approvals: [], tasks: [] })];
    await h.push({ type: 'missions', machine: 'desk', missions });
    await h.push({ type: 'mission_saved', machine: 'desk', id: 'm2' });
    await h.wait(200);
    check('saved: the new mission opens', (await p.textContent('#git-title')) === 'Trading');
    await h.push({ type: 'error', machine: 'desk', request: 'mission_control', message: 'The mission is not running.' });
    await h.wait(100);
    check('an error of a mission frame is shown', (await p.textContent('body')).includes('The mission is not running.'));

    await p.click('#git-back');
    await h.wait(100);
    await p.click('#git-back');
    await h.wait(200);
    check('back twice: out of Mission Control', await p.isHidden('#missions-page') || await p.isHidden('#git-page'));
}
