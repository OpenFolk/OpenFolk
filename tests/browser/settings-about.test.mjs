// Settings, section "About": the versions the app really knows. Its own protocol version, the desktop app's version (from
// the user agent, only there) and, per connected backend, what its backend_status reports. Nothing is made up.
import { bot } from './harness.mjs';

const about = (p) => p.evaluate(() => [...document.querySelectorAll('#about-list dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));

export default async function ({ start, check }) {
    const web = await start({ bots: [bot('pdf', 'PDF-Reader')], online: ['desk', 'laptop'] });
    let p = web.page;
    await p.click('[data-tab=settings]');
    await web.wait(200);
    let rows = await about(p);
    check('about: the section is there', await p.isVisible('#settings-about') && (await p.textContent('#settings-about h3')).includes('About'));
    check('about: browser: the web app\'s protocol version, no desktop line', rows.some(([l, v]) => l === 'Web app' && /^protocol version \d+$/.test(v)) && !rows.some(([l]) => l === 'Desktop app'), rows);

    await web.push({ type: 'backend_status', machine: 'desk', since: new Date().toISOString(), changed: [], protocol: 2, minClientProtocol: 1 });
    await web.push({ type: 'backend_status', machine: 'laptop', since: new Date().toISOString(), changed: [] });
    await web.wait(300);
    rows = await about(p);
    const desk = rows.find(([l]) => l === 'Backend DESK');
    const laptop = rows.find(([l]) => l === 'Backend LAPTOP');
    check('about: an open page shows a backend as soon as it reports: its protocol version and start', desk && /^protocol version 2 · running since \d/.test(desk[1]), rows);
    check('about: a backend without a protocol version says so, instead of a number', laptop && laptop[1].startsWith('from before protocol versions'), rows);
    check('about: no backend software version is invented', !rows.some(([l, v]) => l.startsWith('Backend') && /\b\d+\.\d+\.\d+\b/.test(v)), rows);
    await web.close();

    const desktop = await start({
        bots: [bot('pdf', 'PDF-Reader')], online: ['desk'],
        before: "Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenFolk/0.1.2 Chrome/140.0.0.0 Electron/44.7.0 Safari/537.36' });",
    });
    p = desktop.page;
    await p.click('[data-tab=settings]');
    await desktop.wait(200);
    rows = await about(p);
    check('about: desktop app: its version from the user agent, after OpenFolk\'s', rows[1]?.[0] === 'Desktop app' && rows[1][1] === '0.1.2', rows);
    await desktop.close();

    const german = await start({ bots: [bot('pdf', 'PDF-Reader')], online: [], language: 'de' });
    await german.page.click('[data-tab=settings]');
    await german.wait(200);
    rows = await about(german.page);
    check('about: German, and without a backend it says so', rows.some(([l, v]) => l === 'Web-App' && v.startsWith('Protokollversion ')) && rows.some(([l]) => l === 'Kein Backend verbunden.') && (await german.page.textContent('#settings-about h3')).includes('Über'), rows);
    await german.close();
}
