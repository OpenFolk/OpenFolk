// The web app inside the mobile apps (Capacitor): relay address in the login form, push through APNs/FCM instead of
// Web Push, tapping a notification opens the chat, end-to-end key in the Keychain, number on the app icon.
// The Capacitor bridge and its plugins are stand-ins that record what the app calls.
import { onDialog } from './harness.mjs';

/** Runs in the page before the app: a fake Capacitor bridge for iOS. */
function fakeCapacitor() {
    const calls = (window.__native = []);
    const listeners = {};
    const secure = {};
    const plugins = {
        PushNotifications: {
            checkPermissions: async () => ({ receive: window.__permission || 'prompt' }),
            requestPermissions: async () => { window.__permission = 'granted'; return { receive: 'granted' }; },
            register: async () => {
                calls.push('register');
                setTimeout(() => (listeners.registration || []).forEach((f) => f({ value: 'apns-token-1' })), 10);
            },
            addListener: (name, fn) => {
                (listeners[name] = listeners[name] || []).push(fn);
                // Like the plugin: a tap that started the app is kept until the app listens
                if (name === 'pushNotificationActionPerformed' && window.__coldStart) {
                    const url = window.__coldStart;
                    window.__coldStart = null;
                    setTimeout(() => fn({ notification: { data: { url } } }), 0);
                }
                return Promise.resolve({ remove() {} });
            },
        },
        App: { getInfo: async () => ({ id: 'io.openfolk.app' }) },
        OpenFolk: {
            secureGet: async ({ key }) => ({ value: secure[key] || '' }),
            secureSet: async ({ key, value }) => { secure[key] = value; calls.push(`secureSet:${key}`); },
            secureRemove: async ({ key }) => { delete secure[key]; calls.push(`secureRemove:${key}`); },
            setBadge: async ({ count }) => { calls.push(`badge:${count}`); },
        },
    };
    window.__fire = (name, data) => (listeners[name] || []).forEach((f) => f(data));
    window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        isPluginAvailable: (name) => name in plugins,
        registerPlugin: (name) => plugins[name],
    };
}

export default async function ({ start, check }) {
    // ---- in the browser the server URL is the page's own origin, shown but not editable; the socket goes there
    const web = await start({ device: null });
    await web.page.selectOption('#login-method', 'password');
    check('browser: server URL shown read-only', await web.page.isVisible('#login') && await web.page.evaluate(() => {
        const i = /** @type {HTMLInputElement} */ (document.getElementById('login-relay'));
        return !!i.offsetParent && i.readOnly && i.value === location.origin && i.previousElementSibling.textContent === 'URL';
    }));
    await web.page.fill('#login-token', 'secret');
    await web.page.click('#login-form button[type="submit"]');
    await web.wait(200);
    const webUrls = await web.page.evaluate(() => window.__wsUrls);
    check('browser: socket to the own origin', webUrls.at(-1) === 'ws://test.local/ws/client', webUrls);
    await web.close();

    // ---- the app: asks for the relay first, even with a device key
    const h = await start({ secure: true, before: fakeCapacitor, bots: [{ id: 'pdf', name: 'PDF-Reader', role: 'Test', avatar: '', folder: 'C:/www/pdf', model: 'default', approval: 'risky', tone: '', machine: '' }] });
    const p = h.page;
    check('app: the choice of the setup method first, no field yet', await p.isVisible('#login-method') && await p.evaluate(() => [...document.querySelectorAll('#login-form label input')].filter((i) => i.offsetParent).length === 0));
    check('app: the methods', await p.evaluate(() => [...document.querySelectorAll('#login-method option')].map((o) => o.value).join(',')) === ',invite,password,qr');
    await p.selectOption('#login-method', 'qr');
    check('app: the QR code needs the URL first', await p.evaluate(() => [...document.querySelectorAll('#login-form label input')].filter((i) => i.offsetParent).map((i) => i.id).join(',')) === 'login-relay');
    await p.selectOption('#login-method', 'password');
    check('app: login with editable server URL', await p.isVisible('#login') && await p.isEditable('#login-relay'));
    check('app: URL and password: relay, password and name, no code field while no relay asks for one', await p.evaluate(() => [...document.querySelectorAll('#login-form label input')].filter((i) => i.offsetParent).map((i) => i.id).join(',')) === 'login-relay,login-token,login-name');
    check('app: no connection without relay address', !(await p.evaluate(() => window.__wsUrls)));

    await p.fill('#login-relay', 'ftp://example.com');
    await p.fill('#login-token', 'secret');
    await p.click('#login-form button[type="submit"]');
    await h.wait(100);
    check('invalid address is refused', (await p.textContent('#login-error')).includes('enter the URL'), await p.textContent('#login-error'));

    await p.fill('#login-relay', 'relay.example.com/some/path');
    await p.click('#login-form button[type="submit"]');
    await h.wait(300);
    const urls = await p.evaluate(() => window.__wsUrls);
    check('address normalized and used for the socket', urls && urls.at(-1) === 'wss://relay.example.com/ws/client', urls);
    check('address remembered', (await p.evaluate(() => localStorage.getItem('openfolk-relay'))) === 'https://relay.example.com');
    check('signed in, login closed', !(await p.isVisible('#login')));
    check('badge set from the chat list', (await p.evaluate(() => window.__native)).includes('badge:0'), await p.evaluate(() => window.__native));

    // ---- push: a backend without APNs cannot reach the app
    await p.evaluate(() => { window.__permission = 'granted'; });
    await h.push({ type: 'push_key', machine: 'desk', publicKey: 'BKey', channels: ['web'] });
    await h.wait(100);
    check('no registration while no backend can send to the app', !h.sent.some((f) => f.type === 'push_subscribe'));
    await p.evaluate(() => openSettings());
    await h.wait(100);
    check('the notifications block explains that APNs is missing', (await p.textContent('#push-status')).includes('APNs'), await p.textContent('#push-status'));
    await p.evaluate(() => closeDialog(document.getElementById('settings')));

    await h.push({ type: 'push_key', machine: 'desk', publicKey: 'BKey', channels: ['web', 'apns', 'fcm'] });
    await h.wait(300);
    const sub = h.sent.find((f) => f.type === 'push_subscribe');
    check('device token sent as APNs subscription', sub && sub.subscription.channel === 'apns' && sub.subscription.token === 'apns-token-1' && sub.subscription.app === 'io.openfolk.app', sub);

    // ---- the system hands out a new token: the next registration carries it
    await p.evaluate(() => window.__fire('registration', { value: 'apns-token-2' }));
    await h.push({ type: 'push_key', machine: 'desk', publicKey: 'BKey', channels: ['web', 'apns', 'fcm'] });
    await h.wait(300);
    const latest = h.sent.findLast((f) => f.type === 'push_subscribe');
    check('renewed token is registered', latest && latest.subscription.token === 'apns-token-2', latest);

    // ---- the app is a phone: quiet while a desktop is in use, unless set to always notify
    check('the subscription says it is a phone, not always notified', latest && latest.form === 'phone' && latest.always === false, latest);
    await p.evaluate(() => openSettings());
    await h.wait(100);
    check('"always notify" offered in the notifications block', await p.isVisible('#settings-push #push-always') && !(await p.isChecked('#push-always')));
    await p.check('#push-always');
    await h.wait(300);
    const always = h.sent.findLast((f) => f.type === 'push_subscribe');
    check('switching it on registers again with always', always && always.always === true && always.subscription.token === 'apns-token-2', always);
    await p.evaluate(() => closeDialog(document.getElementById('settings')));

    // ---- tapping a notification opens its chat
    await p.evaluate(() => window.__fire('pushNotificationActionPerformed', { notification: { data: { url: '/?chat=pdf' } } }));
    await h.wait(300);
    check('notification opens the chat', await p.evaluate(() => document.getElementById('app').classList.contains('chat-open')) && (await p.evaluate(() => document.querySelector('[data-el=chat-name]').firstChild.textContent)) === 'PDF-Reader');

    // ---- the terms of use before the first message to a person (Apple 1.2); asked once, a bot's chat never
    await h.push({ type: 'people', machine: 'desk', list: [{ id: 'kunde', name: 'Kunde', admin: false, reach: 'all' }], chats: [] });
    const asked = [];
    let accept = false;
    await onDialog(p, async (d) => {
        asked.push({ message: d.message(), link: await p.evaluate(() => document.querySelector('.overlay.ask a')?.getAttribute('href')) });
        if (accept) d.accept(); else d.dismiss();
    });
    const toPerson = () => h.sent.filter((f) => f.type === 'send' && f.chatId === 'p:kunde');
    const write = async (text) => {
        await p.evaluate(() => openChat('p:kunde'));
        await h.wait(150);
        const pane = p.locator('.pane:not([hidden]) [data-el=text]');
        await pane.fill(text);
        await p.click('.pane:not([hidden]) [data-el=btn-send]');
        await h.wait(200);
    };
    await write('Hello');
    check('first message to a person: the terms are asked for, with a link to them', asked.length === 1 && asked[0].message.includes('terms of use')
        && asked[0].link === 'https://openfolk.app/en/terms', asked);
    check('… declined: nothing sent, the text stays', toPerson().length === 0
        && await p.locator('.pane:not([hidden]) [data-el=text]').inputValue() === 'Hello');
    accept = true;
    await write('Hello');
    check('… accepted: the message goes out', toPerson().length === 1 && toPerson()[0].text === 'Hello', toPerson());
    await write('Again');
    check('… and the terms are not asked again', asked.length === 2 && toPerson().length === 2, asked.length);

    // ---- the end-to-end key goes to the Keychain, not IndexedDB
    await p.evaluate(() => adoptKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))));
    const native = await p.evaluate(() => window.__native);
    check('key stored in the Keychain', native.includes('secureSet:e2e'), native);
    await p.evaluate(() => forgetKey());
    check('key removed from the Keychain', (await p.evaluate(() => window.__native)).includes('secureRemove:e2e'));

    // ---- app started by tapping a notification: the chat opens once the bots have arrived
    const cold = await start({
        secure: true,
        before: { content: `(${fakeCapacitor})(); localStorage.setItem('openfolk-relay', 'https://relay.example.com'); window.__coldStart = '/?chat=pdf';` },
        bots: [{ id: 'pdf', name: 'PDF-Reader', role: 'Test', avatar: '', folder: 'C:/www/pdf', model: 'default', approval: 'risky', tone: '', machine: '' }],
    });
    await cold.wait(300);
    check('cold start from a notification opens the chat', await cold.page.evaluate(() => document.getElementById('app').classList.contains('chat-open')) && (await cold.page.evaluate(() => document.querySelector('[data-el=chat-name]').firstChild.textContent)) === 'PDF-Reader');

    // ---- the desktop app: the password typed on its setup page ("URL and password") signs in at once, asked once
    const desk = await start({
        secure: true, device: null, path: '#relay=https%3A%2F%2Frelay.example.com',
        before: `(${fakeCapacitor})(); window.__asked = []; window.openfolkDesktop = { takePassword: async (relay) => { window.__asked.push(relay); return window.__asked.length === 1 ? 'from-setup' : ''; } };`,
    });
    await desk.wait(400);
    const deskAuth = desk.sent.find((f) => f.type === 'auth' && f.token);
    check('desktop: the password from the setup page signs in, without the form', deskAuth?.token === 'from-setup', desk.sent.filter((f) => f.type === 'auth'));
    check('desktop: asked once, for the relay of the page', JSON.stringify(await desk.page.evaluate(() => window.__asked)) === '["https://relay.example.com"]', await desk.page.evaluate(() => window.__asked));
    await desk.close();

    // ---- the desktop app, signed in as a window: the web app asks the relay for this computer's invitation and hands
    // it to the app, which sets the computer up (desktop/main.js, the second step of the setup)
    const bridge = (key) => `(${fakeCapacitor})(); window.__offers = []; window.__keys = [];
        window.openfolkDesktop = { takePassword: async () => '', machineWanted: async () => ({ wanted: true, key: ${key} }), machineKey: async (relay, k) => { window.__keys.push([relay, k]); }, machineOffer: async (o) => { window.__offers.push(o); } };`;
    const own = (f, push, state, reply) => { if (f.type === 'machine_own') return reply({ type: 'machine_own', kind: 'setup', token: 't'.repeat(32), expiresAt: new Date(Date.now() + 900_000).toISOString() }); };
    const mach = await start({ secure: true, path: '#relay=https%3A%2F%2Frelay.example.com', before: bridge(true), onSend: own });
    await mach.wait(2200);
    check('desktop: signed in, the web app asks the relay for this computer', mach.sent.filter((f) => f.type === 'machine_own').length === 1, mach.sent.map((f) => f.type));
    check('desktop: … and hands the invitation to the app', JSON.stringify(await mach.page.evaluate(() => window.__offers)) === JSON.stringify([{ relay: 'https://relay.example.com', kind: 'setup', token: 't'.repeat(32) }]), await mach.page.evaluate(() => window.__offers));
    await mach.page.evaluate(async (k) => (await import('/js/e2e.js')).adoptKey(k), 'A'.repeat(43));
    check('desktop: a key the page takes over goes to the app, for the backend of this computer', JSON.stringify(await mach.page.evaluate(() => window.__keys)) === JSON.stringify([['https://relay.example.com', 'A'.repeat(43)]]), await mach.page.evaluate(() => window.__keys));
    await mach.close();

    // Machines awake that the app has no key for: a backend here would get a key of its own, so nothing is asked
    const nokey = await start({ secure: true, path: '#relay=https%3A%2F%2Frelay.example.com', before: bridge(false), onSend: own });
    await nokey.wait(2200);
    check('desktop: without the key of the machines awake, no invitation is asked for', !nokey.sent.some((f) => f.type === 'machine_own') && (await nokey.page.evaluate(() => window.__offers)).length === 0, nokey.sent.map((f) => f.type));
    await nokey.close();
}
