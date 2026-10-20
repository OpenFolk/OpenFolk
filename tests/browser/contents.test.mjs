// Contents of a message: read aloud (speech output as a stub), view an image large instead of downloading,
// @ choice in the input field.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bot } from './harness.mjs';

const ICONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'webapp', 'icons');
const preview = 'data:image/png;base64,' + fs.readFileSync(path.join(ICONS, 'icon-192.png')).toString('base64');
const original = fs.readFileSync(path.join(ICONS, 'icon-512.png')).toString('base64');
const text = 'I found the bug. The function `send()` throws on an empty list. **Fix:**\n\n```js\nif (!list.length) return;\n```\n\nDetails are at https://example.com/docs. Shall I deploy?';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader'), bot('cloud', 'Cloud Carlo'), bot('mail', 'Mail Marie')],
        history: {
            pdf: [
                { id: 'u1', role: 'user', from: 'me', text: 'Have a look', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:01Z', attachments: [{ name: 'photo.png', type: 'image/png', size: 3500, path: 'C:/uploads/photo.png', thumb: preview, machine: 'desk' }] },
                { id: 'a1', role: 'assistant', botId: 'pdf', text, ts: '2026-10-08T05:00:30Z' },
            ],
        },
        before: () => {
            window.__spoken = [];
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            // __stuck: like iOS after a recording, the output does not start (no onstart)
            window.__stuck = false;
            window.__resume = 0;
            Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => [{ name: 'Anna', lang: 'de-DE', localService: true }, { name: 'Samantha', lang: 'en-US', localService: true }],
                speak: (u) => { window.__spoken.push(u); if (!window.__stuck && u.onstart) setTimeout(() => u.onstart(), 10); },
                cancel: () => undefined,
                resume: () => { window.__resume++; },
            } });
        },
        onSend: async (f, push) => {
            if (f.type === 'file_get') setTimeout(() => push({ type: 'file', path: f.path, name: 'photo.png', mime: 'image/png', data: original }), 300);
        },
    });
    const p = h.page;
    await h.openChat('PDF');

    check('read-aloud button on the answer, not on the own message', (await p.locator('.bubble.bot .speak').count()) === 1 && (await p.locator('.bubble.me .speak').count()) === 0);
    await p.click('.bubble.bot .speak');
    const g = await p.evaluate(() => window.__spoken.map((u) => ({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name })));
    check('read without Markdown, code and link only announced', g.map((x) => x.text).join(' ') === 'I found the bug. The function send() throws on an empty list. Fix: (code block) Details are at link. Shall I deploy?', g);
    check('voice in the UI language', g[0] && g[0].lang === 'en-US' && g[0].voice === 'Samantha', g[0]);
    check('button shows "speaking"', await p.evaluate(() => document.querySelector('.speak').classList.contains('speaking')));
    await p.click('.bubble.bot .speak');
    check('second tap stops', !(await p.evaluate(() => document.querySelector('.speak').classList.contains('speaking'))));
    check('after cancelling the speech output is woken again', await p.evaluate(() => window.__resume >= 2));
    await p.click('.bubble.bot .speak');
    await p.click('.bubble.bot .speak');
    const silent = await p.evaluate(() => [...document.querySelectorAll('[data-el=messages] .event')].filter((x) => x.textContent.includes('silent mode')).length);
    check('iPhone: hint about the silent mode, only on the first reading', silent === 1, silent);

    // the output hangs: a second try after 1.5 s, afterwards a hint instead of silence
    const stuck = await p.evaluate(() => { window.__stuck = true; window.__spoken = []; return true; });
    await p.click('.bubble.bot .speak');
    await h.wait(1700);
    const tries = await p.evaluate(() => window.__spoken.length);
    check('does not start: second try', stuck && tries === 2 && await p.evaluate(() => document.querySelector('.speak').classList.contains('speaking')), tries);
    await h.wait(1600);
    const hint = await p.evaluate(() => [...document.querySelectorAll('[data-el=messages] .event')].map((x) => x.textContent).join(' '));
    check('does not start again: hint, button no longer active', hint.includes('Speech output does not start') && !(await p.evaluate(() => document.querySelector('.speak').classList.contains('speaking'))), hint);
    await p.evaluate(() => { window.__stuck = false; });

    let downloads = 0;
    p.on('download', () => downloads++);
    await p.click('.attachment.image');
    await h.wait(100);
    const view = () => p.evaluate(() => { const o = document.getElementById('image-view'); const i = o.querySelector('img'); return { open: !o.hidden, photo: o.classList.contains('photo'), size: `${i.naturalWidth}x${i.naturalHeight}` }; });
    check('image opens large right away with the preview', JSON.stringify(await view()) === JSON.stringify({ open: true, photo: true, size: '192x192' }), await view());
    await h.wait(500);
    check('the original replaces the preview', (await view()).size === '512x512', await view());
    check('image view centered', await p.evaluate(() => { const r = document.querySelector('#image-view img').getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - innerHeight / 2) < 30; }));
    await p.click('#image-view');
    check('a tap closes, no download', !(await view()).open && downloads === 0);

    await p.fill('[data-el=text]', '');
    await p.type('[data-el=text]', 'Ask @cl');
    await h.wait(100);
    const matches = await p.locator('[data-el=mention] .match').allTextContents();
    check('@ shows matching bots without the own one', matches.length === 1 && matches[0].includes('Cloud Carlo'), matches);
    await p.keyboard.press('Enter');
    check('Enter takes over @id', (await p.inputValue('[data-el=text]')) === 'Ask @cloud ', await p.inputValue('[data-el=text]'));
}
