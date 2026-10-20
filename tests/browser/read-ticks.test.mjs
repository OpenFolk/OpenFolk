// Ticks on own messages: ✓ stored, ✓✓ blue as soon as the bot starts (read).
export default async function ({ start, check }) {
    const h = await start();
    await h.openChat('PDF');
    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'u1', role: 'user', from: 'me', text: 'Hello', ts: new Date().toISOString() } });
    await h.wait(100);
    const ticks = () => h.page.evaluate(() => { const k = document.querySelector('.bubble[data-id="u1"] .read-ticks'); return k ? (k.classList.contains('read') ? '✓✓' : '✓') : '-'; });
    check('after storing one grey tick', (await ticks()) === '✓');
    await h.push({ type: 'read', chatId: 'pdf', id: 'u1', ts: new Date().toISOString() });
    await h.wait(100);
    check('after "read" two blue ticks', (await ticks()) === '✓✓');
    check('read ticks do not affect the checkbox rows (own class)', await h.page.evaluate(() => getComputedStyle(document.querySelector('label.check')).marginLeft === '0px'));
}
