// Voice message being transcribed: the placeholder survives a redrawn history and goes once the message is there,
// by its own frame or within a history.

export default async function ({ start, check }) {
    const h = await start({ history: { pdf: [{ id: 'a1', role: 'user', from: 'me', text: 'Hello', ts: '2026-10-17T06:00:00.000Z' }] } });
    const p = h.page;
    const pending = () => p.locator('[data-voice-pending="pdf"]').count();
    const begin = () => p.evaluate(() => {
        window.state.voicePending.pdf = { length: 6000, since: Date.now() };
        window.renderVoicePending(window.activePane());
    });
    await h.openChat('PDF');
    await begin();
    check('placeholder shown', (await pending()) === 1);

    const older = [{ id: 'a1', role: 'user', from: 'me', text: 'Hello', ts: '2026-10-17T06:00:00.000Z' }, { id: 'a2', role: 'assistant', from: 'pdf', text: 'Hi', ts: '2026-10-17T06:00:05.000Z' }];
    await h.push({ type: 'history', chatId: 'pdf', entries: older, live: [] });
    await h.wait(100);
    check('history redrawn: the placeholder stays', (await pending()) === 1 && (await p.locator('.bubble', { hasText: 'Hi' }).count()) === 1);
    await p.evaluate(() => window.renderVoicePending(window.activePane()));
    check('not doubled', (await pending()) === 1);

    await h.push({ type: 'user', chatId: 'pdf', entry: { id: 'v1', role: 'user', from: 'me', text: 'Spoken text', voice: true, ts: new Date().toISOString() } });
    await h.wait(100);
    check('transcript there: placeholder gone', (await pending()) === 0 && (await p.locator('.bubble', { hasText: 'Spoken text' }).count()) === 1);
    await h.push({ type: 'history', chatId: 'pdf', entries: older, live: [] });
    await h.wait(100);
    check('a later redraw does not bring it back', (await pending()) === 0);

    await begin();
    const withVoice = [...older, { id: 'v2', role: 'user', from: 'me', text: 'Second', voice: true, ts: new Date().toISOString() }];
    await h.push({ type: 'history', chatId: 'pdf', entries: withVoice, live: [] });
    await h.wait(100);
    check('message came with the history: placeholder gone', (await pending()) === 0 && !(await p.evaluate(() => 'pdf' in window.state.voicePending)));
    check('no page errors', h.errors.length === 0, h.errors);
}
