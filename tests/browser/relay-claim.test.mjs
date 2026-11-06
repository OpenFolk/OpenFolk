// Moving from the relay embedded in a backend to a relay on a server: the form in the first steps and in the settings
// sends address and setup code to that machine, shows why a claim failed and, once claimed, opens the pairing link
// the backend answered with.
const SETTINGS = {
    type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: false, shutdownMethod: 'script',
    offers: { shutdown: true, ide: true, terminal: true, voice: true }, settings: {},
};

export default async function ({ start, check }) {
    const h = await start({ bots: [], online: ['desk'], device: 'test' });
    const p = h.page;
    const step4 = '.welcome-steps li:nth-child(4)';

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: { claude: 'ready' } });
    await h.push(SETTINGS);
    await h.wait(200);
    check('relay on a server: no form, the devices button', !(await p.isVisible(`${step4} .relay-claim`)) && await p.isVisible(`${step4} button`));

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'ready' } });
    await h.wait(200);
    check('embedded relay: the form instead of the devices button', await p.isVisible(`${step4} .relay-claim`)
        && (await p.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].map((b) => b.textContent).join('|'), step4)) === 'Claim and move');

    await p.fill(`${step4} input[name="address"]`, 'relay.example.com');
    await p.fill(`${step4} input[name="code"]`, 'ABCDE-FGHJK');
    await h.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'ready', codex: 'missing' } });
    await h.wait(100);
    check('a new state while typing keeps what was typed and the focus', (await p.inputValue(`${step4} input[name="address"]`)) === 'relay.example.com'
        && await p.evaluate((sel) => document.activeElement === document.querySelector(`${sel} input[name="code"]`), step4));
    h.sent.length = 0;
    await p.click(`${step4} .relay-claim button`);
    await h.wait(500);
    const sent = h.sent.find((x) => x.type === 'relay_claim');
    check('the button sends address and code to that machine', sent?.machine === 'desk' && sent.address === 'relay.example.com' && sent.code === 'ABCDE-FGHJK', sent);
    check('while it runs, the button waits', await p.isDisabled(`${step4} .relay-claim button`));

    await h.push({ type: 'error', machine: 'desk', request: 'relay_claim', message: 'Wrong setup code.' });
    await h.wait(500);
    check('refused: the reason in the form, the button free again', (await p.textContent(`${step4} .relay-claim .error`)) === 'Wrong setup code.'
        && !(await p.isDisabled(`${step4} .relay-claim button`)));

    // The settings show the same form in the devices block; this time the relay typed in is the page's own host
    const target = new URL(p.url());
    await p.fill(`${step4} input[name="address"]`, `http://${target.host}`);
    await p.click(`${step4} .relay-claim button`);
    await p.evaluate(() => openSettings());
    await h.wait(300);
    check('settings: the form in the devices block', await p.isVisible('#relay-claim-box .relay-claim'));
    await p.evaluate(() => closeDialog(document.getElementById('settings')));

    // Only a link to the relay typed in: one to another host or with another scheme is not followed
    await h.push({ type: 'relay_claimed', machine: 'desk', url: 'https://elsewhere.example/#pair=x' });
    await h.push({ type: 'relay_claimed', machine: 'desk', url: `javascript:alert(1)//${target.host}` });
    await h.wait(1600);
    check('a link to another host or scheme: ignored, the page stays', new URL(p.url()).host === target.host
        && !(await p.textContent(`${step4} .relay-claim`)).includes('Switching to it'), p.url());

    target.hash = 'claimed';
    await h.push({ type: 'relay_claimed', machine: 'desk', url: target.href });
    await h.wait(400);
    check('claimed: says it moves over', (await p.textContent(`${step4} .relay-claim`)).includes('Switching to it'));
    await h.wait(1200);
    check('claimed: the page opens the link, marked as a move', new URL(p.url()).hash === '#claimed&moved=1', p.url());

    // The new relay is another origin: nothing the old page stored is there, so the mark travels in the link
    const g = await start({ bots: [], online: ['desk'], device: 'test' });
    const q = g.page;
    await g.push({ type: 'setup_status', machine: 'desk', relay: 'embedded', container: false, engines: { claude: 'ready' } });
    await g.push(SETTINGS);
    await g.wait(200);
    await q.fill(`${step4} input[name="address"]`, 'second.local');
    await q.fill(`${step4} input[name="code"]`, 'ABCDE-FGHJK');
    await q.click(`${step4} .relay-claim button`);
    await g.wait(300);
    await g.push({ type: 'relay_claimed', machine: 'desk', url: 'http://second.local/#pair=one-time' });
    await q.waitForURL((u) => u.host === 'second.local', { timeout: 5000 });
    await q.waitForSelector('#toast:not([hidden])', { timeout: 5000 });
    check('moved to another origin: once signed in there it says "Moved to <host>"', (await q.textContent('#toast')).startsWith('Moved to second.local.'), await q.textContent('#toast'));
    check('moved: the mark of the link is gone from the address bar', !new URL(q.url()).hash, q.url());
    await q.reload();
    await g.wait(1200);
    check('moved: a reload does not say it again', !(await q.isVisible('#toast')));
    check('moved: no script errors', g.errors.length === 0, g.errors);
    await g.close();

    // Same, in German
    const d = await start({ bots: [], online: ['desk'], device: 'test', language: 'de' });
    await d.page.goto('http://second.local/#pair=x&moved=1');
    await d.page.waitForSelector('#toast:not([hidden])', { timeout: 5000 });
    check('moved: German', (await d.page.textContent('#toast')).startsWith('Umgezogen auf second.local.'), await d.page.textContent('#toast'));
    await d.close();

    // A page that was not moved to says nothing
    const n = await start({ bots: [], online: ['desk'], device: 'test' });
    await n.wait(1000);
    check('no move: no message', !(await n.page.isVisible('#toast')));
    await n.close();
}
