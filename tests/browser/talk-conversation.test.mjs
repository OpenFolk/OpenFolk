// The voice conversation in the app runs in the bot's talk conversation: the pane moves there for the dialog, the
// messages go there, and the end sends talk_end and shows the main chat again.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader', { conversations: [{ id: 't1', title: 'Voice conversation', model: 'sonnet', talk: true, createdAt: '2026-11-22T08:00:00Z' }] })],
        ownTalk: true,
        onSend: async (f, push) => { if (f.type === 'talk_start') await push({ type: 'talk_started', machine: 'desk', botId: f.botId, chatId: 'pdf~t1' }); },
        before: () => {
            Object.defineProperty(window, 'isSecureContext', { get: () => true });
            Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
                const ctx = new AudioContext();
                const tone = ctx.createOscillator();
                const gain = ctx.createGain();
                gain.gain.value = 0;
                const target = ctx.createMediaStreamDestination();
                tone.connect(gain);
                gain.connect(target);
                tone.start();
                window.__gain = gain;
                return target.stream;
            } } });
            window.__spoken = [];
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => [], speak: (u) => { window.__spoken.push(u); if (u.onstart) setTimeout(() => u.onstart(), 10); }, cancel: () => undefined, resume: () => undefined,
            } });
        },
    });
    const p = h.page;
    const phase = () => p.evaluate(() => document.getElementById('talk-phase').textContent);
    const recording = () => p.evaluate(() => Boolean(window.rec.recorder));
    const sends = () => h.sent.filter((f) => f.type === 'send');
    const say = async () => {
        await p.evaluate(() => { window.__gain.gain.value = 1; });
        await h.wait(600);
        await p.evaluate(() => { window.__gain.gain.value = 0; });
        await h.wait(2600);
    };
    const shown = () => p.evaluate(() => window.panes.map((x) => x.chatId).join());
    await h.openChat('PDF');
    await p.click('[data-el=btn-talk]');
    await h.wait(500);
    check('talk_start asked for the bot', h.sent.some((f) => f.type === 'talk_start' && f.botId === 'pdf'));
    check('the pane shows the talk conversation, listening there', (await shown()) === 'pdf~t1' && (await phase()) === 'Listening …' && await recording(), [await shown(), await phase()]);
    await say();
    const sent = sends().at(-1);
    check('the voice message goes to the talk conversation, spoken', sent && sent.chatId === 'pdf~t1' && sent.spoken === true, sent);
    await p.click('#talk-end');
    await h.wait(400);
    check('the end: talk_end for the conversation, the pane back in the main chat', h.sent.some((f) => f.type === 'talk_end' && f.chatId === 'pdf~t1') && (await shown()) === 'pdf' && await p.isHidden('#talk'), await shown());

    // the bot editor: the switch is on by default and goes along when saving
    await p.evaluate(() => window.openEditor(window.state.bots[0]));
    await h.wait(200);
    check('editor: fast voice conversation on by default', await p.isChecked('#editor-talk-fast'));
}
