// Checks an Anthropic API key before the machine settings store it: a wrong key would otherwise show only when the
// first bot answers with an error. GET /v1/models costs no tokens. Only a clear "no" from Anthropic refuses a key; no
// network or an error on Anthropic's side lets it through, as before the check. A key without credit passes too: only
// a message can tell, and that would cost.

const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';

/** ok; refused as unknown (401) or without access (403); unknown when Anthropic gave no clear answer. */
export type KeyCheck = 'ok' | 'invalid' | 'forbidden' | 'unknown';

export async function checkAnthropicKey(key: string, fetcher: typeof fetch = fetch): Promise<KeyCheck> {
    try {
        const r = await fetcher(MODELS_URL, {
            headers: { 'x-api-key': key.trim(), 'anthropic-version': '2023-06-01' },
            signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) return 'ok';
        if (r.status === 401) return 'invalid';
        if (r.status === 403) return 'forbidden';
        return 'unknown';
    } catch {
        return 'unknown';
    }
}
