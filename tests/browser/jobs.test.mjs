// Jobs a chat gave other bots (message_bot): a bar above the input says whom it waits for since when, a tap opens that
// chat, and "Stop waiting" or "Cancel job" go to the machine that keeps the job. Other chats show nothing.
import { bot } from './harness.mjs';

const JOB = (id, extra = {}) => ({
    id, from: { id, machine: 'desk', botId: 'lena', chatId: 'lena', chain: ['lena'], chats: ['lena'] },
    to: { machine: 'cloud', botId: 'tom', chatId: 'tom' }, text: 'Add the index', ts: new Date().toISOString(), state: 'running', ...extra,
});

export default async function ({ start, check }) {
    const h = await start({ online: ['desk', 'cloud'], bots: [bot('lena', 'Lena'), bot('tom', 'Tom', { conversations: [{ id: 'aa11', title: 'Index', createdAt: '' }] })] });
    const p = h.page;
    const rows = () => p.$$eval('.pane:not([hidden]) [data-el=jobs] .job-text', (n) => n.map((x) => x.textContent));
    await h.openChat('Lena');
    check('no jobs: no bar', await p.$eval('.pane:not([hidden]) [data-el=jobs]', (n) => n.hidden));

    await h.push({ type: 'jobs', machine: 'desk', jobs: [JOB('j1'), JOB('j2', { state: 'queued', to: { machine: 'cloud', botId: 'tom', chatId: 'tom~aa11' } })] });
    await h.wait(100);
    const shown = await rows();
    check('a row per job: whom it waits for, the conversation by title, a queued one names the machine', shown.length === 2 && shown[0].startsWith('⏳ Waiting for Tom since')
        && shown[1].startsWith('⏳ Tom · Index gets the job once CLOUD is awake'), shown);

    await p.click('.pane:not([hidden]) .job[data-job=j1] .job-stop:not(.job-cancel)');
    await h.wait(100);
    const stop = h.sent.findLast((f) => f.type === 'job_stop');
    check('stop waiting: to the machine that keeps the job, without cancel', stop && stop.id === 'j1' && !stop.cancel && stop.machine === 'desk', stop);
    await p.click('.pane:not([hidden]) .job[data-job=j2] .job-cancel');
    await h.wait(100);
    check('cancel: with cancel', h.sent.findLast((f) => f.type === 'job_stop').cancel === true);

    await p.click('.pane:not([hidden]) .job[data-job=j1] .job-text');
    await h.wait(300);
    check('a tap on the row opens the target\'s chat', await p.evaluate(() => activePane().chatId) === 'tom');
    check('another chat shows no bar', (await rows()).length === 0);

    await h.push({ type: 'jobs', machine: 'desk', jobs: [] });
    await p.click('.back').catch(() => undefined);
    await h.openChat('Lena');
    check('done: the bar is gone', (await rows()).length === 0);
    check('no page errors', h.errors.length === 0, h.errors);
    await h.close();
}
