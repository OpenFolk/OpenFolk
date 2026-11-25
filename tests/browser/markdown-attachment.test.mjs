// A Markdown attachment opens to read in the app, formatted like a bot's answer, instead of being downloaded;
// "Save" still hands over the file, Escape closes the view. Other files are downloaded as before.
import { bot } from './harness.mjs';

const PLAN = '# Plan\n\n- first step\n- second step\n\n```\nnpm test\n```\n';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        history: { pdf: [{
            id: 'a1', role: 'assistant', botId: 'pdf', text: 'Here is the plan', ts: '2026-11-25T08:00:00Z',
            attachments: [
                { name: 'plan.md', type: 'text/markdown', path: 'C:/w/plan.md', size: PLAN.length },
                { name: 'data.csv', type: 'text/csv', path: 'C:/w/data.csv', size: 10 },
            ],
        }] },
        async onSend(f, push) {
            if (f.type === 'file_get') {
                const md = f.path.endsWith('.md');
                await push({ type: 'file', path: f.path, name: md ? 'plan.md' : 'data.csv', mime: md ? 'text/markdown' : 'text/csv', data: b64(md ? PLAN : 'a,b\n1,2\n') });
            }
        },
    });
    const p = h.page;
    await p.evaluate(() => { window.__downloads = []; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); else click.call(this); }; });
    await h.openChat('PDF-Reader');
    await h.wait(200);
    await p.locator('.attachment', { hasText: 'plan.md' }).click();
    await h.wait(400);
    const view = await p.evaluate(() => ({
        open: !document.getElementById('doc-view').hidden, title: document.getElementById('doc-title').textContent,
        heading: document.querySelector('#doc-content h1')?.textContent, items: document.querySelectorAll('#doc-content li').length,
        code: Boolean(document.querySelector('#doc-content pre')), downloads: window.__downloads.length,
    }));
    check('a Markdown attachment opens formatted in the app, nothing downloaded', view.open && view.title === 'plan.md' && view.heading === 'Plan' && view.items === 2 && view.code && view.downloads === 0, view);
    await p.click('#doc-save');
    await h.wait(300);
    check('"Save" hands over the file', (await p.evaluate(() => window.__downloads)).includes('plan.md'));
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('Escape closes the view', await p.evaluate(() => document.getElementById('doc-view').hidden));
    await p.locator('.attachment', { hasText: 'data.csv' }).click();
    await h.wait(300);
    check('another file is downloaded as before', (await p.evaluate(() => window.__downloads)).includes('data.csv') && await p.evaluate(() => document.getElementById('doc-view').hidden));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
