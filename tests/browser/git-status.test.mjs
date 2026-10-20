// Overview of open changes: badge per bot in the list and a row at the bottom left, from the machines' git_status;
// both open the page "Open changes" in the chat area (back at the top left or swipe to the right).
import { bot } from './harness.mjs';

const SKOOL = { name: 'skool', path: '', branch: 'main', ahead: 0, behind: 0, files: [{ status: ' M', path: 'src/a.ts' }], more: 0 };
const MAIL = { name: 'mail', path: '', branch: 'main', ahead: 2, behind: 0, files: [], more: 0 };
const CLEAN = { name: 'old', path: 'old', branch: 'main', ahead: 0, behind: 0, files: [], more: 0 };

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven', { conversations: [{ id: 'aa11', title: 'On the side', createdAt: '' }] }), bot('mail', 'Mail Mia'), bot('empty', 'Empty')],
        onSend: async (f, push) => {
            if (f.type === 'git_changes') await push({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: [SKOOL] });
        },
    });
    const p = h.page;
    const badges = () => p.$$eval('#chat-list li[data-chat] .git-badge', (m) => m.map((x) => `${x.closest('li').dataset.chat}:${x.textContent}`));
    const content = (sel) => p.evaluate((sel) => {
        const m = document.querySelector(sel);
        if (!m || m.hidden) return null;
        const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
        return [...m.querySelectorAll('.menu-info, .git-repo, .git-file')].flatMap((n) => !n.children.length ? [text(n)]
            : n.classList.contains('menu-info') ? [...n.children].map(text) : [[...n.children].map(text).join(' ')]);
    }, sel);
    const page = () => content('#git-page');
    const head = () => p.evaluate(() => `${document.querySelector('#git-title').textContent} · ${document.querySelector('#git-sub').textContent}`);
    const listVisible = () => p.$eval('#chat-list', (n) => n.getBoundingClientRect().width > 0);

    check('without state: no badge, no row at the bottom', !(await badges()).length && await p.$eval('#git-total', (n) => n.hidden));

    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [SKOOL], mail: [MAIL, CLEAN] } });
    await h.wait(100);
    check('badge on the bots with open repos (clean ones do not count)', JSON.stringify((await badges()).sort()) === '["mail:1","skool:1"]', await badges());
    check('row at the bottom left, also collapsed', await p.$eval('#git-total', (n) => !n.hidden && n.offsetHeight > 0 && n.textContent === '2 repos with open changes'));

    await p.click('#git-total');
    await h.wait(100);
    check('opens the page instead of the list, title at the top', !(await listVisible()) && (await head()) === 'Open changes · all bots');
    const total = await page();
    check('total list: all bots, bot per repo', JSON.stringify(total) === JSON.stringify([
        '2 repos at 2 bots', 'Commit & push all (2)',
        'skool Skool Sven · main Commit & push', 'M src/a.ts',
        'mail Mail Mia · main · 2 not pushed Push',
    ]), total);

    p.on('dialog', (d) => d.accept());
    await p.locator('#git-page .git-list .git-button', { hasText: /^Push$/ }).click();
    await h.wait(100);
    const push = h.sent.find((f) => f.type === 'git_commit');
    check('push from the total list to the repo\'s bot', push && push.botId === 'mail' && push.path === '' && push.machine === 'desk', push);
    check('only this button runs', JSON.stringify(await p.$$eval('#git-page .git-list .git-button', (k) => k.map((x) => x.textContent))) === '["Commit & push","running …"]');
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'mail', path: '', ok: true, message: 'mail: pushed' });
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [SKOOL] } });
    await h.wait(100);
    const after = await page();
    check('a new state updates the open page', JSON.stringify(after) === JSON.stringify([
        '1 repo at 1 bot', 'mail: pushed', 'skool Skool Sven · main Commit & push', 'M src/a.ts',
    ]), after);

    await p.click('#git-back');
    await h.wait(100);
    check('back at the top left: the list again', (await page()) === null && await listVisible());
    check('badge and row updated', JSON.stringify(await badges()) === '["skool:1"]' && (await p.textContent('#git-total')) === '1 repo with open changes');

    // tapping the badge: page of this bot, the chat does not open
    await p.click('#chat-list li[data-chat="skool"] .git-badge');
    await h.wait(200);
    const request = h.sent.findLast((f) => f.type === 'git_changes');
    check('badge asks the bot\'s machine', request && request.botId === 'skool' && request.machine === 'desk', request);
    check('page of the bot', (await head()) === 'Open changes · Skool Sven' && JSON.stringify((await page() || []).slice(0, 1)) === '["1 of 1 repos"]', await page());
    check('chat stays closed', !(await p.$eval('#chat-list li[data-chat="skool"]', (n) => n.classList.contains('active'))));
    await h.swipe(30, 400, 330, 400);
    check('swiping to the right: back to the list', (await page()) === null && await listVisible());

    // long press on a conversation: "Open changes" at the very top with count
    await p.click('#chat-list li[data-chat="skool~aa11"]', { button: 'right' });
    await h.wait(100);
    check('conversation: "Open changes" at the very top with count', (await p.locator('#row-menu button[data-action]').first().textContent()) === 'Open changes (1 repo)');
    await p.click('#row-menu .menu-back');
    await h.wait(100);

    // the conversation's page lists the bot's open changes itself, below its own heading
    await p.click('#chat-list li[data-chat="skool~aa11"]');
    await h.wait(300);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    const fromConversation = h.sent.findLast((f) => f.type === 'git_changes');
    check('conversation: asks for the bot', fromConversation && fromConversation.botId === 'skool' && fromConversation.machine === 'desk', fromConversation);
    const inline = await content('#info-git');
    check('conversation: the bot\'s open changes on its page', JSON.stringify(inline) === JSON.stringify(['1 of 1 repos', 'skool main Commit & push', 'M src/a.ts']) && (await page()) === null, inline);
    await p.click('#info [data-page-back]');
    await h.wait(100);
    await p.click('[data-el=btn-back]');
    await h.wait(500);

    // commit & push all: one after the other, message from the file names, repos with an error stay out
    const BROKEN = { name: 'broken', path: 'broken', branch: '', ahead: 0, behind: 0, files: [], more: 0, error: 'dubious ownership' };
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [SKOOL], mail: [MAIL, BROKEN] } });
    await h.wait(500);
    await p.click('#git-total');
    await h.wait(100);
    const allButton = p.locator('#git-page .git-all');
    check('button with the number of doable repos', (await allButton.textContent()) === 'Commit & push all (2)');
    const before = h.sent.filter((f) => f.type === 'git_commit').length;
    await allButton.click();
    await h.wait(100);
    let commits = h.sent.filter((f) => f.type === 'git_commit').slice(before);
    check('first one repo, message from the file names', commits.length === 1 && commits[0].botId === 'skool' && commits[0].message === 'Update a.ts', commits);
    check('button shows the progress', (await allButton.textContent()) === 'running … 1/2' && await allButton.isDisabled());
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'skool', path: '', ok: true, message: 'skool: commit abc, pushed' });
    await h.wait(100);
    commits = h.sent.filter((f) => f.type === 'git_commit').slice(before);
    check('then the next one, push only', commits.length === 2 && commits[1].botId === 'mail' && commits[1].message === '', commits);
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'mail', path: '', ok: false, message: 'mail: push failed: rejected' });
    await h.wait(100);
    check('result with errors at the top', await p.$eval('#git-page .git-message', (n) => n.classList.contains('error') && n.textContent === '1 of 2 repos pushed. mail: push failed: rejected'));
    check('free again afterwards', !(await allButton.isDisabled()));
    await p.click('#git-back');
    await h.wait(100);

    // backend with old code: the row at the bottom names it, the page shows a hint and a button
    await h.push({ type: 'git_status', machine: 'desk', status: {} });
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: ['local/src/agent.ts', 'shared/protocol.ts'] });
    await h.wait(500);
    check('no repos, but a restart is needed: row stays', (await p.textContent('#git-total')) === 'DESK: restart needed');
    await p.click('#git-total');
    await h.wait(100);
    const hint = () => p.$eval('#git-page .backend-hint', (n) => n.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
    check('hint with changed files and button', /^DESK: restart backendRunning with old code since \d\d:\d\d [AP]M\. Changed: agent\.ts, protocol\.tsRestart$/.test(await hint()), await hint());
    await p.click('#git-page .backend-hint .git-button');
    await h.wait(100);
    const restart = h.sent.find((f) => f.type === 'backend_restart');
    check('button requests the restart from the machine', restart && restart.machine === 'desk', restart);
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: ['local/src/agent.ts'], requested: { reason: 'from the app', since: new Date().toISOString() } });
    await h.wait(100);
    check('requested: waits, button disabled', (await hint()).includes('waits until no bot is working') && await p.$eval('#git-page .backend-hint .git-button', (k) => k.disabled && k.textContent === 'waiting …'));
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: [] });
    await h.wait(100);
    check('after the restart: hint and row gone', (await hint()) === null && await p.$eval('#git-total', (n) => n.hidden));
    await p.click('#git-back');

    // the backend's own repo is open: the restart button sits in its row instead of a hint
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [Object.assign({}, SKOOL, { backend: true })] } });
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: ['local/src/agent.ts'] });
    await h.wait(500);
    check('row names only the repos', (await p.textContent('#git-total')) === '1 repo with open changes', await p.textContent('#git-total'));
    await p.click('#git-total');
    await h.wait(100);
    const rowButtons = await p.$$eval('#git-page .git-repo .git-button', (ks) => ks.map((k) => k.textContent));
    check('restart next to commit & push, no hint', JSON.stringify(rowButtons) === '["Commit & push","Restart"]' && (await hint()) === null, rowButtons);
    const sentBefore = h.sent.filter((f) => f.type === 'backend_restart').length;
    await p.click('#git-page .git-repo .git-restart');
    await h.wait(100);
    check('row button requests the restart', h.sent.filter((f) => f.type === 'backend_restart').length === sentBefore + 1);
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: [] });
    await h.wait(100);
    check('after the restart: only commit & push left', (await p.$$('#git-page .git-repo .git-restart')).length === 0);
    await p.click('#git-back');
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [SKOOL] } });
    await h.wait(500);

    // the machine leaves: its state expires
    await h.push({ type: 'agents', online: [] });
    // after tapping into the list it only re-renders 350 ms later
    await h.wait(500);
    check('without a machine no badge and no row', !(await badges()).length && await p.$eval('#git-total', (n) => n.hidden));
}
