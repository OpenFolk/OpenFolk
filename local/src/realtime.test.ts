// Tests for the voice conversation over OpenAI Realtime: the shared setting, the session a bot gets and the SDP
// exchange with OpenAI (with a fake fetch).   node local/src/realtime.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-realtime-'));
const settings = await import('./settings.ts');
const { realtimeSession, connectRealtime } = await import('./realtime.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

check('setting: "app" without a choice', settings.talkMode() === 'app', settings.talkMode());
settings.saveSettings({ talkMode: 'openai-mini' });
check('setting: stored', settings.talkMode() === 'openai-mini', settings.talkMode());
settings.saveSettings({ talkMode: 'nonsense' as never });
check('setting: an unknown value falls back to "app"', settings.talkMode() === 'app', settings.talkMode());

const bot = { id: 'fred', name: 'Fred', role: 'Developer of the messenger', area: 'OpenFolk', tone: 'calm', folder: '/x', model: 'default' as const, avatar: '', approval: 'risky' as const, machine: '', createdAt: '', updatedAt: '' };
const s = realtimeSession(bot, { mode: 'openai', voice: 'male', language: 'de', transcribe: 'de' });
const tool = s.tools[0];
check('session: the large model, audio only, low reasoning', s.model === 'gpt-realtime-2.1' && s.output_modalities.join() === 'audio' && s.reasoning.effort === 'low', s);
check('session: male voice is cedar', s.audio.output.voice === 'cedar', s.audio.output.voice);
check('session: one tool ask_bot with a required request', s.tools.length === 1 && tool.name === 'ask_bot' && tool.parameters.required.join() === 'request', tool);
check('session: the instructions name the bot and pin the language', s.instructions.includes('Fred') && s.instructions.includes('German') && s.instructions.includes('ask_bot'), s.instructions);
check('session: transcription in the voice language, semantic turn detection', 'language' in s.audio.input.transcription && s.audio.input.transcription.language === 'de' && s.audio.input.turn_detection.type === 'semantic_vad', s.audio.input);
const mini = realtimeSession(bot, { mode: 'openai-mini', voice: 'female', language: 'en', transcribe: '' });
check('session: mini model, marin, detected language without a language field', mini.model === 'gpt-realtime-2.1-mini' && mini.audio.output.voice === 'marin' && !('language' in mini.audio.input.transcription), mini.audio);

type Asked = { url: string; auth: string; sdp: unknown; session: { model?: string } };
let asked = null as Asked | null;
const fakeFetch = (async (url: string, init: RequestInit) => {
    const form = init.body as FormData;
    asked = { url, auth: String((init.headers as Record<string, string>).authorization), sdp: form.get('sdp'), session: JSON.parse(String(form.get('session'))) };
    return new Response('v=0 answer', { status: 201, headers: { 'content-type': 'application/sdp' } });
}) as unknown as typeof fetch;
const answer = await connectRealtime('v=0 offer', s, 'sk-test', fakeFetch);
check('exchange: the answer SDP comes back', answer === 'v=0 answer', answer);
const a = asked as Asked | null;
check('exchange: to /v1/realtime/calls with the key, offer and session as form fields', a !== null && a.url === 'https://api.openai.com/v1/realtime/calls' && a.auth === 'Bearer sk-test' && a.sdp === 'v=0 offer' && a.session.model === 'gpt-realtime-2.1', a);
const failing = (async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 })) as unknown as typeof fetch;
const error = await connectRealtime('v=0 offer', s, 'sk-bad', failing).then(() => '', (e: Error) => e.message);
check('exchange: OpenAI\'s message in the error', error.includes('Incorrect API key'), error);
const noKey = await connectRealtime('v=0 offer', s, '', fakeFetch).then(() => '', (e: Error) => e.message);
check('exchange: without a key no request, a message instead', noKey.length > 0, noKey);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
