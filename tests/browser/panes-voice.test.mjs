// One microphone for all panes: a recording belongs to the pane and chat it was started in. The other panes keep
// a disabled microphone, sending goes to that chat even when another pane is active, and switching the chat of
// the recording pane discards it.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna'), bot('carl', 'Carl')],
        // test.local is no secure context: replace the microphone with a silent tone from the AudioContext
        before: () => {
            Object.defineProperty(window, 'isSecureContext', { get: () => true });
            Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
                const ctx = new AudioContext();
                const tone = ctx.createOscillator();
                const target = ctx.createMediaStreamDestination();
                tone.connect(target);
                tone.start();
                return target.stream;
            } } });
        },
    });
    const p = h.page;
    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    await h.openChat('PDF');
    await p.locator('#chat-list li', { hasText: 'Anna' }).first().click({ modifiers: ['Control'] });
    await h.wait(500);
    const pane = (i) => p.locator('.pane').nth(i);

    await pane(0).locator('[data-el=btn-mic]').click();
    await h.wait(300);
    check('recording shows in pane 1', await pane(0).locator('[data-el=recording]').isVisible());
    check('pane 2 keeps a disabled microphone', await pane(1).locator('[data-el=btn-mic]').isVisible() && await pane(1).locator('[data-el=btn-mic]').isDisabled());
    await pane(1).locator('[data-el=text]').click();
    await h.wait(1300);
    await pane(0).locator('[data-el=rec-send]').click();
    await h.wait(800);
    const voice = h.sent.filter((f) => f.type === 'send' && (f.attachments || []).some((a) => a.type.startsWith('audio/')));
    check('sent to PDF although pane 2 was active', voice.length === 1 && voice[0].chatId === 'pdf', voice.map((f) => f.chatId));
    check('both microphones free again', !(await pane(0).locator('[data-el=btn-mic]').isDisabled()) && !(await pane(1).locator('[data-el=btn-mic]').isDisabled()));

    await pane(0).locator('[data-el=btn-mic]').click();
    await h.wait(1300);
    await pane(0).locator('[data-el=messages]').click();
    await h.openChat('Carl');
    await h.wait(500);
    const after = h.sent.filter((f) => f.type === 'send' && (f.attachments || []).some((a) => a.type.startsWith('audio/')));
    check('switching the chat of the recording pane discards it', after.length === 1 && await p.evaluate(() => window.panes[0].chatId === 'carl' && !window.rec.recorder));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
