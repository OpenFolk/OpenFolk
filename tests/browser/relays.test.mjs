// The app signed in to several relays (one per customer): adding one with its pairing link keeps the first relay's
// device key and end-to-end key, each relay signs in with its own, the sidebar switches between them, and removing
// one forgets only what belongs to it.

const HOME = 'https://home.example.com';
const CUSTOMER = 'https://customer.example.com';
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5))).replace(/=+$/, '');

/** A fake Capacitor bridge whose Keychain survives a reload (sessionStorage), set up for the first relay. */
function fakeApp() {
    const calls = (window.__native = []);
    const secure = JSON.parse(sessionStorage.getItem('__secure') || '{}');
    const keep = () => sessionStorage.setItem('__secure', JSON.stringify(secure));
    if (!sessionStorage.getItem('__relays')) {
        sessionStorage.setItem('__relays', '1');
        localStorage.setItem('openfolk-relay', 'https://home.example.com');
        secure.e2e = 'home-key';
        keep();
    }
    const plugins = {
        OpenFolk: {
            secureGet: async ({ key }) => ({ value: secure[key] || '' }),
            secureSet: async ({ key, value }) => { secure[key] = value; keep(); calls.push(`secureSet:${key}`); },
            secureRemove: async ({ key }) => { delete secure[key]; keep(); calls.push(`secureRemove:${key}`); },
            setBadge: async () => undefined,
        },
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: (name) => name in plugins, registerPlugin: (name) => plugins[name] };
}

export default async function ({ start, check }) {
    const h = await start({
        secure: true, before: fakeApp, bots: [],
        auth: (f) => (f.pair === 'customer-token'
            ? { type: 'auth', ok: true, device: { id: 'c1', token: 'c.key', name: 'Phone' } }
            : f.device === 'test' || f.device === 'c.key' ? { type: 'auth', ok: true } : { type: 'auth', ok: false, code: 'wrong_password', message: 'no' }),
    });
    const p = h.page;
    p.on('dialog', (d) => void d.accept());
    const relays = () => p.evaluate(() => JSON.parse(localStorage.getItem('openfolk-relays') || '[]'));
    const stored = (k) => p.evaluate((k) => localStorage.getItem(k), k);
    const secure = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('__secure') || '{}'));

    check('the first relay keeps the names from before', JSON.stringify(await relays()) === JSON.stringify([{ url: HOME, name: 'home.example.com', scope: '' }]), await relays());
    check('one relay, one account: no switch in the sidebar', await p.isHidden('#account-switch'));
    await p.evaluate(() => openSettings());
    await h.wait(100);
    check('the settings list the relay and its one sign-in', await p.isVisible('#settings-accounts') && (await p.locator('#accounts-list li').count()) === 2);

    // ---- adding a customer's relay with its pairing link
    await p.click('#accounts-join');
    await p.fill('#text-input', `${CUSTOMER}/#pair=customer-token&e2e=${KEY}`);
    await p.click('#text-submit');
    await h.wait(900);
    check('the page is now the customer relay\'s', (await stored('openfolk-relay')) === CUSTOMER && (await relays()).map((r) => r.scope).join() === ',@2', await relays());
    check('signed in there with the pairing link', h.sent.some((f) => f.type === 'auth' && f.pair === 'customer-token') && !(await p.isVisible('#login')));
    check('its device key next to the first relay\'s', (await stored('openfolk-device@2')) === 'c.key' && (await stored('openfolk-device')) === 'test');
    const keys = await secure();
    check('its end-to-end key in a slot of its own, the first one kept', !!keys['e2e@2'] && keys.e2e === 'home-key', Object.keys(keys));
    check('the sidebar names the relay', (await p.textContent('#account-switch')).trim() === 'customer.example.com', await p.textContent('#account-switch'));

    // ---- back to the first relay through the sidebar
    const before = h.sent.length;
    await p.click('#account-switch');
    await p.click(`#account-menu [data-relay="${HOME}"]`);
    await h.wait(900);
    // The first sign-in is the page's own; the shared list then signs in to the customer relay too (relays-list.test.mjs)
    check('switched back: the first relay with its own device key', (await stored('openfolk-relay')) === HOME && h.sent.slice(before).find((f) => f.type === 'auth')?.device === 'test');
    check('the sidebar names it', (await p.textContent('#account-switch')).trim() === 'home.example.com');

    // ---- removing the customer relay forgets only its data
    await p.evaluate(() => openSettings());
    await h.wait(100);
    check('the settings list both relays with their sign-ins, the customer\'s not marked', (await p.locator('#accounts-list li').count()) === 4 && await p.locator('#accounts-list li', { hasText: 'customer' }).locator('.tag').count() === 0);
    await p.locator('#accounts-list li', { hasText: 'customer' }).locator('button.danger').click();
    await h.wait(300);
    const left = await secure();
    check('removed: its device key and end-to-end key gone', (await stored('openfolk-device@2')) === null && !left['e2e@2'], Object.keys(left));
    check('… the first relay\'s kept', (await stored('openfolk-device')) === 'test' && left.e2e === 'home-key' && (await relays()).length === 1);
    check('no switch left in the sidebar', await p.isHidden('#account-switch'));
}
