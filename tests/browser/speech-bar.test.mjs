// The bar while a message is read aloud: timeline, pause, jump to a place in the text, go to the message.
import { bot } from './harness.mjs';

const sentence = (n) => `This is sentence number ${n} of a long answer, and it goes on for a while to fill the chunk. `;
const text = Array.from({ length: 6 }, (_, i) => sentence(i + 1)).join('');

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader'), bot('cloud', 'Cloud Carlo')],
        history: { pdf: [{ id: 'a1', role: 'assistant', botId: 'pdf', text, ts: '2026-10-08T05:00:30Z' }] },
        before: () => {
            window.__spoken = [];
            window.__cancels = 0;
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => [],
                speak: (u) => { window.__spoken.push(u); if (window.__spoken.length === 1 && u.onstart) setTimeout(() => u.onstart(), 10); },
                // like the browsers: cancel() reports the queued utterances as ended, late
                cancel: () => { window.__cancels++; const gone = window.__spoken.splice(0); setTimeout(() => { for (const u of gone) if (u.onend) u.onend(); }, 20); },
                resume: () => undefined,
            } });
        },
    });
    const p = h.page;
    await h.openChat('PDF');
    await p.click('.bubble.bot .speak');
    await h.wait(100);
    const parts = await p.evaluate(() => window.__spoken.map((u) => u.text));
    check('long text read in several parts', parts.length === 3 && parts[0].startsWith('This is sentence number 1'), parts);

    // jump to the last third: reading goes on from the part there; the late end of the old queue does not stop it
    await p.evaluate(() => { const s = /** @type {HTMLInputElement} */ (document.getElementById('speech-bar-seek')); s.value = String(Math.round(Number(s.max) * 0.8)); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
    await h.wait(100);
    const after = await p.evaluate(() => ({ spoken: window.__spoken.map((u) => u.text), shown: !document.getElementById('speech-bar').hidden }));
    check('jump: reads from the part at that place on', after.spoken.length === 1 && after.spoken[0].startsWith('This is sentence number 5'), after.spoken);
    check('jump: old queue ending late does not close the bar', after.shown);

    // paused, a jump only moves the place; play goes on from there
    await p.click('#speech-bar-play');
    await p.evaluate(() => { const s = /** @type {HTMLInputElement} */ (document.getElementById('speech-bar-seek')); s.value = '0'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
    const paused = await p.evaluate(() => ({ spoken: window.__spoken.length, elapsed: document.getElementById('speech-bar-elapsed').textContent }));
    check('paused jump: nothing read, time back at the start', paused.spoken === 0 && paused.elapsed === '0:00', paused);
    await p.click('#speech-bar-play');
    check('play after the jump starts at the beginning', await p.evaluate(() => window.__spoken.length === 3));

    // from the chat list the bar leads back to the message
    await p.click('.back');
    await h.wait(300);
    await p.click('#speech-bar-open');
    await h.wait(300);
    check('tap on the bar opens the chat being read', await p.evaluate(() => document.getElementById('app').classList.contains('chat-open')));

    // read to the end: the bar goes away by itself
    await p.click('#speech-bar-stop');
    await p.click('.bubble.bot .speak');
    await h.wait(100);
    await p.evaluate(() => { const last = window.__spoken[window.__spoken.length - 1]; last.onend(); });
    check('end reported: bar gone', await p.evaluate(() => document.getElementById('speech-bar').hidden && !document.querySelector('.speak.speaking')));
    // the voice falls silent without reporting its end (iOS at times): gone after a moment as well
    await p.evaluate(() => { window.speechSynthesis.speaking = true; window.speechSynthesis.pending = false; });
    await p.click('.bubble.bot .speak');
    await h.wait(900);
    check('while it speaks the bar stays', await p.evaluate(() => !document.getElementById('speech-bar').hidden));
    await p.evaluate(() => { window.speechSynthesis.speaking = false; });
    await h.wait(1000);
    check('silent without an end: bar gone', await p.evaluate(() => document.getElementById('speech-bar').hidden));
}
