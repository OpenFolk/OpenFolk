// Phone: swiping to the right closes the chat (long or with momentum), otherwise it stays open.
const history = { pdf: Array.from({ length: 10 }, (_, i) => ({ id: 'e' + i, role: i % 2 ? 'assistant' : 'user', from: 'me', botId: 'pdf', text: `Message ${i} `.repeat(6), ts: `2026-10-08T05:${10 + i}:00Z`, readAt: `2026-10-08T05:${10 + i}:00Z` })) };

export default async function ({ start, check }) {
    const h = await start({ history });
    const open = () => h.page.evaluate(() => document.getElementById('app').classList.contains('chat-open'));
    await h.openChat('PDF');
    await h.swipe(80, 450, 140, 450, 6, 60);
    check('a short, slow swipe leaves the chat open', await open());
    await h.swipe(200, 300, 210, 600, 10, 20);
    check('a vertical swipe leaves the chat open', await open());
    await h.swipe(300, 450, 60, 450, 10, 20);
    check('a swipe to the left leaves the chat open', await open());
    await h.swipe(80, 450, 330, 460, 12, 40);
    check('a long swipe closes the chat', !(await open()));
    check('cleaned up afterwards', await h.page.evaluate(() => !document.getElementById('app').classList.contains('swiping') && !document.getElementById('chat').style.transform));
    await h.openChat('PDF');
    // without pauses between the steps, so the speed is clearly above the threshold even under load
    await h.swipe(80, 450, 160, 455, 4, 0);
    check('a short swipe with momentum closes the chat', !(await open()));
}
