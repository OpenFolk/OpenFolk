// The voice conversation over OpenAI Realtime (webapp/js/talk-realtime.js). The model is only the bot's voice: it has
// one tool, ask_bot, and passes every request on; the web app sends it into the bot's chat and hands the finished
// answer back. The backend does the SDP exchange with the stored key ("unified interface" of /v1/realtime/calls), so
// the key never leaves the machine and the relay's page needs no connection to OpenAI. Audio then flows between the
// device and OpenAI directly.

import { t } from './i18n.ts';
import type { Bot, BotVoice, Language, TalkMode } from '../../shared/protocol.ts';

const MODELS: Record<Exclude<TalkMode, 'app'>, string> = { openai: 'gpt-realtime-2.1', 'openai-mini': 'gpt-realtime-2.1-mini' };
// marin and cedar are the voices OpenAI recommends, the same as for reading aloud (speech.ts)
const VOICES: Record<BotVoice, string> = { female: 'marin', male: 'cedar' };
const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'German' };
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const TIMEOUT_MS = 20_000;

export interface RealtimeOptions {
    mode: Exclude<TalkMode, 'app'>;
    voice: BotVoice;
    /** Language of the conversation (the shared UI language). */
    language: Language;
    /** Language of the transcription; '' = detect. */
    transcribe: '' | Language;
}

/** What the model is told: be the bot's voice, pass everything on, speak the result briefly and faithfully. The
 *  language rule follows OpenAI's prompting guide (a default language, a switch only on a substantive utterance). */
function instructions(bot: Bot, language: Language): string {
    const name = bot.name;
    return [
        `You are the voice of ${name}${bot.role ? `, ${bot.role}` : ''}, a colleague the user works with in the messenger OpenFolk.`,
        `You cannot see files, run anything or know the user's projects; ${name} can. For every question, request or task call ask_bot with the request, complete and in the user's own words and language. Do not answer it yourself, do not ask for confirmation first.`,
        `Right before the call say one short neutral line such as "One moment, I'll ask ${name}." It must not suggest success or failure.`,
        `${name} may need minutes. If the user speaks meanwhile, say briefly that ${name} is still working, and call ask_bot again only for a new request.`,
        `When the result arrives, speak it as ${name} would, in a few short sentences: keep facts, numbers, names and questions, leave out code, lists and links, add nothing of your own. If ${name} asks something, ask it.`,
        'Greetings, thanks and "are you there" you answer yourself in one sentence.',
        `Default to ${LANGUAGE_NAMES[language]} unless the user clearly speaks another language in a substantive utterance; never switch because of an accent, a name or a single foreign word. Pronounce English technical terms the English way.`,
    ].join('\n');
}

/** The session for a bot's chat, as OpenAI's "session" form field. */
export function realtimeSession(bot: Bot, o: RealtimeOptions) {
    return {
        type: 'realtime' as const,
        model: MODELS[o.mode],
        instructions: instructions(bot, o.language),
        output_modalities: ['audio'],
        reasoning: { effort: 'low' as const },
        audio: {
            input: {
                transcription: { model: 'gpt-transcribe', ...(o.transcribe ? { language: o.transcribe } : {}) },
                noise_reduction: { type: 'near_field' as const },
                turn_detection: { type: 'semantic_vad' as const, eagerness: 'auto' as const },
            },
            output: { voice: VOICES[o.voice] },
        },
        tools: [{
            type: 'function' as const,
            name: 'ask_bot',
            description: `Pass the user's request to ${bot.name}, who does the work and answers. Returns ${bot.name}'s answer as text.`,
            parameters: {
                type: 'object' as const,
                properties: { request: { type: 'string' as const, description: 'The user\'s request, complete, in their words and language.' } },
                required: ['request'],
            },
        }],
        tool_choice: 'auto' as const,
    };
}

export type RealtimeSession = ReturnType<typeof realtimeSession>;

/** Sends the browser's SDP offer with the session to OpenAI and returns the SDP answer. */
export async function connectRealtime(sdp: string, session: RealtimeSession, key: string, fetchFn: typeof fetch = fetch): Promise<string> {
    if (!key) throw new Error(t('talk.noKey'));
    const form = new FormData();
    form.set('sdp', sdp);
    form.set('session', JSON.stringify(session));
    const response = await fetchFn(CALLS_URL, {
        method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e: Error) => { throw new Error(t('talk.unreachable', { error: e.name === 'TimeoutError' ? 'timeout' : e.message })); });
    if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(t('talk.failed', { error: json.error?.message || `HTTP ${response.status}` }));
    }
    return response.text();
}
