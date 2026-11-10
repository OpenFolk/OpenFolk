// The voices a bot can choose: the web app's list equals the backend's, saving keeps only known ids, and reading aloud
// takes the bot's own voice for the provider reading (another provider's, or Piper's of the other language, gives way
// to the kind).   node local/src/voices.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-voices-'));
process.env.DATA_DIR = dir;
process.env.E2E_KEY = 'off';
process.env.MACHINE_NAME = 'desk';
process.env.OPENFOLK_ENV_FILE = path.join(dir, '.env');
process.env.OPENFOLK_CONTAINER = '1';
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
delete process.env.WHISPER_PYTHON;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const { VOICE_CATALOG, catalogVoice } = await import('../../shared/protocol.ts');
const web = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'webapp', 'js', 'voices.js')).href) as { VOICE_CATALOG: unknown };
check('the web app offers exactly the backend\'s voices', JSON.stringify(web.VOICE_CATALOG) === JSON.stringify(VOICE_CATALOG));
check('catalog: OpenAI 13, Gemini 30, Piper German and English', VOICE_CATALOG.openai.length === 13 && VOICE_CATALOG.gemini.length === 30
    && VOICE_CATALOG.local.some((v) => v.lang === 'de' && v.kind === 'male') && VOICE_CATALOG.local.some((v) => v.lang === 'en' && v.kind === 'female'));
check('catalogVoice: known id, unknown id, Piper of the other language', catalogVoice('gemini', 'Puck', 'de') === 'Puck' && catalogVoice('openai', 'Puck', 'de') === null
    && catalogVoice('local', 'en_US-ryan-high', 'de') === null && catalogVoice('local', 'de_DE-karlsson-low', 'de') === 'de_DE-karlsson-low');

const bots = await import('./bots.ts');
const folder = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const saved = bots.saveBot({ ...base, id: 'anna', name: 'Anna', voices: { openai: 'coral', gemini: 'NoSuchVoice', local: 'de_DE-kerstin-medium' } });
check('save: known ids kept, an unknown one dropped', saved.voices?.openai === 'coral' && saved.voices?.local === 'de_DE-kerstin-medium' && !('gemini' in (saved.voices ?? {})), saved.voices);
const kept = bots.saveBot({ ...base, id: 'anna', name: 'Anna' });
check('save from an app without the field: the voices stay', kept.voices?.openai === 'coral', kept.voices);
const cleared = bots.saveBot({ ...base, id: 'anna', name: 'Anna', voices: {} });
check('save with none chosen: no voices left', cleared.voices === undefined, cleared.voices);

const settings = await import('./settings.ts');
const { synthesize } = await import('./speech.ts');
const { checkClientFrame } = await import('./frames.ts');
const bodies: Record<string, unknown>[] = [];
globalThis.fetch = (async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(Buffer.from('MP3')); }) as typeof fetch;
settings.saveApiKeys({ openai: 'sk-test' });
await synthesize('One.', 'female', 'coral');
check('OpenAI: the bot\'s own voice', bodies.at(-1)?.voice === 'coral', bodies.at(-1));
await synthesize('Two.', 'male', 'Puck');
check('OpenAI: a Gemini voice gives way to the kind (male: cedar)', bodies.at(-1)?.voice === 'cedar', bodies.at(-1));
check('frame: speech_get with a voice name; odd characters refused', checkClientFrame({ type: 'speech_get', id: 'a:0', text: 'Hi', name: 'en_US-ryan-high' }).ok
    && !checkClientFrame({ type: 'speech_get', id: 'a:0', text: 'Hi', name: '../x' }).ok);

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
