// Bot editor: the folder picker lists the subfolders on the bot's machine, goes down and up, and puts the chosen
// folder into the field, whose repository then follows as for a folder typed in.
const TREE = {
    '': { folder: '', folders: ['C:/www', 'D:/work'] },
    'C:/www': { folder: 'C:/www', parent: '', folders: ['C:/www/api', 'C:/www/web'] },
    'C:/www/web': { folder: 'C:/www/web', parent: 'C:/www', folders: [] },
};

export default async function ({ start, check }) {
    const h = await start({
        online: ['desk'],
        bots: [],
        async onSend(f, push) {
            if (f.type === 'folder_list') {
                const listed = TREE[f.folder];
                await push(listed ? { type: 'folder_listed', asked: f.folder, ok: true, ...listed } : { type: 'folder_listed', asked: f.folder, ok: false, message: 'nope' });
            }
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder, remote: 'https://git.example.com/team/web.git' });
        },
    });
    const p = h.page;
    const entries = () => p.locator('#picker-list button').allTextContents();

    await p.evaluate(() => openEditor(null));
    await h.wait(100);
    await p.click('#editor-folder-browse');
    await h.wait(200);
    check('an empty field asks for the allowed roots', h.sent.some((f) => f.type === 'folder_list' && f.folder === ''));
    check('the roots by their full path, nothing to choose yet', JSON.stringify(await entries()) === JSON.stringify(['C:/www', 'D:/work']) && await p.isDisabled('#picker-choose'), await entries());

    await p.click('#picker-list button:has-text("C:/www")');
    await h.wait(200);
    check('inside a root: a way up and the folders by name', JSON.stringify(await entries()) === JSON.stringify(['Up one level', 'api', 'web']), await entries());
    await p.click('#picker-list button:has-text("web")');
    await h.wait(200);
    check('an empty folder says so', (await p.textContent('#picker-list')).includes('No subfolders') && !(await p.isDisabled('#picker-choose')));

    await p.click('#picker-choose');
    await h.wait(300);
    check('chosen: the picker closes, the folder is in the field', await p.isHidden('#folder-picker') && (await p.inputValue('#editor-folder')) === 'C:/www/web');
    check('chosen: the repository follows', (await p.inputValue('#editor-repo')) === 'https://git.example.com/team/web.git', await p.inputValue('#editor-repo'));

    await p.fill('#editor-folder', 'Z:/elsewhere');
    await p.click('#editor-folder-browse');
    await h.wait(200);
    check('an answer with an error shows it', await p.isVisible('#picker-error') && (await p.textContent('#picker-error')) === 'nope');
    await p.click('#folder-picker [data-close]');
    await h.wait(100);
    check('cancel closes the picker and keeps the editor', await p.isHidden('#folder-picker') && await p.isVisible('#editor'));
}
