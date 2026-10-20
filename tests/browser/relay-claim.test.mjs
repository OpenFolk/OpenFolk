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

    // The settings show the same form in the devices block
    await p.click(`${step4} .relay-claim button`);
    await p.evaluate(() => openSettings());
    await h.wait(300);
    check('settings: the form in the devices block', await p.isVisible('#relay-claim-box .relay-claim'));
    await p.evaluate(() => closeDialog(document.getElementById('settings')));

    const target = new URL(p.url());
    target.hash = 'claimed';
    await h.push({ type: 'relay_claimed', machine: 'desk', url: target.href });
    await h.wait(400);
    check('claimed: says it moves over', (await p.textContent(`${step4} .relay-claim`)).includes('Switching to it'));
    await h.wait(1200);
    check('claimed: the page opens the link', new URL(p.url()).hash === '#claimed', p.url());
}
