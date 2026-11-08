// The voice conversation in the app: text the bot says before a tool runs is read while it works, and the final answer
// goes on after it. A failed transcription shows its message on the page and keeps it open.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
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
    const spoken = () => p.evaluate(() => window.__spoken.map((u) => u.text).filter((x) => x.trim()).join(' | '));
    const endSpeaking = () => p.evaluate(() => { const u = window.__spoken[window.__spoken.length - 1]; if (u && u.onend) u.onend(); });
    const sends = () => h.sent.filter((f) => f.type === 'send');
    const say = async () => {
        await p.evaluate(() => { window.__gain.gain.value = 1; });
        await h.wait(600);
        await p.evaluate(() => { window.__gain.gain.value = 0; });
        await h.wait(2600);
    };
    const frame = (f) => h.push({ machine: 'desk', chatId: 'pdf', botId: 'pdf', ...f });

    await h.openChat('PDF');
    await p.click('[data-el=btn-talk]');
    await h.wait(400);
    await say();
    check('sent', sends().length === 1, sends().length);
    await frame({ type: 'user', entry: { id: 'u1', role: 'user', from: 'me', text: 'Check the build', voice: true, ts: new Date().toISOString() } });
    await frame({ type: 'state', state: 'thinking', activity: 'Read: build.log' });
    await frame({ type: 'delta', text: 'One moment, I look at the log.' });
    await frame({ type: 'tool', tool: { id: 't1', name: 'Read', summary: 'build.log' } });
    await h.wait(200);
    check('text before a tool is read while the bot works', (await spoken()) === 'One moment, I look at the log.' && (await phase()) === 'PDF-Reader is speaking', await spoken());
    await endSpeaking();
    await h.wait(200);
    check('read, the bot still works: thinking, not listening', (await phase()) === 'Read: build.log' && !(await recording()), await phase());
    await frame({ type: 'delta', text: '\n\n' });
    await frame({ type: 'delta', text: 'The build is green.' });
    await frame({ type: 'done', entry: { id: 'a1', role: 'assistant', botId: 'pdf', text: 'One moment, I look at the log.\n\nThe build is green.', ts: new Date().toISOString() } });
    await frame({ type: 'state', state: 'idle' });
    await h.wait(200);
    check('then only the rest is read', (await spoken()) === 'One moment, I look at the log. | The build is green.', await spoken());
    await endSpeaking();
    await h.wait(300);
    check('listening again', (await phase()) === 'Listening …' && await recording(), await phase());

    // transcription failed: the message on the page, microphone off; the microphone button listens again
    await say();
    check('sent again', sends().length === 2, sends().length);
    await h.push({ type: 'error', machine: 'desk', chatId: 'pdf', message: 'Whisper is not set up on DESK.' });
    await h.wait(200);
    const failed = await p.evaluate(() => ({ error: document.getElementById('talk-error').textContent, hidden: document.getElementById('talk-error').hidden, page: !document.getElementById('talk').hidden }));
    check('error shown on the page, the page stays', failed.page && !failed.hidden && failed.error.includes('Whisper'), failed);
    check('not listening after the error', !(await recording()));
    await p.click('#talk-mic');
    await h.wait(300);
    check('microphone button: listening again, the error gone', (await recording()) && await p.evaluate(() => document.getElementById('talk-error').hidden));
    await p.click('#talk-end');
    await h.wait(200);
    check('end button: page gone', await p.evaluate(() => document.getElementById('talk').hidden && !window.rec.recorder));
}
