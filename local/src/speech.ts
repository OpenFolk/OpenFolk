// Reading messages aloud with a cloud voice: the web app splits the text into parts and asks for each one; the backend
// has the provider of the shared settings turn it into audio with the key stored for it (OpenAI or Gemini). The
// result is kept per account for a while, so reading a message again costs nothing. Without a key the web app keeps
// to the device's own voice, which is why "auto" is resolved the same way there (webapp/js/chat-features.js).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import { apiKey, readAloudVoice } from './settings.ts';
import { accountPath } from './store.ts';
import type { BotVoice, ReadAloudVoice, SharedApiKey } from '../../shared/protocol.ts';

type Provider = Extract<SharedApiKey, 'openai' | 'gemini'>;

// marin and cedar are OpenAI's recommended voices for gpt-4o-mini-tts; without a style instruction the English-centred
// voices read German with an accent (found in the Skool project's voice tests), with it they read English words
// inside German text the German way, hence the second sentence.
const OPENAI = { model: 'gpt-4o-mini-tts', voices: { female: 'marin', male: 'cedar' } };
const GEMINI = { model: 'gemini-3.8-flash-tts', voices: { female: 'Kore', male: 'Charon' } };
const STYLE = 'Read in the language of the text with the natural pronunciation of a native speaker, without a foreign accent. '
    + 'Pronounce English words, names and technical terms inside a German text the English way, as a German software developer would. '
    + 'Calm and friendly, at a medium pace, like reading a message to a colleague.';
const TIMEOUT_MS = 60_000;
/** Audio is kept this long after its last use. */
const KEEP_MS = 30 * 24 * 3600_000;
const PRUNE_EVERY_MS = 3600_000;
let lastPrune = 0;

/** The provider that reads: the chosen one if its key is stored, with "auto" the first stored key; else none. */
export function speechProvider(choice: ReadAloudVoice = readAloudVoice(), has: (k: Provider) => boolean = (k) => Boolean(apiKey(k))): Provider | null {
    if (choice === 'device') return null;
    if (choice === 'auto') return has('openai') ? 'openai' : has('gemini') ? 'gemini' : null;
    return has(choice) ? choice : null;
}

/** Audio for one part of a text in the bot's voice, from the cache or the provider. */
export async function synthesize(text: string, who: BotVoice = 'female'): Promise<{ mime: string; data: string }> {
    const provider = speechProvider();
    if (!provider) throw new Error(t('speech.noVoice'));
    const { model, voices } = provider === 'openai' ? OPENAI : GEMINI;
    const voice = voices[who];
    const mime = provider === 'openai' ? 'audio/mpeg' : 'audio/wav';
    const file = accountPath('speech', crypto.createHash('sha256').update(JSON.stringify([provider, model, voice, STYLE, text])).digest('hex') + (provider === 'openai' ? '.mp3' : '.wav'));
    try {
        const data = fs.readFileSync(file);
        const now = new Date();
        fs.utimesSync(file, now, now);
        return { mime, data: data.toString('base64') };
    } catch { /* not there yet */ }
    const audio = provider === 'openai' ? await openai(text, voice) : await gemini(text, voice);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, audio);
    prune(path.dirname(file));
    return { mime, data: audio.toString('base64') };
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e: Error) => { throw new Error(t('speech.unreachable', { error: e.name === 'TimeoutError' ? 'timeout' : e.message })); });
    if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(t('speech.failed', { error: json.error?.message || `HTTP ${response.status}` }));
    }
    return response;
}

/** OpenAI's speech endpoint answers with the MP3 itself. */
async function openai(text: string, voice: string): Promise<Buffer> {
    const response = await post('https://api.openai.com/v1/audio/speech', { authorization: `Bearer ${apiKey('openai')}` },
        { model: OPENAI.model, voice, input: text, instructions: STYLE, response_format: 'mp3' });
    return Buffer.from(await response.arrayBuffer());
}

/** Gemini's Interactions API: a WAV (24 kHz, 16 bit, mono) as base64 in the last audio content of the model output. */
async function gemini(text: string, voice: string): Promise<Buffer> {
    const response = await post('https://generativelanguage.googleapis.com/v1beta/interactions', { 'x-goog-api-key': apiKey('gemini') }, {
        model: GEMINI.model,
        input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE }] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice }] },
    });
    type Content = { type?: string; data?: string };
    const json = await response.json().catch(() => ({})) as { steps?: { type?: string; content?: Content[] }[] };
    const audio = (json.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).findLast((c) => c.type === 'audio' && c.data);
    if (!audio?.data) throw new Error(t('speech.noAudio'));
    return Buffer.from(audio.data, 'base64');
}

/** Removes audio not used for KEEP_MS, at most once an hour. */
function prune(dir: string): void {
    if (Date.now() - lastPrune < PRUNE_EVERY_MS) return;
    lastPrune = Date.now();
    for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        try {
            if (Date.now() - fs.statSync(file).mtimeMs > KEEP_MS) fs.rmSync(file);
        } catch { /* gone meanwhile */ }
    }
}
