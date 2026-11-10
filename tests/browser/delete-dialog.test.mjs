// Deleting a bot, a group or a conversation: a "danger zone" dialog with what goes and what stays. A bot or group is
// confirmed by typing its name, a conversation by the red button alone. The backend here is one before the question
// about the working folder (folder-delete.test.mjs has the newer one): the folder is not part of it.

export default async function ({ start, check }) {
    const h = await start({
        async onSend(f, push) {
            if (f.type === 'folder_delete_check') await push({ type: 'error', machine: 'desk', request: 'folder_delete_check', message: 'unknown frame' });
        },
        bots: [
            { id: 'skool', name: 'Skool Sven', role: 'Test', avatar: '', folder: 'C:/www/skool', model: 'default', approval: 'risky', tone: '', machine: 'desk', conversations: [{ id: 'aa11', title: 'Release', createdAt: '' }, { id: 'bb22', title: 'Notes', createdAt: '' }] },
            { id: 'cloud', name: 'Cloud Carlo', role: 'Test', avatar: '', folder: 'C:/www/cloud', model: 'default', approval: 'risky', tone: '', machine: 'desk' },
        ],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
    });
    const p = h.page;
    const sent = (type) => h.sent.filter((f) => f.type === type);
    const dialog = () => p.evaluate(() => {
        const o = document.querySelector('.overlay.ask');
        if (!o) return null;
        return {
            title: o.querySelector('h2').textContent,
            items: [...o.querySelectorAll('li')].map((l) => l.textContent),
            notes: [...o.querySelectorAll('.danger-note')].map((n) => n.textContent),
            typed: !!o.querySelector('input'),
            action: o.querySelector('button[type=submit]').textContent,
            disabled: o.querySelector('button[type=submit]').disabled,
        };
    });

    await p.evaluate(() => state.routines.push({ id: 'r1', botId: 'skool', name: 'Nightly', cron: '0 3 * * *', prompt: 'x', enabled: true }));
    await p.evaluate(() => { openInfo('skool'); });
    await h.wait(200);
    await p.click('#info-actions button[data-action="delete"]');
    await h.wait(100);
    const bot = await dialog();
    check('bot: title and the red button named after the action', bot && bot.title === 'Delete bot “Skool Sven”?' && bot.action === 'Delete bot', bot);
    check('bot: lists what goes', bot && JSON.stringify(bot.items) === JSON.stringify(['The chat history', '2 further conversations with their history', '1 routine', 'The membership in 1 group']), bot);
    check('bot: the working folder stays', bot && bot.notes.length === 1 && bot.notes[0] === 'The working folder C:/www/skool is not deleted.', bot);
    check('bot: the button waits for the name', bot && bot.typed && bot.disabled);
    check('focus is in the name field', await p.evaluate(() => document.activeElement === document.querySelector('.overlay.ask input')));
    await p.fill('.overlay.ask input', 'skool sven');
    check('a different spelling does not unlock', (await dialog()).disabled);
    await p.keyboard.press('Enter');
    check('Enter does not delete with a wrong name', (await dialog()) !== null && sent('bot_delete').length === 0);
    await p.fill('.overlay.ask input', ' Skool Sven ');
    check('the name unlocks the button', !(await dialog()).disabled);
    await p.fill('.overlay.ask input', 'Skool Sven');
    await p.keyboard.press('Enter');
    await h.wait(100);
    check('bot deleted after the name', sent('bot_delete').length === 1 && sent('bot_delete')[0].botId === 'skool' && (await dialog()) === null, sent('bot_delete'));

    await p.evaluate(() => { openGroupEditor(state.groups[0]); });
    await h.wait(200);
    await p.click('#group-actions button[data-action="group_delete"]');
    await h.wait(100);
    const group = await dialog();
    check('group: name to type, history listed, bots stay', group && group.title === 'Delete group “Team”?' && group.action === 'Delete group' && group.typed && group.disabled
        && JSON.stringify(group.items) === '["The chat history"]' && group.notes[0] === 'The bots stay.', group);
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('Escape keeps the group', (await dialog()) === null && sent('group_delete').length === 0 && await p.isVisible('#group-editor'));
    await p.click('#group-actions button[data-action="group_delete"]');
    await h.wait(100);
    await p.fill('.overlay.ask input', 'Team');
    await p.click('.overlay.ask button[type=submit]');
    await h.wait(100);
    check('group deleted after the name', sent('group_delete').length === 1 && sent('group_delete')[0].groupId === 'team', sent('group_delete'));

    // a conversation: no name to type
    await p.evaluate(() => { openInfo('skool~aa11'); });
    await h.wait(200);
    await p.click('#info-actions button[data-action="conversation_delete"]');
    await h.wait(100);
    const conv = await dialog();
    check('conversation: button alone, archive named as the alternative', conv && conv.title === 'Delete conversation “Release”?' && !conv.typed && !conv.disabled && conv.action === 'Delete conversation'
        && conv.notes[0] === '“Archive” keeps the conversation instead.', conv);
    check('conversation: a cancel button is there', await p.locator('.overlay.ask [data-cancel]').count() === 1);
    await p.click('.overlay.ask [data-cancel]');
    await h.wait(100);
    check('cancel: nothing deleted', sent('conversation_delete').length === 0);
    await p.click('#info-actions button[data-action="conversation_delete"]');
    await h.wait(100);
    await p.click('.overlay.ask button[type=submit]');
    await h.wait(100);
    check('conversation deleted', sent('conversation_delete').length === 1 && sent('conversation_delete')[0].chatId === 'skool~aa11', sent('conversation_delete'));
    await h.close();
}
