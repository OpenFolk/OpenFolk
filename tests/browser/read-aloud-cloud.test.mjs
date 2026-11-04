// Reading aloud with a cloud voice: the web app asks the backend for each part ("speech_get"), plays the audio,
// asks for the next part ahead, pauses the audio itself and falls back to the device's voice on an error.
import { bot } from './harness.mjs';

const sentence = (n) => `This is sentence number ${n} of a long answer, and it goes on for a while to fill the chunk. `;
const text = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join('');

export default async function ({ start, check }) {
    let fail = false;
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna'), bot('astrid', 'Astrid', { voice: 'male' })],
        history: {
            pdf: [{ id: 'a1', role: 'assistant', botId: 'pdf', text, ts: '2026-10-08T05:00:30Z' }],
            anna: [{ id: 'b1', role: 'assistant', botId: 'anna', text: 'Hello from Anna.', ts: '2026-10-08T05:00:30Z' }],
            astrid: [{ id: 'c1', role: 'assistant', botId: 'astrid', text: 'Hello from Astrid.', ts: '2026-10-08T05:00:30Z' }],
        },
        before: () => {
            window.__audios = [];
            window.__played = [];
            window.__spoken = [];
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => [], speak: (u) => { window.__spoken.push(u); if (u.onstart) setTimeout(() => u.onstart(), 10); }, cancel: () => undefined, resume: () => undefined,
            } });
            // stands in for <audio>: knows its source, plays and pauses, the test ends it
            window.Audio = class {
                constructor() { this.currentTime = 0; this.duration = NaN; this.paused = true; this.ended = false; this._src = ''; window.__audios.push(this); }
                set src(v) { this._src = v; this.duration = 20; this.ended = false; setTimeout(() => this.onloadedmetadata && this.onloadedmetadata(), 0); }
                get src() { return this._src; }
                play() { this.paused = false; window.__played.push(this._src); return Promise.resolve(); }
                pause() { this.paused = true; }
            };
        },
        onSend: async (f, push) => {
            if (f.type !== 'speech_get') return;
            setTimeout(() => push(fail ? { type: 'speech', id: f.id, error: 'quota exceeded' } : { type: 'speech', id: f.id, mime: 'audio/mpeg', data: btoa('MP3 ' + f.text.slice(0, 30)) }), 150);
        },
    });
    const p = h.page;
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'auto', apiKeys: { openai: true, gemini: false }, updatedAt: '2026-10-29T10:00:00Z' } });
    await h.openChat('PDF');
    await p.click('.bubble.bot .speak');
    await h.wait(30);
    const asked = h.sent.filter((f) => f.type === 'speech_get');
    check('cloud voice: the first part asked for at the bot\'s machine, short', asked.length === 1 && asked[0].id.endsWith(':0') && asked[0].text.length < 220 && asked[0].text.startsWith('This is sentence number 1'), asked);
    check('no voice chosen: guessed from the name ("PDF-Reader": male)', asked[0].voice === 'male', asked[0].voice);
    check('while it loads the time shows "…"', await p.evaluate(() => document.getElementById('speech-bar-elapsed').textContent === '…'));
    await h.wait(400);
    const state = () => p.evaluate(() => ({ played: window.__played.length, paused: window.__audios[0] && window.__audios[0].paused, spoken: window.__spoken.length, bar: document.getElementById('speech-bar').classList.contains('paused') }));
    const playing = await state();
    const asked2 = h.sent.filter((f) => f.type === 'speech_get');
    check('plays the audio (after the silent unlock), no device voice', playing.played === 2 && !playing.paused && playing.spoken === 0, playing);
    check('the next part is asked for ahead, longer', asked2.length === 2 && asked2[1].id.endsWith(':1') && asked2[1].text.length > 300, asked2.map((f) => f.text.length));

    await p.click('#speech-bar-play');
    const paused = await state();
    check('pause pauses the audio itself', paused.paused && paused.bar, paused);
    await p.click('#speech-bar-play');
    const again = await state();
    check('play goes on in the same audio, nothing asked again', !again.paused && again.played === 3 && h.sent.filter((f) => f.type === 'speech_get').length === 2, again);

    // the end of a part plays the next one, which is already there; the provider fails from now on (for the part after)
    fail = true;
    await p.evaluate(() => { const a = window.__audios[0]; a.ended = true; a.onended(); });
    await h.wait(50);
    const next = await p.evaluate(() => ({ played: window.__played.length, seek: Number(document.getElementById('speech-bar-seek').value) }));
    check('end of a part: the next one plays', next.played === 4 && next.seek >= asked[0].text.length - 2, next);

    // jump inside the part being played: only the place in the audio changes
    await p.evaluate(() => { const s = /** @type {HTMLInputElement} */ (document.getElementById('speech-bar-seek')); s.value = String(Number(s.value) + 100); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
    const jumped = await p.evaluate(() => ({ time: window.__audios[0].currentTime, played: window.__played.length }));
    check('jump inside the part: same audio, later place', jumped.time > 0 && jumped.played === 4, jumped);

    // the part after failed at the provider: the device's voice reads on from there, with a hint
    await p.evaluate(() => { const a = window.__audios[0]; a.ended = true; a.onended(); });
    await h.wait(300);
    const fallback = await p.evaluate(() => ({
        spoken: window.__spoken.map((u) => u.text.slice(0, 26)),
        hint: [...document.querySelectorAll('[data-el=messages] .event')].map((x) => x.textContent).join(' '),
    }));
    check('provider error: device voice from that part on, with a hint', fallback.spoken.length > 0 && fallback.hint.includes('quota exceeded'), fallback);

    await p.click('#speech-bar-stop');
    check('stop: bar gone, audio paused', await p.evaluate(() => document.getElementById('speech-bar').hidden && window.__audios[0].paused));

    // the voice of other bots: guessed from a female name, or the one chosen in the editor
    const voiceFor = async (name) => {
        await p.click('.back');
        await h.wait(300);
        await h.openChat(name);
        const before = h.sent.filter((f) => f.type === 'speech_get').length;
        await p.click('.bubble.bot .speak');
        await h.wait(100);
        await p.click('#speech-bar-stop');
        return h.sent.filter((f) => f.type === 'speech_get').slice(before).map((f) => f.voice).join(',');
    };
    check('"Anna" without a choice: female', (await voiceFor('Anna')) === 'female');
    check('"Astrid" with "male" chosen: the choice wins', (await voiceFor('Astrid')) === 'male');
    await p.click('.back');
    await h.wait(300);
    await h.openChat('PDF');

    // without a key the device's voice reads, nothing goes to the backend
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'auto', apiKeys: { openai: false, gemini: false }, updatedAt: '2026-10-29T11:00:00Z' } });
    const before = h.sent.filter((f) => f.type === 'speech_get').length;
    await p.evaluate(() => { window.__spoken = []; });
    await p.click('.bubble.bot .speak');
    await h.wait(50);
    check('without a key: device voice, no request', h.sent.filter((f) => f.type === 'speech_get').length === before && await p.evaluate(() => window.__spoken.length > 0));
    await p.click('#speech-bar-stop');

    // the settings page offers the voice; the replace form keeps to its provider
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'gemini', avatarModel: 'gpt-image-1', apiKeys: { gemini: true }, updatedAt: '2026-10-29T12:00:00Z' } });
    await p.click('.back');
    await h.wait(300);
    await p.click('[data-tab=settings]');
    await h.wait(300);
    await p.click('#settings-ai-list li[data-provider="gemini"] button');
    const page = await p.evaluate(() => ({
        voice: /** @type {HTMLSelectElement} */ (document.getElementById('settings-read-aloud')).value,
        use: document.querySelector('#settings-ai-list li[data-provider="gemini"] span').textContent,
        form: !document.getElementById('settings-ai-form').hidden, provider: /** @type {HTMLSelectElement} */ (document.getElementById('settings-ai-provider')).value,
        locked: /** @type {HTMLSelectElement} */ (document.getElementById('settings-ai-provider')).disabled,
    }));
    check('settings: voice shown, Gemini used for it, replacing keeps the provider', page.voice === 'gemini' && page.use.endsWith('reading aloud') && page.form && page.provider === 'gemini' && page.locked, page);
    await p.click('#settings-ai-cancel');
    await p.selectOption('#settings-read-aloud', 'device');
    const saved = h.sent.findLast((f) => f.type === 'settings_save');
    check('settings: choice sent to the machines', saved && saved.settings.readAloud === 'device', saved);
}
