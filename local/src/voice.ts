// Turn voice messages into text, locally with faster-whisper (local/tools/transcribe.py).
// The Python service starts with the first voice message, keeps the model loaded and is stopped after a
// longer idle time so it frees the graphics memory again.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { projectRoot } from './config.ts';
import { t } from './i18n.ts';
import { machineSettings } from './machine-settings.ts';
import { voicePython } from './voice-setup.ts';

const SCRIPT = path.join(projectRoot, 'local', 'tools', 'transcribe.py');
const IDLE_MIN = 30;
const START_TIMEOUT_S = 180;
const JOB_TIMEOUT_S = 180;

export interface Transcript {
    text: string;
    language: string;
    duration: number;
}

interface Pending {
    resolve: (t: Transcript) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
}

function python(): string {
    return voicePython() ?? 'python';
}

/**
 * Environment of the Python service: model and device from the machine settings, nothing from the backend's own
 * environment. Without a model it picks large-v3-turbo, or small without a graphics card.
 */
function whisperEnv(): NodeJS.ProcessEnv {
    const { WHISPER_MODEL: _m, WHISPER_DEVICE: _d, WHISPER_LANGUAGE: _l, ...env } = process.env;
    const s = machineSettings();
    return { ...env, PYTHONIOENCODING: 'utf-8', WHISPER_DEVICE: s.voiceDevice, ...(s.voiceModel ? { WHISPER_MODEL: s.voiceModel } : {}) };
}

function log(text: string): void {
    console.log(`${new Date().toTimeString().slice(0, 8)} voice: ${text}`);
}

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

class Transcriber {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private ready: Promise<void> | null = null;
    private pending = new Map<string, Pending>();
    private buffer = '';
    private idle: NodeJS.Timeout | null = null;

    private start(): Promise<void> {
        if (this.ready) return this.ready;
        const since = Date.now();
        this.ready = new Promise<void>((resolve, reject) => {
            const proc = spawn(python(), ['-u', SCRIPT], { env: whisperEnv(), windowsHide: true });
            this.proc = proc;
            const startTimer = setTimeout(() => reject(new Error(t('voice.startTimeout'))), START_TIMEOUT_S * 1000);
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
                            log(`Whisper ready (${String(m.model)} on ${String(m.device)}) after ${seconds(Date.now() - since)} s`);
                            resolve();
                        } else {
                            reject(new Error(`${String(m.error ?? 'Whisper cannot be loaded')} (Python: ${python()})`));
                        }
                        continue;
                    }
                    const o = this.pending.get(String(m.id));
                    if (!o) continue;
                    clearTimeout(o.timer);
                    this.pending.delete(String(m.id));
                    if (m.error) o.reject(new Error(String(m.error)));
                    else o.resolve({ text: String(m.text ?? ''), language: String(m.language ?? ''), duration: Number(m.duration ?? 0) });
                }
            });
            proc.on('error', (e) => {
                clearTimeout(startTimer);
                reject(new Error(t('voice.pythonFailed', { python: python(), error: e.message })));
            });
            proc.on('exit', (code) => {
                clearTimeout(startTimer);
                const reason = new Error(`Whisper exited (code ${code})${errorText ? `: ${errorText.trim().split('\n').pop()}` : ''}`);
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
        // Failed start: start again on the next attempt
        this.ready.catch(() => { this.ready = null; this.proc?.kill(); });
        return this.ready;
    }

    /** Loads the model while recording is still in progress; without a following voice message the idle limit applies. */
    warmUp(): void {
        if (this.idle) clearTimeout(this.idle);
        this.idle = setTimeout(() => this.stop(), IDLE_MIN * 60_000);
        this.start().catch(() => { /* the transcription reports the error itself */ });
    }

    /**
     * At the start of the backend: load the model right away where Whisper is set up (own Python environment or
     * WHISPER_PYTHON), so the first voice message after waking the machine does not wait for the cold start.
     * Switched off in the machine settings (machines that need the graphics memory otherwise, tests).
     */
    preload(): void {
        if (!machineSettings().voicePreload) return;
        if (!voicePython()) return;
        log('loading Whisper at start');
        this.warmUp();
    }

    /** `language`: en, de, or '' to detect it. */
    async transcribe(file: string, language = ''): Promise<Transcript> {
        if (this.idle) clearTimeout(this.idle);
        const since = Date.now();
        const cold = !this.ready;
        await this.start();
        const waited = Date.now() - since;
        const id = randomUUID();
        const result = new Promise<Transcript>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(t('voice.tooSlow')));
            }, JOB_TIMEOUT_S * 1000);
            this.pending.set(id, { resolve, reject, timer });
        });
        this.proc!.stdin.write(JSON.stringify({ id, path: file, language }) + '\n');
        try {
            const x = await result;
            const model = waited >= 100 ? `, ${seconds(waited)} s of it waiting for the model${cold ? ' (cold start)' : ''}` : '';
            log(`${seconds(x.duration * 1000)} s of audio transcribed in ${seconds(Date.now() - since)} s${model}`);
            return x;
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

export const transcriber = new Transcriber();
