// The shared chat list across relays: the app on its first relay also shows the bots of a customer's relay, through a
// connection to that relay signed in with that relay's device key and read with that relay's end-to-end key; the row
// carries the relay's name, and a tap opens the chat on that relay.
import { bot } from './harness.mjs';

const CUSTOMER = 'https://customer.example.com';
const SHOP = bot('shop', 'Shop bot');

/** A fake Capacitor bridge whose Keychain survives a reload; the device knows two relays, the customer's with a key. */
function fakeApp() {
    const secure = JSON.parse(sessionStorage.getItem('__secure') || '{}');
    const keep = () => sessionStorage.setItem('__secure', JSON.stringify(secure));
    if (!sessionStorage.getItem('__relays')) {
        sessionStorage.setItem('__relays', '1');
        localStorage.setItem('openfolk-relay', 'https://home.example.com');
        localStorage.setItem('openfolk-relays', JSON.stringify([
            { url: 'https://home.example.com', name: 'Home', scope: '' },
            { url: 'https://customer.example.com', name: 'Customer Ltd', scope: '@2' },
        ]));
        localStorage.setItem('openfolk-device@2', 'c.key');
        localStorage.setItem('openfolk-seen@2', JSON.stringify({ _since: '2020-01-01T00:00:00.000Z' }));
        secure['e2e@2'] = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
        keep();
    }
    const listeners = {};
    window.__fire = (name, data) => (listeners[name] || []).forEach((f) => f(data));
    const plugins = {
        PushNotifications: {
            checkPermissions: async () => ({ receive: 'denied' }),
            addListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return Promise.resolve({ remove() {} }); },
        },
        OpenFolk: {
            secureGet: async ({ key }) => ({ value: secure[key] || '' }),
            secureSet: async ({ key, value }) => { secure[key] = value; keep(); },
            secureRemove: async ({ key }) => { delete secure[key]; keep(); },
            setBadge: async () => undefined,
        },
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: (name) => name in plugins, registerPlugin: (name) => plugins[name] };
}

export default async function ({ start, check }) {
    const h = await start({
        secure: true, before: fakeApp,
        auth: (f) => (f.device === 'test' || f.device === 'c.key' ? { type: 'auth', ok: true } : { type: 'auth', ok: false, code: 'wrong_password', message: 'no' }),
        // The customer relay's backend encrypts: the page's harness frames in plain text would be dropped there
        botsFor: (f) => (f.device === 'c.key' ? [] : undefined),
    });
    const p = h.page;
    await h.wait(400);
    const urls = await p.evaluate(() => window.__wsUrls);
    check('a connection to the customer relay', urls.includes(`${CUSTOMER.replace('https', 'wss')}/ws/client`), urls);
    check('… signed in with that relay\'s device key', h.sent.some((f) => f.type === 'auth' && f.device === 'c.key'));

    // That relay's backend: its bots and a message, sealed with that relay's key
    const delivered = await p.evaluate(async (shop) => {
        const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(9), 'AES-GCM', false, ['encrypt']);
        const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
        let n = 0;
        const seal = async (frame) => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('openfolk:b2c') }, key,
                new TextEncoder().encode(JSON.stringify({ ...frame, _r: { t: Date.now(), s: 'backend-shop', n: ++n } })));
            return { type: 'e2e', iv: b64(iv), data: b64(data), machine: 'shop-pc' };
        };
        const socket = window.__sockets[window.__wsUrls.findIndex((u) => u.includes('customer'))];
        socket.push(await seal({ type: 'bots', bots: [shop], groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] }));
        socket.push(await seal({ type: 'user', chatId: 'shop', entry: { id: 'e1', role: 'assistant', text: 'Order shipped', ts: new Date().toISOString(), botId: 'shop' } }));
        await new Promise((r) => setTimeout(r, 300));
        const li = document.querySelector('#chat-list li[data-chat="shop"]');
        return li && { relay: li.dataset.relay, badge: li.querySelector('.account-badge').textContent, last: li.querySelector('.last').textContent, unread: li.classList.contains('unread') };
    }, SHOP);
    check('the customer\'s bot in the list with the relay\'s name', delivered?.relay === CUSTOMER && delivered?.badge === 'Customer Ltd', delivered);
    check('… its last message, new', delivered?.last === 'Order shipped' && delivered?.unread === true, delivered);
    check('the history it asks for goes out encrypted', h.sent.some((f) => f.type === 'e2e'));

    // A tap opens the chat on the customer relay
    const before = h.sent.length;
    await p.click('#chat-list li[data-chat="shop"]');
    await p.waitForLoadState('load');
    await h.wait(900);
    check('tap: the page is on the customer relay', await p.evaluate(() => localStorage.getItem('openfolk-relay') === 'https://customer.example.com'));
    check('… its main connection goes there, signed in with its device key', await p.evaluate(() => window.__wsUrls[0] === 'wss://customer.example.com/ws/client')
        && h.sent.slice(before).find((f) => f.type === 'auth')?.device === 'c.key', h.sent.slice(before).filter((f) => f.type === 'auth'));
    check('… and the first relay now in the list with its name', await p.evaluate(() => [...document.querySelectorAll('#chat-list li[data-relay]')].some((li) => li.dataset.relay === 'https://home.example.com' && li.querySelector('.account-badge').textContent === 'Home')));

    // A notification of the first relay (its backend names the relay in the link): the page goes back there, to that chat
    await p.evaluate(() => window.__fire('pushNotificationActionPerformed', { notification: { data: { url: '/?chat=pdf&relay=https%3A%2F%2Fhome.example.com' } } }));
    await p.waitForLoadState('load');
    await h.wait(900);
    check('notification of another relay: the page is on that relay', await p.evaluate(() => localStorage.getItem('openfolk-relay') === 'https://home.example.com'));
    check('… with its chat open, the relay gone from the address', await p.evaluate(() => activePane().chatId === 'pdf' && !location.search.includes('relay')));
}
