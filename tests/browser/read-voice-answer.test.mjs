// After a voice message the finished answer is read aloud by itself: right away when the app is visible, when it comes
// back from the background otherwise; not after a typed message, and not with the setting off.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
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
            window.__spoken = [];
            window.__hidden = false;
            Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => [], speak: (u) => { window.__spoken.push(u); if (u.onstart) setTimeout(() => u.onstart(), 10); }, cancel: () => undefined, resume: () => undefined,
            } });
        },
    });
    const p = h.page;
    const spoken = () => p.evaluate(() => window.__spoken.map((u) => u.text).filter((x) => x.trim()).join(' | '));
    const answer = (id, text) => h.push({ type: 'done', machine: 'desk', chatId: 'pdf', botId: 'pdf', entry: { id, role: 'assistant', botId: 'pdf', text, ts: new Date().toISOString() } });
    const voiceMessage = async () => {
        await p.click('[data-el=btn-mic]');
        await h.wait(900);
        await p.click('[data-el=rec-send]');
        await h.wait(600);
    };
    await h.openChat('PDF');

    await voiceMessage();
    check('a voice message went out', h.sent.some((f) => f.type === 'send' && f.attachments && f.attachments[0].type.startsWith('audio/')));
    await answer('a1', 'Here is the answer.');
    await h.wait(100);
    check('the finished answer is read by itself, with the bar', (await spoken()) === 'Here is the answer.' && await p.evaluate(() => !document.getElementById('speech-bar').hidden), await spoken());
    await p.click('#speech-bar-stop');
    await answer('a2', 'A second answer.');
    await h.wait(100);
    check('only the first answer after it', (await spoken()) === 'Here is the answer.', await spoken());

    // a typed message drops the wish
    await voiceMessage();
    await p.fill('[data-el=text]', 'Never mind');
    await p.click('[data-el=btn-send]');
    await answer('a3', 'Typed answer.');
    await h.wait(100);
    check('after a typed message nothing is read', !(await spoken()).includes('Typed answer'), await spoken());

    // in the background: read when the app comes back
    await voiceMessage();
    await p.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await answer('a4', 'Background answer.');
    await h.wait(100);
    check('in the background: not yet', !(await spoken()).includes('Background answer'), await spoken());
    await p.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await h.wait(100);
    check('back in the app: read now', (await spoken()).endsWith('Background answer.'), await spoken());
    await p.click('#speech-bar-stop');

    // setting off: nothing by itself
    await p.evaluate(() => localStorage.setItem('openfolk-read-voice-answers', 'off'));
    await voiceMessage();
    await answer('a5', 'Quiet answer.');
    await h.wait(100);
    check('setting off: not read', !(await spoken()).includes('Quiet answer'), await spoken());
}
