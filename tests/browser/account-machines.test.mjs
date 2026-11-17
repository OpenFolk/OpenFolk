// The machines an account runs on: in an account's "Edit" dialog and in the form for a new account the admin ticks
// which of the relay's machines serve it ("all, new ones too" or one by one); a computer bound to the account by a
// setup link shows as a line. Each change goes to the relay as `machines` (null = all).

const MAIN = { id: 'main', name: 'Alex', admin: true, reach: 'all', created: '' };
const ERIK = { id: 'erik', name: 'Erik', admin: false, reach: 'all', created: '2026-11-15T08:00:00Z' };
const KUNDE = { id: 'kunde', name: 'Kunde', admin: false, reach: 'admins', created: '2026-11-10T08:00:00Z', setupBy: 'main', machines: [] };
const MACHINES = [{ name: 'cloud' }, { name: 'desk' }, { name: 'laptop', account: 'kunde' }];

export default async function ({ start, check }) {
    const accounts = [MAIN, { ...ERIK }, { ...KUNDE }];
    const h = await start({
        auth: () => ({ type: 'auth', ok: true, account: { id: 'main', name: 'Alex', admin: true } }),
        onSend: async (f, push) => {
            if (f.type === 'accounts') await push({ type: 'accounts', list: accounts, current: 'main', machines: MACHINES });
            if (f.type === 'account_update' && 'machines' in f) {
                const a = accounts.find((x) => x.id === f.id);
                if (f.machines === null) delete a.machines;
                else a.machines = f.machines;
                await push({ type: 'accounts', list: accounts, current: 'main', machines: MACHINES });
            }
            if (f.type === 'setups') await push({ type: 'setups', machine: 'desk', list: [] });
            if (f.type === 'account_create') await push({ type: 'account_created', account: { id: f.name.toLowerCase(), name: f.name, admin: false, created: '2026-11-15T09:00:00Z' }, pair: { token: 'tok', expiresAt: '2026-11-15T09:15:00Z' } });
        },
    });
    const p = h.page;
    await p.evaluate(() => openAccounts());
    await h.wait(200);
    const updates = () => h.sent.filter((f) => f.type === 'account_update' && 'machines' in f);
    const ticks = () => p.evaluate(() => [...document.querySelectorAll('#settings-dialog .machine-picker-list input')]
        .map((c) => `${c.value}:${c.checked}`).join());

    // ---- Erik: no choice yet, so all machines
    await p.locator('#accounts-list li').filter({ hasText: 'Erik' }).locator('button', { hasText: 'Edit' }).click();
    await h.wait(200);
    check('the dialog offers the machines', await p.isVisible('#settings-dialog .machine-picker'));
    check('no choice yet: "all, new ones too" ticked, the single machines folded away',
        await p.isChecked('#settings-dialog .machine-picker > label input') && await p.isHidden('#settings-dialog .machine-picker-list'));
    await p.uncheck('#settings-dialog .machine-picker > label input');
    await h.wait(150);
    check('unticking "all": the relay\'s own machines, all ticked, none bound to another account', (await ticks()) === 'cloud:true,desk:true', await ticks());
    check('… and the relay gets them as a list', JSON.stringify(updates().at(-1)) === JSON.stringify({ type: 'account_update', id: 'erik', machines: ['cloud', 'desk'] }), updates().at(-1));
    await p.uncheck('#settings-dialog .machine-picker-list input[value="desk"]');
    await h.wait(150);
    check('unticking a machine: the list without it', JSON.stringify(updates().at(-1)?.machines) === '["cloud"]', updates().at(-1));
    check('the dialog stays with the choice after the relay\'s answer', (await ticks()) === 'cloud:true,desk:false', await ticks());
    await p.check('#settings-dialog .machine-picker > label input');
    await h.wait(150);
    check('"all" again: null, every machine also to come', updates().at(-1)?.machines === null, updates().at(-1));
    await p.keyboard.press('Escape');
    await h.wait(100);

    // ---- the customer on a computer of its own: none of the relay's machines yet, its computer as a line
    await p.locator('#accounts-list li').filter({ hasText: 'Kunde' }).locator('button', { hasText: 'Edit' }).click();
    await h.wait(200);
    check('an account set up: "all" not ticked, no machine of the relay ticked', !(await p.isChecked('#settings-dialog .machine-picker > label input')) && (await ticks()) === 'cloud:false,desk:false', await ticks());
    check('… its own computer named', (await p.textContent('#settings-dialog .machine-picker')).includes('LAPTOP'));
    await p.check('#settings-dialog .machine-picker-list input[value="cloud"]');
    await h.wait(150);
    check('ticking the cloud server for it', JSON.stringify(updates().at(-1)) === JSON.stringify({ type: 'account_update', id: 'kunde', machines: ['cloud'] }), updates().at(-1));
    await p.keyboard.press('Escape');
    await h.wait(100);

    // ---- a new account: the choice in the form
    await p.click('#accounts-join');
    await h.wait(150);
    check('the form for a new account offers the machines, all by default',
        await p.isVisible('#accounts-new-machines .machine-picker') && await p.isChecked('#accounts-new-machines .machine-picker > label input'));
    await p.fill('#accounts-new-name', 'Lena');
    await p.uncheck('#accounts-new-machines .machine-picker > label input');
    await p.uncheck('#accounts-new-machines .machine-picker-list input[value="cloud"]');
    check('ticking in the form sends nothing yet', !h.sent.some((f) => f.type === 'account_update' && f.id !== 'erik' && f.id !== 'kunde'));
    await p.click('#accounts-create');
    await h.wait(150);
    const create = h.sent.findLast((f) => f.type === 'account_create');
    check('create carries the machines ticked', create?.name === 'Lena' && JSON.stringify(create.machines) === '["desk"]', create);

    await p.click('#accounts-join');
    await h.wait(150);
    await p.fill('#accounts-new-name', 'Mia');
    await p.click('#accounts-create');
    await h.wait(150);
    const plain = h.sent.findLast((f) => f.type === 'account_create');
    check('the form opens again with "all"; then create sends no list', plain?.name === 'Mia' && !('machines' in plain), plain);
    await h.close();

    // ---- a relay from before the choice names no machines: no picker
    const old = await start({
        auth: () => ({ type: 'auth', ok: true, account: { id: 'main', name: 'Alex', admin: true } }),
        onSend: async (f, push) => {
            if (f.type === 'accounts') await push({ type: 'accounts', list: [MAIN, ERIK], current: 'main' });
            if (f.type === 'setups') await push({ type: 'setups', machine: 'desk', list: [] });
        },
    });
    await old.page.evaluate(() => openAccounts());
    await old.wait(200);
    await old.page.locator('#accounts-list li').filter({ hasText: 'Erik' }).locator('button', { hasText: 'Edit' }).click();
    await old.wait(200);
    check('older relay: the dialog without the choice', !(await old.page.isVisible('#settings-dialog .machine-picker')));
    await old.close();
}
