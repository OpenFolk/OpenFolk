// Tests for reading aloud with a cloud voice (providers stubbed):  node local/src/speech.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-speech-'));
process.env.DATA_DIR = dir;
process.env.E2E_KEY = 'off';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const settings = await import('./settings.ts');
const { speechProvider, synthesize } = await import('./speech.ts');
const { checkClientFrame } = await import('./frames.ts');

const has = (...keys: string[]) => (k: string) => keys.includes(k);
check('auto: OpenAI first, then Gemini, else the device', speechProvider('auto', has('openai', 'gemini')) === 'openai'
    && speechProvider('auto', has('gemini')) === 'gemini' && speechProvider('auto', has()) === null);
check('a chosen provider without its key: the device', speechProvider('gemini', has('openai')) === null && speechProvider('openai', has('openai')) === 'openai');
check('device: never a cloud voice', speechProvider('device', has('openai', 'gemini')) === null);

const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let answer: () => Response = () => new Response('no', { status: 500 });
globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return answer();
}) as typeof fetch;

let error = '';
await synthesize('Hello').catch((e: Error) => { error = e.message; });
check('without a key: an error, no request', error.includes('API key') && calls.length === 0, error);

settings.saveApiKeys({ openai: 'sk-test', gemini: 'g-test' });
answer = () => new Response(Buffer.from('MP3DATA'));
const first = await synthesize('Hello there.');
const sent = calls[0];
check('OpenAI: speech endpoint, key, female voice, style with English terms', sent?.url === 'https://api.openai.com/v1/audio/speech' && sent.headers.authorization === 'Bearer sk-test'
    && sent.body.model === 'gpt-4o-mini-tts' && sent.body.voice === 'marin' && sent.body.input === 'Hello there.' && String(sent.body.instructions).includes('English words'), sent);
check('OpenAI: MP3 as base64', first.mime === 'audio/mpeg' && Buffer.from(first.data, 'base64').toString() === 'MP3DATA', first);
await synthesize('Hello there.');
check('the same text again comes from the cache', calls.length === 1, calls.length);
await synthesize('Hello there.', 'male');
check('OpenAI: a male voice is cedar, cached apart', calls.length === 2 && calls[1].body.voice === 'cedar', calls[1]?.body);

settings.saveSettings({ readAloud: 'gemini' });
answer = () => Response.json({ steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'text', text: 'x' }, { type: 'audio', data: Buffer.from('WAVDATA').toString('base64') }] }] });
const g = await synthesize('Hello there.');
const gs = calls[2];
check('Gemini: interactions endpoint, key, female voice', gs?.url.endsWith('/v1beta/interactions') && gs.headers['x-goog-api-key'] === 'g-test'
    && JSON.stringify(gs.body).includes('"voice":"Kore"') && JSON.stringify(gs.body).includes('Hello there.'), gs);
await synthesize('Hello there.', 'male');
check('Gemini: a male voice is Charon', calls.length === 4 && JSON.stringify(calls[3].body).includes('"voice":"Charon"'), calls[3]?.body);
check('Gemini: WAV from the model output, cached apart from OpenAI', g.mime === 'audio/wav' && Buffer.from(g.data, 'base64').toString() === 'WAVDATA', g);

answer = () => Response.json({ error: { message: 'quota exceeded' } }, { status: 429 });
error = '';
await synthesize('Something new.').catch((e: Error) => { error = e.message; });
check('provider error comes back readable', error.includes('quota exceeded'), error);

check('frame: speech_get accepted, with a voice too', checkClientFrame({ type: 'speech_get', id: 'a1:0', text: 'Hello' }).ok && checkClientFrame({ type: 'speech_get', id: 'a1:0', text: 'Hello', voice: 'male' }).ok
    && !checkClientFrame({ type: 'speech_get', id: 'a1:0', text: 'Hello', voice: 'robot' }).ok);
check('frame: too long a text refused', !checkClientFrame({ type: 'speech_get', id: 'a1:0', text: 'x'.repeat(5000) }).ok);
check('frame: readAloud in the settings', checkClientFrame({ type: 'settings_save', settings: { readAloud: 'device' } }).ok
    && !checkClientFrame({ type: 'settings_save', settings: { readAloud: 'elevenlabs' } }).ok);

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
