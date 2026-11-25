// A voice message takes the full bubble width, however short its transcript: its track is as long as with a long one.
import { bot } from './harness.mjs';

const audio = { name: 'v.webm', type: 'audio/webm', path: 'x/v.webm', size: 1000, durationMs: 5000 };
export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        history: { pdf: [
            { id: 'u1', role: 'user', from: 'me', text: 'Short', voice: true, attachments: [audio], ts: '2026-10-10T09:59:00Z' },
            { id: 'u2', role: 'user', from: 'me', text: 'A longer transcript. '.repeat(30), voice: true, attachments: [audio], ts: '2026-10-10T10:00:00Z' },
        ] },
    });
    const p = h.page;
    const widths = () => p.evaluate(() => [...document.querySelectorAll('.bubble.voice')].map((b) => ({
        bubble: Math.round(b.getBoundingClientRect().width), track: Math.round(b.querySelector('.voice-track').getBoundingClientRect().width) })));
    await h.openChat('PDF-Reader');
    for (const [name, size] of [['phone', { width: 400, height: 860 }], ['iPad', { width: 820, height: 1180 }]]) {
        await p.setViewportSize(size);
        await h.wait(300);
        const w = await widths();
        check(`${name}: short and long voice message equally wide`, w.length === 2 && w[0].bubble === w[1].bubble && w[0].track === w[1].track && w[0].track > 150, w);
    }
    await h.close();
}
