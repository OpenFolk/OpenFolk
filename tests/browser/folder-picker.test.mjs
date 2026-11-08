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
            if (f.type === 'folder_create') {
                if (f.name === 'taken') { await push({ type: 'folder_created', name: f.name, ok: false, message: 'C:/www/taken already exists' }); return; }
                const folder = `${f.parent}/${f.name}`;
                TREE[f.parent].folders.push(folder);
                TREE[folder] = { folder, parent: f.parent, folders: [] };
                await push({ type: 'folder_created', name: f.name, ok: true, folder });
            }
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
    check('no new folder next to the roots', await p.isDisabled('#picker-create'));

    await p.click('#picker-list button:has-text("C:/www")');
    await h.wait(200);
    check('inside a root: a way up and the folders by name', JSON.stringify(await entries()) === JSON.stringify(['Up one level', 'api', 'web']), await entries());

    // A new folder below the one shown: created there, and the picker goes into it
    await p.fill('#picker-new-name', 'taken');
    await p.click('#picker-create');
    await h.wait(200);
    check('a name that is taken: the reason, the picker stays', (await p.textContent('#picker-error')).includes('already exists') && await p.isVisible('#folder-picker'));
    await p.fill('#picker-new-name', 'blog');
    await p.press('#picker-new-name', 'Enter');
    await h.wait(300);
    const create = h.sent.findLast((f) => f.type === 'folder_create');
    check('Enter creates it below the folder shown', create && create.name === 'blog' && create.parent === 'C:/www' && !create.nextFree, create);
    check('the picker is in the new folder, the field empty again', (await p.textContent('#picker-path')).startsWith('C:/www/blog') && (await p.inputValue('#picker-new-name')) === '' && await p.isHidden('#picker-error'));
    await p.click('#picker-list button:has-text("Up one level")');
    await h.wait(200);
    check('one level up it is listed', (await entries()).includes('blog'), await entries());
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
