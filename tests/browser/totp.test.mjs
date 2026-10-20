// Second factor in "Devices and security": set up with QR code and a confirming code, switched off with a code;
// hidden for an account that may not set it.

export default async function ({ start, check }) {
    const h = await start({});
    const p = h.page;
    await p.click('#btn-settings');
    await h.wait(100);
    check('the settings ask the relay', h.sent.some((f) => f.type === 'totp_status'));
    check('hidden until the relay answers', !(await p.isVisible('#totp-box')));

    await h.push({ type: 'totp', active: false, available: false });
    await h.wait(50);
    check('another account: nothing to set', !(await p.isVisible('#totp-box')) && !(await p.isVisible('#totp-title')));

    await h.push({ type: 'totp', active: false, available: true });
    await h.wait(50);
    check('off: explained, with a button to set it up', await p.isVisible('#totp-box button') && (await p.textContent('#totp-box')).includes('Off'));
    await p.click('#totp-box button');
    await h.wait(50);
    const begin = h.sent.find((f) => f.type === 'totp_begin');
    check('setting up asks the relay for a secret, named after it', begin && begin.label === 'test.local', begin);

    await h.push({ type: 'totp_setup', secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', uri: 'otpauth://totp/OpenFolk:test.local?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=OpenFolk' });
    await h.wait(50);
    check('QR code and the key in groups of four', await p.isVisible('#totp-box svg path') && (await p.textContent('#totp-box .totp-secret')) === 'ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
    await p.fill('#totp-box .totp-row input', '12');
    await p.click('#totp-box .totp-row button');
    await h.wait(50);
    check('too short: said so, nothing sent', (await p.textContent('#totp-box .error')).includes('6 digits') && !h.sent.some((f) => f.type === 'totp_confirm'));
    await p.fill('#totp-box .totp-row input', '123 456');
    await p.click('#totp-box .totp-row button');
    await h.wait(50);
    const confirm = h.sent.find((f) => f.type === 'totp_confirm');
    check('the code goes to the relay without spaces', confirm && confirm.code === '123456', confirm);
    await h.push({ type: 'error', request: 'totp_confirm', code: 'totp_wrong_code', message: 'Wrong code.' });
    await h.wait(50);
    check('a wrong code: shown at the field', (await p.textContent('#totp-box .error')).includes('Wrong code'));

    await h.push({ type: 'totp', active: true, available: true });
    await h.wait(50);
    check('on: switching off with a code', (await p.textContent('#totp-box')).includes('On') && (await p.textContent('#totp-box .totp-row button')) === 'Switch off');
    await p.fill('#totp-box .totp-row input', '654321');
    await p.click('#totp-box .totp-row button');
    await h.wait(50);
    const off = h.sent.find((f) => f.type === 'totp_off');
    check('switching off sends the code', off && off.code === '654321', off);
}
