// Keeping repos current: a repo that is only behind counts as open and gets "Pull"; moving a bot with work not on
// the git server offers to take it along, asked from the previous machine once the new one took the folder.
import { bot } from './harness.mjs';

const BEHIND = { name: 'lib', path: 'lib', branch: 'main', ahead: 0, behind: 3, files: [], more: 0 };
const UNPUSHED = { name: 'skool', path: '', branch: 'main', ahead: 1, behind: 0, files: [], more: 0 };

export default async function ({ start, check }) {
    const h = await start({
        online: ['desk', 'workstation'],
        bots: [bot('skool', 'Skool Sven', { machine: 'desk' })],
        async onSend(f, push) {
            if (f.type === 'git_changes') await push({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: [BEHIND] });
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    let dialog = null;
    let accept = false;
    p.on('dialog', (d) => { dialog = d.message(); return accept ? d.accept() : d.dismiss(); });
    const rows = () => p.$$eval('#row-menu .git-repo', (n) => n.map((x) => [...x.children].map((c) => c.textContent.trim()).join(' ')));

    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [BEHIND] } });
    await h.wait(100);
    check('only behind: counts as open (badge)', await p.$$eval('#chat-list li[data-chat="skool"] .git-badge', (m) => m.length === 1));

    await p.setViewportSize({ width: 1200, height: 860 });
    await p.click('#chat-list li[data-chat="skool"]', { button: 'right' });
    await h.wait(100);
    await p.locator('#row-menu button', { hasText: 'Open changes' }).click();
    await h.wait(200);
    check('row with "Pull"', JSON.stringify(await rows()) === JSON.stringify(['lib main · 3 not pulled Pull']), await rows());

    await p.locator('#row-menu .git-button', { hasText: 'Pull' }).click();
    await h.wait(100);
    const pull = h.sent.find((f) => f.type === 'git_pull');
    check('pull goes to the bot\'s machine without asking', pull && pull.botId === 'skool' && pull.path === 'lib' && pull.machine === 'desk' && dialog === null, pull);
    check('meanwhile "running …", disabled', await p.$eval('#row-menu .git-button', (k) => k.textContent === 'running …' && k.disabled));
    await h.push({ type: 'git_pull', machine: 'desk', botId: 'skool', path: 'lib', ok: false, message: 'lib: not pulled, 3 new on the remote but local changes here.' });
    await h.wait(100);
    check('refusal in red at the top, button free again', await p.$eval('#row-menu .git-message', (n) => n.classList.contains('error') && n.textContent.startsWith('lib: not pulled'))
        && !(await p.$eval('#row-menu .git-button', (k) => k.disabled)));
    await h.push({ type: 'git_pull', machine: 'desk', botId: 'skool', path: 'lib', ok: true, message: 'lib: brought up to date (3 new from the remote)' });
    await h.push({ type: 'git_changes', machine: 'desk', botId: 'skool', repos: [{ ...BEHIND, behind: 0 }] });
    await h.wait(100);
    check('success: message, repo no longer listed', await p.$eval('#row-menu .git-message', (n) => n.classList.contains('ok')) && (await rows()).length === 0);

    // An old backend does not know git_pull: the menu says so instead of staying at "running …"
    await h.push({ type: 'git_changes', machine: 'desk', botId: 'skool', repos: [BEHIND] });
    await h.wait(100);
    await p.locator('#row-menu .git-button', { hasText: 'Pull' }).click();
    await h.push({ type: 'error', machine: 'desk', request: 'git_pull', message: 'Unknown request git_pull' });
    await h.wait(100);
    check('old backend: error shown', (await p.textContent('#row-menu')).includes('Unknown request git_pull'));
    await p.mouse.click(5, 5);

    // Moving with unpushed commits: asked first; cancelling keeps the editor open and sends nothing
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [UNPUSHED] } });
    await h.wait(100);
    await p.evaluate(() => openEditor(bot('skool')));
    await h.wait(150);
    await p.selectOption('#editor-machine', 'workstation');
    dialog = null;
    await p.click('#editor-form button[type=submit]');
    await h.wait(150);
    check('question offers to take the work from DESK to WORKSTATION', dialog && dialog.includes('DESK') && dialog.includes('(skool)') && dialog.includes('Take it along to WORKSTATION'), dialog);
    check('cancelled: nothing checked, requested or saved, editor open', !h.sent.some((f) => f.type === 'folder_check' && f.machine === 'workstation')
        && !h.sent.some((f) => f.type === 'bot_save' || f.type === 'work_take') && await p.isVisible('#editor'));
    accept = true;
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    const saved = h.sent.find((f) => f.type === 'bot_save');
    const take = h.sent.find((f) => f.type === 'work_take');
    check('confirmed: saved on the new machine', saved && saved.bot.machine === 'workstation', saved);
    check('the previous machine is asked for the work, with its folder, before the save', take && take.machine === 'desk' && take.botId === 'skool'
        && take.folder === 'C:/www/skool' && h.sent.indexOf(take) < h.sent.indexOf(saved), take);

    // Without unpushed work there is nothing to ask
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [BEHIND] } });
    await h.wait(100);
    await p.evaluate(() => openEditor(bot('skool')));
    await h.wait(150);
    await p.selectOption('#editor-machine', 'workstation');
    dialog = null;
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    check('only behind: no question, no work requested', dialog === null && h.sent.filter((f) => f.type === 'bot_save').length === 2
        && h.sent.filter((f) => f.type === 'work_take').length === 1, dialog);
}
