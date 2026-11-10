// Deleting a bot with its working folder: the dialog asks the bot's machine first. A folder that may go gets a box to
// tick, and only then does the delete carry deleteFolder, sent to that machine alone; one that stays shows the box
// disabled with the reason. A sleeping machine is not asked, and a refusal at the last moment is shown.
const BOTS = [
    { id: 'notes', name: 'Notes', role: '', avatar: '', folder: '/work/Notes', model: 'default', approval: 'risky', tone: '', machine: 'desk' },
    { id: 'shop', name: 'Shop', role: '', avatar: '', folder: '/work/shop', model: 'default', approval: 'risky', tone: '', machine: 'desk' },
    { id: 'far', name: 'Far', role: '', avatar: '', folder: '/home/far', model: 'default', approval: 'risky', tone: '', machine: 'laptop' },
];

export default async function ({ start, check }) {
    let lastMinute = null;
    const h = await start({
        online: ['desk'],
        bots: BOTS,
        async onSend(f, push) {
            if (f.type === 'folder_delete_check') {
                await push(f.botId === 'notes' ? { type: 'folder_delete_checked', machine: 'desk', botId: 'notes', ok: true, folder: '/work/Notes' }
                    : { type: 'folder_delete_checked', machine: 'desk', botId: f.botId, ok: false, folder: '/work/shop', message: '/work/shop stays: Shop docs work in it.' });
            }
            if (f.type === 'bot_delete' && f.deleteFolder) {
                await push(lastMinute ? { type: 'error', machine: 'desk', request: 'bot_delete', message: lastMinute } : { type: 'folder_deleted', machine: 'desk', botId: f.botId, folder: '/work/Notes' });
            }
        },
    });
    const p = h.page;
    const deletes = () => h.sent.filter((f) => f.type === 'bot_delete');
    const box = () => p.evaluate(() => {
        const o = document.querySelector('.overlay.ask');
        const c = o && o.querySelector('.danger-option input');
        return o ? { box: c ? { disabled: c.disabled, checked: c.checked, label: c.parentElement.textContent } : null, notes: [...o.querySelectorAll('.danger-note')].map((n) => n.textContent) } : null;
    });
    const open = async (id) => {
        await p.evaluate((id) => { openInfo(id); }, id);
        await h.wait(200);
        await p.click('#info-actions button[data-action="delete"]');
        await h.wait(200);
    };
    const confirm = async (name) => {
        await p.fill('.overlay.ask input:not([type=checkbox])', name);
        await p.click('.overlay.ask button[type=submit]');
        await h.wait(200);
    };

    await open('notes');
    const free = await box();
    check('a folder that may go: a box, not ticked', free && free.box && !free.box.disabled && !free.box.checked && free.box.label.includes('/work/Notes'), free);
    check('the machine was asked', h.sent.some((f) => f.type === 'folder_delete_check' && f.botId === 'notes' && f.machine === 'desk'));
    await p.click('.overlay.ask .danger-option input');
    await confirm('Notes');
    const d = deletes().at(-1);
    check('ticked: deleteFolder, to the bot\'s machine only', d && d.deleteFolder === true && d.machine === 'desk', d);
    check('the deleted folder is reported', (await p.textContent('body')).includes('The working folder /work/Notes is deleted'));

    await open('shop');
    const kept = await box();
    check('a folder that stays: the box disabled with the reason', kept && kept.box && kept.box.disabled && kept.notes.some((n) => n.includes('Shop docs work in it')), kept);
    await confirm('Shop');
    check('deleted without the folder, to every machine', deletes().at(-1).botId === 'shop' && !deletes().at(-1).deleteFolder && !deletes().at(-1).machine, deletes().at(-1));

    await open('far');
    const asleep = await box();
    check('the bot\'s machine asleep: not asked, the folder stays as before', asleep && !asleep.box && asleep.notes.some((n) => n.includes('is not deleted'))
        && !h.sent.some((f) => f.type === 'folder_delete_check' && f.botId === 'far'), asleep);
    await p.click('.overlay.ask button[data-cancel]');
    await h.wait(100);

    // Refused at the last moment (a bot started working in it meanwhile): the reason, nothing deleted
    lastMinute = '/work/Notes stays: Notes three work in it.';
    await open('notes');
    await p.click('.overlay.ask .danger-option input');
    await confirm('Notes');
    check('a refusal at the last moment is shown', (await p.evaluate(() => [...document.querySelectorAll('.overlay.ask .ask-text')].map((n) => n.textContent).join())).includes('Notes three work in it'));
    check('no page errors', h.errors.length === 0, h.errors);
    await h.close();
}
