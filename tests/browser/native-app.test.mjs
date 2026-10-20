// The web app inside the mobile apps (Capacitor): relay address in the login form, push through APNs/FCM instead of
// Web Push, tapping a notification opens the chat, end-to-end key in the Keychain, number on the app icon.
// The Capacitor bridge and its plugins are stand-ins that record what the app calls.

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
    check('browser: server URL shown read-only', await web.page.isVisible('#login') && await web.page.evaluate(() => {
        const i = /** @type {HTMLInputElement} */ (document.getElementById('login-relay'));
        return !!i.offsetParent && i.readOnly && i.value === location.origin && i.previousElementSibling.textContent === 'Server URL';
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
    check('app: login with editable server URL', await p.isVisible('#login') && await p.isEditable('#login-relay'));
    check('app: relay, password and name from the start, no code field while no relay asks for one', await p.evaluate(() => [...document.querySelectorAll('#login-form label input')].filter((i) => i.offsetParent).map((i) => i.id).join(',')) === 'login-relay,login-token,login-name');
    check('app: no connection without relay address', !(await p.evaluate(() => window.__wsUrls)));

    await p.fill('#login-relay', 'ftp://example.com');
    await p.fill('#login-token', 'secret');
    await p.click('#login-form button[type="submit"]');
    await h.wait(100);
    check('invalid address is refused', (await p.textContent('#login-error')).includes('server URL'), await p.textContent('#login-error'));

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

    // ---- tapping a notification opens its chat
    await p.evaluate(() => window.__fire('pushNotificationActionPerformed', { notification: { data: { url: '/?chat=pdf' } } }));
    await h.wait(300);
    check('notification opens the chat', await p.evaluate(() => document.getElementById('app').classList.contains('chat-open')) && (await p.evaluate(() => document.querySelector('[data-el=chat-name]').firstChild.textContent)) === 'PDF-Reader');

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
}
