// Background agents visible: header, status line (without stop) and chat list, as long as a task runs.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('empty', 'Landing Lena'), bot('cloud', 'Cloud Carlo')] });
    const p = h.page;
    const task = [{ id: 't1', description: 'Cloud agent sets up deploy' }];
    const preview = (name) => p.locator('#chat-list li', { hasText: name }).locator('.last').textContent();
    await h.push({ type: 'background', machine: 'desk', botId: 'empty', tasks: task });
    await h.wait(150);
    check('chat list shows the task as preview', (await preview('Landing Lena')) === 'In the background: Cloud agent sets up deploy', await preview('Landing Lena'));
    check('bot is under "Running now"', (await p.locator('#chat-list li').first().textContent()) === 'Running now');
    await h.openChat('Landing Lena');
    check('chat header shows the task', (await p.locator('[data-el=chat-sub]').textContent()) === 'In the background: Cloud agent sets up deploy');
    const line = () => p.evaluate(() => { const a = document.querySelector('[data-el=working]'); return a.hidden ? '' : document.querySelector('[data-el=working-text]').textContent + (document.querySelector('[data-el=btn-stop]').hidden ? '' : ' [Stop]'); });
    check('status line calm, without stop', (await line()) === 'In the background: Cloud agent sets up deploy', await line());
    // the foreground takes precedence
    await h.push({ type: 'state', machine: 'desk', botId: 'empty', state: 'thinking', chatId: 'empty', activity: 'Bash: git status' });
    await h.wait(150);
    check('if the bot works in the foreground, the header shows that', (await p.locator('[data-el=chat-sub]').textContent()) === 'Bash: git status');
    await h.push({ type: 'state', machine: 'desk', botId: 'empty', state: 'idle' });
    await h.push({ type: 'background', machine: 'desk', botId: 'empty', tasks: [...task, { id: 't2', description: 'Tests running' }] });
    await h.wait(150);
    check('several tasks', (await line()) === 'In the background: 2 tasks, Cloud agent sets up deploy', await line());
    await h.push({ type: 'background', machine: 'desk', botId: 'empty', tasks: [] });
    await h.wait(150);
    check('done: line and hint gone', (await line()) === '' && !(await p.locator('[data-el=chat-sub]').textContent()).includes('background'));
    await p.click('[data-el=btn-back]');
    await h.wait(200);
    check('chat list normal again', !(await preview('Landing Lena')).includes('background'));
}
