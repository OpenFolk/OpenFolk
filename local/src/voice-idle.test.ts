// Tests for keeping the speech model loaded:  node local/src/voice-idle.test.ts
// With voicePreload the Whisper service is never stopped for being idle; without it, it stops after the idle limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from './remove-tree.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-voice-idle-'));
process.env.DATA_DIR = dir;
const { transcriber } = await import('./voice.ts');
const { saveMachineSettings } = await import('./machine-settings.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const idleTimer = () => (transcriber as unknown as { idle: NodeJS.Timeout | null }).idle;

saveMachineSettings({ voicePreload: true });
transcriber.idleLater();
check('kept loaded: no idle limit', idleTimer() === null);
saveMachineSettings({ voicePreload: false });
transcriber.idleLater();
check('not kept: stopped after the idle limit', idleTimer() !== null);
saveMachineSettings({ voicePreload: true });
transcriber.idleLater();
check('switched on again: the idle limit goes away', idleTimer() === null);

transcriber.stop();
removeTree(dir);
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
