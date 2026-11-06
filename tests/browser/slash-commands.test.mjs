// Slash commands: "/" at the start of a message in a bot's chat asks the bot's machine for Claude Code's commands
// and offers them like the @ mentions. None in groups and for other engines; an older backend's error stays quiet.
import { bot } from './harness.mjs';

const COMMANDS = [
    { name: 'release', description: 'Raise the version and publish', argumentHint: '<version>' },
    { name: 'push', description: 'Commit and push a small change', argumentHint: '' },
    { name: 'compact', description: 'Free up context', argumentHint: '<instructions>' },
];

export default async function ({ start, check }) {
    let answer = true;
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('cloud', 'Cloud Carlo'), bot('cx', 'Codex Cora', { model: 'codex:gpt-5' })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
        onSend: async (f, push) => {
            if (f.type === 'commands' && answer) await push({ type: 'commands', machine: 'desk', botId: f.botId, commands: COMMANDS });
        },
    });
    const p = h.page;
    const requests = () => h.sent.filter((f) => f.type === 'commands');
    const rows = () => p.locator('[data-el=mention]:visible .match').allTextContents();
    const input = '[data-el=text]';

    // wide: the chat list stays next to the open chat
    await p.setViewportSize({ width: 1200, height: 860 });
    await h.openChat('Skool Sven');
    await p.type(input, '/');
    await h.wait(200);
    const asked = requests();
    check('"/" asks the bot\'s machine once', asked.length === 1 && asked[0].botId === 'skool' && asked[0].machine === 'desk', asked);
    let list = await rows();
    check('the answer opens the list with name, hint and description', list.length === 3 && list[0] === '/release <version>Raise the version and publish', list);
    check('the list is labelled as commands', (await p.getAttribute('[data-el=mention]', 'aria-label')) === 'Commands');

    await p.type(input, 'pu');
    await h.wait(100);
    list = await rows();
    check('typing filters', list.length === 1 && list[0].startsWith('/push'), list);
    await p.keyboard.press('Enter');
    check('Enter takes the command over, nothing is sent yet', (await p.inputValue(input)) === '/push ' && !h.sent.some((f) => f.type === 'send'), await p.inputValue(input));
    check('the list closes', (await rows()).length === 0);

    await p.fill(input, '');
    await p.type(input, '/');
    await h.wait(100);
    check('the list is kept: no second request', requests().length === 1 && (await rows()).length === 3, requests());
    await p.keyboard.press('Escape');
    check('Escape closes it', (await rows()).length === 0);

    await p.fill(input, '');
    await p.type(input, 'see /etc and @cl');
    await h.wait(100);
    list = await rows();
    check('"/" inside the text is no command; @ still mentions', list.length === 1 && list[0].includes('Cloud Carlo'), list);

    await p.fill(input, '');
    await h.openChat('Team');
    await p.type(input, '/');
    await h.wait(150);
    check('group: no request, no list', requests().length === 1 && (await rows()).length === 0, requests());

    await p.fill(input, '');
    await h.openChat('Codex Cora');
    await p.type(input, '/');
    await h.wait(150);
    check('other engine: no request, no list', requests().length === 1 && (await rows()).length === 0, requests());

    // an older backend does not know the frame: no list, no error in the chat
    answer = false;
    await p.fill(input, '');
    await h.openChat('Cloud Carlo');
    await p.type(input, '/');
    await h.wait(100);
    await h.push({ type: 'error', machine: 'desk', request: 'commands', message: 'Unknown request "commands"' });
    await h.wait(150);
    const shown = await p.locator('[data-el=messages]:visible').textContent();
    check('older backend: no list, no error shown', requests().length === 2 && (await rows()).length === 0 && !shown.includes('Unknown request'), shown);
    check('no page errors', h.errors.length === 0, h.errors);
}
