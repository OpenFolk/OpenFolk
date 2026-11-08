// The sign-in page and the key dialog say which secret they ask for: the relay password and where it comes from, the
// relay setup code (two blocks) apart from the device sign-in code (four blocks), and who to ask without server access.

export default async function ({ start, check }) {
    const h = await start({ device: null });
    const p = h.page;
    const text = (sel) => p.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);

    check('password field is the relay password', (await text('#login-token ~ span, label:has(#login-token) > span')) === 'Relay password');
    const hint = await text('label:has(#login-token) small');
    check('says where the password comes from', hint && hint.includes('USER_PASSWORD') && hint.includes('node local/tools/e2e.mjs password') && hint.includes('pairing link'), hint);

    await p.evaluate(() => { document.getElementById('login-first').hidden = false; document.getElementById('login').hidden = false; });
    check('device sign-in code: named, four blocks', (await text('#login-first .login-or')).includes('device sign-in code') && (await text('#login-first label span')).includes('four blocks'));
    check('and told apart from the relay setup code', (await text('#login-first .start-help')).includes('not the relay setup code (two blocks)'));

    await p.evaluate(() => askForKey(''));
    const key = await text('#key-text');
    check('key dialog: with a container or server, the machine is the server', key.includes('container or on a server, the machine is that server') && key.includes('ask your administrator'), key);
    await h.close();
}
