// Sign-in by QR code: the start page shows a code with a request id and a key of its own; a signed-in device that
// opens it (camera app or the app's scanner) asks who is waiting, confirms, gets a pairing link from a backend and
// sends it sealed for that key. The new device opens the box and signs in with the token, end-to-end key included.

const KEY = Buffer.alloc(32, 9).toString('base64url');

/** A fake Capacitor bridge whose scanner returns window.__scanResult. */
function fakeCapacitor() {
    const secure = {};
    const plugins = {
        OpenFolk: {
            secureGet: async ({ key }) => ({ value: secure[key] || '' }),
            secureSet: async ({ key, value }) => { secure[key] = value; },
            secureRemove: async ({ key }) => { delete secure[key]; },
            setBadge: async () => undefined,
        },
        CapacitorBarcodeScanner: { scanBarcode: async (o) => { window.__scanOptions = o; return { ScanResult: window.__scanResult || '', format: 0 }; } },
    };
    window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        isPluginAvailable: (name) => name in plugins,
        registerPlugin: (name) => plugins[name],
    };
}

/** A fake camera for getUserMedia: a canvas showing window.__cameraText as QR code (qrcode-generator of the page). */
function fakeCamera() {
    navigator.mediaDevices.getUserMedia = async () => {
        const qr = window.qrcode(0, 'M');
        qr.addData(window.__cameraText || '');
        qr.make();
        const n = qr.getModuleCount();
        const size = 6;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = (n + 8) * size;
        const g = canvas.getContext('2d');
        const draw = () => {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.fillStyle = '#000';
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + 4) * size, (r + 4) * size, size, size);
        };
        draw();
        // a canvas stream only delivers frames after a paint
        const timer = setInterval(draw, 100);
        const stream = canvas.captureStream(10);
        window.__cameraStopped = false;
        for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => { clearInterval(timer); window.__cameraStopped = true; stop(); };
        }
        return stream;
    };
}

export default async function ({ start, check }) {
    // ---- the new device: a code appears on the start page, without any field moving around
    let toWaiting = null;
    const fresh = await start({
        secure: true, device: null,
        onSend: (f, push, state, reply) => {
            if (f.type === 'pair_wait') {
                toWaiting = reply;
                return reply({ type: 'pair_wait', id: 'req-1', expiresAt: new Date(Date.now() + 600_000).toISOString() });
            }
        },
    });
    const np = fresh.page;
    await fresh.wait(300);
    check('start page asks the relay for a request', fresh.sent.some((f) => f.type === 'pair_wait'));
    check('QR code shown below the fields', await np.isVisible('#login-qr svg path'));
    const link = await np.getAttribute('#login-qr-code', 'data-link');
    const pk = /#approve=req-1&pk=([\w-]+)$/.exec(link || '')?.[1] || '';
    check('code holds the server URL, the id and a public key', link?.startsWith('https://test.local/#approve=req-1&pk=') && pk.length > 80, link);
    check('scanner button in the browser too', await np.isVisible('#login-scan'));
    check('hint for pairing from a signed-in device', (await np.textContent('#login-form')).includes('Pair another device'));

    // ---- the signed-in device opens the code: confirms, asks a backend for a link and seals it
    let box = null;
    const dialogs = [];
    const approver = await start({
        secure: true, path: `#approve=req-1&pk=${pk}`,
        before: () => { window.confirm = (m) => { (window.__dialogs ||= []).push(m); return true; }; window.alert = (m) => { (window.__dialogs ||= []).push(m); }; },
        onSend: (f, push, state, reply) => {
            if (f.type === 'pair_request') return reply({ type: 'pair_request', id: f.id, name: 'Chrome on Windows', ip: '203.0.113.7', since: new Date().toISOString() });
            if (f.type === 'pair_link') return reply({ type: 'pair_link', machine: 'desk', url: `https://elsewhere.example/#pair=tok-qr&e2e=${KEY}`, expiresAt: new Date().toISOString(), svg: '', e2e: true });
            if (f.type === 'pair_approve') {
                box = f;
                return reply({ type: 'pair_approved', id: f.id });
            }
        },
    });
    await approver.wait(400);
    const ap = approver.page;
    dialogs.push(...await ap.evaluate(() => window.__dialogs || []));
    check('signed in: asks the relay who waits behind the code', approver.sent.some((f) => f.type === 'pair_request' && f.id === 'req-1'));
    check('confirmation names the device and its address', /Chrome on Windows/.test(dialogs[0] || '') && /203\.0\.113\.7/.test(dialogs[0] || ''), dialogs);
    check('after confirming: a pairing link from the backend', approver.sent.some((f) => f.type === 'pair_link' && !f.token));
    check('link sent sealed, not shown', box && box.id === 'req-1' && typeof box.box?.data === 'string' && !JSON.stringify(box).includes('tok-qr') && await ap.isHidden('#pair-box'), box);
    check('approver hears that it worked', dialogs.some((d) => /signed in/.test(d)), dialogs);

    // ---- the new device opens the box and signs in with the token and the key
    await toWaiting({ type: 'pair_wait', box: box.box });
    await fresh.wait(400);
    const auth = fresh.sent.find((f) => f.type === 'auth');
    check('new device signs in with the token from the box', auth && auth.pair === 'tok-qr' && !auth.token, auth);
    check('… takes the end-to-end key over', await np.evaluate(() => !!e2e.key));
    check('… and leaves the start page', !(await np.isVisible('#login')));
    await fresh.close();
    await approver.close();

    // ---- opened on a device that is not signed in: it has to sign in first
    const notYet = await start({ secure: true, device: null, path: '#approve=req-2&pk=abc' });
    check('not signed in: says to sign in first', (await notYet.page.textContent('#login-error')).includes('Sign this device in first'));
    await notYet.close();

    // ---- a relay from before QR sign-in refuses the request: no code, no second attempt
    const old = await start({ secure: true, device: null, onSend: (f, push, state, reply) => { if (f.type === 'pair_wait') reply({ type: 'auth', ok: false, code: 'wrong_password' }); } });
    await old.wait(300);
    check('old relay: no QR code', !(await old.page.isVisible('#login-qr')) && old.sent.filter((f) => f.type === 'pair_wait').length === 1);
    await old.close();

    // ---- a new code on request: a fresh request at the relay, the old one's connection closed
    let requests = 0;
    const renew = await start({
        secure: true, device: null,
        onSend: (f, push, state, reply) => {
            if (f.type === 'pair_wait') return reply({ type: 'pair_wait', id: `req-r${++requests}`, expiresAt: new Date(Date.now() + 600_000).toISOString() });
        },
    });
    await renew.wait(300);
    const before = await renew.page.getAttribute('#login-qr-code', 'data-link');
    check('renew button below the code', await renew.page.isVisible('#login-qr-renew'));
    await renew.page.click('#login-qr-renew');
    await renew.wait(300);
    const after = await renew.page.getAttribute('#login-qr-code', 'data-link');
    check('renew: a second request and a different code', requests === 2 && before?.includes('approve=req-r1') && after?.includes('approve=req-r2'), { before, after });
    await renew.wait(5500);
    check('renew: the old connection does not bring a third code', requests === 2, requests);
    check('no page errors when renewing', renew.errors.length === 0, renew.errors);
    await renew.close();

    // ---- the browser reads a signed-in device's pairing code with the camera
    const web = await start({ secure: true, device: null, before: fakeCamera });
    const wp = web.page;
    await wp.evaluate(() => { window.__cameraText = 'https://test.local/#pair=web-qr'; });
    await wp.click('#login-scan');
    await wp.waitForSelector('.qr-scan video');
    check('browser: camera shown in an overlay', await wp.isVisible('.qr-scan video'));
    await wp.waitForFunction(() => !document.querySelector('.qr-scan'), null, { timeout: 5000 }).catch(() => undefined);
    await web.wait(300);
    const webAuth = web.sent.find((f) => f.type === 'auth');
    check('browser: scanned pairing code signs in', webAuth && webAuth.pair === 'web-qr', webAuth);
    check('browser: camera stopped after the scan', await wp.evaluate(() => window.__cameraStopped === true));
    await web.close();

    // ---- cancelling the scan closes the camera and leaves the start page as it was
    const esc = await start({ secure: true, device: null, before: fakeCamera });
    await esc.page.evaluate(() => { window.__cameraText = 'no code here'; });
    await esc.page.click('#login-scan');
    await esc.page.waitForSelector('.qr-scan video');
    await esc.page.keyboard.press('Escape');
    await esc.wait(200);
    check('browser: Escape closes the scanner', !(await esc.page.isVisible('.qr-scan')) && await esc.page.evaluate(() => window.__cameraStopped === true) && await esc.page.isVisible('#login-form'));
    check('browser: nothing sent after cancelling', !esc.sent.some((f) => f.type === 'auth'));
    check('no page errors in the browser scans', web.errors.length + esc.errors.length === 0, [...web.errors, ...esc.errors]);
    await esc.close();

    // ---- the app scans a signed-in device's pairing code on its start page
    const app = await start({ secure: true, device: null, before: fakeCapacitor });
    const p = app.page;
    check('app: scanner button on the start page', await p.isVisible('#login-scan'));
    await p.evaluate((k) => { window.__scanResult = `https://relay.example.com/#pair=app-qr&e2e=${k}`; }, KEY);
    await p.click('#login-scan');
    await app.wait(400);
    const appAuth = app.sent.find((f) => f.type === 'auth');
    check('app: scanned pairing code signs in', appAuth && appAuth.pair === 'app-qr', appAuth);
    check('app: server URL taken from the code', await p.evaluate(() => localStorage.getItem('openfolk-relay') === 'https://relay.example.com'));

    // ---- and, signed in, scans a new device's code in the devices block
    await p.click('#btn-settings');
    check('app: scanner button in the devices block', await p.isVisible('#devices-scan'));
    await p.evaluate(() => { window.__scanResult = 'https://relay.example.com/#approve=req-5&pk=abc'; window.confirm = () => false; });
    await p.click('#devices-scan');
    await app.wait(300);
    check('app: scanned code is looked up at the relay', app.sent.some((f) => f.type === 'pair_request' && f.id === 'req-5'));
    await p.evaluate(() => { window.__scanResult = 'https://example.com/nothing'; window.__alerts = []; window.alert = (m) => window.__alerts.push(m); });
    await p.click('#devices-scan');
    await app.wait(200);
    check('app: other codes are refused with a hint', await p.evaluate(() => window.__alerts.length === 1 && /not the sign-in code/.test(window.__alerts[0])));
    check('no page errors', fresh.errors.length + approver.errors.length + app.errors.length === 0, [...fresh.errors, ...approver.errors, ...app.errors]);
    await app.close();
}
