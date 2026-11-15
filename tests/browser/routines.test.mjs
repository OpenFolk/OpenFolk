// Routines on the bot's page: a row each with when in words, next run and a switch active/paused; opened, the
// instruction, run now, edit, edit in chat and the last runs with status, reason and a jump to the chat. In German too.
import { bot } from './harness.mjs';

const day = (offset, hour, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
};
const routine = (id, name, cron, extra = {}) => ({ id, botId: 'anna', name, cron, prompt: `Instruction of ${name}.`, enabled: true, updatedAt: day(-5, 9), ...extra });

const ROUTINES = [
    routine('r1', 'Report', '0 8 * * 1-5', {
        prompt: 'Summarize the inbox.\nOnly what matters.', nextRun: day(1, 8), lastRun: day(-1, 8), lastStatus: 'ok',
        runs: [
            { start: day(-1, 8), end: new Date(new Date(day(-1, 8)).getTime() + 45_000).toISOString(), status: 'ok', entryId: 'e-answer' },
            { start: day(-2, 8), end: day(-2, 8, 1), status: 'error', error: 'The machine OFFICE is asleep.', entryId: 'e-prompt' },
            { start: day(-3, 8), status: 'running' },
        ],
    }),
    routine('r2', 'Backup', '0 */2 * * *', { enabled: false, wake: true }),
    routine('r3', 'Half past', '30 * * * *'),
    routine('r4', 'Office hours', '*/15 9-17 * * 1-5'),
    routine('r5', 'Rent', '0 9 1 * *'),
    routine('r6', 'Weekend', '0 10 * * 6,0'),
    routine('r7', 'Gym', '0 7 * * 1,3,5'),
    routine('r8', 'Odd', '5 4 1-3 */2 *'),
    routine('r9', 'Other bot', '0 8 * * *', { botId: 'bert' }),
];

async function open(h) {
    await h.page.evaluate(() => openInfo('anna'));
    await h.wait(300);
}

const rows = (p) => p.evaluate(() => [...document.querySelectorAll('#info-routines li.routine')].map((l) => l.querySelector('.r-text').textContent));

export default async function ({ start, check }) {
    let routines = structuredClone(ROUTINES);
    const h = await start({
        bots: [bot('anna', 'Anna'), bot('bert', 'Bert')],
        history: {
            anna: [
                { id: 'e-prompt', role: 'user', from: 'routine:Report', text: 'Summarize the inbox.', ts: day(-1, 8) },
                { id: 'e-answer', role: 'assistant', botId: 'anna', text: 'All quiet in the inbox.', ts: day(-1, 8, 1) },
            ],
        },
        onSend: async (f, push) => {
            if (f.type === 'bot_info') await push({ type: 'bot_info', machine: 'desk', botId: f.botId, info: { skills: [], claudeMd: '', knowledge: [], routines: [], messages: 2 } });
            if (f.type === 'routines') await push({ type: 'routines', machine: 'desk', routines });
            if (f.type === 'routine_save') {
                routines = routines.map((r) => (r.id === f.routine.id ? { ...r, ...f.routine } : r));
                await push({ type: 'routines', machine: 'desk', routines });
            }
        },
    });
    const p = h.page;

    await open(h);
    check('the page asks for the list with the next runs as of now', h.sent.some((f) => f.type === 'routines'));
    const list = await rows(p);
    check('a row per routine of this bot only', list.length === 8 && !list.some((r) => r.includes('Other bot')), list);
    const tomorrow = new Date(day(1, 8)).toLocaleString('en-US', { weekday: 'short' });
    check('when in words, next run and last run', list[0].startsWith('Report') && list[0].includes('weekdays 8:00 · next ') && list[0].includes(tomorrow) && list[0].includes('last '), list[0]);
    check('a paused one says so instead of a next run', list[1].includes('every 2 hours · paused') && !list[1].includes('next'), list[1]);
    check('hourly at a minute', list[2].includes('hourly at :30'), list[2]);
    check('every 15 minutes on weekdays within hours', list[3].includes('weekdays, every 15 minutes between 9:00 and 17:00'), list[3]);
    check('monthly', list[4].includes('monthly on day 1, 9:00'), list[4]);
    check('weekends', list[5].includes('weekends 10:00'), list[5]);
    check('a list of weekdays', list[6].includes('Mon, Wed, Fri 7:00'), list[6]);
    check('anything else stays the cron expression', list[7].includes('5 4 1-3 */2 *'), list[7]);
    const switches = await p.$$eval('#info-routines input.switch', (k) => k.map((x) => `${x.checked}:${x.getAttribute('role')}`));
    check('a switch per row, on for active, off for paused', switches[0] === 'true:switch' && switches[1] === 'false:switch', switches);
    check('closed rows show no details', (await p.locator('#info-routines .r-body').count()) === 0);

    // the switch resumes the paused one: the whole routine goes out with enabled
    await p.locator('#info-routines li.routine', { hasText: 'Backup' }).locator('input.switch').click();
    await h.wait(200);
    const resumed = h.sent.findLast((f) => f.type === 'routine_save');
    check('resuming sends the routine with enabled, the rest unchanged', resumed && resumed.routine.id === 'r2' && resumed.routine.enabled === true && resumed.routine.cron === '0 */2 * * *'
        && resumed.routine.prompt === 'Instruction of Backup.' && resumed.routine.wake === true && resumed.routine.botId === 'anna', resumed);
    check('the row shows it active after the answer', (await p.locator('#info-routines li.routine', { hasText: 'Backup' }).getAttribute('class')).includes('off') === false);
    await p.locator('#info-routines li.routine', { hasText: 'Backup' }).locator('input.switch').click();
    await h.wait(200);
    check('and pauses it again', h.sent.findLast((f) => f.type === 'routine_save').routine.enabled === false);

    // opened: instruction, actions, last runs
    await p.locator('#info-routines li.routine', { hasText: 'Report' }).locator('.r-text').click();
    await h.wait(100);
    const body = p.locator('#info-routines li.routine.open .r-body');
    check('opened: the instruction as written', (await body.locator('.r-prompt').textContent()) === 'Summarize the inbox.\nOnly what matters.');
    const runs = await body.locator('.r-run').evaluateAll((k) => k.map((x) => ({
        status: x.querySelector('.r-status').textContent, took: x.querySelector('.r-took').textContent,
        error: x.querySelector('.r-error')?.textContent ?? '', jump: !!x.querySelector('button'),
    })));
    check('runs newest first with status and duration', runs.length === 3 && runs[0].status === 'ok' && runs[0].took === '45.0 s' && runs[1].status === 'error' && runs[2].status === 'running' && runs[2].took === '', runs);
    check('the reason of a failed run', runs[1].error === 'The machine OFFICE is asleep.', runs[1]);
    check('a jump where the run names an entry', runs[0].jump && runs[1].jump && !runs[2].jump, runs);
    await body.locator('button[data-action=run]').click();
    await h.wait(100);
    check('run now', h.sent.findLast((f) => f.type === 'routine_run')?.id === 'r1');
    await p.locator('#info-routines li.routine', { hasText: 'Half past' }).locator('.r-text').click();
    await h.wait(100);
    check('a routine without runs says so', (await p.locator('#info-routines li.routine', { hasText: 'Half past' }).locator('.r-body .hint').textContent()) === 'No runs yet.');
    await h.push({ type: 'routines', machine: 'desk', routines });
    await h.wait(100);
    check('opened rows stay open when the list comes again', (await p.locator('#info-routines li.routine.open').count()) === 2);
    // the jump to the answer: the page gives way to the chat, which loads far enough back
    await body.locator('.r-run').first().locator('button').click();
    await h.wait(400);
    const history = h.sent.findLast((f) => f.type === 'history');
    check('jump: the bot\'s chat opens with the history to the answer', !(await p.isVisible('#info')) && (await p.evaluate(() => window.activePane().chatId)) === 'anna'
        && history?.chatId === 'anna' && history.limit === 5000, history);

    // edit in chat: the composer of the bot's chat gets the start of the request
    await open(h);
    await p.locator('#info-routines li.routine.open', { hasText: 'Report' }).locator('button[data-action=chat]').click();
    await h.wait(300);
    const composer = () => p.evaluate(() => window.activePane().el.text.value);
    check('edit in chat: the chat with the request started in the composer', !(await p.isVisible('#info')) && (await composer()) === 'Change the routine “Report”: ', await composer());
    // a draft stays, the request follows on a line of its own
    await p.evaluate(() => { window.activePane().el.text.value = 'A draft'; });
    await open(h);
    await p.locator('#info-routines li.routine.open', { hasText: 'Report' }).locator('button[data-action=chat]').click();
    await h.wait(300);
    check('a draft stays in front', (await composer()) === 'A draft\nChange the routine “Report”: ', await composer());

    // edit opens the editor
    await open(h);
    await p.locator('#info-routines li.routine.open', { hasText: 'Report' }).locator('button[data-action=edit]').click();
    await h.wait(100);
    check('edit opens the routine editor', await p.isVisible('#routine-editor') && (await p.inputValue('#routine-name')) === 'Report');

    // German
    const de = await start({
        language: 'de', locale: 'de-DE',
        bots: [bot('anna', 'Anna')],
        onSend: async (f, push) => {
            if (f.type === 'routines') await push({ type: 'routines', machine: 'desk', routines: ROUTINES });
        },
    });
    await open(de);
    const deRows = await rows(de.page);
    check('German: when in words, next run, paused', deRows[0].includes('werktags 8:00 · nächster Lauf') && deRows[1].includes('alle 2 Stunden · pausiert')
        && deRows[3].includes('werktags, alle 15 Minuten von 9 bis 17 Uhr') && deRows[4].includes('monatlich am 1., 9:00') && deRows[5].includes('am Wochenende 10:00')
        && deRows[6].includes('Mo, Mi, Fr 7:00'), deRows);
    await de.page.locator('#info-routines li.routine', { hasText: 'Report' }).locator('.r-text').click();
    await de.wait(100);
    const deStatus = await de.page.locator('#info-routines .r-run .r-status').allTextContents();
    check('German: status words and actions', deStatus.join() === 'ok,Fehler,läuft' && (await de.page.locator('#info-routines button[data-action=chat]').textContent()) === 'Im Chat ändern', deStatus);
    await de.page.locator('#info-routines button[data-action=chat]').click();
    await de.wait(300);
    check('German: the request in the composer', (await de.page.evaluate(() => window.activePane().el.text.value)) === 'Ändere die Routine „Report“: ');
}
