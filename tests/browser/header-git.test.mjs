// The open changes of a bot's repos in the chat's header: shown with their count as in the list, a tap opens them;
// gone once the repos are clean, never in a group's header.
import { bot } from './harness.mjs';

const DIRTY = { name: 'skool', path: '', branch: 'main', ahead: 1, behind: 0, files: [{ path: 'a.ts', status: 'M' }], more: 0 };
const LIB = { name: 'lib', path: 'lib', branch: 'main', ahead: 0, behind: 2, files: [], more: 0 };

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven', { machine: 'desk' }), bot('cloud', 'Cloud Carlo', { machine: 'desk' })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
        onSend: async (f, push) => {
            if (f.type === 'git_changes') await push({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: [DIRTY, LIB] });
        },
    });
    const p = h.page;
    const badge = () => p.evaluate(() => {
        const b = document.querySelector('.pane:not([hidden]) [data-el=chat-git]');
        return b && !b.hidden ? `${b.textContent}|${b.title}` : '';
    });

    await h.openChat('Skool Sven');
    check('clean repos: no badge in the header', (await badge()) === '');
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [DIRTY, LIB] } });
    await h.wait(150);
    check('open changes: the badge with their count in the header', (await badge()).startsWith('2|'), await badge());
    await p.click('.pane:not([hidden]) [data-el=chat-git]');
    await h.wait(200);
    check('a tap opens the bot\'s open changes', await p.isVisible('#git-page') && (await p.textContent('#git-sub')) === 'Skool Sven' && h.sent.some((f) => f.type === 'git_changes' && f.botId === 'skool'));
    await p.evaluate(() => closeGitPage());
    await h.wait(100);

    // back from the page the chat is there again (the phone's list is behind it): open the others directly
    check('back from the page: the chat again', (await p.evaluate(() => activePane().chatId)) === 'skool');
    await p.evaluate(() => openChat('g:team'));
    await h.wait(200);
    check('a group\'s header: no badge', (await badge()) === '');
    await p.evaluate(() => openChat('skool'));
    await h.wait(200);
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [] } });
    await h.wait(150);
    check('clean again: the badge goes', (await badge()) === '');
    check('no page errors', h.errors.length === 0, h.errors);
}
