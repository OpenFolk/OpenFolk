// Reading aloud with the voice on the bot's machine (Piper): "automatic" without a key takes a machine that reports it
// speaks itself, the explicit choice asks the bot's machine, and a failure there falls back to the device's voice
// with a hint naming the machine. Without a machine that speaks, the device reads and nothing is asked.
import { bot } from './harness.mjs';

const text = 'This is the first sentence of the answer. Here comes a second one to make it longer. And a third for good measure.';
const machineSettings = (machine, voice) => ({
    type: 'machine_settings', machine, anthropicKey: false, gitPushToken: false, engineKeys: {}, shutdownMethod: 'script',
    offers: { shutdown: false, ide: false, terminal: false, voice: true }, voice, roots: ['C:/www'],
    settings: { claudeAuth: 'subscription', shutdownDelaySeconds: 60, shutdownAfterWake: 'off', afterWakeWaitMinutes: 60, idleMinutes: 15, handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true, gitPushUser: '', gitPushHost: '', claudeAiConnectors: false, botFolder: '' },
});

export default async function ({ start, check }) {
    let fail = false;
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader', { machine: 'desk' }), bot('far', 'Far Away', { machine: 'laptop' })],
        online: ['desk', 'laptop'],
        history: {
            pdf: [{ id: 'a1', role: 'assistant', botId: 'pdf', text, ts: '2026-11-09T05:00:30Z' }],
            far: [{ id: 'b1', role: 'assistant', botId: 'far', text, ts: '2026-11-09T05:00:30Z' }],
        },
        before: () => {
            window.__played = [];
            window.__spoken = [];
            window.SpeechSynthesisUtterance = function (t) { this.text = t; };
            Object.defineProperty(window, 'speechSynthesis', { value: {
                getVoices: () => [], speak: (u) => { window.__spoken.push(u); if (u.onstart) setTimeout(() => u.onstart(), 10); }, cancel: () => undefined, resume: () => undefined,
            } });
            window.Audio = class {
                constructor() { this.currentTime = 0; this.duration = NaN; this.paused = true; this.ended = false; this._src = ''; }
                set src(v) { this._src = v; this.duration = 10; setTimeout(() => this.onloadedmetadata && this.onloadedmetadata(), 0); }
                get src() { return this._src; }
                play() { this.paused = false; window.__played.push(this._src); return Promise.resolve(); }
                pause() { this.paused = true; }
            };
        },
        onSend: async (f, push) => {
            if (f.type !== 'speech_get') return;
            setTimeout(() => push(fail ? { type: 'speech', id: f.id, error: 'Voice on DESK: piper-tts is missing' } : { type: 'speech', id: f.id, mime: 'audio/wav', data: btoa('WAV ' + f.text.slice(0, 20)) }), 100);
        },
    });
    const p = h.page;
    const asked = () => h.sent.filter((f) => f.type === 'speech_get');
    const read = async () => {
        await p.click('.bubble.bot .speak');
        await h.wait(300);
    };
    const stop = () => p.click('#speech-bar-stop');

    // no key, no machine that speaks: the device reads
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'auto', apiKeys: { openai: false, gemini: false }, updatedAt: '2026-11-09T10:00:00Z' } });
    await h.openChat('PDF');
    await read();
    check('auto without a key and without a speaking machine: the device reads, nothing asked', asked().length === 0 && await p.evaluate(() => window.__spoken.length > 0));
    await stop();

    // the bot's machine reports it speaks: "auto" asks it, in shorter parts than a cloud voice
    await h.push(machineSettings('desk', { state: 'ready', detail: 'C:/py/python.exe', speech: true }));
    await p.evaluate(() => { window.__spoken = []; });
    await read();
    const first = asked()[0];
    check('auto with a machine that speaks: asked there, short first part', asked().length >= 1 && first.machine === 'desk' && first.text.length <= 160 && first.text.startsWith('This is the first'), first);
    check('the audio plays, no device voice', await p.evaluate(() => window.__played.length > 0 && window.__spoken.length === 0));
    await stop();

    // a machine without piper in its Python says so in the settings; its bot is read by the one that speaks
    await h.push(machineSettings('laptop', { state: 'ready', detail: 'C:/py/python.exe', speech: false }));
    await p.click('.back');
    await h.wait(300);
    await h.openChat('Far Away');
    const before = asked().length;
    await read();
    check('bot on a machine without the voice: "auto" asks the one that speaks', asked().length > before && asked()[before].machine === 'desk', asked()[before]);
    await stop();

    // explicitly chosen: the bot's own machine is asked even when it does not report the voice (other accounts never see that)
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'local', apiKeys: { openai: false, gemini: false }, updatedAt: '2026-11-09T11:00:00Z' } });
    await h.push(machineSettings('laptop', { state: 'missing' }));
    const before2 = asked().length;
    await read();
    check('chosen: asked at the machine that speaks when the bot\'s own does not', asked().length > before2 && asked()[before2].machine === 'desk', asked()[before2]);
    await stop();

    // the machine fails: the device reads on, the hint names the machine
    fail = true;
    await p.click('.back');
    await h.wait(300);
    await h.openChat('PDF');
    await p.evaluate(() => { window.__spoken = []; });
    await read();
    const hint = await p.evaluate(() => [...document.querySelectorAll('[data-el=messages] .event')].map((x) => x.textContent).join(' '));
    check('failure on the machine: hint names it, the device reads on', hint.includes('DESK') && hint.includes('piper-tts') && await p.evaluate(() => window.__spoken.length > 0), hint);
    await stop();

    // the settings page offers the choice, and the machine's row says it reads aloud itself
    await p.click('.back');
    await h.wait(300);
    await p.click('[data-tab=settings]');
    await h.wait(300);
    const page = await p.evaluate(() => ({
        choice: /** @type {HTMLSelectElement} */ (document.getElementById('settings-read-aloud')).value,
        options: [...document.querySelectorAll('#settings-read-aloud option')].map((o) => o.value).join(','),
        rows: [...document.querySelectorAll('.settings-voice-setup .settings-hint')].map((x) => x.textContent),
    }));
    check('settings: "local" offered and chosen', page.choice === 'local' && page.options.includes('local'), page);
    check('settings: one machine says it reads aloud itself, the other that voice messages are not set up', page.rows.some((r) => r.includes('reads aloud itself')) && page.rows.some((r) => r.includes('Not set up')), page.rows);
    await h.push(machineSettings('laptop', { state: 'ready', detail: 'C:/py/python.exe', speech: false }));
    await h.wait(200);
    const rows = await p.evaluate(() => [...document.querySelectorAll('.settings-voice-setup .settings-hint')].map((x) => x.textContent));
    check('settings: a machine whose Python lacks piper-tts says so', rows.some((r) => r.includes('piper-tts')), rows);
}
