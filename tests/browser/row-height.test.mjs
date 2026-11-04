// Overview: a bot's row keeps the same height with the git badge, the conversations button, or a mute mark.
import { bot } from './harness.mjs';

const REPO = { name: 'repo', path: '', branch: 'main', ahead: 0, behind: 0, files: [{ status: ' M', path: 'a.ts' }], more: 0 };

export default async function ({ start, check }) {
    const h = await start({
        bots: [
            bot('plain', 'Plain'),
            bot('full', 'Full', { conversations: [{ id: 'cc11', title: 'On the side', createdAt: '' }] }),
            bot('convs', 'Convs', { conversations: [{ id: 'dd11', title: 'Another', createdAt: '' }] }),
        ],
        history: Object.fromEntries(['plain', 'full', 'convs'].map((id) => [id, [{ id: id + '1', role: 'assistant', botId: id, text: 'Hi', ts: '2026-10-07T10:00:00Z' }]])),
    });
    const p = h.page;
    await h.push({ type: 'git_status', machine: 'desk', status: { full: [REPO] } });
    await h.wait(150);
    const heights = () => p.$$eval('#chat-list li[data-chat]:not(.sub)', (rows) => Object.fromEntries(rows.map((r) => [r.dataset.chat, Math.round(r.getBoundingClientRect().height)])));
    const hs = await heights();
    check('git badge and conversations shown', await p.$$eval('#chat-list li[data-chat="full"] .git-badge, #chat-list li[data-chat="full"] .collapse', (n) => n.length) === 2);
    check('row with git badge and conversations as high as a plain one', hs.full === hs.plain, hs);
    check('row with conversations as high as a plain one', hs.convs === hs.plain, hs);
}
