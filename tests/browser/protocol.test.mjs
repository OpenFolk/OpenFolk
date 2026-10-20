// Protocol version: the web app's copy equals shared/protocol.ts; a backend that needs a newer app, or is too old for
// this one, is shown in the footer and on the page of open changes. Backends without a version (from before) fit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function ({ start, check }) {
    const constant = (file, name) => Number((new RegExp(`export const ${name} = (\\d+);`).exec(fs.readFileSync(path.join(ROOT, file), 'utf8')) || [])[1]);
    const shared = constant('shared/protocol.ts', 'PROTOCOL_VERSION');
    const web = constant('webapp/js/core.js', 'PROTOCOL_VERSION');
    check('web app and backend speak the same protocol version', shared > 0 && shared === web, { shared, web });

    const h = await start({ online: ['desk', 'workstation'] });
    const p = h.page;
    const footer = () => p.evaluate(() => { const g = document.getElementById('git-total'); return g.hidden ? '' : g.textContent; });
    await h.push({ type: 'backend_status', machine: 'desk', since: '2026-10-13T08:00:00Z', changed: [] });
    await h.push({ type: 'backend_status', machine: 'workstation', since: '2026-10-13T08:00:00Z', changed: [], protocol: web, minClientProtocol: 0 });
    await h.wait(100);
    check('backend without version and same version: no hint', (await footer()) === '', await footer());

    await h.push({ type: 'backend_status', machine: 'workstation', since: '2026-10-13T08:00:00Z', changed: [], protocol: web + 1, minClientProtocol: web + 1 });
    await h.wait(100);
    check('backend needs a newer app: hint in the footer', (await footer()).includes('WORKSTATION: app and backend do not fit'), await footer());
    await p.evaluate(() => openGitPage());
    await h.wait(200);
    const page = await p.textContent('#git-page-content');
    check('page explains what to update', page.includes('This app is too old for the backend on WORKSTATION') && page.includes('Update the app'), page);
}
