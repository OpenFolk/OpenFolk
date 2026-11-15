// Presence for the push rule "the phone stays quiet while a desktop is in use": every machine awake hears whether the
// page is visible, a desktop also whether it is in use (input in the last two minutes), reported on the change and
// at most once a minute while it lasts. A phone says it is one and can choose to be notified always.

const DESKTOP = { viewport: { width: 1400, height: 900 }, screen: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

export default async function ({ start, check }) {
    // ---- a desktop browser
    const h = await start({ online: ['desk', 'workstation'], context: DESKTOP, now: Date.parse('2026-11-14T09:00:00Z') });
    const p = h.page;
    const presence = () => h.sent.filter((f) => f.type === 'presence');
    let sent = presence();
    check('presence to every machine awake', sent.map((f) => f.machine).sort().join() === 'desk,workstation', sent);
    check('a desktop says so, and is not in use before any input', sent.every((f) => f.visible === true && f.desktop === true && f.active === false), sent);

    h.sent.length = 0;
    await p.mouse.move(200, 200);
    await p.mouse.move(300, 250);
    await h.wait(100);
    sent = presence();
    check('input: in use, once to each machine', sent.length === 2 && sent.every((f) => f.active === true) && sent.map((f) => f.machine).sort().join() === 'desk,workstation', sent);

    h.sent.length = 0;
    await p.clock.fastForward(30_000);
    await p.keyboard.press('Shift');
    await h.wait(100);
    check('more input within the minute: nothing sent', presence().length === 0, presence());
    await p.clock.fastForward(40_000);
    await p.mouse.move(320, 260);
    await h.wait(100);
    check('input after a minute: the report is renewed', presence().length === 2 && presence().every((f) => f.active === true), presence());

    h.sent.length = 0;
    await p.clock.fastForward(2 * 60_000 + 1000);
    await h.wait(100);
    check('two minutes without input: no longer in use', presence().length === 2 && presence().every((f) => f.active === false && f.visible === true), presence());
    h.sent.length = 0;
    await p.clock.fastForward(10 * 60_000);
    await h.wait(100);
    check('idle: nothing more is sent', presence().length === 0, presence());

    await h.push({ type: 'agents', online: ['desk', 'workstation', 'laptop'] });
    await h.wait(100);
    check('a machine that wakes gets the presence, the others not again', presence().map((f) => f.machine).join() === 'laptop', presence());
    check('a desktop has no "always notify"', !(await p.isVisible('#push-always')));
    check('no page errors', h.errors.length === 0, h.errors);
    await h.close();

    // ---- a phone browser (the harness's default device); "always notify" is in native-app.test.mjs
    const m = await start({ online: ['desk', 'workstation'] });
    sent = m.sent.filter((f) => f.type === 'presence');
    check('phone: presence to every machine, as a phone without activity', sent.map((f) => f.machine).sort().join() === 'desk,workstation' && sent.every((f) => f.desktop === false && !('active' in f)), sent);
    await m.page.mouse.move(100, 100);
    await m.wait(100);
    check('phone: input sends nothing', m.sent.filter((f) => f.type === 'presence').length === 2);
    check('phone: no page errors', m.errors.length === 0, m.errors);
    await m.close();
}
