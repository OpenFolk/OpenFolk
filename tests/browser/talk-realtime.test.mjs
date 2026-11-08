// The voice conversation over OpenAI Realtime: the offer goes to the bot's machine, OpenAI's events drive the page,
// a request of the model goes into the bot's chat and the bot's answer goes back as the tool's result. RTCPeerConnection
// and the data channel are fakes; the test plays OpenAI through window.__server(event).
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        before: () => {
            Object.defineProperty(window, 'isSecureContext', { get: () => true });
            Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
                const ctx = new AudioContext();
                const target = ctx.createMediaStreamDestination();
                ctx.createOscillator().connect(target);
                window.__track = target.stream.getAudioTracks()[0];
                return target.stream;
            } } });
            window.RTCPeerConnection = class {
                constructor() { this.connectionState = 'new'; this.listeners = {}; window.__pc = this; }
                addTrack() {}
                createDataChannel(label) {
                    const dc = { label, readyState: 'open', sent: [], listeners: {}, send(x) { this.sent.push(JSON.parse(x)); }, addEventListener(type, fn) { this.listeners[type] = fn; }, close() { this.readyState = 'closed'; } };
                    window.__dc = dc;
                    return dc;
                }
                async createOffer() { return { type: 'offer', sdp: 'v=0 offer' }; }
                async setLocalDescription() {}
                async setRemoteDescription(d) { this.remote = d.sdp; }
                addEventListener(type, fn) { this.listeners[type] = fn; }
                close() { this.connectionState = 'closed'; window.__closed = true; }
            };
            window.__server = (e) => window.__dc.listeners.message({ data: JSON.stringify(e) });
        },
        onSend: async (f, push) => {
            if (f.type === 'talk_connect') setTimeout(() => push({ type: 'talk_answer', machine: 'desk', id: f.id, sdp: 'v=0 answer' }), 50);
        },
    });
    const p = h.page;
    const phase = () => p.evaluate(() => document.getElementById('talk-phase').textContent);
    const dcSent = () => p.evaluate(() => (window.__dc ? window.__dc.sent : []));
    const server = (e) => p.evaluate((e) => window.__server(e), e);
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', talkMode: 'openai', apiKeys: { openai: true }, updatedAt: '2026-11-07T10:00:00Z' } });
    await h.openChat('PDF');
    await p.click('[data-el=btn-talk]');
    await h.wait(300);
    const connect = h.sent.find((f) => f.type === 'talk_connect');
    check('the offer goes to the bot\'s machine with the bot\'s voice', connect && connect.chatId === 'pdf' && connect.sdp === 'v=0 offer' && connect.voice === 'male', connect);
    check('OpenAI\'s answer is set, the data channel is oai-events', await p.evaluate(() => window.__pc.remote === 'v=0 answer' && window.__dc.label === 'oai-events'));
    check('no local recording, no warm-up of Whisper', await p.evaluate(() => !window.rec.recorder) && !h.sent.some((f) => f.type === 'voice_warmup'));
    check('listening', (await phase()) === 'Listening …', await phase());

    await server({ type: 'input_audio_buffer.speech_started', audio_start_ms: 100, item_id: 'u1' });
    await server({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', content_index: 0, transcript: 'How is the build?' });
    await h.wait(100);
    check('the transcript is shown', await p.evaluate(() => document.getElementById('talk-heard').textContent === 'You: How is the build?'));

    await server({ type: 'response.function_call_arguments.done', response_id: 'r1', item_id: 'fc1', output_index: 0, call_id: 'call_1', name: 'ask_bot', arguments: JSON.stringify({ request: 'How is the build?' }) });
    await h.wait(100);
    const asked = h.sent.findLast((f) => f.type === 'send');
    check('the request goes into the bot\'s chat as text, marked spoken', asked && asked.chatId === 'pdf' && asked.text === 'How is the build?' && asked.spoken === true && !asked.attachments, asked);
    check('while the bot works: thinking', (await phase()) === 'PDF-Reader is thinking …', await phase());

    // a second request while the first runs: answered at once, nothing sent to the bot
    await server({ type: 'response.function_call_arguments.done', response_id: 'r2', item_id: 'fc2', output_index: 0, call_id: 'call_2', name: 'ask_bot', arguments: JSON.stringify({ request: 'And the tests?' }) });
    await h.wait(100);
    const busy = (await dcSent()).find((e) => e.type === 'conversation.item.create' && e.item.call_id === 'call_2');
    check('second request while busy: answered by the page, not sent', busy && /still working/i.test(busy.item.output) && h.sent.filter((f) => f.type === 'send').length === 1, busy);

    await h.push({ type: 'done', machine: 'desk', chatId: 'pdf', botId: 'pdf', entry: { id: 'a1', role: 'assistant', botId: 'pdf', text: 'The build is green.', ts: new Date().toISOString() } });
    await h.wait(100);
    const sent = await dcSent();
    const out = sent.filter((e) => e.type === 'conversation.item.create' && e.item.call_id === 'call_1');
    check('the bot\'s answer goes back as the tool\'s result, then a response', out.length === 1 && out[0].item.type === 'function_call_output' && out[0].item.output === 'The build is green.' && sent.at(-1).type === 'response.create', sent.slice(-2));
    check('the app does not read it aloud itself', await p.evaluate(() => document.getElementById('speech-bar').hidden));

    await server({ type: 'output_audio_buffer.started', response_id: 'r3' });
    await server({ type: 'response.output_audio_transcript.delta', response_id: 'r3', item_id: 'm1', output_index: 0, content_index: 0, delta: 'The build ' });
    await server({ type: 'response.output_audio_transcript.delta', response_id: 'r3', item_id: 'm1', output_index: 0, content_index: 0, delta: 'is green.' });
    await h.wait(100);
    check('speaking, with what is said', (await phase()) === 'PDF-Reader is speaking' && await p.evaluate(() => document.getElementById('talk-answer').textContent === 'The build is green.'), await phase());

    // tap: the voice stops, OpenAI is told to cancel and clear
    await p.click('#talk-avatar-button');
    await h.wait(100);
    const types = (await dcSent()).map((e) => e.type);
    check('tap while speaking: cancel and clear sent, listening', types.includes('response.cancel') && types.includes('output_audio_buffer.clear') && (await phase()) === 'Listening …', types.slice(-3));
    await server({ type: 'output_audio_buffer.stopped', response_id: 'r3' });

    // microphone off: the track is disabled
    await p.click('#talk-mic');
    await h.wait(100);
    check('microphone off: track disabled', await p.evaluate(() => window.__track.enabled === false) && (await phase()) === 'Microphone off');
    await p.click('#talk-mic');
    await h.wait(100);
    check('microphone on: track enabled', await p.evaluate(() => window.__track.enabled === true) && (await phase()) === 'Listening …');

    // an error of OpenAI: shown, the page stays
    await server({ type: 'error', error: { type: 'invalid_request_error', code: 'x', message: 'Something odd', param: null, event_id: 'e1' } });
    await h.wait(100);
    check('an OpenAI error is shown', await p.evaluate(() => document.getElementById('talk-error').textContent.includes('Something odd') && !document.getElementById('talk').hidden));

    await p.click('#talk-end');
    await h.wait(100);
    check('end: connection closed, page gone', await p.evaluate(() => window.__closed === true && document.getElementById('talk').hidden));

    // the backend refuses (no key): the test answers first with an error; onSend's valid answer 50 ms later finds the
    // id answered already and is dropped
    await p.evaluate(() => { window.__closed = false; });
    const before = h.sent.length;
    await p.click('[data-el=btn-talk]');
    await h.wait(30);
    const second = h.sent.slice(before).find((f) => f.type === 'talk_connect');
    await h.push({ type: 'talk_answer', machine: 'desk', id: second.id, error: 'The voice conversation over OpenAI needs an OpenAI key in the settings.' });
    await h.wait(150);
    check('refused: the reason on the page, the connection closed', await p.evaluate(() => document.getElementById('talk-error').textContent.includes('OpenAI key') && window.__closed === true));
    await p.click('#talk-end');

    // without a key: the app's own way, no offer
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', talkMode: 'openai', apiKeys: { openai: false }, updatedAt: '2026-11-07T11:00:00Z' } });
    const count = h.sent.filter((f) => f.type === 'talk_connect').length;
    await p.click('[data-el=btn-talk]');
    await h.wait(300);
    check('without a key: local recording, no offer', h.sent.filter((f) => f.type === 'talk_connect').length === count && await p.evaluate(() => Boolean(window.rec.recorder)));
    await p.click('#talk-end');
    await h.wait(200);

    // the settings: the choice is shown, sent to the machines, and OpenAI's key is listed as used for it
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', talkMode: 'openai-mini', readAloud: 'device', apiKeys: { openai: true }, updatedAt: '2026-11-07T12:00:00Z' } });
    await p.click('.back');
    await h.wait(300);
    await p.click('[data-tab=settings]');
    await h.wait(300);
    const shown = await p.evaluate(() => ({
        mode: /** @type {HTMLSelectElement} */ (document.getElementById('settings-talk-mode')).value,
        use: document.querySelector('#settings-ai-list li[data-provider="openai"] span').textContent,
    }));
    check('settings: the voice conversation shown, the key used for it', shown.mode === 'openai-mini' && shown.use.includes('voice conversation'), shown);
    await p.selectOption('#settings-talk-mode', 'app');
    const saved = h.sent.findLast((f) => f.type === 'settings_save');
    check('settings: the choice is sent', saved && saved.settings.talkMode === 'app', saved);
}
