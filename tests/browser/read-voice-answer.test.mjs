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

    // while the next voice message is recorded: not read; discarded, it is read then
    await voiceMessage();
    await p.click('[data-el=btn-mic]');
    await h.wait(300);
    await answer('a6', 'Answer while recording.');
    await h.wait(100);
    check('while recording: not read', !(await spoken()).includes('while recording'), await spoken());
    await p.click('[data-el=rec-discard]');
    await h.wait(300);
    check('recording discarded: read now', (await spoken()).endsWith('Answer while recording.'), await spoken());
    // something being read stops when recording starts
    await p.click('[data-el=btn-mic]');
    await h.wait(300);
    check('recording starts: the reading stops', await p.evaluate(() => document.getElementById('speech-bar').hidden));
    await p.click('[data-el=rec-discard]');
    await h.wait(200);

    // the switch next to the recording: off here, the settings show it, the answer is not read
    await p.click('[data-el=btn-mic]');
    await h.wait(300);
    const on = await p.evaluate(() => !document.querySelector('[data-el=rec-autoread]').classList.contains('off'));
    await p.click('[data-el=rec-autoread]');
    const off = await p.evaluate(() => ({ button: document.querySelector('[data-el=rec-autoread]').classList.contains('off'), stored: localStorage.getItem('openfolk-read-voice-answers'), setting: document.getElementById('settings-auto-read').checked }));
    check('switch at the recording: on before, off after a tap, the setting follows', on && off.button && off.stored === 'off' && !off.setting, { on, off });
    await p.click('[data-el=rec-send]');
    await h.wait(600);
    await answer('a7', 'Not read by switch.');
    await h.wait(100);
    check('switched off at the recording: the answer is not read', !(await spoken()).includes('Not read by switch'), await spoken());
    // and back on from the speech bar
    await p.click('.bubble.bot .speak');
    await h.wait(100);
    await p.click('#speech-bar-auto');
    check('switch in the speech bar: on again', await p.evaluate(() => localStorage.getItem('openfolk-read-voice-answers') === 'on' && !document.getElementById('speech-bar-auto').classList.contains('off')));
    await p.click('#speech-bar-stop');

    // setting off: nothing by itself
    await p.evaluate(() => localStorage.setItem('openfolk-read-voice-answers', 'off'));
    await voiceMessage();
    await answer('a5', 'Quiet answer.');
    await h.wait(100);
    check('setting off: not read', !(await spoken()).includes('Quiet answer'), await spoken());
}
