// VS Code sessions: list from the bot's page, watching the history (partial updates from an index), "Continue here"
// creates a conversation and opens it; if the session is on another machine than the bot, that does not work.
import { bot } from './harness.mjs';

const SESSIONS = [
    { id: 's1', title: 'Test the web app locally', firstPrompt: 'test the web app locally once', lastModified: '2026-10-08T12:25:00Z', size: 9_700_000, origin: 'vscode', open: true, working: false, branch: 'main' },
    { id: 's2', title: 'Get the machine fit', firstPrompt: 'Get the machine fit', lastModified: '2026-10-08T10:00:00Z', size: 450_000, origin: 'terminal', open: false, working: true },
];
const HISTORY = [
    { id: 'u1', role: 'user', from: 'me', text: 'Test the web app', ts: '2026-10-08T12:00:00Z' },
    { id: 'a1', role: 'assistant', text: 'I am starting the server.', ts: '2026-10-08T12:00:05Z', tools: [{ id: 't1', name: 'Bash', summary: 'npm start', ok: true, result: 'running' }] },
    { id: 'e1', role: 'event', text: 'Context was summarized', ts: '2026-10-08T12:10:00Z' },
];

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven')],
        onSend: async (f, push, z) => {
            if (f.type === 'vscode_sessions') await push({ type: 'vscode_sessions', machine: 'desk', botId: f.botId, sessions: SESSIONS });
            if (f.type === 'vscode_open') await push({ type: 'vscode_history', machine: 'desk', sessionId: f.sessionId, from: 0, entries: HISTORY, working: false });
            if (f.type === 'vscode_adopt') {
                z.bots[0].conversations = [{ id: 'cc33', title: 'Test the web app locally', createdAt: '' }];
                await push({ type: 'bots', machine: 'desk', bots: z.bots, groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
                await push({ type: 'conversation_created', machine: 'desk', chatId: 'skool~cc33' });
            }
        },
    });
    const p = h.page;
    await h.openChat('Skool Sven');
    await p.click('[data-el=chat-title]');
    await h.wait(150);
    check('entry on the bot\'s page', (await p.locator('#info-actions button').allTextContents()).includes('VS Code'));
    await p.click('#info-actions button[data-action="vscode"]');
    await h.wait(200);
    check('view open, the bot\'s page left', await p.isVisible('#vscode') && await p.isHidden('#info'));
    check('list requested from the machine', h.sent.some((f) => f.type === 'vscode_sessions' && f.botId === 'skool' && f.machine === 'desk'));
    const rows = await p.locator('#vs-list .vs-session').allTextContents();
    check('two sessions with badges', rows.length === 2 && rows[0].includes('open') && rows[1].includes('working') && rows[1].includes('Terminal'), rows);

    await p.locator('#vs-list .vs-session').first().click();
    await h.wait(200);
    check('opening goes to the session\'s machine', h.sent.some((f) => f.type === 'vscode_open' && f.sessionId === 's1' && f.machine === 'desk'));
    check('title of the session in the header', (await p.textContent('#vs-title')) === 'Test the web app locally');
    check('history rendered: question, tool, answer, hint',
        (await p.locator('#vs-history .bubble.me').count()) === 1 && (await p.locator('#vs-history .tool').count()) === 1
        && (await p.locator('#vs-history .bubble.bot').count()) === 1 && (await p.locator('#vs-history .event').count()) === 1);
    check('state: open in VS Code', (await p.textContent('#vs-sub')).includes('open in VS Code'), await p.textContent('#vs-sub'));

    // live: new from index 2 (the hint stays), plus a new question and a running answer
    await h.push({ type: 'vscode_history', machine: 'desk', sessionId: 's1', from: 2, working: true, entries: [
        HISTORY[2],
        { id: 'u2', role: 'user', from: 'me', text: 'And now deploy', ts: '2026-10-08T12:20:00Z' },
        { id: 'a2', role: 'assistant', text: '', ts: '2026-10-08T12:20:02Z', tools: [{ id: 't2', name: 'Bash', summary: 'git push' }] },
    ] });
    await h.wait(150);
    check('a partial update appends instead of doubling', (await p.locator('#vs-history [data-vsi]').count()) === 5 && (await p.locator('#vs-history .event').count()) === 1);
    check('running tool visible', (await p.locator('#vs-history .tool.running').count()) === 1);
    check('state: working', (await p.textContent('#vs-sub')).includes('working'));
    await h.push({ type: 'vscode_history', machine: 'desk', sessionId: 'other', from: 0, working: false, entries: [] });
    await h.wait(100);
    check('frames of other sessions are ignored', (await p.locator('#vs-history [data-vsi]').count()) === 5);
    await h.push({ type: 'vscode_history', machine: 'desk', sessionId: 's1', from: 5, working: false, entries: [] });
    await h.wait(100);
    check('end of the turn: the tool no longer runs', (await p.locator('#vs-history .tool.running').count()) === 0);

    check('continuing possible (the bot runs on the session\'s machine)', await p.isEnabled('#vs-adopt'));
    await p.click('#vs-adopt');
    await h.wait(300);
    check('taking over to the session\'s machine', h.sent.some((f) => f.type === 'vscode_adopt' && f.sessionId === 's1' && f.botId === 'skool' && f.machine === 'desk'));
    check('view closed, watching unregistered', !(await p.isVisible('#vscode')) && h.sent.some((f) => f.type === 'vscode_close' && f.sessionId === 's1'));
    check('new conversation opened', (await p.textContent('[data-el=chat-name]')) === 'Test the web app locally', await p.textContent('[data-el=chat-name]'));

    // second machine: the bot runs only on WORKSTATION, the session is on DESK
    const h2 = await start({
        bots: [bot('skool', 'Skool Sven', { machine: 'workstation' })],
        online: ['desk', 'workstation'],
        onSend: async (f, push) => {
            if (f.type === 'vscode_sessions') await push({ type: 'vscode_sessions', machine: f.machine, botId: f.botId, sessions: f.machine === 'desk' ? SESSIONS.slice(0, 1) : [] });
            if (f.type === 'vscode_open') await push({ type: 'vscode_history', machine: 'desk', sessionId: f.sessionId, from: 0, entries: HISTORY, working: false });
        },
    });
    const p2 = h2.page;
    await h2.openChat('Skool Sven');
    await p2.click('[data-el=chat-title]');
    await h2.wait(150);
    await p2.click('#info-actions button[data-action="vscode"]');
    await h2.wait(200);
    check('both machines asked', ['desk', 'workstation'].every((r) => h2.sent.some((f) => f.type === 'vscode_sessions' && f.machine === r)));
    const machines = await p2.locator('#vs-list .vs-machine').allTextContents();
    check('list grouped by machines', machines.join('|') === 'DESK|WORKSTATION', machines);
    await p2.locator('#vs-list .vs-session').first().click();
    await h2.wait(200);
    check('continuing disabled, with a reason', !(await p2.isEnabled('#vs-adopt')) && (await p2.textContent('#vs-hint')).includes('WORKSTATION'), await p2.textContent('#vs-hint'));
    // phone: the page's back arrow leads to the list first
    await p2.click('#vscode [data-page-back]');
    await h2.wait(200);
    check('back to the list unregisters the watching', (await p2.isVisible('#vs-list')) && h2.sent.some((f) => f.type === 'vscode_close' && f.machine === 'desk'));
}
