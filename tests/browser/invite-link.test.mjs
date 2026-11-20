// The invitation the way the person gets it: the field "Invitation link" on the sign-in (any link that was sent, an
// invitation into an account, a setup link, nonsense), and an admin who scans the code on that person's sign-in or
// desktop app from the row of their account, so the person's device lands in their account without a link.
import crypto from 'node:crypto';

const KEY = Buffer.alloc(32, 7).toString('base64url');
const MAIN = { id: 'main', name: 'Alex', admin: true };
const KUNDE = { id: 'kunde', name: 'Kunde', admin: false, reach: 'all', created: '2026-11-10T08:00:00Z' };

/** The public key of a device waiting behind a QR code, as the relay's code carries it (raw P-256, base64url). */
function devicePk() {
    const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
    return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
}

/** A camera for getUserMedia showing window.__cameraText as QR code (as in qr-login.test.mjs). */
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
        const timer = setInterval(draw, 100);
        const stream = canvas.captureStream(10);
        for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => { clearInterval(timer); stop(); };
        }
        return stream;
    };
}

export default async function ({ start, check }) {
    // ---- the sign-in in a browser: the field takes the link someone sent
    const fresh = await start({
        secure: true, device: null,
        auth: (f) => (f.pair === 'inv-9' || f.device === 'k.key' ? { type: 'auth', ok: true, device: { id: 'k', token: 'k.key', name: 'Mac' }, account: KUNDE } : { type: 'auth', ok: false, code: 'wrong_password', message: 'Wrong password.' }),
    });
    const p = fresh.page;
    await fresh.wait(300);
    check('sign-in: the invitation link is a setup method, its field only once chosen', !(await p.isVisible('#login-invite-link')));
    await p.selectOption('#login-method', 'invite');
    check('… then the field, without the password', await p.isVisible('#login-invite-link') && !(await p.isVisible('#login-token')));
    await p.fill('#login-invite-link', 'just some text');
    await p.click('#login-invite-go');
    await fresh.wait(100);
    check('sign-in: no link: says so, no sign-in tried', /no invitation link/.test(await p.textContent('#login-error')) && !fresh.sent.some((f) => f.type === 'auth'));
    await p.fill('#login-invite-link', `http://test.local/#pair=inv-9&e2e=${KEY}`);
    await p.press('#login-invite-link', 'Enter');
    await p.waitForLoadState('load');
    await fresh.wait(700);
    const auth = fresh.sent.find((f) => f.type === 'auth');
    check('sign-in: Enter in the field signs in with the invitation, no password', auth?.pair === 'inv-9' && !auth.token, auth);
    check('… and the sign-in is done', await p.isHidden('#login'));
    await fresh.close();

    const landing = await start({ device: null });
    await landing.wait(300);
    await landing.page.selectOption('#login-method', 'invite');
    await landing.page.fill('#login-invite-link', `http://test.local/#setup=st-9&e2e=${KEY}`);
    await landing.page.click('#login-invite-go');
    await landing.page.waitForLoadState('load');
    await landing.wait(700);
    check('sign-in: a setup link in the field shows its page, not the password form', await landing.page.isVisible('text=Open in OpenFolk') && await landing.page.isHidden('#login'));
    await landing.close();

    // ---- the admin scans the person's code from the row of their account
    const pk = devicePk();
    let box = null;
    let invites = 0;
    let setupLinks = 0;
    const pairLinks = [];
    const admin = await start({
        secure: true, before: fakeCamera, recordDialogs: true,
        auth: () => ({ type: 'auth', ok: true, account: MAIN }),
        onSend: async (f, push, state, reply) => {
            if (f.type === 'accounts') await push({ type: 'accounts', list: [{ ...MAIN, created: '', reach: 'all' }, KUNDE], current: 'main' });
            if (f.type === 'setups') await push({ type: 'setups', machine: 'desk', list: [] });
            if (f.type === 'pair_request') return reply({ type: 'pair_request', id: f.id, name: f.id === 'req-m' ? 'Mac of Kunde' : 'Safari on iPhone', ip: '203.0.113.9', since: new Date().toISOString() });
            if (f.type === 'account_invite') {
                invites++;
                return push({ type: 'account_invite', account: KUNDE, pair: { token: 'inv-7', expiresAt: '2026-11-24T09:00:00Z' } });
            }
            if (f.type === 'setup_link') setupLinks++;
            if (f.type === 'pair_link') pairLinks.push(f.token || '');
            if (f.type === 'pair_link') return reply({ type: 'pair_link', machine: 'desk', url: `https://relay.example.com/#pair=${f.token || 'own'}&e2e=${KEY}`, expiresAt: '2026-11-24T09:00:00Z', svg: '', e2e: true });
            if (f.type === 'pair_approve') {
                box = f;
                return reply({ type: 'pair_approved', id: f.id });
            }
        },
    });
    const a = admin.page;
    await admin.wait(300);
    await a.evaluate(() => openAccounts());
    await admin.wait(300);
    const row = a.locator('#accounts-list li').filter({ hasText: 'Kunde' });
    check('account row: "Scan QR code" next to the invitation link', await row.locator('button', { hasText: 'Scan QR code' }).isVisible() && await row.locator('button', { hasText: 'Create invitation link' }).isVisible());

    /** Scans `text` with the camera from the row's button; waits until the overlay is gone. */
    const scan = async (text) => {
        await a.evaluate((t) => { window.__cameraText = t; window.__dialogs = []; }, text);
        await row.locator('button', { hasText: 'Scan QR code' }).click();
        await a.waitForFunction(() => !document.querySelector('.qr-scan'), null, { timeout: 5000 }).catch(() => undefined);
        await admin.wait(600);
    };
    await scan(`https://relay.example.com/#approve=req-7&pk=${pk}`);
    const asked = await a.evaluate(() => window.__dialogs || []);
    check('account row: the question names the device and the account', /Safari on iPhone/.test(asked[0] || '') && /Kunde/.test(asked[0] || ''), asked);
    check('… then the account\'s invitation, not a pairing link of the own account', invites === 1 && pairLinks.join() === 'inv-7', pairLinks);
    check('… sent sealed to that device, not shown', box?.id === 'req-7' && typeof box.box?.data === 'string' && !JSON.stringify(box).includes('inv-7') && await a.isHidden('#invite-box'), { box, dialogs: await a.evaluate(() => window.__dialogs) });

    // A computer's code (the desktop app's setup page) for an account without a setup: refused, nothing sent
    box = null;
    await scan(`https://relay.example.com/#approve=req-m&pk=${pk}&kind=machine`);
    const refused = await a.evaluate(() => window.__dialogs || []);
    check('account row: a computer\'s code without a stored setup says what is missing', refused.some((d) => /no setup stored/.test(d)) && setupLinks === 0 && !box, refused);
    check('no page errors', admin.errors.length === 0, admin.errors);
    await admin.close();
}
