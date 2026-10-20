// The main account's first device with the code from the container log: the sign-in page offers the field only while
// the relay says there is no device yet, sends its key (never the code), opens the box a backend sealed with the code
// (local/src/first-device.ts, the real sealing) and signs in with the token and the key inside.
import { newFirstDeviceCode, sealFirstDevice } from '../../local/src/first-device.ts';

const KEY = Buffer.alloc(32, 7).toString('base64url');

export default async function ({ start, check }) {
    const code = newFirstDeviceCode();
    let toWaiting = null;
    const h = await start({
        secure: true, device: null,
        onSend: (f, push, state, reply) => {
            if (f.type === 'pair_wait') {
                toWaiting = reply;
                return reply({ type: 'pair_wait', id: 'req-first', expiresAt: new Date(Date.now() + 600_000).toISOString(), first: true });
            }
        },
    });
    const p = h.page;
    await h.wait(300);
    check('no device yet: the code field below the QR code', await p.isVisible('#login-first') && await p.isVisible('#login-qr svg'));

    await p.fill('#login-first-code', 'ABCD');
    await p.click('#login-first-send');
    await h.wait(100);
    check('a code too short: says how long, asks nothing', (await p.textContent('#login-error')).includes('16 characters') && !h.sent.some((f) => f.type === 'pair_first'));

    await p.fill('#login-first-code', code.toLowerCase());
    await p.press('#login-first-code', 'Enter');
    await h.wait(200);
    const asked = h.sent.find((f) => f.type === 'pair_first');
    const link = await p.getAttribute('#login-qr-code', 'data-link');
    const pk = /&pk=([\w-]+)$/.exec(link || '')?.[1] || '';
    check('Enter asks with the key of the QR code, the code stays on the device', asked?.pk === pk && !JSON.stringify(h.sent).includes(code.replace(/-/g, '').slice(0, 8)), asked);
    check('Enter does not submit the password form', !h.sent.some((f) => f.type === 'auth'));

    await toWaiting({ type: 'pair_first', ok: false, reason: 'busy' });
    await h.wait(100);
    check('refused: the reason, and the button free again', (await p.textContent('#login-error')).includes('Another request') && !(await p.isDisabled('#login-first-send')));

    await p.click('#login-first-send');
    await h.wait(100);
    const box = await sealFirstDevice(`pair=tok-first&e2e=${KEY}`, 'req-first', pk, code);
    await toWaiting({ type: 'pair_wait', box });
    await h.wait(1500);
    const auth = h.sent.find((f) => f.type === 'auth');
    check('the box opens with the typed code: signed in with its token', auth?.pair === 'tok-first' && !auth.token, auth);
    check('… with the end-to-end key, off the start page', await p.evaluate(() => !!e2e.key) && !(await p.isVisible('#login')));
    await h.close();

    // ---- a mistyped code: the box does not open, the page says so
    let reply2 = null;
    const wrong = await start({
        secure: true, device: null,
        onSend: (f, push, state, reply) => {
            if (f.type === 'pair_wait') {
                reply2 = reply;
                return reply({ type: 'pair_wait', id: 'req-2', expiresAt: new Date(Date.now() + 600_000).toISOString(), first: true });
            }
        },
    });
    await wrong.wait(300);
    await wrong.page.fill('#login-first-code', newFirstDeviceCode());
    await wrong.page.click('#login-first-send');
    await wrong.wait(100);
    const pk2 = /&pk=([\w-]+)$/.exec((await wrong.page.getAttribute('#login-qr-code', 'data-link')) || '')?.[1] || '';
    await reply2({ type: 'pair_wait', box: await sealFirstDevice(`pair=tok-2&e2e=${KEY}`, 'req-2', pk2, code) });
    await wrong.wait(1500);
    check('wrong code: says it does not fit, no sign-in', (await wrong.page.textContent('#login-error')).includes('does not fit') && !wrong.sent.some((f) => f.type === 'auth'));
    await wrong.close();

    // ---- a relay with devices: no field
    const later = await start({
        secure: true, device: null,
        onSend: (f, push, state, reply) => { if (f.type === 'pair_wait') return reply({ type: 'pair_wait', id: 'req-3', expiresAt: new Date(Date.now() + 600_000).toISOString() }); },
    });
    await later.wait(300);
    check('with a device on the relay: no code field', await later.page.isVisible('#login-qr svg') && !(await later.page.isVisible('#login-first')));
    await later.close();
}
