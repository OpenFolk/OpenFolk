// The voice conversation in the app reads the answer sentence by sentence while the bot still writes it: a finished
// sentence at once, what arrives meanwhile in one go, a code block once closed, and the finished answer only the rest.
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
    await frame({ type: 'user', entry: { id: 'u1', role: 'user', from: 'me', text: 'How is the build?', voice: true, ts: new Date().toISOString() } });
    await frame({ type: 'state', state: 'thinking' });
    await frame({ type: 'delta', text: 'The build is gr' });
    await h.wait(150);
    check('half a sentence: nothing read yet', (await spoken()) === '', await spoken());
    await frame({ type: 'delta', text: 'een. All 40 tests pass' });
    await h.wait(150);
    check('the first sentence is read while the bot writes on', (await spoken()) === 'The build is green.' && (await phase()) === 'PDF-Reader is speaking', await spoken());
    await frame({ type: 'delta', text: '.\n\nOne warning about ' });
    await frame({ type: 'delta', text: 'the cache. Code:\n```\nnpm ci. x\n' });
    await h.wait(150);
    check('while one is read, nothing else starts', (await spoken()) === 'The build is green.', await spoken());
    await endSpeaking();
    await h.wait(150);
    check('then what came meanwhile in one go, an open code block waits', (await spoken()) === 'The build is green. | All 40 tests pass. One warning about the cache. Code:', await spoken());
    await endSpeaking();
    await frame({ type: 'delta', text: '```\nDone.' });
    await h.wait(150);
    check('the closed code block is announced', (await spoken()).endsWith('| (code block)'), await spoken());
    await endSpeaking();
    await frame({ type: 'done', entry: { id: 'a1', role: 'assistant', botId: 'pdf', text: 'The build is green. All 40 tests pass.\n\nOne warning about the cache. Code:\n```\nnpm ci. x\n```\nDone.', ts: new Date().toISOString() } });
    await frame({ type: 'state', state: 'idle' });
    await h.wait(200);
    const all = (await spoken()).split(' | ');
    check('the finished answer reads only the rest, nothing twice', all.length === 4 && all[3] === 'Done.', all);
    await endSpeaking();
    await h.wait(300);
    check('listening again', (await phase()) === 'Listening …' && await recording(), await phase());
}
