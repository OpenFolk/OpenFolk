// Title of a conversation as keywords: Claude (Haiku, a short session without tools) sums up the first message in
// two to four keywords. Until the answer is there, the shortened first line is the title.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { claudeEnv, claudeSettings } from './engine-home.ts';
import { projectRoot } from './config.ts';

const TIMEOUT_MS = 60_000;
const MAX_TEXT = 2000;
const MAX_TITLE = 40;
const SEPARATOR = ' · ';

const SCHEMA = {
    type: 'object',
    properties: { keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 } },
    required: ['keywords'],
    additionalProperties: false,
} as const;

export function titlePrompt(text: string): string {
    return ['Give a conversation in a messenger app a title made of keywords. Its first message:',
        `"""\n${text.replace(/^🎤[^\n]*\n/, '').trim().slice(0, MAX_TEXT)}\n"""`,
        'Name two to four keywords that hit the topic: nouns, product, project and file names, versions,',
        'together at most 36 characters, the most important first, in the language of the message. No filler words, no verbs',
        'like "please check", no courtesies, no quotation marks, no period. Example: "Please check the upload',
        'for version 3.2 in the web store" becomes ["Web store", "Upload", "Version 3.2"].'].join('\n');
}

/** Put keywords together into a title; at the end as many drop out as needed to fit the list. */
export function titleFromKeywords(data: unknown): string {
    const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const words = (Array.isArray(o.keywords) ? o.keywords : [])
        .filter((w): w is string => typeof w === 'string')
        .map((w) => w.replace(/["„“”'`·]/g, '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, ''))
        .filter(Boolean);
    const unique = words.filter((w, i) => words.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i);
    while (unique.length > 1 && unique.join(SEPARATOR).length > MAX_TITLE) unique.pop();
    return unique.join(SEPARATOR).slice(0, MAX_TITLE).trim();
}

/** Asks Claude for the keywords; empty if nothing usable comes back. */
export async function keywordTitle(text: string): Promise<string> {
    if (!text.trim()) return '';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        let data: unknown;
        const q = query({
            prompt: titlePrompt(text),
            options: {
                cwd: projectRoot,
                model: 'haiku',
                tools: [],
                maxTurns: 3,
                persistSession: false,
                settingSources: [],
                systemPrompt: 'You assign short titles. Answer only with the requested JSON.',
                outputFormat: { type: 'json_schema', schema: SCHEMA },
                env: claudeEnv(),
                settings: claudeSettings(),
                abortController: abort,
            },
        });
        for await (const m of q) {
            if (m.type === 'result' && m.subtype === 'success' && !m.is_error) data = m.structured_output ?? jsonFrom(m.result);
        }
        return titleFromKeywords(data);
    } finally {
        clearTimeout(timer);
    }
}

function jsonFrom(text: string): unknown {
    const s = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return JSON.parse(s); } catch { return undefined; }
}
