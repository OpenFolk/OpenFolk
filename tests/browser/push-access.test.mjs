// Push access: a machine whose bots push to a git host without credentials there says so in setup_status; the row at
// the bottom left names it and "Open changes" says what to set, for a container the git token in the machine's
// settings. Cloning in the bot editor onto such a machine says so too.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        online: ['desk', 'cloud'],
        bots: [bot('skool', 'Skool Sven', { machine: 'cloud' }), bot('mail', 'Mail Mia', { machine: 'cloud' }), bot('pdf', 'PDF-Reader', { machine: 'desk' })],
        onSend: async (f, push) => {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
            if (f.type === 'folder_clone') await push({ type: 'folder_cloned', url: f.url, ok: true, folder: '/work/web', push: false });
        },
    });
    const p = h.page;
    const hint = () => p.$$eval('#git-page .backend-hint', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const engines = { claude: 'ready' };

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines });
    await h.push({ type: 'setup_status', machine: 'cloud', relay: 'remote', container: true, engines });
    await h.wait(300);
    check('all hosts reachable: no row at the bottom', await p.$eval('#git-total', (n) => n.hidden));

    await h.push({ type: 'setup_status', machine: 'cloud', relay: 'remote', container: true, engines, push: [{ host: 'git.example.com', bots: ['skool', 'mail'] }] });
    await h.wait(300);
    check('row at the bottom names the machine', (await p.textContent('#git-total')) === 'no push access on CLOUD', await p.textContent('#git-total'));
    await p.click('#git-total');
    await h.wait(200);
    const container = (await hint())[0] || '';
    check('page: host, bots and the git token in the settings for the container', container.startsWith('CLOUD cannot push to git.example.com')
        && container.includes('Skool Sven, Mail Mia') && container.includes('git token for git.example.com in the settings of CLOUD'), container);
    await p.click('#git-back');

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines, push: [{ host: 'github.com', bots: ['pdf'] }] });
    await h.wait(300);
    check('two machines: both named', (await p.textContent('#git-total')) === 'no push access on CLOUD, DESK', await p.textContent('#git-total'));
    await p.click('#git-total');
    await h.wait(200);
    const pc = (await hint()).find((x) => x.startsWith('DESK')) || '';
    check('a PC: sign in once with git there', pc.includes('Sign in to github.com once with git on DESK'), pc);
    await p.click('#git-back');

    await h.push({ type: 'setup_status', machine: 'cloud', relay: 'remote', container: true, engines });
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines });
    await h.wait(300);
    check('credentials set: row gone', await p.$eval('#git-total', (n) => n.hidden));

    // Cloning onto a machine without push access: the editor says so under the folder
    await p.evaluate(() => openEditor(bot('skool')));
    await h.wait(150);
    await p.fill('#editor-folder', 'https://git.example.com/team/web.git');
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    check('cloned: folder filled in, hint about push, editor still open', (await p.inputValue('#editor-folder')) === '/work/web' && await p.isVisible('#editor')
        && (await p.textContent('#editor-folder-hint')).includes('CLOUD has no credentials yet to push to git.example.com'), await p.textContent('#editor-folder-hint'));
    check('… not saved before the user read it', !h.sent.some((f) => f.type === 'bot_save'));
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    check('saving again saves with the cloned folder', h.sent.some((f) => f.type === 'bot_save' && f.bot.folder === '/work/web'));
}
