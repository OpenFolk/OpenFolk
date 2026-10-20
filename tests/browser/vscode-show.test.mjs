// Hand a chat over to its machine ("VS Code" on the bot's page, buttons above the session list): question, request to the bot's machine, message in the chat;
// which buttons show follows the targets the machine reports. Plus sessions from subfolders in the VS Code list: folder in the row, and when opening it goes
// to the backend along.
import { bot } from './harness.mjs';

const SESSIONS = [
    { id: 's9', title: 'Rework the API', firstPrompt: 'Rework the API', lastModified: '2026-10-10T09:00:00Z', size: 20_000, origin: 'terminal', open: false, working: false, folder: 'C:/www/skool/backend' },
];

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven')],
        onSend: async (f, push) => {
            if (f.type === 'vscode_sessions') await push({ type: 'vscode_sessions', machine: 'desk', botId: f.botId, sessions: SESSIONS });
            if (f.type === 'vscode_open') await push({ type: 'vscode_history', machine: 'desk', sessionId: f.sessionId, from: 0, entries: [], working: false });
        },
    });
    const p = h.page;
    let accept = false;
    let dialog = null;
    p.on('dialog', (d) => { dialog = d.message(); return accept ? d.accept() : d.dismiss(); });
    const events = () => p.locator('[data-el=messages] .event').allTextContents();

    await h.openChat('Skool Sven');
    await p.click('[data-el=chat-title]');
    await h.wait(150);
    const labels = await p.locator('#info-actions button[data-action]').allTextContents();
    check('one entry "VS Code"', labels.filter((l) => l.includes('VS Code')).join() === 'VS Code', labels);
    await p.click('#info-actions button[data-action="vscode"]');
    await h.wait(100);
    check('a backend from before: only the IDE', (await p.isVisible('#vs-show')) && !(await p.isVisible('#vs-terminal')));
    await p.click('#vs-show');
    await h.wait(100);
    check('cancel: no request, the list stays', dialog && dialog.includes('DESK') && !h.sent.some((f) => f.type === 'vscode_show') && (await p.isVisible('#vscode')), dialog);

    accept = true;
    await p.click('#vs-show');
    await h.wait(100);
    check('sent: the list closes', !(await p.isVisible('#vscode')));
    const request = h.sent.find((f) => f.type === 'vscode_show');
    check('request to the bot\'s machine', request && request.chatId === 'skool' && request.machine === 'desk' && request.target === 'ide', request);
    check('hint in the chat', (await events()).some((t) => t.includes('Opening in the IDE on DESK')), await events());
    await h.push({ type: 'vscode_shown', machine: 'desk', chatId: 'skool', ok: true, message: 'Opened in the IDE.' });
    await h.push({ type: 'vscode_shown', machine: 'desk', chatId: 'skool', ok: false, message: 'No desktop app answered.' });
    await h.wait(100);
    const e = await events();
    check('success and error in the chat', e.includes('Opened in the IDE.') && e.some((t) => t.startsWith('Handing over failed: No desktop app')), e);

    // the machine offers both targets: a terminal as well
    const status = { type: 'backend_status', machine: 'desk', since: '2026-10-17T08:00:00Z', changed: [], protocol: 2, minClientProtocol: 2 };
    await h.push({ ...status, handover: ['ide', 'terminal'] });
    await p.click('[data-el=chat-title]');
    await h.wait(150);
    await p.click('#info-actions button[data-action="vscode"]');
    await h.wait(100);
    check('both targets offered', (await p.isVisible('#vs-show')) && (await p.isVisible('#vs-terminal')));
    await p.click('#vs-terminal');
    await h.wait(100);
    const toTerminal = h.sent.findLast((f) => f.type === 'vscode_show');
    check('terminal: request with its target', toTerminal?.target === 'terminal', toTerminal);
    check('terminal: hint in the chat', (await events()).some((t) => t.includes('Opening in a terminal on DESK')), await events());
    // nothing offered (a container, another account): no buttons
    await h.push({ ...status, handover: [] });
    await p.click('[data-el=chat-title]');
    await h.wait(150);
    await p.click('#info-actions button[data-action="vscode"]');
    await h.wait(100);
    check('no target: no buttons', !(await p.isVisible('#vs-show')) && !(await p.isVisible('#vs-terminal')));
    await p.keyboard.press('Escape');
    await h.wait(100);

    // session from a subfolder
    await p.click('[data-el=chat-title]');
    await h.wait(150);
    await p.click('#info-actions button[data-action="vscode"]');
    await h.wait(200);
    const row = await p.locator('#vs-list .vs-session').first().textContent();
    check('subfolder in the row', row.includes('backend/') && row.includes('Terminal'), row);
    await p.locator('#vs-list .vs-session').first().click();
    await h.wait(150);
    const open = h.sent.find((f) => f.type === 'vscode_open');
    check('the folder goes along when opening', open && open.folder === 'C:/www/skool/backend', open);
    await p.click('#vs-adopt');
    await h.wait(100);
    const adopt = h.sent.find((f) => f.type === 'vscode_adopt');
    check('and when taking over', adopt && adopt.folder === 'C:/www/skool/backend', adopt);
}
