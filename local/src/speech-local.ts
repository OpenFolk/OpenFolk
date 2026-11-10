// Reading aloud with a voice on the machine: Piper (local/tools/speak.py) in the Python environment of the voice
// messages. The service starts with the first text, keeps its voices loaded and stops after a while without work.
// Free and offline, below the cloud voices in quality; the choice "on the bot's machine" in the settings, and the
// fallback of "automatic" when no key is stored.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config, projectRoot } from './config.ts';
import { t } from './i18n.ts';
import { piperDataDir, voicePython, voiceStatus } from './voice-setup.ts';

const SCRIPT = path.join(projectRoot, 'local', 'tools', 'speak.py');
const IDLE_MIN = 10;
const START_TIMEOUT_S = 60;
/** A voice not on the machine yet is downloaded first (60 to 120 MB); speak.py says so first. */
const DOWNLOAD_TIMEOUT_S = 10 * 60;
const JOB_TIMEOUT_S = 60;

/** Whether this machine can read aloud itself: voice messages set up and piper-tts in their Python. */
export async function localVoiceReady(): Promise<boolean> {
    const s = await voiceStatus();
    return s.state === 'ready' && s.speech === true;
}

interface Pending {
    resolve: (duration: number) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
}

function log(text: string): void {
    console.log(`${new Date().toTimeString().slice(0, 8)} speech: ${text}`);
}

class Speaker {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private ready: Promise<void> | null = null;
    private pending = new Map<string, Pending>();
    private buffer = '';
    private idle: NodeJS.Timeout | null = null;

    private start(python: string): Promise<void> {
        if (this.ready) return this.ready;
        const since = Date.now();
        this.ready = new Promise<void>((resolve, reject) => {
            const proc = spawn(python, ['-u', SCRIPT], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PIPER_DATA_DIR: piperDataDir() }, windowsHide: true });
            this.proc = proc;
            const startTimer = setTimeout(() => reject(new Error(t('speech.localTimeout', { machine: config.machine.toUpperCase() }))), START_TIMEOUT_S * 1000);
            let errorText = '';
            proc.stderr.on('data', (d: Buffer) => { errorText = (errorText + d.toString()).slice(-2000); });
            proc.stdout.on('data', (d: Buffer) => {
                this.buffer += d.toString('utf8');
                let i: number;
                while ((i = this.buffer.indexOf('\n')) >= 0) {
                    const line = this.buffer.slice(0, i).trim();
                    this.buffer = this.buffer.slice(i + 1);
                    if (!line) continue;
                    let m: Record<string, unknown>;
                    try {
                        m = JSON.parse(line) as Record<string, unknown>;
                    } catch {
                        continue;
                    }
                    if ('ready' in m) {
                        clearTimeout(startTimer);
                        if (m.ready) {
                            log(`Piper ready after ${((Date.now() - since) / 1000).toFixed(1)} s`);
                            resolve();
                        } else reject(new Error(t('speech.localMissing', { machine: config.machine.toUpperCase(), python, error: String(m.error ?? '') })));
                        continue;
                    }
                    if ('downloading' in m) {
                        // the job waiting gets the download's time instead of its own
                        log(`downloading the voice ${String(m.downloading)} first`);
                        for (const [id, o] of this.pending) {
                            clearTimeout(o.timer);
                            o.timer = setTimeout(() => { this.pending.delete(id); o.reject(new Error(t('speech.localDownloadTimeout', { voice: String(m.downloading) }))); }, DOWNLOAD_TIMEOUT_S * 1000);
                        }
                        continue;
                    }
                    const o = this.pending.get(String(m.id));
                    if (!o) continue;
                    clearTimeout(o.timer);
                    this.pending.delete(String(m.id));
                    if (m.error) o.reject(new Error(t('speech.localFailed', { machine: config.machine.toUpperCase(), error: String(m.error) })));
                    else o.resolve(Number(m.duration ?? 0));
                }
            });
            proc.on('error', (e) => {
                clearTimeout(startTimer);
                reject(new Error(t('voice.pythonFailed', { python, error: e.message })));
            });
            proc.on('exit', (code) => {
                clearTimeout(startTimer);
                const reason = new Error(`Piper exited (code ${code})${errorText ? `: ${errorText.trim().split('\n').pop()}` : ''}`);
                reject(reason);
                for (const o of this.pending.values()) {
                    clearTimeout(o.timer);
                    o.reject(reason);
                }
                this.pending.clear();
                this.proc = null;
                this.ready = null;
                this.buffer = '';
            });
        });
        this.ready.catch(() => { this.ready = null; this.proc?.kill(); });
        return this.ready;
    }

    /** Writes `text` spoken by `voice` (a Piper voice name) as a WAV to `file`; returns its length in seconds. */
    async speak(text: string, voice: string, file: string): Promise<number> {
        if (this.idle) clearTimeout(this.idle);
        const since = Date.now();
        if (!this.ready) {
            const s = await voiceStatus();
            const machine = config.machine.toUpperCase();
            if (s.state === 'unavailable') throw new Error(t('voice.unavailable', { machine }));
            if (s.state === 'installing') throw new Error(t('voice.installing', { machine }));
            if (!voicePython()) throw new Error(t('voice.notSetUp', { machine }));
        }
        const python = voicePython()!;
        await this.start(python);
        const id = randomUUID();
        const result = new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(t('speech.localTimeout', { machine: config.machine.toUpperCase() })));
            }, JOB_TIMEOUT_S * 1000);
            this.pending.set(id, { resolve, reject, timer });
        });
        this.proc!.stdin.write(JSON.stringify({ id, text, voice, path: file }) + '\n');
        try {
            const duration = await result;
            log(`${duration.toFixed(1)} s of speech (${voice}) in ${((Date.now() - since) / 1000).toFixed(1)} s`);
            return duration;
        } finally {
            this.idle = setTimeout(() => this.stop(), IDLE_MIN * 60_000);
        }
    }

    stop(): void {
        if (this.idle) clearTimeout(this.idle);
        this.idle = null;
        this.proc?.stdin.end();
        this.proc?.kill();
    }
}

export const speaker = new Speaker();
