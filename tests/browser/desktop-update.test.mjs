// The desktop app's own update in the settings (block "About"): the state the app reports, "Check for updates",
// "Restart now" once a version is downloaded, the switch for the automatic checks, and a build that does not update
// itself. The bridge (desktop/preload.js) is a stub here; the browser and a desktop app without it show nothing.

export default async function ({ start, check }) {
    const desk = await start({
        before: () => {
            Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 OpenFolk/0.7.1 Electron/44' });
            window.__calls = [];
            let state = { supported: true, auto: true, forced: false, current: '0.7.1', phase: 'idle', version: '', message: '' };
            let listener = null;
            window.__push = (s) => { state = s; listener?.(s); };
            window.openfolkDesktop = {
                updateState: async () => { window.__calls.push(['state']); return state; },
                updateCheck: async () => {
                    window.__calls.push(['check']);
                    await new Promise((r) => setTimeout(r, 150));
                    state = { ...state, phase: 'downloading', version: '0.7.2' };
                    return state;
                },
                updateAuto: async (on) => { window.__calls.push(['auto', on]); state = { ...state, auto: on }; return state; },
                updateRestart: async () => { window.__calls.push(['restart']); },
                onUpdateState: (h) => { listener = h; },
            };
        },
    });
    const p = desk.page;
    await p.click('[data-tab=settings]');
    await desk.wait(300);
    const box = '#about-update';
    check('desktop app: the update below the versions', await p.isVisible(`${box} .about-update-check`) && (await p.textContent(`${box} h4`)) === 'Updates');
    check('the automatic checks: switched on as the app says', await p.isChecked(`${box} .about-update-auto`));

    await p.click(`${box} .about-update-check`);
    await desk.wait(50);
    check('while it checks: says so, the button waits', (await p.textContent(`${box} .about-update-state`)) === 'Checking for updates …' && await p.isDisabled(`${box} .about-update-check`));
    await desk.wait(300);
    check('a new version found: it is downloading', (await p.textContent(`${box} .about-update-state`)) === 'Version 0.7.2 is downloading …', await p.textContent(box));

    // The download finished: the app sends the new state by itself
    await p.evaluate(() => window.__push({ supported: true, auto: true, forced: false, current: '0.7.1', phase: 'ready', version: '0.7.2', message: '' }));
    await desk.wait(100);
    check('downloaded: "ready" and "Restart now" instead of the check', (await p.textContent(`${box} .about-update-state`)) === 'Version 0.7.2 is ready.'
        && await p.isVisible(`${box} .about-update-restart`) && !(await p.isVisible(`${box} .about-update-check`)));
    await p.click(`${box} .about-update-restart`);
    await p.click(`${box} .about-update-auto`);
    await desk.wait(100);
    const calls = await p.evaluate(() => window.__calls);
    check('restart and the switch go to the app', calls.some((c) => c[0] === 'restart') && calls.some((c) => c[0] === 'auto' && c[1] === false), calls);
    check('the switch shows what the app answered', !(await p.isChecked(`${box} .about-update-auto`)));

    await p.evaluate(() => window.__push({ supported: true, auto: true, forced: false, current: '0.7.1', phase: 'failed', version: '', message: 'openfolk.app: HTTP 503; GitHub: HTTP 403' }));
    await desk.wait(100);
    check('a failed check: the reasons, the button free again', (await p.textContent(`${box} .error`)).includes('HTTP 503; GitHub: HTTP 403') && !(await p.isDisabled(`${box} .about-update-check`)));

    await p.evaluate(() => window.__push({ supported: true, auto: false, forced: true, current: '0.7.1', phase: 'idle', version: '', message: '' }));
    await desk.wait(100);
    check('OPENFOLK_NO_UPDATE: the switch off and locked, saying why', !(await p.isChecked(`${box} .about-update-auto`)) && await p.isDisabled(`${box} .about-update-auto`)
        && (await p.textContent(box)).includes('OPENFOLK_NO_UPDATE is set'));

    await p.evaluate(() => window.__push({ supported: false, auto: false, forced: false, current: '0.7.1', phase: 'idle', version: '', message: '' }));
    await desk.wait(100);
    check('a build that does not update itself: says so, no button', (await p.textContent(box)).includes('does not update itself') && !(await p.isVisible(`${box} button`)));
    check('no page errors', desk.errors.length === 0, desk.errors);
    await desk.close();

    // The browser: no update block
    const web = await start({});
    await web.page.click('[data-tab=settings]');
    await web.wait(300);
    check('browser: no update block', await web.page.isHidden('#about-update'));
    await web.close();
}
