// Suggestions for the bot editor: name with field of work, role and a profile picture, made by Claude in a short session without
// tools. As context Claude gets README.md and CLAUDE.md of the folder and its entries. With Claude switched off on this
// machine another engine that is on answers instead (suggestionEngine), asked for the same JSON in plain words.
// Profile picture: with the key of the image model in the shared settings (Gemini for Nano Banana, OpenAI for gpt-image)
// Claude describes the person and the image model turns that into a photo (data URL); without a key Claude
// draws an SVG that the browser turns into an image. A bot making its own picture (make_avatar) gets the same, only
// small: the backend cannot shrink a picture, and the SVG is kept as it is.

import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ACP_AGENTS, AcpRun } from './acp.ts';
import { CodexRun, type EngineTarget } from './codex.ts';
import { claudeEnv, claudeSettings, engineAvailable } from './engine-home.ts';
import { engineEnabled } from './machine-settings.ts';
import { underAllowedRoot } from './bots.ts';
import { projectRoot } from './config.ts';
import { language, t } from './i18n.ts';
import { apiKey, avatarModel } from './settings.ts';
import { OTHER_ENGINES, engineModelId, engineOf, type BotVoice, type Engine, type Language, type SuggestionRequest, type SuggestionResult } from '../../shared/protocol.ts';

const MAX_CONTEXT = 2500;
// Realistic portraits need many gradients and strands, hence more room than a flat drawing.
const MAX_SVG = 200 * 1024;
const TIMEOUT_MS = 90_000;
/** Image model for photos; the answer must be there before the web app's 120-s timer. */
const PHOTO_TIMEOUT_MS = 75_000;
/**
 * The image model a photo is made with: the one chosen in the shared settings (default Nano Banana 2, about 6 cents per
 * image), or, when only the other provider's key is stored, that provider's model; a drawing only without either key.
 */
export function photoModel(has: (p: 'gemini' | 'openai') => boolean = (p) => Boolean(apiKey(p)), chosen: string = avatarModel()): string | null {
    const provider = chosen.startsWith('gemini') ? 'gemini' : 'openai';
    if (has(provider)) return chosen;
    if (provider === 'gemini' && has('openai')) return 'gpt-image-1';
    if (provider === 'openai' && has('gemini')) return 'gemini-3.1-flash-image';
    return null;
}
/**
 * The model OpenAI makes the photo with. The setting keeps the value 'gpt-image-1' as "OpenAI" (stored settings and
 * older apps name it), but OpenAI retired that model; its successor answers the same request.
 */
const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const photoProvider = (): 'gemini' | 'openai' => ((photoModel() ?? avatarModel()).startsWith('gemini') ? 'gemini' : 'openai');

const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'German' };

/** What Claude should deliver: 'photo' is the description of the person for the image model (step 1 of the photo). */
type Task = SuggestionRequest['what'] | 'photo';

const SCHEMAS = {
    name: {
        type: 'object',
        properties: {
            suggestions: {
                type: 'array', minItems: 3, maxItems: 3,
                items: { type: 'object', properties: { name: { type: 'string' }, area: { type: 'string' }, voice: { type: 'string', enum: ['female', 'male'] } }, required: ['name', 'area', 'voice'], additionalProperties: false },
            },
        },
        required: ['suggestions'], additionalProperties: false,
    },
    role: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'], additionalProperties: false },
    avatar: { type: 'object', properties: { svg: { type: 'string' } }, required: ['svg'], additionalProperties: false },
    photo: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'], additionalProperties: false },
} as const;

/** Whether photos are possible: a key of an image model's provider is in the settings. */
export function photoPossible(): boolean {
    return photoModel() !== null;
}

function photoKey(): string {
    return apiKey(photoProvider());
}

/** README.md, CLAUDE.md and the folder's entries as context; nothing outside the allowed roots. */
export function folderContext(folder: string): string {
    const abs = path.resolve(folder || '');
    if (!folder || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory() || !underAllowedRoot(abs)) return '';
    const parts: string[] = [`Folder: ${abs.replace(/\\/g, '/')}`];
    try {
        const entries = fs.readdirSync(abs).filter((e) => !e.startsWith('.') && e !== 'node_modules' && e !== 'vendor').slice(0, 40);
        parts.push(`Entries: ${entries.join(', ')}`);
    } catch { /* without list */ }
    for (const name of ['README.md', 'CLAUDE.md']) {
        const p = path.join(abs, name);
        if (!fs.existsSync(p)) continue;
        const text = fs.readFileSync(p, 'utf8').slice(0, MAX_CONTEXT);
        parts.push(`\n--- ${name} (beginning) ---\n${text}`);
    }
    return parts.join('\n');
}

export function prompt(a: SuggestionRequest, context: string, task: Task = a.what, lang: Language = language()): string {
    const languageName = LANGUAGE_NAMES[lang];
    const known = [a.name && `Name: ${a.name}`, a.area && `Field of work: ${a.area}`, a.role && `Role: ${a.role}`, a.tone && `Tone/way of working: ${a.tone.slice(0, 600)}`,
        a.wish && (task === 'photo' || task === 'avatar') && `Wishes for the picture: ${a.wish.slice(0, 600)}`].filter(Boolean).join('\n');
    const head = ['A user creates a bot in a messenger app: a Claude Code colleague that works permanently in a project folder.',
        known ? `Details so far:\n${known}` : 'No details so far.', context || 'Nothing is known about the folder.'];
    switch (task) {
        case 'photo':
            head.push('Describe for an image model the person who embodies this bot, as an English prompt for a portrait photo',
                '(one paragraph, 60 to 110 words, only the description). First name and sound of the name determine gender, age',
                '(25 to 45) and charisma; the role determines collar, accessories on the head and the blurred background (e.g.',
                'shirt collar, hoodie, headphones, glasses, office, workshop, studio). The photo is a tight close-up of the face, so',
                'describe face and hair precisely, clothing only briefly. The person is strikingly attractive and charismatic like a model on a',
                'magazine cover: distinctive features, bright eyes, well-groomed hair, a confident, warm smile, stylish',
                'and well-fitting clothes. Name hairstyle, hair color, eye color, skin tone, clothing and background concretely.',
                'No text, no logos, no animals, no robots.',
                a.previous?.length ? 'A different person than last time (different type, hairstyle, hair color, clothing).' : '');
            break;
        case 'name':
            head.push('Suggest three names for the bot, each a first name with a field of work; the app shows them as two separate',
                'fields, like name "Astrid" with field of work "Assistant", "Rudolf" with "Research" or "Petra" with "Personnel".',
                'The name is only a common',
                `${languageName} first name, sometimes female, sometimes male. The field of work is a real ${languageName} word or short term`,
                'for what the bot does (from role, folder or tone): a full word rather than an abbreviation or tech jargon, capitalized,',
                'at most 24 characters. A matching initial letter is nice but not required; together they should sound natural, not',
                'like a tongue twister. No quotation marks, no hyphen. For each name say which voice reads the answers of the bot',
                'aloud: "female" or "male", as the name suggests.',
                a.previous?.length ? `Do not suggest again: ${a.previous.join(', ')}.` : '');
            break;
        case 'role':
            head.push(`Phrase the bot's role as a short line for the chat list (at most 60 characters, in ${languageName}, no period at the end),`,
                'e.g. "Servers, deployments, hosting" or "Coordinates the other bots".',
                a.previous?.length ? `Not again: ${a.previous.join(' | ')}.` : '');
            break;
        case 'avatar':
            head.push('Create a profile picture for the bot as SVG: a portrait of a human, head and shoulders, frontal, friendly',
                'smiling, as realistic as an application photo, explicitly no flat illustration, no comic, no cartoon.',
                'Realism comes from light and shadow: soft radial and linear gradients for skin (cheeks, forehead, bridge of the nose,',
                'chin, neck with a core shadow under the chin), highlights in eyes and on lips, hair as many fine',
                'strands in several tones instead of one area, natural skin colors with redness on cheeks and nose, eyebrows from',
                'single strokes, slight blur (feGaussianBlur) for shadow gradients, a soft, blurred background as in',
                'a photo with an open aperture (work out face, neck, hair, eyes, brows, nose, mouth, ears, top). The person',
                'should fit the name: first name and sound of the name determine gender, approximate age, hairstyle and charisma; the',
                'role determines clothing and accessories (e.g. glasses, headphones, shirt, hoodie, blazer). Choose skin tone and hair color freely,',
                'face large in the picture (about 60 % of the height). Square, viewBox="0 0 256 256", width="256" height="256". Allowed are',
                'paths, basic shapes, gradients, masks and filters (feGaussianBlur, feDropShadow); no text, no lettering, no animals,',
                'no robots, no external references, no scripts, no embedded raster images. Return the complete',
                'SVG markup.',
                a.previous?.length ? 'A different person than last time (different hairstyle, hair color, clothing).' : '');
            break;
    }
    return head.filter(Boolean).join('\n');
}

/** Check the SVG of the answer: only markup without scripts, events and foreign addresses. */
export function checkSvg(svg: unknown): string {
    if (typeof svg !== 'string') throw new Error('No SVG received');
    const s = svg.trim().replace(/^```(?:svg|xml)?\s*|\s*```$/g, '').trim();
    if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) throw new Error('The answer is not an SVG');
    if (s.length > MAX_SVG) throw new Error('SVG too large');
    if (/<script|<foreignObject|<iframe|javascript:|\son[a-z]+\s*=|href\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(s)) throw new Error('SVG contains forbidden content');
    return s;
}

/** Turn Claude's answer into the result of the frame; throws for an unusable answer. */
export function resultFrom(what: SuggestionRequest['what'], data: unknown): SuggestionResult {
    const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    switch (what) {
        case 'name': {
            const clean = (v: unknown) => typeof v === 'string' ? v.replace(/["„“]/g, '').trim().slice(0, 40) : '';
            const pairs = new Map<string, { area: string; voice: BotVoice }>();
            for (const s of Array.isArray(o.suggestions) ? o.suggestions : []) {
                const name = clean(s?.name);
                if (name && !pairs.has(name)) pairs.set(name, { area: clean(s?.area), voice: s?.voice === 'male' ? 'male' : 'female' });
            }
            if (!pairs.size) throw new Error('No names received');
            const chosen = [...pairs].slice(0, 3);
            return { what, names: chosen.map(([n]) => n), areas: chosen.map(([, x]) => x.area), voices: chosen.map(([, x]) => x.voice) };
        }
        case 'role': {
            const role = typeof o.role === 'string' ? o.role.trim().replace(/\.$/, '').slice(0, 80) : '';
            if (!role) throw new Error('No role received');
            return { what, role };
        }
        case 'avatar':
            if (typeof o.image === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(o.image)) return { what, image: o.image };
            return { what, svg: checkSvg(o.svg) };
    }
}

/** A profile picture as data URL for Bot.avatar: the photo as it is, the SVG encoded (the apps show it like any picture). */
export function avatarDataUrl(r: SuggestionResult): string {
    if (r.what !== 'avatar') throw new Error('No picture received');
    if (r.image) return r.image;
    return `data:image/svg+xml;base64,${Buffer.from(checkSvg(r.svg), 'utf8').toString('base64')}`;
}

/** Description of the person from Claude's answer; throws if it is missing. */
export function descriptionFrom(data: unknown): string {
    const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const b = typeof o.description === 'string' ? o.description.trim().slice(0, 1500) : '';
    if (b.length < 20) throw new Error('No description of the person received');
    return b;
}

/** Complete prompt for the image model: Claude's person plus fixed requirements for a real photo. */
export function photoPrompt(description: string): string {
    return `${description}\n\nPhotorealistic professional close-up headshot, square crop: the face fills about 70 percent of the `
        + 'frame height, framed from just above the top of the head to just below the chin, with only the neck and the top of the '
        + 'collar visible and no torso, subject centered and looking into the camera, '
        + 'shot on a full-frame camera with an 85mm lens at f/2, soft natural window light with a gentle '
        + 'rim light, shallow depth of field with a softly blurred background, natural skin texture, sharp focus on the eyes, true '
        + 'to life colors, editorial magazine quality. No text, no watermark, no logo, no illustration, no painting, no 3D render.';
}

/**
 * Asks Claude for a suggestion; a short session without tools and without history. `small`: the photo comes at
 * 512 pixels (a bot's own picture, which nothing shrinks before it travels in bots.json); the editor shrinks itself.
 */
export async function suggest(a: SuggestionRequest, small = false): Promise<SuggestionResult> {
    const context = folderContext(a.folder);
    if (a.what === 'avatar' && photoPossible()) {
        const description = descriptionFrom(await ask(a, context, 'photo'));
        return { what: 'avatar', image: await createPhoto(photoPrompt(description), small) };
    }
    return resultFrom(a.what, await ask(a, context, a.what));
}

/**
 * The engine a suggestion runs on: Claude as long as it is on (its structured output is the most reliable), otherwise
 * the bot's own engine, otherwise the first one that is on. With none on it stays Claude, whose error says so.
 */
export function suggestionEngine(model: string | undefined, on: (e: Engine) => boolean = (e) => engineEnabled(e) && engineAvailable(e)): Engine {
    if (on('claude')) return 'claude';
    const own = engineOf(model);
    return own !== 'claude' && on(own) ? own : OTHER_ENGINES.find(on) ?? 'claude';
}

function ask(a: SuggestionRequest, context: string, task: Task): Promise<unknown> {
    return askJson({ prompt: prompt(a, context, task), schema: SCHEMAS[task], shape: SHAPES[task], folder: context ? a.folder : '', model: a.model });
}

/** One question with a JSON answer, without tools or history: Claude with structured output, another engine in words. */
export interface JsonQuestion {
    prompt: string;
    schema: object;
    /** The answer's shape in words, for the engines without structured output */
    shape: string;
    /** Working folder of the short session; '' = the project's own */
    folder: string;
    model?: string;
    system?: string;
    timeoutMs?: number;
}

export function askJson(q: JsonQuestion): Promise<unknown> {
    const engine = suggestionEngine(q.model);
    // A model of another engine means nothing to Claude: then its default
    return engine === 'claude' ? askClaude({ ...q, model: engineOf(q.model) === 'claude' ? q.model : 'default' }) : askEngine(engine, q);
}

/** The answer's shape in words, for the engines without structured output. */
const SHAPES: Record<Task, string> = {
    name: '{"suggestions":[{"name":"…","area":"…","voice":"female" or "male"}, … three of them]}',
    role: '{"role":"…"}',
    avatar: '{"svg":"…"}',
    photo: '{"description":"…"}',
};

/** The JSON object in an answer that may come in a code fence or with words around it. */
export function jsonIn(text: string): unknown {
    const from = text.indexOf('{');
    const to = text.lastIndexOf('}');
    if (from < 0 || to < from) return undefined;
    try { return JSON.parse(text.slice(from, to + 1)); } catch { return undefined; }
}

/** One question to another engine (Codex, ACP) in a session of its own: no tools, every approval refused. */
function askEngine(engine: Exclude<Engine, 'claude'>, q: JsonQuestion): Promise<unknown> {
    const folder = q.folder ? path.resolve(q.folder) : projectRoot;
    return new Promise((resolve, reject) => {
        let text = '';
        let settled = false;
        const end = (error?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            run.close();
            if (error) reject(new Error(t('suggest.failed', { error })));
            else resolve(jsonIn(text));
        };
        const nothing = () => undefined;
        const target: EngineTarget = {
            threadId: nothing, account: nothing, limits: nothing, notice: nothing, textStarts: nothing, tool: nothing, toolResult: nothing, context: nothing,
            delta: (part) => { text += part; },
            done: (error) => end(error),
            approval: async () => ({ behavior: 'deny', message: 'No tools here: answer with the JSON only.' }),
        };
        const run = engine === 'codex' ? new CodexRun(target) : new AcpRun(ACP_AGENTS[engine], target);
        const timer = setTimeout(() => end('timeout'), q.timeoutMs ?? TIMEOUT_MS);
        void run.send(`${q.prompt}\nAnswer with one JSON object of this shape and nothing else: ${q.shape}`, {
            folder,
            model: engineOf(q.model) === engine ? engineModelId(q.model) : undefined,
            instructions: `${q.system ?? 'You help set up bots.'} Use no tools and change no files. Answer only with the requested JSON.`,
            tools: [],
        });
    });
}

async function askClaude(q: JsonQuestion): Promise<unknown> {
    const cwd = q.folder ? path.resolve(q.folder) : projectRoot;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), q.timeoutMs ?? TIMEOUT_MS);
    try {
        let data: unknown;
        let error: string | null = null;
        const run = query({
            prompt: q.prompt,
            options: {
                cwd,
                model: !q.model || q.model === 'default' ? undefined : q.model,
                tools: [],
                // The structured answer needs a second round depending on the model
                maxTurns: 3,
                persistSession: false,
                settingSources: [],
                systemPrompt: `${q.system ?? 'You help set up bots.'} Answer only with the requested JSON.`,
                outputFormat: { type: 'json_schema', schema: q.schema as Record<string, unknown> },
                env: claudeEnv(),
                settings: claudeSettings(),
                abortController: abort,
            },
        });
        for await (const m of run) {
            if (m.type !== 'result') continue;
            if (m.subtype === 'success') {
                data = m.structured_output ?? jsonFrom(m.result);
                if (m.is_error) error = m.result || m.subtype;
            } else {
                error = m.subtype;
            }
        }
        if (error) throw new Error(t('suggest.failed', { error }));
        return data;
    } finally {
        clearTimeout(timer);
    }
}

/** Lets the image model create a square photo; result as data URL. */
async function createPhoto(promptText: string, small: boolean): Promise<string> {
    return photoProvider() === 'gemini' ? photoGemini(promptText, small) : photoOpenai(promptText, small);
}

async function imageRequest(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    }).catch((e: Error) => { throw new Error(t('suggest.imageUnreachable', { error: e.name === 'TimeoutError' ? 'timeout' : e.message })); });
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, json };
}

/** Google Gemini (Nano Banana): generateContent with image output, image in candidates[].content.parts[].inlineData. */
async function photoGemini(promptText: string, small: boolean): Promise<string> {
    const { ok, status, json } = await imageRequest(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(photoModel() ?? avatarModel())}:generateContent`,
        { 'x-goog-api-key': photoKey() },
        {
            contents: [{ parts: [{ text: promptText }] }],
            // 512 only from Nano Banana 2 on; an older image model answers with its error
            generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: small ? '512' : '1K' } },
        },
    );
    const error = (json.error as { message?: string } | undefined)?.message;
    if (!ok) throw new Error(`Image model ${photoModel() ?? avatarModel()}: ${error || `HTTP ${status}`}`);
    type Part = { inlineData?: { mimeType?: string; data?: string }; text?: string };
    const candidates = json.candidates as { content?: { parts?: Part[] }; finishReason?: string }[] | undefined;
    const parts = candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!image?.data) {
        const reason = (json.promptFeedback as { blockReason?: string } | undefined)?.blockReason
            || candidates?.[0]?.finishReason || parts.find((p) => p.text)?.text?.slice(0, 200);
        throw new Error(t('suggest.noImage', { reason: reason ? ` (${reason})` : '' }));
    }
    const type = /^image\/(jpeg|png|webp)$/.test(image.mimeType ?? '') ? image.mimeType : 'image/png';
    return `data:${type};base64,${image.data}`;
}

/** OpenAI Images (gpt-image): image as b64_json. */
async function photoOpenai(promptText: string, small: boolean): Promise<string> {
    const { ok, status, json } = await imageRequest(
        'https://api.openai.com/v1/images/generations',
        { authorization: `Bearer ${photoKey()}` },
        // gpt-image makes no 512: a stronger JPEG compression keeps the picture small instead
        { model: OPENAI_IMAGE_MODEL, prompt: promptText, n: 1, size: '1024x1024', quality: 'medium', output_format: 'jpeg', ...(small ? { output_compression: 60 } : {}) },
    );
    const error = (json.error as { message?: string } | undefined)?.message;
    if (!ok) throw new Error(`Image model ${OPENAI_IMAGE_MODEL}: ${error || `HTTP ${status}`}`);
    const b64 = (json.data as { b64_json?: string }[] | undefined)?.[0]?.b64_json;
    if (!b64) throw new Error(t('suggest.noImage', { reason: '' }));
    return `data:image/jpeg;base64,${b64}`;
}

function jsonFrom(text: string): unknown {
    const s = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return JSON.parse(s); } catch { return undefined; }
}
