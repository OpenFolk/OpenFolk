// With the end-to-end key on the device, the frames the relay answers itself stay readable in plain text: the joined
// machines ("Add machine") and the second factor. Only backend frames have to be encrypted.
import crypto from 'node:crypto';

const KEY = crypto.randomBytes(32);

export default async function ({ start, check }) {
    const h = await start({
        secure: true,
        path: `#e2e=${KEY.toString('base64url')}`,
        online: ['desk'],
    });
    const p = h.page;
    check('key taken over from the link', await p.evaluate(() => !!e2e.key));

    await p.click('#btn-settings');
    await h.wait(100);
    check('the relay is asked for the joined machines and the second factor', h.sent.some((f) => f.type === 'machine_tokens') && h.sent.some((f) => f.type === 'totp_status'));
    check('no "Add machine" before the relay answered', !(await p.isVisible('#machine-add')));

    await h.push({ type: 'machine_tokens', list: [] });
    await h.wait(100);
    check('the plain answer counts: "Add machine"', await p.isVisible('#machine-add'));

    await h.push({ type: 'totp', active: false, available: true });
    await h.wait(50);
    check('second factor: the plain state counts', await p.isVisible('#totp-box button'));
    await p.click('#totp-box button');
    await h.wait(50);
    await h.push({ type: 'totp_setup', secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', uri: 'otpauth://totp/OpenFolk:test.local?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=OpenFolk' });
    await h.wait(50);
    check('second factor: the plain secret counts', await p.isVisible('#totp-box svg path'));

    // What stays encrypted: a bot list in plain text is still ignored
    await h.sendBots();
    check('a backend frame in plain text is still ignored', (await p.locator('#chat-list li', { hasText: 'PDF-Reader' }).count()) === 0);
    await h.close();
}
