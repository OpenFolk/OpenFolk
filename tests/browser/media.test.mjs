// Images and videos in the app: a picture a bot sent (no preview) loads from its machine into the bubble and opens
// large without a second request; a video plays in a player over the page, fetched once.
import { bot } from './harness.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const now = new Date().toISOString();

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('anna', 'Anna')],
        history: {
            anna: [
                { id: 'a1', role: 'assistant', botId: 'anna', text: 'The screenshot and the recording', ts: now, attachments: [
                    { name: 'shot.png', type: 'image/png', size: 70, path: 'C:/www/anna/shot.png', machine: 'desk' },
                    { name: 'demo.mp4', type: 'video/mp4', size: 4000, path: 'C:/www/anna/demo.mp4', machine: 'desk' },
                    { name: 'notes.pdf', type: 'application/pdf', size: 900, path: 'C:/www/anna/notes.pdf', machine: 'desk' },
                ] },
            ],
        },
        onSend: async (f, push) => {
            if (f.type !== 'file_get') return;
            const video = f.path.endsWith('.mp4');
            await push({ type: 'file', machine: 'desk', path: f.path, name: video ? 'demo.mp4' : 'shot.png', mime: video ? 'video/mp4' : 'image/png', data: video ? 'AAAAIGZ0eXBpc29t' : PNG });
        },
    });
    const p = h.page;
    const gets = (end) => h.sent.filter((f) => f.type === 'file_get' && f.path.endsWith(end)).length;
    await h.openChat('Anna');
    await h.wait(400);

    const src = await p.evaluate(() => document.querySelector('.bubble[data-eid="a1"] .attachment.image img')?.getAttribute('src') || '');
    check('a sent picture shows in the bubble, fetched from its machine', src.startsWith('blob:') && gets('.png') === 1, { src, gets: gets('.png') });
    await p.click('.bubble[data-eid="a1"] .attachment.image');
    await h.wait(150);
    check('… a tap shows it large without fetching again', await p.isVisible('#image-view') && gets('.png') === 1);
    await p.keyboard.press('Escape');

    check('a video is a card with a play button, nothing fetched yet', await p.isVisible('.bubble[data-eid="a1"] .attachment.video .play') && gets('.mp4') === 0);
    await p.click('.bubble[data-eid="a1"] .attachment.video');
    await h.wait(300);
    const player = await p.evaluate(() => { const v = document.querySelector('#video-view video'); return v ? { open: !document.getElementById('video-view').hidden, src: v.src, controls: v.controls } : null; });
    check('… a tap plays it in the app', player && player.open && player.src.startsWith('blob:') && player.controls && gets('.mp4') === 1, player);
    await p.keyboard.press('Escape');
    check('… Escape closes the player', await p.isHidden('#video-view'));
    await p.click('.bubble[data-eid="a1"] .attachment.video');
    await h.wait(200);
    check('… a second time from memory', gets('.mp4') === 1 && await p.isVisible('#video-view'));
    await p.mouse.click(5, 5);
    check('… a tap beside it closes it too', await p.isHidden('#video-view'));

    check('other files stay a download card', await p.isVisible('.bubble[data-eid="a1"] .attachment:not(.image):not(.video) .name') && gets('.pdf') === 0);
    check('no page errors', h.errors.length === 0, h.errors);
}
