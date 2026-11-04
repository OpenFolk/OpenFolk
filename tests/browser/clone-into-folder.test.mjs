// Saving a bot with a repository and a folder that is already there but holds no clone of it (empty, say, after a
// clone that failed): the editor clones into it instead of saving the bot without its repository, and a failed clone
// keeps the editor open with the error. A folder that holds the repository is saved as it is.
import { bot } from './harness.mjs';

const REPO = 'https://git.example.com/wrong-owner/web.git';

export default async function ({ start, check }) {
    let cloneAnswer = { ok: false, message: 'Cloning failed: remote: Repository not found.' };
    const h = await start({
        online: ['desk'],
        bots: [bot('pdf', 'PDF-Reader', { machine: 'desk' })],
        async onSend(f, push) {
            if (f.type === 'folder_check') {
                const remote = { 'C:/www/web-ok': 'https://git.example.com/wrong-owner/web' }[f.folder];
                await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder, ...(remote ? { remote } : {}) });
            }
            if (f.type === 'folder_clone') await push({ type: 'folder_cloned', url: f.url, ...cloneAnswer, ...(cloneAnswer.ok ? { folder: f.folder } : {}) });
        },
    });
    const p = h.page;
    const fillNew = async (folder) => {
        await p.evaluate(() => openEditor(null));
        await h.wait(150);
        await p.fill('#editor-name', 'Web');
        await p.fill('#editor-folder', folder);
        await h.wait(900);
        await p.fill('#editor-repo', REPO);
        await p.click('#editor-form button[type=submit]');
        await h.wait(300);
    };

    await fillNew('C:/www/web');
    const clone = h.sent.find((f) => f.type === 'folder_clone');
    check('an existing folder without the repository: cloned into it', clone && clone.url === REPO && clone.folder === 'C:/www/web', clone);
    check('the clone failed: error in the editor, editor open, nothing saved', await p.isVisible('#editor') && (await p.textContent('#editor-error')).includes('Repository not found')
        && !h.sent.some((f) => f.type === 'bot_save'), await p.textContent('#editor-error'));

    cloneAnswer = { ok: true };
    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    check('cloned on the second try: saved with that folder', h.sent.some((f) => f.type === 'bot_save' && f.bot.folder === 'C:/www/web'));

    await p.click('#editor [data-close]').catch(() => undefined);
    await h.wait(100);
    const clones = h.sent.filter((f) => f.type === 'folder_clone').length;
    await fillNew('C:/www/web-ok');
    check('a folder that holds the repository (without ".git"): saved without cloning', h.sent.filter((f) => f.type === 'folder_clone').length === clones
        && h.sent.some((f) => f.type === 'bot_save' && f.bot.folder === 'C:/www/web-ok'));
    await h.close();
}
