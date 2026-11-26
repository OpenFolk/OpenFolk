// Background agents visible: header, status line (without stop) and chat list, as long as a task runs; the list's
// dot pulses meanwhile, and a long shell command shows short.
import { bot, onDialog } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('empty', 'Landing Lena'), bot('cloud', 'Cloud Carlo')] });
    const p = h.page;
    const task = [{ id: 't1', description: 'Cloud agent sets up deploy' }];
    const preview = (name) => p.locator('#chat-list li', { hasText: name }).locator('.last').textContent();
    await h.push({ type: 'background', machine: 'desk', botId: 'empty', tasks: task });
    await h.wait(150);
    check('chat list shows the task as preview', (await preview('Landing Lena')) === 'Still running: Cloud agent sets up deploy', await preview('Landing Lena'));
    const dot = (name) => p.locator('#chat-list li', { hasText: name }).locator('.dot').getAttribute('class');
    check('the dot pulses while the task runs', (await dot('Landing Lena')).includes('thinking'), await dot('Landing Lena'));
    await h.push({ type: 'background', machine: 'desk', botId: 'cloud', tasks: [{ id: 'c1', description: 'cd /c/www/apps/openfolk && node tests/browser/run.mjs > /tmp/bt.log 2>&1; grep -v "^ok" /tmp/bt.log | tail -8' }] });
    await h.wait(150);
    check('a long command: its first real step, short', (await preview('Cloud Carlo')) === 'Still running: node tests/browser/run.mjs', await preview('Cloud Carlo'));
    await h.push({ type: 'background', machine: 'desk', botId: 'cloud', tasks: [] });
    await h.wait(150);
    check('done: the dot stops', !(await dot('Cloud Carlo')).includes('thinking'), await dot('Cloud Carlo'));
    check('bot is under "Running now"', (await p.locator('#chat-list li').first().textContent()) === 'Running now');
    await h.openChat('Landing Lena');
    check('chat header shows the task', (await p.locator('[data-el=chat-sub]').textContent()) === 'Still running: Cloud agent sets up deploy');
    const line = () => p.evaluate(() => { const a = document.querySelector('[data-el=working]'); return a.hidden ? '' : document.querySelector('[data-el=working-text]').textContent + (document.querySelector('[data-el=btn-stop]').hidden ? '' : ' [Stop]'); });
    check('status line calm, without the stop of a running job', (await line()) === 'Still running: Cloud agent sets up deploy', await line());
    // the foreground takes precedence
    await h.push({ type: 'state', machine: 'desk', botId: 'empty', state: 'thinking', chatId: 'empty', activity: 'Bash: git status' });
    await h.wait(150);
    check('if the bot works in the foreground, the header shows that', (await p.locator('[data-el=chat-sub]').textContent()) === 'Bash: git status');
    await h.push({ type: 'state', machine: 'desk', botId: 'empty', state: 'idle' });
    await h.push({ type: 'background', machine: 'desk', botId: 'empty', tasks: [...task, { id: 't2', description: 'Tests running' }] });
    await h.wait(150);
    // only background tasks: a stop of their own, asked first, to the machine that reported them
    check('a stop for the background tasks', await p.isVisible('[data-el=btn-stop-tasks]'));
    check('several tasks', (await line()) === 'Still running: 2 tasks, Cloud agent sets up deploy', await line());
    await onDialog(p, (d) => d.accept());
    await p.click('[data-el=btn-stop-tasks]');
    await h.wait(200);
    const stop = h.sent.findLast((f) => f.type === 'task_stop');
    check('stop: asked, then the ids of both tasks to their machine', stop?.chatId === 'empty' && stop.taskIds.join() === 't1,t2' && stop.machine === 'desk', stop);
    await h.push({ type: 'background', machine: 'desk', botId: 'empty', tasks: [] });
    await h.wait(150);
    check('done: line and hint gone', (await line()) === '' && !(await p.locator('[data-el=chat-sub]').textContent()).includes('Still running'));
    await p.click('[data-el=btn-back]');
    await h.wait(200);
    check('chat list normal again', !(await preview('Landing Lena')).includes('Still running'));
}
