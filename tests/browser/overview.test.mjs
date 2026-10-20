// Overview: unread answers with an orange dot, expandable footer, loading bar when opening,
// no "no machine awake" as long as the machine list is missing.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const old = (id) => [{ id: 'old-' + id, role: 'assistant', botId: id, text: 'Old answer', ts: '2026-10-07T10:00:00Z' }];
    const h = await start({
        bots: [bot('anna', 'Anna'), bot('bert', 'Bert')],
        history: { anna: old('anna'), bert: old('bert') },
        onSend: async (f) => { if (f.type === 'machine_shutdown') return; },
    });
    const p = h.page;
    const unread = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li.unread')].map((l) => l.querySelector('.name').firstChild.textContent + (l.querySelector('.dot.new') ? '•' : '')));
    check('old answers count as seen', (await unread()).length === 0);
    await h.push({ type: 'done', chatId: 'bert', botId: 'bert', entry: { id: 'n1', role: 'assistant', botId: 'bert', text: 'New answer', ts: new Date().toISOString() }, durationMs: 1 });
    await h.wait(150);
    check('new answer: dot at Bert', (await unread()).join() === 'Bert•', await unread());
    await h.openChat('Bert');
    await h.push({ type: 'done', chatId: 'bert', botId: 'bert', entry: { id: 'n2', role: 'assistant', botId: 'bert', text: 'Another one', ts: new Date().toISOString() }, durationMs: 1 });
    await h.wait(100);
    await p.click('[data-el=btn-back]');
    await h.wait(200);
    check('opened and back: no dot any more', (await unread()).length === 0, await unread());

    // footer: collapsed only the row of the connected machine
    await h.push({ type: 'machine_status', configured: true, hosts: { desk: { active: true }, workstation: { active: false } } });
    await h.wait(150);
    const footer = () => p.evaluate(() => [...document.querySelectorAll('.machine-row')].filter((z) => z.offsetParent).length + (document.querySelector('.footer-row').offsetParent ? '+buttons' : ''));
    check('footer collapsed: one machine row', (await footer()) === '1', await footer());
    await p.click('#footer-handle');
    check('expanded: all machines and buttons', (await footer()) === '2+buttons', await footer());
    await p.click('.machine-row.main .machine-text');
    check('a tap on the machine row collapses it', (await footer()) === '1');
}
