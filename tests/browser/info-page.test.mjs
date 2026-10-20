// The bot's page holds what the chat's ⋮ menu did: open changes with commit and push (message in the app's text
// dialog), the backend's restart in the row of its repo, entries that keep the page open (favorite, a declined
// restart) or leave it. A group's header opens its editor with search, favorite and delete.
import { bot } from './harness.mjs';

const SKOOL = { name: 'skool', path: '', branch: 'main', ahead: 0, behind: 0, files: [{ status: ' M', path: 'src/a.ts' }], more: 0 };
const ZETA = { name: 'zeta', path: 'zeta', branch: 'main', ahead: 2, behind: 0, files: [], more: 0 };

export default async function ({ start, check }) {
    let repos = [SKOOL, ZETA];
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('pdf', 'PDF-Reader')],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'pdf'], createdAt: '', updatedAt: '' }],
        onSend: async (f, push) => {
            if (f.type === 'git_changes') await push({ type: 'git_changes', machine: 'desk', botId: f.botId, repos });
        },
    });
    const p = h.page;
    const buttons = () => p.$$eval('#info-git .git-list .git-button', (k) => k.map((x) => x.textContent + (x.disabled ? '!' : '')));
    let dialog = null;
    let accept = true;
    p.on('dialog', (d) => { dialog = { kind: d.type(), text: d.message() }; return accept ? d.accept() : d.dismiss(); });

    await h.openChat('Skool Sven');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('the page lists the open changes with commit & push and push', JSON.stringify(await buttons()) === '["Commit & push","Push"]', await buttons());
    check('the heading stands above, not in the list', (await p.locator('#info-git .menu-info strong').count()) === 0 && (await p.locator('#info-git .menu-info span').first().textContent()) === '2 of 2 repos');

    // commit & push: the message in the app's text dialog, the page stays below it
    await p.locator('#info-git .git-list .git-button', { hasText: 'Commit' }).click();
    await h.wait(100);
    check('message asked in the text dialog with a suggestion', await p.isVisible('#text-dialog') && (await p.inputValue('#text-input')) === 'Update a.ts' && (await p.textContent('#text-title')) === 'skool' && dialog === null);
    await p.fill('#text-input', 'Fix the parser');
    await p.click('#text-submit');
    await h.wait(100);
    const commit = h.sent.find((f) => f.type === 'git_commit');
    check('git_commit with repo and message to the bot\'s machine', commit && commit.botId === 'skool' && commit.path === '' && commit.message === 'Fix the parser' && commit.machine === 'desk', commit);
    check('meanwhile "running …", the page still open', JSON.stringify(await buttons()) === '["running …!","Push!"]' && await p.isVisible('#info'), await buttons());
    repos = [ZETA];
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'skool', path: '', ok: true, message: 'skool: commit abc1234, pushed' });
    await h.push({ type: 'git_changes', machine: 'desk', botId: 'skool', repos });
    await h.wait(100);
    check('result on the page, list new', (await p.textContent('#info-git .git-message')) === 'skool: commit abc1234, pushed' && JSON.stringify(await buttons()) === '["Push"]', await buttons());
    await p.locator('#info-git .git-list .git-button', { hasText: 'Push' }).click();
    await h.wait(100);
    const push = h.sent.findLast((f) => f.type === 'git_commit');
    check('push asks to confirm, then goes out without a message', dialog && dialog.kind === 'confirm' && push.path === 'zeta' && push.message === '', { dialog, push });
    await h.push({ type: 'git_commit', machine: 'desk', botId: 'skool', path: 'zeta', ok: true, message: 'zeta: pushed' });
    await h.wait(100);

    // entries that keep the page: favorite redraws it, a declined restart sends nothing
    await p.click('#info-actions button[data-action="favorite"]');
    await h.wait(100);
    check('favorite: the page stays and shows the new state', await p.isVisible('#info') && (await p.textContent('#info-actions button[data-action="favorite"]')) === 'Remove from favorites');
    accept = false;
    await p.click('#info-actions button[data-action="restart"]');
    await h.wait(100);
    check('restart declined: nothing sent, the page stays', !h.sent.some((f) => f.type === 'restart') && await p.isVisible('#info'));
    accept = true;
    await p.click('#info [data-page-back]');
    await h.wait(100);

    // the bot's repo is the backend and its code is outdated: the restart button sits in the repo's row
    repos = [Object.assign({}, SKOOL, { backend: true })];
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: ['local/src/agent.ts'] });
    await h.wait(100);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('restart next to commit & push in the backend\'s row', JSON.stringify(await buttons()) === '["Commit & push","Restart"]' && (await p.locator('#info-git .backend-hint').count()) === 0, await buttons());
    await p.click('#info-git .git-restart');
    await h.wait(100);
    const restart = h.sent.find((f) => f.type === 'backend_restart');
    check('the button requests the restart from the machine', restart && restart.machine === 'desk', restart);
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: [] });
    await h.wait(100);
    check('after the restart: only commit & push', JSON.stringify(await buttons()) === '["Commit & push"]', await buttons());
    // without the backend's repo open: a hint with the button above the list
    repos = [];
    await h.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: ['local/src/agent.ts'] });
    await p.click('#info [data-page-back]');
    await h.wait(100);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('a hint with the restart button instead', (await p.locator('#info-git .backend-hint .git-button').textContent()) === 'Restart');
    await p.click('#info [data-page-back]');
    await p.click('[data-el=btn-back]');
    await h.wait(300);

    // a group: the header opens its editor with search, favorite and delete
    await h.openChat('Team');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    const entries = await p.locator('#group-actions button[data-action]').evaluateAll((k) => k.map((x) => x.dataset.action));
    check('group: the editor with its entries', await p.isVisible('#group-editor') && await p.isVisible('#group-actions') && entries.join() === 'search,favorite,group_delete', entries);
    await p.click('#group-actions button[data-action="favorite"]');
    await h.wait(100);
    const fav = h.sent.findLast((f) => f.type === 'favorite');
    check('group favorite: sent for the group, the editor stays and shows the new state', fav && fav.chatId === 'g:team' && fav.on === true && await p.isVisible('#group-editor')
        && (await p.textContent('#group-actions button[data-action="favorite"]')) === 'Remove from favorites', fav);
    dialog = null;
    accept = false;
    await p.click('#group-actions button[data-action="group_delete"]');
    await h.wait(100);
    check('delete group asks first; declined, the editor stays', dialog && dialog.text.includes('Team') && await p.isVisible('#group-editor') && !h.sent.some((f) => f.type === 'group_delete'), dialog);
    accept = true;
    if (await p.isHidden('#group-editor')) { await p.click('[data-el=chat-title]'); await h.wait(200); }
    await p.click('#group-actions button[data-action="search"]');
    await h.wait(200);
    const chat = await p.evaluate(() => window.activePane().chatId);
    check('"Search in chat" closes the editor and opens the group\'s chat search', !(await p.isVisible('#group-editor')) && await p.isVisible('[data-el=chat-search]') && chat === 'g:team', chat);
    check('no page errors', h.errors.length === 0, h.errors);
}
