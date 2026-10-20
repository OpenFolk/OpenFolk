// startRelay() in this process: tokens kept as hashes, the claim of an unclaimed relay, closing.
//   node relay/src/relay.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { hashToken } from './auth.ts';
import { newSetupCode, normalizeCode, OWNER_FILE, Owner } from './owner.ts';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-relay-'));
const quiet = () => undefined;
const wakeOff = parseWakeConfig({});
const CLIENT = 'client-token-0123456789';
const AGENT = 'agent-token-0123456789ab';

/** Opens /ws/agent with a token; resolves with the HTTP status of a refusal or 101 for an open socket. */
const agentStatus = (port: number, token: string) => new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`, { headers: { authorization: `Bearer ${token}`, 'x-machine': 'test' } });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => { ws.close(); resolve(101); });
    ws.on('error', () => resolve(0));
});

// ---- owner.ts on its own
const code = newSetupCode();
check('setup code: XXXXX-XXXXX without I, O, 0, 1', /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code), code);
check('setup code: case and separators do not matter', normalizeCode(code.toLowerCase().replace('-', ' ')) === normalizeCode(code));
let threw = '';
try { void new Owner(tmp(), CLIENT, ''); } catch (e) { threw = (e as Error).message; }
check('only one token set: refused at start', threw.includes('both'), threw);
threw = '';
try { void new Owner(tmp(), 'short', AGENT); } catch (e) { threw = (e as Error).message; }
check('password under 8 characters: refused at start', threw.includes('USER_PASSWORD'), threw);
const legacy = new Owner(tmp(), 'old-pass1', AGENT);
check('password of 8 to 15 characters set by hand: still starts, with a warning', legacy.credentials !== null && legacy.warning.includes('USER_PASSWORD'));
check('a claim still needs 16 characters', new Owner(tmp(), '', '', 'abcde-fghjk').claim('abcde-fghjk', 'old-pass1', AGENT) === 'invalid');
threw = '';
try { void new Owner(tmp(), CLIENT, 'short-agent'); } catch (e) { threw = (e as Error).message; }
check('agent token under 16 characters: refused at start', threw.includes('AGENT_TOKEN'), threw);
const fromEnv = new Owner(tmp(), CLIENT, AGENT);
check('tokens from the environment: only hashes kept', fromEnv.credentials?.clientHash === hashToken(CLIENT) && fromEnv.credentials?.agentHash === hashToken(AGENT) && !fromEnv.setupCode);

const ownerDir = tmp();
const unclaimed = new Owner(ownerDir, '', '', 'abcde-fghjk');
check('without tokens: unclaimed with the given code', unclaimed.credentials === null && unclaimed.setupCode === 'abcde-fghjk');
check('claim with a wrong code', unclaimed.claim('ZZZZZ-ZZZZZ', CLIENT, AGENT) === 'wrong_code' && !fs.existsSync(path.join(ownerDir, OWNER_FILE)));
check('claim with a short token', unclaimed.claim('ABCDE-FGHJK', 'short', AGENT) === 'invalid');
check('claim with the code in other spelling', unclaimed.claim('abcde fghjk', CLIENT, AGENT) === 'ok');
const stored = JSON.parse(fs.readFileSync(path.join(ownerDir, OWNER_FILE), 'utf8')) as Record<string, string>;
check('owner.json holds hashes, never the tokens', stored.clientHash === hashToken(CLIENT) && !JSON.stringify(stored).includes(CLIENT) && !JSON.stringify(stored).includes(AGENT));
check('a second claim is refused', unclaimed.claim('abcde fghjk', 'other-client-token-xyz', AGENT) === 'already_claimed');
check('after a restart the relay is still claimed', new Owner(ownerDir).credentials?.agentHash === hashToken(AGENT));

// ---- a relay with tokens, in this process
const owned = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir: tmp(), wake: wakeOff, log: quiet });
const base = `http://127.0.0.1:${owned.port}`;
check('listens on a free port', owned.port > 0);
check('health: ok', JSON.stringify(await (await fetch(`${base}/health`)).json()) === '{"ok":true}');
check('start page: the web app', (await (await fetch(`${base}/`)).text()).includes('<script'));
check('agent with its token connects', await agentStatus(owned.port, AGENT) === 101);
check('agent with a wrong token: 401', await agentStatus(owned.port, 'wrong-token-0123456789') === 401);
const pair = await fetch(`${base}/pair`, { method: 'POST', headers: { authorization: `Bearer ${AGENT}` } });
check('pairing token for the agent token', pair.status === 200 && typeof ((await pair.json()) as { token?: unknown }).token === 'string');
const claimOwned = await fetch(`${base}/claim`, { method: 'POST', body: JSON.stringify({ code: 'x', clientToken: CLIENT, agentToken: AGENT }) });
check('a relay with tokens cannot be claimed', claimOwned.status === 409);

// A proxy such as Tailscale Serve in front of the embedded relay: on 127.0.0.1, the page from
// https://<computer>.<tailnet>.ts.net. Whether it passes the Host on or only X-Forwarded-Host, the origin counts as own.
const clientStatus = (headers: Record<string, string>, origin: string) => new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${owned.port}/ws/client`, { headers, origin });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => { ws.close(); resolve(101); });
    ws.on('error', () => resolve(0));
});
const ts = 'https://desk.tail1234.ts.net';
check('Tailscale Serve passing the Host on: allowed', await clientStatus({ host: 'desk.tail1234.ts.net', 'x-forwarded-for': '100.101.102.103' }, ts) === 101);
check('Tailscale Serve with X-Forwarded-Host only: allowed', await clientStatus({ 'x-forwarded-host': 'desk.tail1234.ts.net', 'x-forwarded-for': '100.101.102.103' }, ts) === 101);
check('another site through the same proxy: refused', await clientStatus({ 'x-forwarded-host': 'desk.tail1234.ts.net' }, 'https://evil.example') === 403);
await owned.close();
check('closed: no longer listening', await fetch(`${base}/health`).then(() => false, () => true));

// ---- with a second factor: the login form learns it from /health, the apps may ask from their own origin
const guarded = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, totpSecret: 'JBSWY3DPEHPK3PXP', dataDir: tmp(), wake: wakeOff, log: quiet });
const health = await fetch(`http://127.0.0.1:${guarded.port}/health`);
check('health with TOTP: says so, readable from another origin', JSON.stringify(await health.json()) === '{"ok":true,"totp":true}'
    && health.headers.get('access-control-allow-origin') === '*');
await guarded.close();

// ---- unclaimed relay, claimed over HTTP
const dir = tmp();
const free = await startRelay({ port: 0, host: '127.0.0.1', setupCode: 'QRSTU-VWXYZ', dataDir: dir, wake: wakeOff, log: quiet });
const fb = `http://127.0.0.1:${free.port}`;
check('unclaimed: health says so', JSON.stringify(await (await fetch(`${fb}/health`)).json()) === '{"ok":true,"unclaimed":true}');
const page = await (await fetch(`${fb}/`)).text();
check('unclaimed: start page explains the claim and does not show the code', page.includes('npm run claim') && !page.includes('QRSTU'));
check('unclaimed: WebSockets refused with 503', await agentStatus(free.port, AGENT) === 503);
const claim = (body: object) => fetch(`${fb}/claim`, { method: 'POST', body: JSON.stringify(body) });
check('claim with a wrong code: 403', (await claim({ code: 'AAAAA-BBBBB', clientToken: CLIENT, agentToken: AGENT })).status === 403);
check('claim that is not JSON: 400', (await fetch(`${fb}/claim`, { method: 'POST', body: 'nope' })).status === 400);
check('claim with the code: 200', (await claim({ code: 'qrstu-vwxyz', clientToken: CLIENT, agentToken: AGENT })).status === 200);
check('claimed: health without "unclaimed"', JSON.stringify(await (await fetch(`${fb}/health`)).json()) === '{"ok":true}');
check('claimed: the agent connects at once', await agentStatus(free.port, AGENT) === 101);
check('claimed: start page is the web app', (await (await fetch(`${fb}/`)).text()).includes('<script'));
await free.close();

if (failed) process.exit(1);
console.log('all tests passed');
