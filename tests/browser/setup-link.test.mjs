// Setting a person up with a setup link: the admin's dialog (bots with repository, token and level, contacts, hand-over),
// the invitation from the account's row, which is the setup link once a setup is stored, and the page a setup link
// opens in a browser, which hands it to the desktop app instead of signing in.

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

    // ---- a setup link pasted where an invitation goes ("Add"): its page in a browser, not a sign-in with the link cut
    /** "Add" as someone who is no admin: the question for the link. */
    const pasteLink = async (h, link) => {
        await h.page.evaluate(() => openSettings());
        await h.wait(100);
        await h.page.click('#accounts-join');
        await h.page.fill('#text-dialog input', link);
        await h.page.keyboard.press('Enter');
    };
    const paste = await start({});
    await pasteLink(paste, `http://test.local/#setup=tok-2&e2e=${KEY}`);
    await paste.page.waitForLoadState('load');
    await paste.wait(700);
    const pastedHref = await paste.page.getAttribute('a[href^="openfolk://"]', 'href', { timeout: 2000 }).catch(() => '');
    check('setup link pasted under "Add" in a browser: the page of the link', (pastedHref ? new URL(pastedHref).searchParams.get('link') : '') === `http://test.local/#setup=tok-2&e2e=${KEY}` && await paste.page.isHidden('#login'), pastedHref);
    await paste.close();

    // The desktop app takes it over: the page navigates to openfolk://setup, which main.js answers with its question
    const desk = await start({
        before: () => {
            Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 OpenFolk/0.7.1 Electron/44' });
            window.navigation.addEventListener('navigate', (e) => {
                if (!e.destination.url.startsWith('openfolk:')) return;
                window.__handed = e.destination.url;
                e.preventDefault();
            });
        },
    });
    await pasteLink(desk, `http://test.local/#setup=tok-3&e2e=${KEY}`);
    await desk.wait(300);
    const handed = await desk.page.evaluate(() => window.__handed || '');
    check('… in the desktop app: handed to the app with the whole link, no sign-in form', (handed ? new URL(handed).searchParams.get('link') : '') === `http://test.local/#setup=tok-3&e2e=${KEY}` && await desk.page.isHidden('#login'), handed);
    await desk.close();

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
    check('an account that is no admin can be set up', await kunde.locator('button', { hasText: 'Edit' }).isVisible());
    await kunde.locator('button', { hasText: 'Edit' }).click();
    await h.wait(200);
    check('the dialog opens with a support and a development bot', await p.isVisible('#setup-box') && (await p.locator('#setup-box .setup-bot').count()) === 2
        && (await p.textContent('#settings-dialog-title')) === 'Edit Kunde');
    // Per bot two choices: its approval level, then whose picture it shows (none to begin with)
    const levels = await p.locator('#setup-box .setup-bot select').evaluateAll((s) => s.map((x) => x.value));
    check('support only reads, development asks before what is risky; no picture yet', levels.join() === 'read,,risky,', levels);
    const pictures = await p.locator('#setup-box .setup-bot').first().locator('select').nth(1).locator('option').allTextContents();
    check('the picture: none, or like one of my bots', pictures[0] === 'None (initials)' && pictures.some((x) => x.startsWith('Like my bot ')), pictures);
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
    // The support bot shows the picture of one of the admin's bots
    const pictureOf = cards.nth(0).locator('select').nth(1);
    await pictureOf.selectOption({ index: 1 });
    const followed = await pictureOf.inputValue();
    await p.locator('#setup-box .setup-contacts input[value="anna"]').check();
    await p.locator('#setup-box').getByRole('button', { name: 'Save', exact: true }).click();
    await h.wait(300);
    const reach = h.sent.find((f) => f.type === 'account_update' && f.id === 'kunde');
    check('saved: whom the person reaches goes to the relay', reach?.reach === 'listed' && reach.contacts.sort().join() === 'anna,main', reach);
    const saved = h.sent.find((f) => f.type === 'setup_save');
    check('… the bots with their tokens to the backend, the hand-over to the admin',
        saved?.setup.account === 'kunde' && saved.setup.handover === 'main' && saved.setup.bots.map((b) => `${b.key}:${b.approval}:${b.token}`).join() === 'support:read:read-tok,dev:risky:write-tok', saved?.setup);
    check('… the support bot names whose picture it shows, the other none', saved?.setup.bots[0].avatarFrom === followed && !!followed && !('avatarFrom' in saved.setup.bots[1]), saved?.setup.bots);
    check('a stored token shows as stored, not as text', (await cards.nth(0).locator('input[type="password"]').getAttribute('placeholder'))?.includes('stored'));

    check('the dialog has no link of its own, only saving', (await p.locator('#setup-box button', { hasText: 'link' }).count()) === 0);

    // The invitation from the account's row is the setup link once a setup is stored
    await p.keyboard.press('Escape');
    await h.wait(100);
    const before = h.sent.length;
    await kunde.locator('button', { hasText: 'Create invitation link' }).click();
    await h.wait(300);
    const asked = h.sent.slice(before);
    check('"Create invitation link" asks for the setup link, no pairing', asked.some((f) => f.type === 'setup_link' && f.account === 'kunde' && !f.revoke) && !asked.some((f) => f.type === 'account_invite'), asked.map((f) => f.type));
    check('… shown as the invitation, with until when', (await p.textContent('#settings-dialog-title')) === 'Invitation for Kunde'
        && (await p.locator('#invite-box .pair-url input').inputValue()).includes('#setup=st-1') && (await p.textContent('#invite-box')).includes('17'));
    await p.locator('#invite-box button', { hasText: 'Revoke link' }).click();
    await h.wait(300);
    check('revoked: the link is gone, the dialog closed', h.sent.some((f) => f.type === 'setup_link' && f.revoke === true) && await p.isHidden('#settings-dialog'));
    const anna = p.locator('#accounts-list li').filter({ hasText: 'Anna' });
    const beforeAnna = h.sent.length;
    await anna.locator('button', { hasText: 'Create invitation link' }).click();
    await h.wait(200);
    check('an account without a setup keeps the pairing invitation', h.sent.slice(beforeAnna).some((f) => f.type === 'account_invite' && f.id === 'anna'));

    // Opened again: the stored bots closed, each named in its head with repository and level
    await kunde.locator('button', { hasText: 'Edit' }).click();
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
