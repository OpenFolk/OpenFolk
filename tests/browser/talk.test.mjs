// The voice conversation in the app: a page over the chat where listening, sending, the answer and reading it aloud
// follow each other by themselves until the user ends it. The microphone is a tone whose volume the test turns up and
// down; the recorder's level meter (voice.js) hears it.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader'), bot('ops', 'Ops')],
        groups: [{ id: 'g1', name: 'Team', avatar: '', members: ['pdf', 'ops'] }],
        before: () => {
            // test.local is no secure context; the microphone is an oscillator behind a gain the test controls
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
            window.__hidden = false;
            Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
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
    const speak = async (ms) => {
        await p.evaluate(() => { window.__gain.gain.value = 1; });
        await h.wait(ms);
        await p.evaluate(() => { window.__gain.gain.value = 0; });
    };
    const sends = () => h.sent.filter((f) => f.type === 'send');
    const answer = (id, text) => h.push({ type: 'done', machine: 'desk', chatId: 'pdf', botId: 'pdf', entry: { id, role: 'assistant', botId: 'pdf', text, ts: new Date().toISOString() } });

    await h.openChat('PDF');
    check('the composer offers the conversation', await p.evaluate(() => !document.querySelector('[data-el=btn-talk]').hidden));
    await p.click('[data-el=btn-talk]');
    await h.wait(400);
    check('page open, listening, microphone on', await p.evaluate(() => !document.getElementById('talk').hidden) && (await phase()) === 'Listening …' && await recording(), await phase());
    check('the speech model is warmed up', h.sent.some((f) => f.type === 'voice_warmup'));

    // speech, then silence: the recording goes out by itself, marked as spoken
    await speak(600);
    await h.wait(300);
    check('right after speaking still listening', sends().length === 0 && (await phase()) === 'Listening …', await phase());
    await h.wait(2200);
    const first = sends()[0];
    check('after the pause the voice message went out, marked spoken', sends().length === 1 && first.spoken === true && first.attachments[0].type.startsWith('audio/'), first);
    check('while it is understood: not listening', !(await recording()) && (await phase()) === 'Understanding …', await phase());

    await h.push({ type: 'user', machine: 'desk', chatId: 'pdf', entry: { id: 'u1', role: 'user', from: 'me', text: 'How is the build?', voice: true, ts: new Date().toISOString() } });
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'thinking', activity: 'Read: build.log', chatId: 'pdf' });
    await h.wait(300);
    const thinking = await p.evaluate(() => ({ heard: document.getElementById('talk-heard').textContent, phase: document.getElementById('talk-phase').textContent }));
    check('transcript shown, the bot\'s activity as the phase', thinking.heard === 'You: How is the build?' && thinking.phase === 'Read: build.log', thinking);

    await answer('a1', 'The build is green.');
    await h.wait(200);
    check('the answer is read, not listening meanwhile', (await spoken()) === 'The build is green.' && (await phase()) === 'PDF-Reader is speaking' && !(await recording()), await phase());
    check('the answer is not read a second time by the voice-message wish', (await spoken()) === 'The build is green.', await spoken());
    await endSpeaking();
    await h.wait(400);
    check('after reading: listening again', (await phase()) === 'Listening …' && await recording(), await phase());

    // a tap on the picture: while listening it sends at once, while the bot speaks it stops the voice
    await speak(700);
    await p.click('#talk-avatar-button');
    await h.wait(300);
    check('tap: sent at once', sends().length === 2 && !(await recording()), sends().length);
    await answer('a2', 'A second answer that goes on and on.');
    await h.wait(200);
    await p.click('#talk-avatar-button');
    await h.wait(300);
    check('tap while it speaks: voice stopped, listening', (await phase()) === 'Listening …' && await recording() && await p.evaluate(() => document.getElementById('speech-bar').hidden), await phase());

    // microphone off and on
    await p.click('#talk-mic');
    await h.wait(200);
    check('microphone off: no recording', (await phase()) === 'Microphone off' && !(await recording()), await phase());
    await p.click('#talk-mic');
    await h.wait(300);
    check('microphone on: listening', (await phase()) === 'Listening …' && await recording(), await phase());

    // background: the microphone closes, an answer waits; back in the app it is read
    await p.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await h.wait(200);
    check('in the background: paused', !(await recording()) && (await phase()) === 'Paused while the app is in the background', await phase());
    await answer('a3', 'Background answer.');
    await h.wait(100);
    check('answer in the background: not read yet', !(await spoken()).includes('Background answer'), await spoken());
    await p.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await h.wait(200);
    check('back in the app: read now', (await spoken()).endsWith('Background answer.') && (await phase()) === 'PDF-Reader is speaking', await spoken());
    await endSpeaking();
    await h.wait(300);

    // back ends it: page gone, nothing records, the composer as before
    await p.click('#talk [data-page-back]');
    await h.wait(300);
    check('ended: page gone, nothing records, the composer shows the microphone', await p.evaluate(() => document.getElementById('talk').hidden && !window.rec.recorder && !document.querySelector('[data-el=btn-mic]').hidden));

    // no conversation with a group
    await p.click('.back');
    await h.wait(300);
    await h.openChat('Team');
    check('a group offers no conversation', await p.evaluate(() => document.querySelector('[data-el=btn-talk]').hidden));
}
