// The relay's version (relayVersion in the backends' backend_status): next to its address on the status page and in
// "About"; a line and the "!" on the status tab when the relay is older than this app or a connected backend (major.minor
// only); "unknown (older than 0.9.0)" for a relay that tells nothing to a backend that could have heard it; nothing for
// backends from before the field.
import { bot } from './harness.mjs';
import { VERSION } from '../../webapp/js/release.js';

const [major, minor] = VERSION.split('.').map(Number);
const patchOf = (n) => `${major}.${minor}.${n}`;
const status = (machine, extra) => ({ type: 'backend_status', machine, since: new Date().toISOString(), changed: [], ...extra });

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader')], online: ['desk', 'laptop'] });
    const p = h.page;
    await p.click('[data-tab=machines]');
    await h.wait(200);
    const line = () => p.evaluate(() => {
        const n = document.querySelector('#machines-relay');
        return n.hidden ? null : { text: n.firstElementChild.textContent, old: n.querySelector('.relay-old')?.textContent ?? '' };
    });
    const badge = () => p.evaluate(() => { const b = document.querySelector('#tab-status-badge'); return b.hidden ? '' : b.textContent; });
    const about = () => p.evaluate(() => [...document.querySelectorAll('#about-list dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
    const set = async (...frames) => { for (const f of frames) await h.push(f); await h.wait(150); };

    check('no backend status yet: no relay line, no badge', (await line()) === null && (await badge()) === '');

    // backends from before the field say nothing about the relay
    await set(status('desk', { version: '0.8.0' }), status('laptop'));
    check('a backend before 0.9.0 gives no relay line', (await line()) === null);

    // same major.minor as the app, patch behind: shown, no warning
    await set(status('desk', { version: VERSION, relayVersion: patchOf(0) }));
    let l = await line();
    check('the relay line names the address and the version', l && /^Relay \S+ · \d+\.\d+\.0$/.test(l.text), l);
    check('same major.minor: no warning, no badge', l && l.old === '' && (await badge()) === '', [l, await badge()]);

    // a relay a minor behind the app
    const behind = `${major}.${Math.max(0, minor - 1)}.9`;
    if (minor > 0) {
        await set(status('desk', { version: VERSION, relayVersion: behind }));
        l = await line();
        check('older than this app: the line says so and which version', l && l.old === `The relay (version ${behind}) is older than this app (${VERSION}). Update the relay.`, l);
        check('… and the status tab gets its "!"', (await badge()) === '!', await badge());
    }

    // older than a connected backend that is newer than the app
    const newer = `${major}.${minor + 1}.0`;
    await set(status('desk', { version: VERSION, relayVersion: VERSION }), status('laptop', { version: newer, relayVersion: VERSION }));
    l = await line();
    check('older than a backend: names the machine', l && l.old === `The relay (version ${VERSION}) is older than the backend on LAPTOP (${newer}). Update the relay.`, l);
    await set({ type: 'agents', online: ['desk'], gone: {} });
    check('a backend that is gone is not compared any more', (await line())?.old === '', await line());
    await set({ type: 'agents', online: ['desk', 'laptop'], gone: {} });

    // a relay that tells no version to a backend that could have heard it
    await set(status('desk', { version: '0.9.0' }), status('laptop', { version: '0.10.0' }));
    l = await line();
    check('no relay version, backend 0.9+: "unknown (older than 0.9.0)"', l && l.text.endsWith('· unknown (older than 0.9.0)'), l);
    check('… and a warning, since the relay is older than that backend', l && l.old === 'The relay is older than the backend on LAPTOP (0.10.0). Update the relay.', l);

    // About
    await p.click('[data-tab=settings]');
    await h.wait(200);
    const rows = await about();
    const relay = rows.find(([label]) => label === 'Relay');
    check('about: a row for the relay, with its address', relay && /^unknown \(older than 0\.9\.0\) · \S+$/.test(relay[1]), rows);
    await set(status('desk', { version: VERSION, relayVersion: VERSION }), status('laptop', { version: VERSION, relayVersion: VERSION }));
    check('about: the relay\'s version once it tells', (await about()).find(([label]) => label === 'Relay')?.[1].startsWith(`${VERSION} · `), await about());
    await h.close();

    const german = await start({ bots: [bot('pdf', 'PDF-Reader')], online: ['desk'], language: 'de' });
    await german.page.click('[data-tab=machines]');
    await german.push(status('desk', { version: '0.9.0' }));
    await german.wait(200);
    const text = await german.page.$eval('#machines-relay', (n) => n.textContent);
    check('German: the same line in German', text.includes('unbekannt (älter als 0.9.0)') && text.includes('Aktualisiere das Relay'), text);
    await german.close();
}
