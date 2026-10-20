// Machine switch on the bot's page: active is the machine the bot lives on; a tap on another one opens the bot editor
// to move it there, with its repository in the repository field and the folder there derived from it. The new machine
// checks the folder before the bot is saved there and clones the repository into it if it is not there yet; a
// sleeping one is woken. Not in groups. The machine in the page's facts opens the editor too.
import { bot } from './harness.mjs';

const REMOTE = 'https://git.example.com/team/skool.git';

export default async function ({ start, check }) {
    let oldBackend = false;
    const cloned = new Set();
    const h = await start({
        online: ['desk', 'workstation'],
        bots: [bot('skool', 'Skool Sven', { machine: 'desk', model: 'opus', tone: 'brief' }), bot('cloud', 'Cloud Carlo', { machine: 'desk' })],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
        // The backends: the folder of a bot on DESK is a repository; on WORKSTATION a folder exists once it was cloned
        async onSend(f, push) {
            if (oldBackend && (f.type === 'folder_check' || f.type === 'folder_clone' || f.type === 'folder_propose')) {
                await push({ type: 'error', request: f.type, message: `Unknown request ${f.type}` });
                return;
            }
            if (f.type === 'folder_check') {
                const ok = f.machine === 'desk' ? f.folder === 'C:/www/skool' || f.folder === 'C:/www/cloud2' : cloned.has(f.folder);
                await push(ok ? { type: 'folder_checked', asked: f.folder, ok, folder: f.folder, remote: REMOTE } : { type: 'folder_checked', asked: f.folder, ok, message: `Folder does not exist: ${f.folder}` });
            }
            if (f.type === 'folder_propose') await push({ type: 'folder_proposed', url: f.url, ok: true, folder: '/work/skool' });
            if (f.type === 'folder_clone') {
                const folder = f.folder || '/work/skool';
                cloned.add(folder);
                await push({ type: 'folder_cloned', url: f.url, ok: true, folder });
            }
        },
    });
    const p = h.page;
    await h.push({ type: 'machine_status', configured: true, hosts: { desk: { active: true }, workstation: { active: true }, laptop: { active: false } } });
    const chips = () => p.locator('#info-switches .machine-switch .chip').allTextContents();
    const active = () => p.locator('#info-switches .machine-switch .chip.on').allTextContents();
    const chip = (name) => p.locator('#info-switches .machine-switch .chip', { hasText: name }).click();
    // the bot's page via the header; it stays open below the editor
    const page = async () => { if (await p.isHidden('#info')) { await p.click('[data-el=chat-title]'); await h.wait(150); } };
    const saves = () => h.sent.filter((f) => f.type === 'bot_save');
    const editorOpen = () => p.locator('#editor').isVisible();
    let dialog = null;
    p.on('dialog', (d) => { dialog = d.message(); return d.accept(); });

    await h.openChat('Skool Sven');
    await page();
    check('all machines, sleeping ones marked', (await chips()).join('|') === 'DESK|LAPTOP · asleep|WORKSTATION', await chips());
    check('active: where it lives', (await active()).join() === 'DESK', await active());
    await chip('DESK');
    await h.wait(100);
    check('a tap on its own machine: nothing opens, nothing sent, the page stays', !(await editorOpen()) && saves().length === 0 && await p.isVisible('#info'));

    // Another machine: the editor opens on it; the repository goes into its field, the folder there is derived from it
    await chip('WORKSTATION');
    await h.wait(200);
    check('editor open with WORKSTATION chosen', (await editorOpen()) && (await p.inputValue('#editor-machine')) === 'workstation');
    const small = await p.evaluate(() => ({
        name: document.querySelector('#editor-name').offsetParent !== null, model: document.querySelector('#editor-model').offsetParent !== null,
        folder: document.querySelector('#editor-folder').offsetParent !== null, repo: document.querySelector('#editor-repo').offsetParent !== null,
        title: document.querySelector('#editor-title').textContent, button: document.querySelector('#editor-form button[type=submit]').textContent,
        page: document.querySelector('#editor').classList.contains('page'),
    }));
    check('a small dialog: folder and repository only, titled and labelled for the move', !small.name && !small.model && small.folder && small.repo
        && small.title === 'Move Skool Sven to WORKSTATION' && small.button === 'Move' && !small.page, small);
    const asked = h.sent.find((f) => f.type === 'folder_check');
    check('the repository is asked from the machine the bot lives on', asked && asked.machine === 'desk' && asked.folder === 'C:/www/skool', asked);
    check('the repository is in its field', (await p.inputValue('#editor-repo')) === REMOTE, await p.inputValue('#editor-repo'));
    const proposed = h.sent.find((f) => f.type === 'folder_propose');
    check('the new machine is asked where it goes', proposed && proposed.machine === 'workstation' && proposed.url === REMOTE, proposed);
    check('the folder there filled in, the hint says it is cloned on saving', (await p.inputValue('#editor-folder')) === '/work/skool'
        && (await p.textContent('#editor-folder-hint')).includes('WORKSTATION into /work/skool'), await p.textContent('#editor-folder-hint'));

    // The old folder without a repository on the new machine: WORKSTATION refuses it, the editor stays open
    await p.fill('#editor-repo', '');
    await p.fill('#editor-folder', 'C:/www/skool');
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    const refused = h.sent.findLast((f) => f.type === 'folder_check');
    check('the new machine checks the folder', refused.machine === 'workstation' && refused.folder === 'C:/www/skool', refused);
    check('refused: error shown, editor open, nothing saved', (await editorOpen()) && (await p.textContent('#editor-error')).includes('does not exist') && saves().length === 0);

    // Neither field: said so
    await p.fill('#editor-folder', '');
    await p.click('#editor-form button[type=submit]');
    await h.wait(100);
    check('neither folder nor repository: said so', (await p.textContent('#editor-error')).includes('folder or a repository') && saves().length === 0);

    // Folder and repository: the folder is not there yet, so the repository is cloned into it, then saved
    await p.fill('#editor-folder', '/work/skool');
    await p.fill('#editor-repo', REMOTE);
    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    const clone = h.sent.find((f) => f.type === 'folder_clone');
    check('clone on the new machine into the folder', clone && clone.machine === 'workstation' && clone.url === REMOTE && clone.folder === '/work/skool', clone);
    const checked = h.sent.findLast((f) => f.type === 'folder_check');
    check('then the cloned folder is checked there', checked.machine === 'workstation' && checked.folder === '/work/skool', checked);
    const f = saves()[0];
    check('saved on the new machine with its folder there', f && f.machine === 'workstation' && f.bot.machine === 'workstation' && f.bot.folder === '/work/skool', f);
    check('other fields unchanged, no machineOnly', f && f.bot.id === 'skool' && f.bot.model === 'opus' && f.bot.tone === 'brief' && !('machineOnly' in f.bot), f);
    check('editor closed', !(await editorOpen()));

    // Sleeping machine: woken, and nothing can be saved there until it is awake
    await page();
    await chip('LAPTOP');
    await h.wait(200);
    const wake = h.sent.find((x) => x.type === 'wake');
    check('LAPTOP is woken', wake && wake.host === 'laptop', wake);
    check('the editor says LAPTOP is asleep', (await p.textContent('#editor-error')).includes('LAPTOP is asleep'));
    const before = saves().length;
    await p.click('#editor-form button[type=submit]');
    await h.wait(150);
    check('asleep: not saved', saves().length === before && (await editorOpen()));
    await p.click('#editor [data-close]');
    await h.wait(150);

    // Renaming while the bot's machine sleeps: machine and folder stay, any machine awake takes it
    await h.push({ type: 'agents', online: ['workstation'] });
    await h.wait(100);
    await p.evaluate(() => openEditor(bot('cloud')));
    await h.wait(150);
    await p.fill('#editor-name', 'Cloud Clara');
    await p.click('#editor-form button[type=submit]');
    await h.wait(150);
    const renamed = saves().pop();
    check('rename on a sleeping machine: saved without a check', renamed && renamed.bot.name === 'Cloud Clara' && renamed.bot.machine === 'desk' && renamed.machine === undefined, renamed);
    await h.push({ type: 'agents', online: ['desk', 'workstation'] });
    await h.wait(100);

    // A backend before 0.2 knows no folder_check: the bot is saved, that backend checks the folder itself
    oldBackend = true;
    await p.evaluate(() => openEditor(bot('cloud')));
    await h.wait(150);
    await p.fill('#editor-folder', 'C:/www/cloud2');
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    const legacy = saves().pop();
    check('old backend: saved anyway', legacy && legacy.bot.folder === 'C:/www/cloud2' && legacy.machine === 'desk' && !(await editorOpen()), legacy);
    oldBackend = false;

    // A repository typed into the folder field moves to its own field
    await p.evaluate(() => openEditor(bot('cloud')));
    await h.wait(150);
    await p.fill('#editor-folder', 'git@git.example.com:team/cloud.git');
    await h.wait(100);
    check('an address in the folder field moves to the repository field', (await p.inputValue('#editor-repo')) === 'git@git.example.com:team/cloud.git'
        && (await p.inputValue('#editor-folder')) === '/work/skool', [await p.inputValue('#editor-folder'), await p.inputValue('#editor-repo')]);
    await p.click('#editor [data-close]');
    await h.wait(150);

    // The machine in the page's facts opens the editor at its machine field
    await page();
    await p.click('#info .info-machine');
    await h.wait(150);
    check('the machine in the facts opens the editor there', (await editorOpen()) && (await p.evaluate(() => document.activeElement?.id)) === 'editor-machine');
    await p.click('#editor [data-close]');
    await h.wait(150);

    // a working bot does not move
    await p.evaluate(() => { state.states.skool = 'thinking'; });
    dialog = null;
    await page();
    await chip('WORKSTATION');
    await h.wait(150);
    check('working: a hint instead of moving', dialog && dialog.includes('working right now') && !(await editorOpen()), dialog);
    await p.evaluate(() => { state.states.skool = 'idle'; });

    await p.click('#info [data-page-back]');
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Team');
    await p.click('[data-el=chat-title]');
    await h.wait(150);
    check('no machine switch in groups', (await p.isVisible('#group-editor')) && (await p.locator('#group-editor .machine-switch').count()) === 0);
}
