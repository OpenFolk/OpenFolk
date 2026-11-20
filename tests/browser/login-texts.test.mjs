// The sign-in page and the key dialog say which secret they ask for: the password and the URL without
// explanations, the relay setup code (two blocks) apart from the device sign-in code (four blocks), and who to ask without server access.

export default async function ({ start, check }) {
    const h = await start({ device: null });
    const p = h.page;
    const text = (sel) => p.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);

    check('password field: just "Password", no hint below', (await text('label:has(#login-token) > span')) === 'Password' && (await text('label:has(#login-token) small')) === null);
    check('URL field: just "URL", no placeholder', (await text('label:has(#login-relay) > span')) === 'URL' && await p.getAttribute('#login-relay', 'placeholder') === null);
    check('no help texts on the card', await p.evaluate(() => [...document.querySelectorAll('#login-form > .start-help')].length === 0 && document.getElementById('login-intro').offsetParent === null));

    await p.evaluate(() => { document.getElementById('login-first').hidden = false; document.getElementById('login').hidden = false; });
    check('device sign-in code: named, four blocks', (await p.evaluate(async () => (await import('/js/i18n.js')).t('login.methodFirst'))).toLowerCase().includes('device sign-in code') && (await text('#login-first label span')).includes('four blocks'));
    check('and told apart from the relay setup code', (await text('#login-first .start-help')).includes('not the relay setup code (two blocks)'));

    await p.evaluate(() => askForKey(''));
    const key = await text('#key-text');
    check('key dialog: with a container or server, the machine is the server', key.includes('container or on a server, the machine is that server') && key.includes('ask your administrator'), key);
    await h.close();
}
