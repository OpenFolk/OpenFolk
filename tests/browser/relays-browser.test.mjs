// The browser's page belongs to its relay: the list "Signed in as" names it first and keeps further relays (a
// customer's) as links, which open that relay's own page; nothing else of them is stored here.
export default async function ({ start, check }) {
    const h = await start({});
    const p = h.page;
    // Another relay's page, so the browser can open it
    await h.ctx.route(/^https:\/\/customer\.example\.com\//, (r) => r.fulfill({ body: '<html><body>customer relay</body></html>', contentType: 'text/html' }));
    const rows = () => p.evaluate(() => [...document.querySelectorAll('#accounts-list li')].map((li) => `${li.querySelector('strong').firstChild.textContent}${li.querySelector('.tag') ? ' *' : ''}: ${[...li.querySelectorAll('button')].map((b) => b.textContent).join(',')}`));

    await p.evaluate(() => openSettings());
    await h.wait(100);
    check('the block is there, with the page\'s own relay first and its sign-in marked', await p.isVisible('#settings-accounts') && JSON.stringify(await rows()) === JSON.stringify(['test.local: Rename', 'Main *: ']), await rows());
    check('the browser text explains the links', (await p.textContent('#accounts-intro')).includes('links'));

    await p.click('#accounts-join');
    await p.fill('#text-input', 'customer.example.com');
    await p.click('#text-submit');
    await p.waitForURL(/customer\.example\.com/, { timeout: 5000 }).catch(() => undefined);
    check('an address added opens that relay\'s page', p.url() === 'https://customer.example.com/', p.url());

    await p.goto('http://test.local/');
    await h.wait(600);
    await p.evaluate(() => openSettings());
    await h.wait(100);
    check('back here: the relay is kept as a link, with a button to open it', JSON.stringify(await rows()) === JSON.stringify(['test.local: Rename', 'Main *: ', 'customer.example.com: Open,Rename,Remove']), await rows());
    await p.locator('#accounts-list li', { hasText: 'customer' }).locator('button', { hasText: 'Open' }).click();
    await p.waitForURL(/customer\.example\.com/, { timeout: 5000 }).catch(() => undefined);
    check('open: that relay\'s page', p.url() === 'https://customer.example.com/', p.url());

    await p.goto('http://test.local/');
    await h.wait(600);
    await p.evaluate(() => openSettings());
    await h.wait(100);
    await p.locator('#accounts-list li', { hasText: 'customer' }).locator('button.danger').click();
    await h.wait(100);
    check('remove: the link is gone, no question asked', JSON.stringify(await rows()) === JSON.stringify(['test.local: Rename', 'Main *: ']), await rows());
    check('… and nothing of it stored', await p.evaluate(() => JSON.parse(localStorage.getItem('openfolk-relays')).length === 1));
}
