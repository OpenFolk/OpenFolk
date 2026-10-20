// Bot info: knowledge in tabs (bot, folder, group, all), create a fact, error in the dialog, edit, delete.
import { bot } from './harness.mjs';

const T = '2026-10-12T08:00:00.000Z';

export default async function ({ start, check }) {
    const location = (scope, key = '') => ({ scope, key });
    const knowledge = [
        { location: location('bot', 'anna'), title: 'Own knowledge', facts: [{ name: 'tea', description: 'What the user drinks', type: 'user', text: 'Green tea.', updatedAt: T }] },
        { location: location('folder', 'c--www-anna'), title: 'Folder C:/www/anna', facts: [] },
        { location: location('group', 'team'), title: 'Group Team', facts: [{ name: 'standup', description: 'Standup at 9', type: 'project', text: 'Daily at 9.', updatedAt: T }] },
        { location: location('all'), title: 'All bots', facts: [] },
    ];
    const info = () => ({ skills: [], claudeMd: '', knowledge, routines: [], messages: 3 });
    const h = await start({
        bots: [bot('anna', 'Anna'), bot('bert', 'Bert')],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['anna', 'bert'] }],
        onSend: async (f, push) => {
            if (f.type === 'bot_info') await push({ type: 'bot_info', machine: 'desk', botId: f.botId, info: info() });
            const section = f.location && knowledge.find((x) => x.location.scope === f.location.scope && x.location.key === f.location.key);
            if (f.type === 'knowledge_save') {
                if (f.fact.name === 'tea' && f.oldName !== 'tea') {
                    await push({ type: 'error', machine: 'desk', request: 'knowledge_save', message: 'A fact “tea” already exists here.' });
                    return;
                }
                section.facts = [{ ...f.fact, updatedAt: T }, ...section.facts.filter((x) => x.name !== f.fact.name && x.name !== f.oldName)];
                await push({ type: 'bot_info', machine: 'desk', botId: f.botId, info: info() });
            }
            if (f.type === 'knowledge_delete') {
                section.facts = section.facts.filter((x) => x.name !== f.name);
                await push({ type: 'bot_info', machine: 'desk', botId: f.botId, info: info() });
            }
        },
    });
    const p = h.page;
    const tabs = () => p.evaluate(() => [...document.querySelectorAll('#info-knowledge-tabs .tab')].map((r) => (r.classList.contains('on') ? '*' : '') + r.textContent).join(' | '));
    const rows = () => p.evaluate(() => [...document.querySelectorAll('#info-knowledge li')].map((l) => l.textContent).join(' | '));

    await p.evaluate(() => openInfo('anna'));
    await h.wait(300);
    check('tabs with count, bot active first', (await tabs()) === '*Bot 1 | Folder | Team 1 | All', await tabs());
    check('fact of the bot with kind and description', (await rows()).includes('tea') && (await rows()).includes('about you') && (await rows()).includes('What the user drinks'), await rows());
    check('session row only once', (await p.locator('#info-facts dt', { hasText: 'Session' }).count()) === 1);

    await p.locator('#info-knowledge-tabs .tab', { hasText: 'Team' }).click();
    check('group tab shows group knowledge and hint', (await rows()).includes('standup') && (await p.textContent('#info-knowledge-hint')).includes('members of the group'), await rows());
    await p.locator('#info-knowledge-tabs .tab', { hasText: 'Folder' }).click();
    check('empty folder', (await rows()) === 'Nothing remembered yet.', await rows());

    // new in the folder, the name becomes a slug while typing
    await p.click('#info-knowledge-new');
    check('dialog shows the scope', (await p.textContent('#knowledge-location')).includes('Folder C:/www/anna'));
    await p.fill('#knowledge-name', 'Deploy Steps');
    await p.dispatchEvent('#knowledge-name', 'input');
    check('name as slug', (await p.inputValue('#knowledge-name')) === 'deploy-steps', await p.inputValue('#knowledge-name'));
    await p.selectOption('#knowledge-type', 'project');
    await p.fill('#knowledge-description', 'How deploying works here');
    await p.fill('#knowledge-text', 'Via a Forgejo webhook.');
    await p.click('#knowledge-form button[type=submit]');
    await h.wait(300);
    const saved = h.sent.findLast((f) => f.type === 'knowledge_save');
    check('request with bot, location and fact', saved?.botId === 'anna' && saved.location.scope === 'folder' && saved.fact.name === 'deploy-steps'
        && saved.fact.type === 'project' && saved.oldName === undefined, saved);
    check('dialog closed after the answer, list updated, tab stays', await p.isHidden('#knowledge-editor') && (await tabs()).includes('*Folder 1') && (await rows()).includes('deploy-steps'), await tabs());

    // duplicate name: the error stays in the dialog
    await p.locator('#info-knowledge-tabs .tab', { hasText: 'Bot' }).click();
    await p.click('#info-knowledge-new');
    await p.fill('#knowledge-name', 'tea');
    await p.fill('#knowledge-text', 'Twice.');
    await p.click('#knowledge-form button[type=submit]');
    await h.wait(300);
    check('error in the open dialog', await p.isVisible('#knowledge-editor') && (await p.textContent('#knowledge-error')).includes('already exists'));
    // Closing does not ask, changes or not
    await p.click('#knowledge-editor [data-close]');
    await h.wait(200);

    // edit and delete
    await p.locator('#info-knowledge li', { hasText: 'tea' }).locator('button').click();
    check('editing fills the dialog', (await p.inputValue('#knowledge-text')) === 'Green tea.' && await p.isVisible('#knowledge-delete'));
    await p.fill('#knowledge-text', 'Green tea, no sugar.');
    await p.click('#knowledge-form button[type=submit]');
    await h.wait(300);
    const changed = h.sent.findLast((f) => f.type === 'knowledge_save');
    check('changing sends oldName', changed.oldName === 'tea' && changed.fact.text === 'Green tea, no sugar.' && await p.isHidden('#knowledge-editor'), changed);

    await p.locator('#info-knowledge li', { hasText: 'tea' }).locator('button').click();
    p.once('dialog', (d) => d.accept());
    await p.click('#knowledge-delete');
    await h.wait(300);
    const deleted = h.sent.findLast((f) => f.type === 'knowledge_delete');
    check('deleting sends location and name, list empty', deleted?.name === 'tea' && deleted.location.scope === 'bot' && (await rows()) === 'Nothing remembered yet.' && await p.isHidden('#knowledge-editor'), await rows());
}
