// A voice message on a machine where voice messages are not set up: the transcription says so at once instead of
// starting some Python and waiting minutes for its time limit.
//   node local/src/voice-not-set-up.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-voice-none-'));
process.env.DATA_DIR = dir;
process.env.OPENFOLK_ENV_FILE = path.join(dir, '.env');
process.env.MACHINE_NAME = 'desk';
delete process.env.WHISPER_PYTHON;
delete process.env.OPENFOLK_CONTAINER;
// No Python of the system either: nothing on the path
process.env.PATH = dir;
process.env.Path = dir;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const { transcriber } = await import('./voice.ts');
const { speaker, localVoiceReady } = await import('./speech-local.ts');
const { voicePython } = await import('./voice-setup.ts');
const since = Date.now();
const error = await transcriber.transcribe(path.join(dir, 'recording.webm')).then(() => null, (e: Error) => e);
check('not set up: no Python found', voicePython() === null, voicePython());
check('not set up: the transcription fails at once, saying how to set it up', Boolean(error?.message.includes('Set up voice messages')) && Date.now() - since < 30_000, { message: error?.message, ms: Date.now() - since });
transcriber.stop();
// Reading aloud on the machine shares the environment: same answer, and "auto" does not count on it
const speechError = await speaker.speak('Hello', 'en_US-ryan-high', path.join(dir, 'out.wav')).then(() => null, (e: Error) => e);
check('not set up: the voice says the same at once', Boolean(speechError?.message.includes('Set up voice messages')), speechError?.message);
check('not set up: the machine does not report that it speaks', (await localVoiceReady()) === false);
speaker.stop();

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
