// Bot editor: the repository field fills itself from the folder, when the folder holds a repository: for a bot that
// is opened (also one without a stored machine) and shortly after a folder is typed, without leaving the field.
// What the user typed into the repository field stays.
import { bot } from './harness.mjs';

const WEB = 'https://git.example.com/team/web.git';
const API = 'https://git.example.com/team/api.git';

export default async function ({ start, check }) {
    const h = await start({
        online: ['desk'],
        // No stored machine: the one that runs it is the bot's home
        bots: [bot('web', 'Web Wanda')],
        async onSend(f, push) {
            if (f.type !== 'folder_check') return;
            const remote = { 'C:/www/web': WEB, 'C:/www/api': API }[f.folder];
            await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder, ...(remote ? { remote } : {}) });
        },
    });
    const p = h.page;
    const repo = () => p.inputValue('#editor-repo');
    const folder = () => p.inputValue('#editor-folder');

    await p.evaluate(() => openEditor(bot('web')));
    await h.wait(200);
    check('a bot without a stored machine: its repository filled in, its folder kept', (await repo()) === WEB && (await folder()) === 'C:/www/web',
        [await folder(), await repo()]);
    await p.click('#editor [data-close]');
    await h.wait(100);

    await p.evaluate(() => openEditor(null));
    await h.wait(100);
    await p.fill('#editor-folder', 'C:/www/api');
    await h.wait(900);
    check('a folder typed: the repository follows without leaving the field', (await repo()) === API, await repo());
    const asks = h.sent.filter((f) => f.type === 'folder_check' && f.folder === 'C:/www/api').length;
    await p.locator('#editor-folder').blur();
    await h.wait(200);
    check('leaving the field afterwards does not ask again', h.sent.filter((f) => f.type === 'folder_check' && f.folder === 'C:/www/api').length === asks);

    await p.fill('#editor-folder', 'C:/www/plain');
    await h.wait(900);
    check('a folder without a repository: the filled-in address goes again', (await repo()) === '', await repo());

    await p.fill('#editor-repo', 'git@git.example.com:team/own.git');
    await p.fill('#editor-folder', 'C:/www/api');
    await h.wait(900);
    check('a repository typed by hand stays', (await repo()) === 'git@git.example.com:team/own.git', await repo());
}
