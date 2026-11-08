// A bot without folder and repository gets a folder of its own: the editor asks its machine to create one named
// after the bot (the next free name), then saves the bot with it. A refusal keeps the editor open with the reason,
// and a backend before folder_create says to enter a folder.
export default async function ({ start, check }) {
    let answer = (f) => ({ type: 'folder_created', name: f.name, ok: true, folder: `/work/${f.name}` });
    const h = await start({
        online: ['desk'],
        bots: [],
        async onSend(f, push) {
            if (f.type === 'folder_create') await push(answer(f));
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    const save = async (name) => {
        await p.evaluate(() => openEditor(null));
        await h.wait(150);
        await p.fill('#editor-name', name);
        await p.click('#editor-form button[type=submit]');
        await h.wait(400);
    };

    await save('Research');
    const created = h.sent.find((f) => f.type === 'folder_create');
    check('asks the machine for a folder named after the bot, the next free name', created && created.name === 'Research' && created.nextFree === true && !created.parent, created);
    const saved = h.sent.find((f) => f.type === 'bot_save');
    check('then saved with that folder, the editor closed', saved && saved.bot.folder === '/work/Research' && await p.isHidden('#editor'), saved && saved.bot);

    answer = (f) => ({ type: 'folder_created', name: f.name, ok: false, message: 'This machine has no folder for bots (ALLOWED_ROOTS).' });
    await save('Ideas');
    check('refused: the reason in the editor, nothing saved', await p.isVisible('#editor') && (await p.textContent('#editor-error')).includes('no folder for bots')
        && h.sent.filter((f) => f.type === 'bot_save').length === 1, await p.textContent('#editor-error'));
    await p.click('#editor [data-close]').catch(() => undefined);

    answer = () => ({ type: 'error', request: 'folder_create', message: 'unknown frame folder_create' });
    await save('Notes');
    check('an older backend: asked to enter a folder', await p.isVisible('#editor') && (await p.textContent('#editor-error')).includes('enter a folder or a repository'), await p.textContent('#editor-error'));
    check('no page errors', h.errors.length === 0, h.errors);
    await h.close();
}
