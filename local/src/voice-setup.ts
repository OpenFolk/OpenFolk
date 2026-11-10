// Setting up voice messages from the app: a Python environment of its own with faster-whisper, in the data folder
// (writable also where the backend runs from the desktop app's installation folder). Needs Python 3.9 or newer on
// the machine; pip downloads the packages, on a machine with an NVIDIA graphics card also the CUDA libraries, and the
// setup loads the speech model too, so the first voice message does not wait for a download of up to 1.6 GB.
// WHISPER_PYTHON (an environment of one's own, also the "-voice" image's), the older local/tools/.venv and a Python
// of the system that has faster-whisper already are used as they are.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, projectRoot } from './config.ts';
import { machineSettings } from './machine-settings.ts';
import type { BotVoice, Language, VoiceSetup } from '../../shared/protocol.ts';

const REQUIREMENTS = path.join(projectRoot, 'local', 'tools', 'requirements-voice.txt');
const CUDA_PACKAGES = ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12==9.*'];
const INSTALL_TIMEOUT_MS = 30 * 60_000;
/** What the transcription imports; faster-whisper alone loads without its engine. */
const CHECK = 'import faster_whisper, av, ctranslate2';
/** What reading aloud on the machine imports (local/tools/speak.py); missing in environments from before it. */
const SPEECH_CHECK = 'import piper';

/**
 * The voice that reads aloud on the machine, per language and kind, by the voices Piper offers (rhasspy/piper-voices):
 * the best German ones are Thorsten (male, "high") and Kerstin (female, "medium"); in English Ryan and Lessac, both
 * "high". The setup loads the two of the settings' language; the others come with their first use.
 */
export const LOCAL_VOICES: Record<Language, Record<BotVoice, string>> = {
    de: { female: 'de_DE-kerstin-medium', male: 'de_DE-thorsten-high' },
    en: { female: 'en_US-lessac-high', male: 'en_US-ryan-high' },
};

/** Where those voices live: per machine, next to the environment. */
export const piperDataDir = (): string => path.join(config.dataDir, 'voice', 'piper');

const venvPython = (dir: string): string => path.join(dir, process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python3'));
/** The environment this module sets up. */
export const voiceVenv = (): string => path.join(config.dataDir, 'voice', '.venv');
const OLD_VENV = path.join(projectRoot, 'local', 'tools', '.venv');

/** A Python of the system with faster-whisper, found by voiceStatus() when there is no environment. */
let systemPython: string | null = null;

/**
 * The Python the transcription runs with: WHISPER_PYTHON, the environment set up here, the older one, a Python of the
 * system that has faster-whisper (after voiceStatus()), or none.
 */
export function voicePython(): string | null {
    if (process.env.WHISPER_PYTHON) return process.env.WHISPER_PYTHON;
    for (const dir of [voiceVenv(), OLD_VENV]) if (fs.existsSync(venvPython(dir))) return venvPython(dir);
    return systemPython;
}

let state: VoiceSetup = { state: 'missing' };
let checked = false;

const run = (file: string, args: string[], timeout = 60_000): Promise<{ ok: boolean; out: string }> => new Promise((resolve) => {
    try {
        execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8' }, (e, stdout, stderr) => resolve({ ok: !e, out: `${stdout}${stderr}`.trim() }));
    } catch (e) {
        // Windows refuses a file that is no program (EFTYPE) right away instead of through the callback
        resolve({ ok: false, out: (e as Error).message });
    }
});

/** Where things stand; checks once whether faster-whisper loads in the environment found. */
export async function voiceStatus(): Promise<VoiceSetup> {
    // A container sets nothing up; the "-voice" image brings its Python as WHISPER_PYTHON, which is checked like any other
    if (process.env.OPENFOLK_CONTAINER === '1' && !process.env.WHISPER_PYTHON) return { state: 'unavailable' };
    if (state.state === 'installing' || checked) return state;
    checked = true;
    const python = voicePython() ?? (systemPython = await installedPython());
    if (!python) return (state = { state: 'missing' });
    const r = await run(python, ['-c', CHECK]);
    if (!r.ok) return (state = { state: 'missing', detail: lastLine(r.out) });
    state = { state: 'ready', detail: python, speech: (await run(python, ['-c', SPEECH_CHECK])).ok };
    return state;
}

/** A Python of the system that has faster-whisper installed already, as the path of its executable; null if none. */
async function installedPython(): Promise<string | null> {
    for (const [file, ...pre] of candidates()) {
        const r = await run(file, [...pre, '-c', `${CHECK}, sys; print(sys.executable)`], 30_000);
        const exe = r.ok ? lastLine(r.out) : '';
        if (exe && fs.existsSync(exe)) return exe;
    }
    return null;
}

const candidates = (): string[][] => (process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']]);

const lastLine = (text: string): string => text.split('\n').map((l) => l.trim()).findLast(Boolean)?.slice(0, 300) ?? '';

/** A Python 3.9+ to create the environment with (on Windows the py launcher first; the Store's python alias fails). */
async function basePython(): Promise<string[] | null> {
    for (const [file, ...pre] of candidates()) {
        const r = await run(file, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 9))'], 20_000);
        if (r.ok && r.out.endsWith('True')) return [file, ...pre];
    }
    return null;
}

/** One step with its output kept short; rejects with the last line of output. */
function step(file: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { windowsHide: true });
        let out = '';
        const keep = (d: Buffer) => { out = (out + d.toString()).slice(-4000); };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(lastLine(out) || `exit code ${code}`));
        });
    });
}

/**
 * Creates the environment and installs the packages. `report` gets every change of state; `language` says which
 * voices for reading aloud to load. Only one setup at a time; a running one is not started twice.
 */
export async function setupVoice(report: (s: VoiceSetup) => void, language: Language = 'en'): Promise<void> {
    if (state.state === 'installing' || process.env.OPENFOLK_CONTAINER === '1' || process.env.WHISPER_PYTHON) return;
    const set = (s: VoiceSetup) => { state = s; report(s); };
    const log = (text: string) => console.log(`${new Date().toTimeString().slice(0, 8)} voice setup: ${text}`);
    set({ state: 'installing', detail: 'python' });
    const base = await basePython();
    if (!base) {
        log('no Python 3.9 or newer found');
        set({ state: 'failed', detail: 'no_python' });
        return;
    }
    const venv = voiceVenv();
    try {
        if (!fs.existsSync(venvPython(venv))) {
            log(`creating ${venv} with ${base.join(' ')}`);
            fs.mkdirSync(path.dirname(venv), { recursive: true });
            await step(base[0], [...base.slice(1), '-m', 'venv', venv]);
        }
        set({ state: 'installing', detail: 'packages' });
        const python = venvPython(venv);
        const pip = [python, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input'];
        let gpu = (await run('nvidia-smi', ['-L'], 20_000)).ok;
        log(`installing the packages${gpu ? ' with the CUDA libraries' : ''}`);
        await step(pip[0], [...pip.slice(1), '-r', REQUIREMENTS, ...(gpu ? CUDA_PACKAGES : [])]);
        // nvidia-smi is not on every PATH: CTranslate2 sees the card as well, and without cuBLAS and cuDNN it cannot use it
        if (!gpu && Number(lastLine((await run(python, ['-c', 'import ctranslate2; print(ctranslate2.get_cuda_device_count())'])).out)) > 0) {
            gpu = true;
            log('graphics card found, installing the CUDA libraries');
            await step(pip[0], [...pip.slice(1), ...CUDA_PACKAGES]);
        }
        // The model the transcription will load (transcribe.py): loaded now, with the setup's time limit
        const model = machineSettings().voiceModel || (gpu && machineSettings().voiceDevice !== 'cpu' ? 'large-v3-turbo' : 'small');
        set({ state: 'installing', detail: `model:${model}` });
        log(`loading the speech model ${model}`);
        await step(python, ['-c', `from faster_whisper import download_model; download_model(${JSON.stringify(model)})`]);
        // The voices for reading aloud (speak.py loads a missing one on its first use, which then takes a while)
        const voices = Object.values(LOCAL_VOICES[language]);
        set({ state: 'installing', detail: 'voices' });
        log(`loading the voices for reading aloud: ${voices.join(', ')}`);
        try {
            await step(python, ['-m', 'piper.download_voices', '--download-dir', piperDataDir(), ...voices]);
        } catch (e) {
            log(`voices not loaded, they come with the first use: ${(e as Error).message}`);
        }
        checked = false;
        state = { state: 'missing' };
        const done = await voiceStatus();
        log(done.state === 'ready' ? 'ready' : `not usable: ${done.detail ?? ''}`);
        set(done.state === 'ready' ? done : { state: 'failed', detail: done.detail });
    } catch (e) {
        log(`failed: ${(e as Error).message}`);
        set({ state: 'failed', detail: (e as Error).message.slice(0, 300) });
    }
}
