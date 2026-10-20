// Open changes: in the long-press menu and on the bot's page the uncommitted files of its repos.
import { bot } from './harness.mjs';

const REPOS = [
    { name: 'group/b', path: 'group/b', branch: 'main', ahead: 0, behind: 0, files: [], more: 0 },
    { name: 'zeta', path: 'zeta', branch: 'master', ahead: 2, behind: 0, files: [], more: 0 },
    { name: 'skool', path: '', branch: 'main', ahead: 0, behind: 1, files: [{ status: ' M', path: 'src/a.ts' }, { status: '??', path: 'new ä.txt' }, { status: 'D ', path: 'old.md' }], more: 3 },
];

export default async function ({ start, check }) {
    let answer = (f) => ({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: REPOS });
    const h = await start({
        bots: [bot('skool', 'Skool Sven')],
        onSend: async (f, push) => {
            if (f.type === 'git_changes') await push(answer(f));
        },
    });
    const p = h.page;
    const content = (sel) => p.evaluate((sel) => {
        const m = document.querySelector(sel);
        if (!m || m.hidden) return null;
        const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
        return [...m.querySelectorAll('.menu-info, .git-repo, .git-file')].flatMap((n) => !n.children.length ? [text(n)]
            : n.classList.contains('menu-info') ? [...n.children].map(text) : [[...n.children].map(text).join(' ')]);
    }, sel);

    // long press with the mouse: right click; on the PC the list comes in the menu (the phone gets the page, see git-status)
    await p.setViewportSize({ width: 1200, height: 860 });
    await p.click('#chat-list li[data-chat="skool"]', { button: 'right' });
    await h.wait(100);
    await p.locator('#row-menu button', { hasText: 'Open changes' }).click();
    await h.wait(200);
    const request = h.sent.find((f) => f.type === 'git_changes');
    check('request to the bot\'s machine', request && request.botId === 'skool' && request.machine === 'desk', request);
    const list = await content('#row-menu');
    check('list: own repo first, clean ones only counted', JSON.stringify(list) === JSON.stringify([
        'Open changes · Skool Sven', '2 of 3 repos, 1 without changes', 'Commit & push all (2)',
        'skool main · 1 not pulled Commit & push', 'M src/a.ts', 'U new ä.txt', 'D old.md', '… and 3 more',
        'zeta master · 2 not pushed Push',
    ]), list);
    await p.locator('#row-menu .git-path').first().click();
    check('tapping into the list does not close the menu', (await content('#row-menu')) !== null);

    // commit & push: the message in a dialog of the app (a page on the phone) with a suggestion; cancel sends nothing
    const asked = () => p.evaluate(() => document.getElementById('text-dialog').hidden ? null : ['text-title', 'text-hint', 'text-input', 'text-submit']
        .map((id) => { const n = /** @type {HTMLInputElement} */ (document.getElementById(id)); return id === 'text-input' ? n.value : n.textContent; }));
    let dialog = null;
    p.on('dialog', (d) => { dialog = { kind: d.type(), text: d.message() }; return d.accept(); });
    await p.locator('#row-menu .git-list .git-button', { hasText: 'Commit' }).click();
    await h.wait(100);
    const question = await asked();
    check('message asked with a suggestion from the file names', JSON.stringify(question) === JSON.stringify([
        'skool', 'Commit message for skool. Commits all 6 files (new ones too) and pushes.', 'Update a.ts, new ä.txt, old.md and 3 more', 'Commit & push',
    ]) && dialog === null, question);
    await p.click('#text-dialog [data-close]');
    await h.wait(100);
    check('cancel: no request, the list stays open', !h.sent.some((f) => f.type === 'git_commit') && (await asked()) === null && (await content('#row-menu')) !== null);
    await p.locator('#row-menu .git-list .git-button', { hasText: 'Commit' }).click();
    await p.fill('#text-input', 'New feature');
    await p.click('#text-submit');
    await h.wait(100);
    const commit = h.sent.find((f) => f.type === 'git_commit');
    check('request with repo and message to the machine', commit && commit.botId === 'skool' && commit.path === '' && commit.message === 'New feature' && commit.machine === 'desk', commit);
    check('meanwhile "running …", all buttons disabled', JSON.stringify(await p.$$eval('#row-menu .git-list .git-button', (k) => k.map((x) => x.textContent + (x.disabled ? '!' : '')))) === '["running …!","Push!"]');
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'skool', path: '', ok: true, message: 'skool: commit abc1234, pushed' });
    await h.push({ type: 'git_changes', machine: 'desk', botId: 'skool', repos: [REPOS[0], REPOS[1]] });
    await h.wait(100);
    const after = await content('#row-menu');
    check('result at the top, list new', JSON.stringify(after) === JSON.stringify([
        'Open changes · Skool Sven', '1 of 2 repos, 1 without changes', 'skool: commit abc1234, pushed', 'zeta master · 2 not pushed Push',
    ]), after);

    // push only: confirmation instead of a message; an error stands in red at the top
    await p.locator('#row-menu .git-list .git-button', { hasText: 'Push' }).click();
    await h.wait(100);
    const push = h.sent.findLast((f) => f.type === 'git_commit');
    check('push only asks to confirm', dialog.kind === 'confirm' && dialog.text === 'Push 2 commits from zeta?' && push.path === 'zeta' && push.message === '', { dialog, push });
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'skool', path: 'zeta', ok: false, message: 'zeta: push failed: rejected' });
    await h.wait(100);
    check('no page errors up to here', !h.errors.length, h.errors);
    check('error in red in the menu, buttons free again', await p.$eval('#row-menu .git-message', (n) => n.classList.contains('error') && n.textContent === 'zeta: push failed: rejected')
        && !(await p.$eval('#row-menu .git-list .git-button', (k) => k.disabled)));
    await p.mouse.click(5, 5);
    await h.wait(100);
    check('tapping next to it closes it', (await content('#row-menu')) === null);

    // open changes on the bot's page (the header opens it), requested as soon as it opens; everything clean
    answer = (f) => ({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: [REPOS[0]] });
    await p.click('#chat-list li[data-chat="skool"]');
    await h.wait(300);
    const requests = () => h.sent.filter((f) => f.type === 'git_changes').length;
    const before = requests();
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('the bot\'s page asks for the open changes right away', requests() === before + 1);
    check('no "Open changes" entry among the actions', !(await p.locator('#info-actions button').allTextContents()).some((t) => t.startsWith('Open changes')));
    const clean = await content('#info-git');
    check('bot\'s page: everything committed', JSON.stringify(clean) === JSON.stringify(['Everything committed and pushed (1 repo).']), clean);

    // an error from the machine shows on the page; a late answer does not change another menu
    answer = () => ({ type: 'error', machine: 'desk', request: 'git_changes', message: 'Open changes: folder C:/www/skool does not exist on this machine' });
    await p.click('#info .panel-head [data-close]');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('error on the bot\'s page', JSON.stringify(await content('#info-git')) === JSON.stringify(['Open changes: folder C:/www/skool does not exist on this machine']), await content('#info-git'));
    await p.click('#info .panel-head [data-close]');
    await h.wait(100);
    await p.click('#chat-list li[data-chat="skool"]', { button: 'right' });
    await h.wait(100);
    await h.push({ type: 'git_changes', machine: 'desk', botId: 'skool', repos: REPOS });
    await h.wait(100);
    check('a late answer does not overwrite the long-press menu', await p.locator('#row-menu button', { hasText: 'VS Code' }).count() === 1);
    check('no page errors', !h.errors.length, h.errors);
}
