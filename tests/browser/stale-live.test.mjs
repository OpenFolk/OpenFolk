// A running answer whose `done` got lost while the connection was down (phone in the background): the next
// history drops it when its backend no longer reports it, instead of drawing it under the finished answer again.
// In a group, a backend only speaks for its own bots.
import { bot } from './harness.mjs';

const ts = '2026-10-29T19:24:00Z';
const tool = { id: 't1', name: 'PowerShell', summary: 'Copies the variables', ts };

export default async function ({ start, check }) {
    const asked = [{ id: 'u1', role: 'user', from: 'me', text: 'Go on', ts: '2026-10-29T19:23:41Z', readAt: '2026-10-29T19:23:42Z' }];
    const h = await start({
        bots: [bot('mail', 'Marie', { machine: 'desk' }), bot('cloud', 'Carlo', { machine: 'laptop' })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['mail', 'cloud'], createdAt: '', updatedAt: '' }],
        history: { mail: asked },
    });
    const p = h.page;
    const live = () => p.evaluate(() => document.querySelectorAll('[data-el=messages] .answer.live').length);
    const final = { id: 'a1', role: 'assistant', botId: 'mail', text: 'Azure runs live', ts: '2026-10-29T19:30:16Z' };

    await h.openChat('Marie');
    await h.push({ type: 'delta', chatId: 'mail', botId: 'mail', text: 'Copying the variables' });
    await h.push({ type: 'tool', chatId: 'mail', botId: 'mail', tool });
    await h.wait(300);
    check('the running answer shows', (await live()) === 1);

    // reconnected: `done` never arrived, the history holds the final answer and nothing runs
    await h.push({ type: 'history', machine: 'desk', chatId: 'mail', entries: [...asked, final], live: [] });
    await h.wait(300);
    check('after the history no running answer is left', (await live()) === 0, await live());
    check('the final answer is there', (await p.locator('[data-el=messages] .bubble').last().textContent()).includes('Azure runs live'));

    // still running on the backend: the history keeps it
    await h.push({ type: 'delta', chatId: 'mail', botId: 'mail', text: 'Next step' });
    await h.push({ type: 'history', machine: 'desk', chatId: 'mail', entries: [...asked, final], live: [{ botId: 'mail', text: 'Next step', tools: [] }] });
    await h.wait(300);
    check('an answer the backend still reports stays', (await live()) === 1);

    // a group: the history of desk drops Marie's lost answer, not Carlo's on laptop
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Team');
    await h.push({ type: 'delta', chatId: 'g:team', botId: 'mail', text: 'Marie works' });
    await h.push({ type: 'delta', chatId: 'g:team', botId: 'cloud', text: 'Carlo works' });
    await h.wait(300);
    await h.push({ type: 'history', machine: 'desk', chatId: 'g:team', entries: [], live: [] });
    await h.wait(300);
    const left = await p.locator('[data-el=messages] .answer.live .content').allTextContents();
    check('group: only the answering machine\'s bot is dropped', left.map((s) => s.trim()).join('|') === 'Carlo works', left);
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
