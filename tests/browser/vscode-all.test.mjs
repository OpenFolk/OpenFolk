// VS Code sessions of every folder from the "+" menu: asked of each awake machine without a bot, each row with its
// folder, "Continue here" only with a bot whose folder holds the session on that machine, no handover buttons.
// Codex threads stand in the same list with their engine, which open and adopt pass on.
import { bot } from './harness.mjs';

const SESSIONS = {
    desk: [
        { id: 's1', title: 'Fix the relay', firstPrompt: 'fix the relay', lastModified: '2026-11-09T12:00:00Z', size: 1_000, origin: 'vscode', open: true, working: false, folder: 'c:/www/skool/backend' },
        { id: 's2', title: 'Taxes', firstPrompt: 'taxes', lastModified: '2026-11-09T11:00:00Z', size: 2_000, origin: 'terminal', open: false, working: false, folder: 'C:/private/taxes' },
        { id: 'x4', engine: 'codex', title: 'Landing page', firstPrompt: 'landing page', lastModified: '2026-11-09T09:00:00Z', size: 4_000, origin: 'vscode', open: false, working: false, folder: 'c:/www/skool' },
    ],
    workstation: [
        { id: 's3', title: 'Mac build', firstPrompt: 'mac build', lastModified: '2026-11-09T10:00:00Z', size: 3_000, origin: 'vscode', open: false, working: false, folder: '/Users/me/skool' },
    ],
};

export default async function ({ start, check }) {
    const h = await start({
        // The bot has no fixed machine: it runs on the first awake one, DESK
        bots: [bot('skool', 'Skool Sven')],
        online: ['desk', 'workstation'],
        onSend: async (f, push) => {
            if (f.type === 'vscode_sessions') await push({ type: 'vscode_sessions', machine: f.machine, sessions: SESSIONS[f.machine] });
            if (f.type === 'vscode_open') await push({ type: 'vscode_history', machine: f.machine, sessionId: f.sessionId, from: 0, entries: [], working: false });
        },
    });
    const p = h.page;
    await p.click('#btn-new');
    await h.wait(100);
    check('"+" menu offers the sessions', (await p.locator('#new-menu button').allTextContents()).includes('Machine sessions'));
    await p.click('#new-menu [data-new="vscode"]');
    await h.wait(250);
    check('page open, every machine asked without a bot', await p.isVisible('#vscode')
        && ['desk', 'workstation'].every((r) => h.sent.some((f) => f.type === 'vscode_sessions' && f.machine === r && !('botId' in f))));
    check('header says every folder', (await p.textContent('#vs-sub')) === 'All folders, newest first', await p.textContent('#vs-sub'));
    const rows = await p.locator('#vs-list .vs-session').allTextContents();
    check('four sessions, each with its folder', rows.length === 4 && rows[0].includes('www/skool/backend/') && rows[1].includes('private/taxes/') && rows[3].includes('Users/me/skool/'), rows);
    check('the Codex thread says so, the Claude sessions do not', rows[2].includes('Codex') && !rows[0].includes('Codex'), rows[2]);
    check('no handover buttons without a chat', await p.isHidden('#vs-show') && await p.isHidden('#vs-terminal'));

    // In a bot's folder: opened with the folder, continued with that bot
    await p.locator('#vs-list .vs-session').first().click();
    await h.wait(200);
    check('opening names the folder, not a bot or an engine', h.sent.some((f) => f.type === 'vscode_open' && f.sessionId === 's1' && f.folder === 'c:/www/skool/backend' && !('botId' in f) && !('engine' in f) && f.machine === 'desk'));
    check('continuing with the bot of the folder', await p.isEnabled('#vs-adopt') && (await p.textContent('#vs-hint')).includes('Skool Sven'), await p.textContent('#vs-hint'));
    await p.click('#vs-adopt');
    await h.wait(200);
    check('taking over names the bot and the folder', h.sent.some((f) => f.type === 'vscode_adopt' && f.botId === 'skool' && f.sessionId === 's1' && f.folder === 'c:/www/skool/backend' && f.machine === 'desk'));

    // Outside every bot's folder: no way to continue, with the reason (on the phone the page's arrow leads back to the list)
    await p.click('#vscode [data-page-back]');
    await h.wait(200);
    await p.locator('#vs-list .vs-session').nth(1).click();
    await h.wait(200);
    check('no bot for the folder: continuing disabled with the reason', !(await p.isEnabled('#vs-adopt')) && (await p.textContent('#vs-hint')).includes('No bot works in this folder on DESK'), await p.textContent('#vs-hint'));

    // On the other machine the bot does not run, even though the folder would fit by name
    await p.click('#vscode [data-page-back]');
    await h.wait(200);
    await p.locator('#vs-list .vs-session').nth(3).click();
    await h.wait(200);
    check('other machine: the bot does not run there', !(await p.isEnabled('#vs-adopt')) && (await p.textContent('#vs-hint')).includes('WORKSTATION'), await p.textContent('#vs-hint'));
    check('history asked of that machine', h.sent.some((f) => f.type === 'vscode_open' && f.sessionId === 's3' && f.machine === 'workstation'));

    // A Codex thread: opened and continued as Codex, with the bot of its folder
    await p.click('#vscode [data-page-back]');
    await h.wait(200);
    await p.locator('#vs-list .vs-session').nth(2).click();
    await h.wait(200);
    check('Codex: opening names the engine', h.sent.some((f) => f.type === 'vscode_open' && f.sessionId === 'x4' && f.engine === 'codex' && f.machine === 'desk'));
    check('Codex: the hint says the conversation runs on Codex', (await p.textContent('#vs-hint')).includes('running on Codex'), await p.textContent('#vs-hint'));
    await p.click('#vs-adopt');
    await h.wait(200);
    check('Codex: taking over names the engine and the bot', h.sent.some((f) => f.type === 'vscode_adopt' && f.sessionId === 'x4' && f.engine === 'codex' && f.botId === 'skool'));
}
