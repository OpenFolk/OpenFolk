// "Open changes" says since when something is open (GitRepo.since from the backend); a repo without it shows no time.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const today = new Date();
    today.setHours(9, 41, 0, 0);
    const SKOOL = { name: 'skool', path: '', branch: 'main', ahead: 0, behind: 0, files: [{ status: ' M', path: 'a.ts' }], more: 0, since: today.toISOString() };
    const MAIL = { name: 'mail', path: '', branch: 'main', ahead: 1, behind: 0, files: [], more: 0 };
    const h = await start({ bots: [bot('skool', 'Skool'), bot('mail', 'Mail')] });
    const p = h.page;
    await h.push({ type: 'git_status', machine: 'desk', status: { skool: [SKOOL], mail: [MAIL] } });
    await h.wait(100);
    await p.click('#tab-repos');
    await h.wait(200);
    const meta = await p.$$eval('#git-page .git-repo', (rows) => Object.fromEntries(rows.map((r) => [r.querySelector('strong').textContent, r.querySelector('.git-meta')?.textContent || ''])));
    check('a repo with a time: "since" and the time of today', meta.skool.includes("since 09:41"), meta);
    check('a repo without: no time', !meta.mail.includes('since'), meta);
    check('no page errors', h.errors.length === 0, h.errors);
    await h.close();
}
