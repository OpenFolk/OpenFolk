// Tests for switching between subscription and API key:  node local/src/auth.test.ts
import { checkSignIn, cliEnv, cliSettings, keyRejected } from './auth.ts';

let failures = 0;
const check = (name: string, ok: boolean) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`);
    if (!ok) failures++;
};
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const base = {
    PATH: 'x', ANTHROPIC_API_KEY: 'sk-from-env', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'https://proxy',
    CLAUDE_CODE_USE_BEDROCK: '1',
};
const sub = cliEnv('subscription', 'sk-test', base);
check('subscription: API key removed', !('ANTHROPIC_API_KEY' in sub));
check('subscription: token, proxy and Bedrock removed', !('ANTHROPIC_AUTH_TOKEN' in sub) && !('ANTHROPIC_BASE_URL' in sub) && !('CLAUDE_CODE_USE_BEDROCK' in sub));
check('subscription: rest of the environment stays', sub.PATH === 'x');

const key = cliEnv('apikey', ' sk-test ', base);
check('API key: the stored key, never the one from the environment', key.ANTHROPIC_API_KEY === 'sk-test');
check('API key: token, proxy and Bedrock removed', !('ANTHROPIC_AUTH_TOKEN' in key) && !('ANTHROPIC_BASE_URL' in key) && !('CLAUDE_CODE_USE_BEDROCK' in key));
check('API key without key: error instead of subscription fallback', throws(() => cliEnv('apikey', '', { PATH: 'x' })));
check('API key only in the environment: error', throws(() => cliEnv('apikey', '  ', base)));
check('base stays unchanged', base.ANTHROPIC_API_KEY === 'sk-from-env');

check('subscription via login: ok', checkSignIn('subscription', 'none') === null);
check('subscription, but key active: abort', checkSignIn('subscription', 'ANTHROPIC_API_KEY') !== null);
check('API key via helper active: ok', checkSignIn('apikey', 'apiKeyHelper') === null);
check('API key wanted, subscription active: abort', checkSignIn('apikey', 'none')?.includes('Claude subscription') === true);
check('API key wanted, key only from environment: abort', checkSignIn('apikey', 'ANTHROPIC_API_KEY') !== null);

check('subscription: no extra settings', cliSettings('subscription') === undefined);
const helper = cliSettings('apikey', 'C:\\Program Files\\nodejs\\node.exe')?.apiKeyHelper ?? '';
check('API key: helper with quoted node path', helper.startsWith('"C:/Program Files/nodejs/node.exe" "') && helper.endsWith('/local/tools/api-key.mjs"'));
check('API key: key is not in the helper command', !helper.includes('sk-'));

check('API key, 401: abort', keyRejected('apikey', 401, 'authentication_failed') !== null);
check('API key, overload (529): keep trying', keyRejected('apikey', 529, 'server_error') === null);
check('subscription, 401: left to the CLI', keyRejected('subscription', 401, 'authentication_failed') === null);

if (failures) process.exit(1);
console.log('all tests passed');
