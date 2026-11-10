// Reading aloud with the device's voice picks one of the bot's kind: a male bot a male voice, a female bot a female
// one, by the names of the system voices. Without a voice of that kind another one reads with a changed pitch, and the
// user learns once how to load one.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        language: 'de',
        bots: [bot('paul', 'Paul'), bot('charlotte', 'Charlotte')],
        history: {
            paul: [{ id: 'p1', role: 'assistant', botId: 'paul', text: 'Hallo von Paul.', ts: '2026-11-09T10:00:00Z' }],
            charlotte: [{ id: 'c1', role: 'assistant', botId: 'charlotte', text: 'Hallo von Charlotte.', ts: '2026-11-09T10:00:00Z' }],
        },
        before: () => {
            // like an iPhone fresh from the box: female German voices only, one of Apple's oddly named ones among them
            window.__voices = [{ name: 'Grandma', lang: 'de-DE', localService: true }, { name: 'Anna', lang: 'de-DE', localService: true }, { name: 'Daniel', lang: 'en-GB', localService: true }];
            window.__spoken = [];
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => window.__voices, speak: (u) => { window.__spoken.push(u); if (u.onstart) setTimeout(() => u.onstart(), 10); }, cancel: () => undefined, resume: () => undefined,
            } });
        },
    });
    const p = h.page;
    const last = () => p.evaluate(() => { const u = window.__spoken.findLast((x) => x.text.trim()); return u && { voice: u.voice && u.voice.name, pitch: u.pitch }; });
    const hints = () => p.evaluate(() => [...document.querySelectorAll('[data-el=messages] .event')].map((x) => x.textContent).filter((x) => x.includes('Stimme')).length);
    const read = async (name) => {
        await h.openChat(name);
        await p.click('.bubble.bot .speak');
        await h.wait(100);
        const r = await last();
        await p.click('#speech-bar-stop');
        return r;
    };

    // read-aloud.js is not in main.js's list, so the scaffold does not put its exports on window
    const sexes = await p.evaluate(async () => {
        const { voiceSex } = await import('/js/read-aloud.js');
        return ['Grandpa', 'Grandma', 'Martin (Erweitert)', 'Google Deutsch'].map(voiceSex).join();
    });
    check('names of system voices: Apple\'s Grandpa male, Grandma female, Google\'s nameless voice unknown', sexes === 'male,female,male,', sexes);
    const charlotte = await read('Charlotte');
    check('female bot: a female German voice, normal pitch', charlotte.voice === 'Grandma' || charlotte.voice === 'Anna' ? charlotte.pitch === 1 : false, charlotte);
    check('no hint when the kind exists', (await hints()) === 0);
    await p.click('.back');
    await h.wait(300);

    const paul = await read('Paul');
    check('male bot without a male German voice: another German one, lower pitch', paul.voice === 'Grandma' || paul.voice === 'Anna' ? paul.pitch < 1 : false, paul);
    check('with a hint how to load one, once', (await hints()) === 1);
    await p.click('.bubble.bot .speak');
    await h.wait(100);
    await p.click('#speech-bar-stop');
    check('the hint comes once only', (await hints()) === 1);

    // a male voice loaded: it reads, at normal pitch
    await p.evaluate(() => { window.__voices.push({ name: 'Martin', lang: 'de-DE', localService: true }); });
    await p.click('.bubble.bot .speak');
    await h.wait(100);
    const loaded = await last();
    await p.click('#speech-bar-stop');
    check('male voice there: it reads, normal pitch', loaded.voice === 'Martin' && loaded.pitch === 1, loaded);
}
