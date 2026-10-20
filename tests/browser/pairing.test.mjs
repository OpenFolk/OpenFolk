// Pairing links: `#pair=<token>&e2e=<key>` signs a new device in once without the password and brings the
// end-to-end key; the part behind '#' never reaches a server and leaves the address bar at once. A signed-in device
// creates such a link in the devices dialog (the backend answers "pair_link"); the mobile app accepts a pasted link.

const KEY = Buffer.alloc(32, 7).toString('base64url');
const BOT = { id: 'pdf', name: 'PDF-Reader', role: 'Test', avatar: '', folder: 'C:/www/pdf', model: 'default', approval: 'risky', tone: '', machine: '' };

function fakeCapacitor() {
    const calls = (window.__native = []);
    const secure = {};
    window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        isPluginAvailable: (name) => name === 'OpenFolk',
        registerPlugin: () => ({
            secureGet: async ({ key }) => ({ value: secure[key] || '' }),
            secureSet: async ({ key, value }) => { secure[key] = value; calls.push(`secureSet:${key}`); },
            secureRemove: async ({ key }) => { delete secure[key]; },
            setBadge: async () => undefined,
        }),
    };
}

export default async function ({ start, check }) {
    // ---- opened with a pairing link in the browser
    const h = await start({ secure: true, device: null, path: `#pair=tok-123&e2e=${KEY}`, auth: (f) => (f.pair === 'tok-123'
        ? { type: 'auth', ok: true, device: { id: 'dev1', token: 'dev1.secret', name: 'Phone' } }
        : { type: 'auth', ok: false, code: 'wrong_password', message: 'no' }) });
    const p = h.page;
    const first = h.sent.find((f) => f.type === 'auth');
    check('signs in with the token instead of the password', first && first.pair === 'tok-123' && !first.token, first);
    check('login form stays closed', !(await p.isVisible('#login')));
    check('device key stored, token forgotten', await p.evaluate(() => localStorage.getItem('openfolk-device') === 'dev1.secret' && state.pairToken === ''));
    check('link gone from the address bar', await p.evaluate(() => location.hash === ''));
    check('end-to-end key taken over', await p.evaluate(() => !!e2e.key));
    await h.close();

    // ---- a used or expired token: back to the password
    const bad = await start({ device: null, path: '#pair=used-token', auth: () => ({ type: 'auth', ok: false, code: 'pairing_invalid', message: 'This pairing link is no longer valid.' }) });
    check('refused link shows the login with the reason', await bad.page.isVisible('#login') && (await bad.page.textContent('#login-error')).includes('no longer valid'), await bad.page.textContent('#login-error'));
    check('token not sent again', await bad.page.evaluate(() => state.pairToken === ''));
    await bad.close();

    // ---- a signed-in device creates a link for the next one
    const d = await start({
        bots: [BOT],
        onSend: async (f, push) => {
            if (f.type === 'pair_link') await push({ type: 'pair_link', machine: 'desk', url: 'https://relay.example.com/#pair=new-token&e2e=abc', expiresAt: '2026-10-13T10:15:00Z', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', e2e: true });
        },
    });
    await d.page.click('#btn-settings');
    await d.wait(100);
    await d.page.click('#pair-create');
    await d.wait(200);
    check('asks a backend for the link', d.sent.some((f) => f.type === 'pair_link'));
    check('link and QR code shown', await d.page.evaluate(() => !document.getElementById('pair-box').hidden && document.querySelector('#pair-box input').value === 'https://relay.example.com/#pair=new-token&e2e=abc' && !!document.querySelector('#pair-box svg')));
    check('hint mentions the key', (await d.page.textContent('#pair-box')).includes('end-to-end key'), await d.page.textContent('#pair-box'));
    // The generic icon rule for svg (stroke width 2, round caps) ran the modules into a black blot no camera could read
    const look = await d.page.evaluate(() => { const s = getComputedStyle(document.querySelector('#pair-box svg rect')); return [s.strokeWidth, s.strokeLinecap].join(); });
    check('QR code without the icon strokes', look === '1px,butt', look);
    await d.close();

    // ---- the app: the whole link pasted into the address field
    const app = await start({ secure: true, device: null, before: fakeCapacitor, bots: [BOT], auth: (f) => (f.pair === 'app-token'
        ? { type: 'auth', ok: true, device: { id: 'dev2', token: 'dev2.secret', name: 'Pixel' } }
        : { type: 'auth', ok: false, code: 'wrong_password', message: 'no' }) });
    await app.page.fill('#login-relay', `https://relay.example.com/#pair=app-token&e2e=${KEY}`);
    await app.page.click('#login-form button[type="submit"]');
    await app.wait(300);
    const sent = app.sent.find((f) => f.type === 'auth');
    check('app signs in with the token from the link', sent && sent.pair === 'app-token', sent);
    check('relay address taken from the link', (await app.page.evaluate(() => localStorage.getItem('openfolk-relay'))) === 'https://relay.example.com');
    check('key stored in the Keystore', (await app.page.evaluate(() => window.__native)).includes('secureSet:e2e'));
    check('signed in', !(await app.page.isVisible('#login')) && (await app.page.evaluate(() => localStorage.getItem('openfolk-device'))) === 'dev2.secret');
}
