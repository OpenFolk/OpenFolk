// Tests for the check of an Anthropic API key:  node local/src/anthropic-key.test.ts
import { checkAnthropicKey } from './anthropic-key.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

let sent: { url: string; headers: Record<string, string> } | null = null;
const answer = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => {
    sent = { url: String(url), headers: init?.headers as Record<string, string> };
    return new Response('{}', { status });
}) as typeof fetch;

check('a valid key', await checkAnthropicKey(' sk-ant-1 ', answer(200)) === 'ok');
check('… asks the model list with the key trimmed and the API version', sent!.url.startsWith('https://api.anthropic.com/v1/models')
    && sent!.headers['x-api-key'] === 'sk-ant-1' && sent!.headers['anthropic-version'] === '2023-06-01', sent);
check('401: refused as invalid', await checkAnthropicKey('x', answer(401)) === 'invalid');
check('403: refused as without access', await checkAnthropicKey('x', answer(403)) === 'forbidden');
check('429 and 5xx: no clear answer', await checkAnthropicKey('x', answer(429)) === 'unknown' && await checkAnthropicKey('x', answer(529)) === 'unknown');
check('no network: no clear answer', await checkAnthropicKey('x', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch) === 'unknown');

process.exit(failures ? 1 : 0);
