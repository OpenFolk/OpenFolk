// Tests for setting up voice messages from the app:  node local/src/voice-setup.test.ts
// The setup itself downloads hundreds of megabytes and is not run here; these check where it looks and what it reports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-voice-'));
process.env.DATA_DIR = dir;
// config.ts loads the machine's .env, which may set WHISPER_PYTHON again
process.env.OPENFOLK_ENV_FILE = path.join(dir, '.env');
delete process.env.WHISPER_PYTHON;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const { voicePython, voiceStatus, voiceVenv, setupVoice } = await import('./voice-setup.ts');

check('its own environment lies in the data folder', voiceVenv().startsWith(dir));
const fake = path.join(voiceVenv(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
fs.mkdirSync(path.dirname(fake), { recursive: true });
fs.writeFileSync(fake, '');
check('an environment set up here is found', voicePython() === fake, voicePython());
process.env.WHISPER_PYTHON = 'C:/own/python.exe';
check('WHISPER_PYTHON wins', voicePython() === 'C:/own/python.exe');
const reports: string[] = [];
await setupVoice((s) => reports.push(s.state));
check('with WHISPER_PYTHON nothing is set up', reports.length === 0, reports);
delete process.env.WHISPER_PYTHON;

process.env.OPENFOLK_CONTAINER = '1';
check('container: not available', (await voiceStatus()).state === 'unavailable');
await setupVoice((s) => reports.push(s.state));
check('container: no setup', reports.length === 0, reports);
delete process.env.OPENFOLK_CONTAINER;

// The empty file is no Python: the check reports "not set up" instead of "ready"
check('an environment that does not run: missing', (await voiceStatus()).state === 'missing');

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
