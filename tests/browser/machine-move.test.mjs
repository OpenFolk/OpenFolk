// Moving a bot that has a place (Bot.place): a tap on another machine moves it there without a question. That machine
// clones or creates what is missing and saves the bot there; no folder or repository field. The work not on the git
// server comes along by itself, asked from the previous machine once the new one took the bot. A refused place or a
// backend before bot_move falls back to the small move dialog; a sleeping machine is woken and the move goes on once
// it is awake.
import { bot, onDialog } from './harness.mjs';

const REMOTE = 'https://git.example.com/team/skool.git';
const PLACE = { path: 'apps/skool', repo: REMOTE };
const UNPUSHED = { name: 'skool', path: '', branch: 'main', ahead: 1, behind: 0, files: [], more: 0 };

export default async function ({ start, check }) {
    /** What the machines answer to bot_move: a result per machine, or a refusal, or an unknown frame. */
    const answers = {
        workstation: { ok: true, folder: 'D:/OpenFolk/apps/skool', action: 'clone' },
        laptop: { ok: true, folder: 'C:/Users/me/OpenFolk/apps/skool', action: 'use' },
    };
    const h = await start({
        online: ['desk', 'workstation'],
        bots: [bot('skool', 'Skool Sven', { machine: 'desk', place: PLACE })],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder, remote: REMOTE });
            if (f.type !== 'bot_move') return;
            const a = answers[f.machine];
            if (a === 'unknown') await push({ type: 'error', request: 'bot_move', message: 'unknown frame type' });
            else await push({ type: 'bot_moved', botId: f.botId, ...a });
        },
    });
    const p = h.page;
    await h.push({ type: 'machine_status', configured: true, hosts: { desk: { active: true }, workstation: { active: true }, laptop: { active: false } } });
    const chip = (name) => p.locator('#info-switches .machine-switch .chip', { hasText: name }).click();
    const page = async () => { if (await p.isHidden('#info')) { await p.click('[data-el=chat-title]'); await h.wait(150); } };
    const moves = () => h.sent.filter((f) => f.type === 'bot_move');
    const editorOpen = () => p.locator('#editor').isVisible();
    const dialogs = [];
    await onDialog(p, (d) => { dialogs.push(d.message()); return d.accept(); });

    await h.openChat('Skool Sven');
    await page();

    // A tap moves the bot: one request to the new machine, no question, nothing saved by the app
    await chip('WORKSTATION');
    await h.wait(200);
    const done = moves();
    check('one move to the new machine, no dry run', done.length === 1 && done[0].machine === 'workstation' && done[0].botId === 'skool' && !('dryRun' in done[0]), done);
    check('no question, no fields, no bot_save, no work asked for', dialogs.length === 0 && !(await editorOpen()) && !h.sent.some((f) => f.type === 'bot_save' || f.type === 'work_take'));
    check('it says where the bot went', (await p.textContent('#toast')).includes('Skool Sven moved to WORKSTATION (D:/OpenFolk/apps/skool)'), await p.textContent('#toast'));

    // Work not on the git server comes along: only after the move is the previous machine told to send it
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [UNPUSHED] } });
    await h.wait(100);
    answers.workstation = { ok: true, folder: 'D:/OpenFolk/apps/skool', action: 'use' };
    await page();
    await chip('WORKSTATION');
    await h.wait(250);
    const work = h.sent.find((f) => f.type === 'work_take');
    check('the previous machine sends the work after the move, unasked', dialogs.length === 0 && work && work.machine === 'desk' && work.botId === 'skool' && work.folder === 'C:/www/skool'
        && h.sent.indexOf(work) > h.sent.indexOf(moves().pop()), work);
    check('it says the work comes along', (await p.textContent('#toast')).includes('comes along from DESK (skool)'), await p.textContent('#toast'));
    await h.push({ type: 'git_status', machine: 'desk', status: {} });

    // Refused there (a folder with other content): the small dialog, the error and the repository from the place
    answers.workstation = { ok: false, message: 'D:/OpenFolk/apps/skool already exists and is not a clone of this repository.' };
    const before = moves().length;
    await page();
    await chip('WORKSTATION');
    await h.wait(250);
    check('refused: one request, no second move', moves().length === before + 1);
    check('refused: the dialog with the reason', (await editorOpen()) && (await p.textContent('#editor-error')).includes('already exists'), await p.textContent('#editor-error'));
    check('refused: the repository from the place is in its field', (await p.inputValue('#editor-repo')) === REMOTE, await p.inputValue('#editor-repo'));
    await p.click('#editor [data-close]');
    await h.wait(150);

    // A backend before bot_move: the dialog as before
    answers.workstation = 'unknown';
    await page();
    await chip('WORKSTATION');
    await h.wait(250);
    check('old backend: the dialog with folder and repository', (await editorOpen()) && (await p.inputValue('#editor-machine')) === 'workstation'
        && (await p.isHidden('#editor-error')));
    await p.click('#editor [data-close]');
    await h.wait(150);

    // Asleep: woken without a question, and the move goes on as soon as the machine is there
    await page();
    await chip('LAPTOP');
    await h.wait(200);
    const wake = h.sent.find((f) => f.type === 'wake');
    check('LAPTOP is woken, nothing asked', wake && wake.host === 'laptop' && !moves().some((f) => f.machine === 'laptop') && !(await editorOpen()) && dialogs.length === 0, wake);
    check('it says the move waits', (await p.textContent('#toast')).includes('Waking LAPTOP'), await p.textContent('#toast'));
    await h.push({ type: 'agents', online: ['desk', 'workstation', 'laptop'] });
    await h.wait(250);
    const woke = moves().filter((f) => f.machine === 'laptop');
    check('awake: moved with one request', woke.length === 1 && !('dryRun' in woke[0]), woke);
    check('it says where the bot went there', (await p.textContent('#toast')).includes('moved to LAPTOP (C:/Users/me/OpenFolk/apps/skool)'), await p.textContent('#toast'));

    // Without a place (a folder outside the allowed folders): the dialog right away
    await p.evaluate(() => { delete state.bots.find((b) => b.id === 'skool').place; });
    const count = moves().length;
    await page();
    await chip('WORKSTATION');
    await h.wait(200);
    check('no place: the dialog, nothing asked', (await editorOpen()) && moves().length === count);
    check('no question in the whole run', dialogs.length === 0, dialogs);
}
