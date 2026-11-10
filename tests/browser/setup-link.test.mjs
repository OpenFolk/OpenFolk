// Setting a person up with a setup link: the admin's dialog (bots with repository, token and level, contacts, hand-over,
// the link), and the page a setup link opens in a browser, which hands it to the desktop app instead of signing in.

const KEY = Buffer.alloc(32, 7).toString('base64url');
const MAIN = { id: 'main', name: 'Alex', admin: true };
const ANNA = { id: 'anna', name: 'Anna', admin: false, reach: 'all', created: '2026-10-01T08:00:00Z' };
const KUNDE = { id: 'kunde', name: 'Kunde', admin: false, reach: 'all', created: '2026-11-10T08:00:00Z' };

export default async function ({ start, check }) {
    // ---- the page of a setup link in a browser
    const landing = await start({ device: null, path: `#setup=tok-1&e2e=${KEY}` });
    const lp = landing.page;
    await landing.wait(200);
    const href = await lp.getAttribute('a[href^="openfolk://"]', 'href');
    const inner = href ? new URL(href).searchParams.get('link') : '';
    check('setup link in a browser: a page that opens it in OpenFolk', await lp.isVisible('text=Open in OpenFolk') && inner === `http://test.local/#setup=tok-1&e2e=${KEY}`, href);
    check('… with the way to the app, and no sign-in', await lp.isVisible('text=Download OpenFolk') && await lp.isHidden('#login') && !landing.sent.some((f) => f.type === 'auth'));
    check('… and the link left the address bar', await lp.evaluate(() => !location.hash));
    await landing.close();

    // ---- the admin's dialog
    const accounts = [{ ...MAIN, created: '', reach: 'all' }, ANNA, KUNDE];
    let setups = [];
    const h = await start({
        auth: () => ({ type: 'auth', ok: true, account: MAIN }),
        onSend: async (f, push) => {
            if (f.type === 'accounts') await push({ type: 'accounts', list: accounts, current: 'main' });
            if (f.type === 'setups') await push({ type: 'setups', machine: 'desk', list: setups });
            if (f.type === 'setup_save') {
                setups = [{ ...f.setup, updatedAt: '2026-11-10T09:00:00Z', bots: f.setup.bots.map((b) => ({ ...b, token: true })) }];
                await push({ type: 'setups', machine: 'desk', list: setups });
            }
            if (f.type === 'setup_link') {
                await push(f.revoke ? { type: 'setup_link', machine: 'desk', account: f.account }
                    : { type: 'setup_link', machine: 'desk', account: f.account, url: `https://relay.example.com/#setup=st-1&e2e=${KEY}`, expiresAt: '2026-11-17T09:00:00Z' });
            }
        },
    });
    const p = h.page;
    await p.evaluate(() => openAccounts());
    await h.wait(200);
    const kunde = p.locator('#accounts-list li').filter({ hasText: 'Kunde' });
    check('an account that is no admin can be set up', await kunde.locator('button', { hasText: 'Set up' }).isVisible());
    await kunde.locator('button', { hasText: 'Set up' }).click();
    await h.wait(200);
    check('the dialog opens with a support and a development bot', await p.isVisible('#setup-box') && (await p.locator('#setup-box .setup-bot').count()) === 2
        && (await p.textContent('#settings-dialog-title')) === 'Set up Kunde');
    const levels = await p.locator('#setup-box .setup-bot select').evaluateAll((s) => s.map((x) => x.value));
    check('support only reads, development asks before what is risky', levels.join() === 'read,risky', levels);
    const ticked = await p.locator('#setup-box .setup-contacts input:checked').evaluateAll((l) => l.map((x) => x.value));
    check('the admin is the contact from the start', ticked.join() === 'main', ticked);

    await p.locator('#setup-box').getByRole('button', { name: 'Save', exact: true }).click();
    await h.wait(100);
    check('without repository and token: not saved, the reason shown', !h.sent.some((f) => f.type === 'setup_save') && await p.locator('#setup-box .error').isVisible());

    const cards = p.locator('#setup-box .setup-bot');
    for (const [i, token] of [[0, 'read-tok'], [1, 'write-tok']]) {
        await cards.nth(i).locator('input[type="url"]').fill('https://git.example.com/team/dashboard.git');
        await cards.nth(i).locator('input[type="password"]').fill(token);
    }
    await p.locator('#setup-box .setup-contacts input[value="anna"]').check();
    await p.locator('#setup-box').getByRole('button', { name: 'Save', exact: true }).click();
    await h.wait(300);
    const reach = h.sent.find((f) => f.type === 'account_update' && f.id === 'kunde');
    check('saved: whom the person reaches goes to the relay', reach?.reach === 'listed' && reach.contacts.sort().join() === 'anna,main', reach);
    const saved = h.sent.find((f) => f.type === 'setup_save');
    check('… the bots with their tokens to the backend, the hand-over to the admin',
        saved?.setup.account === 'kunde' && saved.setup.handover === 'main' && saved.setup.bots.map((b) => `${b.key}:${b.approval}:${b.token}`).join() === 'support:read:read-tok,dev:risky:write-tok', saved?.setup);
    check('a stored token shows as stored, not as text', (await cards.nth(0).locator('input[type="password"]').getAttribute('placeholder'))?.includes('stored'));

    await p.locator('#setup-box button', { hasText: 'Make setup link' }).click();
    await h.wait(300);
    check('the link to send, with until when', (await p.locator('#setup-box .pair-url input').inputValue()).includes('#setup=st-1') && (await p.textContent('#setup-box')).includes('17'));
    await p.locator('#setup-box button', { hasText: 'Revoke link' }).click();
    await h.wait(300);
    check('revoked: the link is gone', h.sent.some((f) => f.type === 'setup_link' && f.revoke === true) && (await p.locator('#setup-box .pair-url').count()) === 0);

    // Opened again: the stored bots closed, each named in its head with repository and level
    await p.locator('#setup-box button', { hasText: 'Close' }).click();
    await kunde.locator('button', { hasText: 'Set up' }).click();
    await h.wait(200);
    const heads = await p.locator('#setup-box .setup-bot > summary').allTextContents();
    check('a stored setup: its bots closed', await p.locator('#setup-box .setup-bot').evaluateAll((c) => c.length === 2 && c.every((x) => !x.open)) && !(await cards.nth(0).locator('input[type="url"]').isVisible()));
    check('… the head names bot, repository and level', heads.length === 2 && heads[0].includes('dashboard') && heads[0].includes('only reads'), heads);
    await cards.nth(1).locator('summary').click();
    check('a tap opens it', await cards.nth(1).locator('input[type="url"]').isVisible());
    await p.locator('#setup-box button', { hasText: 'Add a bot' }).click();
    check('a new bot opens, the others stay as they were', await p.locator('#setup-box .setup-bot').evaluateAll((c) => c.map((x) => x.open).join() === 'false,true,true'));
    await h.close();
}
