// A bot's own voice: the editor lists the voices of the provider reading right now, "Listen" plays a sample of the one
// chosen, saving sends it per provider, and reading aloud asks for it. Without a voice of the backend only a hint.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader', { machine: 'desk' })],
        history: { pdf: [{ id: 'a1', role: 'assistant', botId: 'pdf', text: 'Hello there.', ts: '2026-11-10T05:00:30Z' }] },
        before: () => {
            window.__played = [];
            window.Audio = class {
                constructor() { this.currentTime = 0; this.duration = 5; this.paused = true; this._src = ''; }
                set src(v) { this._src = v; setTimeout(() => this.onloadedmetadata && this.onloadedmetadata(), 0); }
                get src() { return this._src; }
                play() { this.paused = false; window.__played.push(this._src); return Promise.resolve(); }
                pause() { this.paused = true; }
            };
        },
        onSend: async (f, push) => {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
            if (f.type === 'speech_get') setTimeout(() => push({ type: 'speech', id: f.id, mime: 'audio/mpeg', data: btoa('MP3') }), 50);
        },
    });
    const p = h.page;
    const openEditor = async () => {
        await p.evaluate(() => window.openEditor(window.bot('pdf')));
        await h.wait(200);
    };
    const shown = () => p.evaluate(() => ({
        choice: !document.getElementById('editor-voice-choice').hidden,
        hint: !document.getElementById('editor-voice-hint').hidden,
        where: document.getElementById('editor-voice-where').textContent,
        options: [...document.querySelectorAll('#editor-voice-name option')].map((o) => o.value),
    }));

    // no key, no machine that reads aloud: only the hint
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'auto', apiKeys: { openai: false, gemini: false }, updatedAt: '2026-11-10T10:00:00Z' } });
    await openEditor();
    const none = await shown();
    check('without a voice of the backend: a hint, no list', !none.choice && none.hint, none);
    await p.click('#editor .page-back, #editor [data-close]').catch(() => p.evaluate(() => window.closeDialog(document.getElementById('editor'))));

    // with an OpenAI key: its 13 voices after "as the kind above"
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'auto', apiKeys: { openai: true, gemini: true }, updatedAt: '2026-11-10T11:00:00Z' } });
    await openEditor();
    const openai = await shown();
    check('OpenAI key: the list of OpenAI\'s voices', openai.choice && openai.where === 'Voice with OpenAI' && openai.options.length === 14 && openai.options[0] === '' && openai.options.includes('coral'), openai);

    // choosing a voice sets the kind to match; "Listen" plays a sample in it
    await p.selectOption('#editor-voice-name', 'coral');
    check('a female voice chosen: the kind follows', await p.evaluate(() => document.getElementById('editor-voice').value === 'female'));
    const before = h.sent.length;
    await p.click('#editor-voice-listen');
    await h.wait(200);
    const sample = h.sent.slice(before).find((f) => f.type === 'speech_get');
    check('Listen: a sample in that voice from the bot\'s machine, played', sample && sample.name === 'coral' && sample.id.startsWith('preview:') && sample.machine === 'desk'
        && await p.evaluate(() => window.__played.some((s) => s.startsWith('blob:'))), sample);

    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    const saved = h.sent.findLast((f) => f.type === 'bot_save');
    check('saved per provider', saved && saved.bot.voices && saved.bot.voices.openai === 'coral' && saved.bot.voice === 'female', saved && saved.bot);

    // the bot list comes back with the voice; reading aloud asks for it
    await h.push({ type: 'bots', machine: 'desk', bots: [bot('pdf', 'PDF-Reader', { machine: 'desk', voice: 'female', voices: { openai: 'coral' } })], groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
    await h.openChat('PDF');
    await p.click('.bubble.bot .speak');
    await h.wait(100);
    const read = h.sent.findLast((f) => f.type === 'speech_get');
    check('reading aloud asks for the bot\'s own voice', read && read.name === 'coral' && !read.id.startsWith('preview:'), read);
    await p.click('#speech-bar-stop');

    // Gemini chosen as the voice: the list changes to Gemini's, the OpenAI choice is not shown there
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', readAloud: 'gemini', apiKeys: { openai: true, gemini: true }, updatedAt: '2026-11-10T12:00:00Z' } });
    await openEditor();
    const gemini = await shown();
    const value = await p.evaluate(() => document.getElementById('editor-voice-name').value);
    check('Gemini reads: its 30 voices, nothing chosen there yet', gemini.where === 'Voice with Gemini' && gemini.options.length === 31 && gemini.options.includes('Puck') && value === '', { gemini, value });
}
