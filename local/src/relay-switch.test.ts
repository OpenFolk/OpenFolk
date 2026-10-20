// Claiming a relay of one's own from the app (relay-switch.ts): a real unclaimed relay in this process, the backend's
// tokens in a data folder of its own, the .env a file of its own. The claim answers with a pairing link that signs a
// device in at the new relay, writes RELAY_URL and switches over; the errors say what to do.
//   node local/src/relay-switch.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { removeTree } from './remove-tree.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-relay-switch-'));
process.env.DATA_DIR = path.join(home, 'data');
process.env.OPENFOLK_ENV_FILE = path.join(home, '.env');
for (const k of ['RELAY_URL', 'AGENT_TOKEN', 'USER_PASSWORD', 'CLIENT_TOKEN', 'E2E_KEY', 'APP_URL']) delete process.env[k];
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.writeFileSync(process.env.OPENFOLK_ENV_FILE, 'MACHINE_NAME=switch-test\n');

const { startRelay } = await import('../../relay/src/relay.ts');
const { claimRelay, onRelaySwitch, relayOrigin } = await import('./relay-switch.ts');
const { setupE2eKey } = await import('./e2e.ts');
const { config } = await import('./config.ts');
setupE2eKey();

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures++;
};
const fails = async (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message);

// ---- Addresses
check('address: a host alone means https', relayOrigin('relay.example.com') === 'https://relay.example.com');
check('address: the agent socket means its origin', relayOrigin('wss://relay.example.com/ws/agent') === 'https://relay.example.com');
check('address: plain http only to this computer', relayOrigin('http://127.0.0.1:9999') === 'http://127.0.0.1:9999'
    && (await fails(Promise.resolve().then(() => relayOrigin('http://relay.example.com')))).includes('HTTPS'));

const CODE = 'MNPQR-STUVW';
const relay = await startRelay({ port: 0, host: '127.0.0.1', setupCode: CODE, dataDir: path.join(home, 'relay'), log: () => undefined, wake: { method: 'none' } as never });
const origin = `http://127.0.0.1:${relay.port}`;
let switchedTo = '';
onRelaySwitch((url) => { switchedTo = url; });

try {
    check('not answering: names the address', (await fails(claimRelay('http://127.0.0.1:1', CODE, 0))).includes('http://127.0.0.1:1'));
    check('wrong code: says where the right one is', (await fails(claimRelay(origin, 'WRONG-CODE0', 0))).includes('log'));
    check('nothing written after a failure', !fs.readFileSync(process.env.OPENFOLK_ENV_FILE, 'utf8').includes('RELAY_URL') && switchedTo === '');

    const { url, relayUrl } = await claimRelay(` ${origin} `, CODE, 0);
    const link = new URL(url);
    const params = new URLSearchParams(link.hash.slice(1));
    check('claimed: a pairing link at the new relay with the end-to-end key', link.origin === origin && !!params.get('pair') && !!params.get('e2e'), url);
    check('claimed: RELAY_URL in the .env, the other lines kept', fs.readFileSync(process.env.OPENFOLK_ENV_FILE, 'utf8') === `MACHINE_NAME=switch-test\nRELAY_URL=${relayUrl}\n`);
    await new Promise((r) => setTimeout(r, 50));
    check('claimed: the process switches to the new relay', switchedTo === `ws://127.0.0.1:${relay.port}/ws/agent`, switchedTo);

    // The link signs a device in at the new relay
    const auth = await new Promise<{ ok?: boolean }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/client`, { origin });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', pair: params.get('pair'), name: 'test' })));
        ws.on('message', (raw) => { resolve(JSON.parse(raw.toString()) as { ok?: boolean }); ws.close(); });
        ws.on('error', () => resolve({}));
    });
    check('the pairing link signs a device in there', auth.ok === true, auth);

    // Once moved, a second claim is refused before anything goes out
    config.relay = { mode: 'remote', url: relayUrl, port: 0 };
    check('on a relay of its own already: refused', (await fails(claimRelay(origin, CODE, 0))).includes('already'));
    config.relay = { mode: 'embedded', url: 'ws://127.0.0.1:8787/ws/agent', port: 8787 };
    check('a claimed relay: says it has an owner', (await fails(claimRelay(origin, CODE, 0))).includes('owner'));
} finally {
    await relay.close();
    removeTree(home);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exitCode = failures ? 1 : 0;
