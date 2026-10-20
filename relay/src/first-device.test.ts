// The main account's first device on the relay: a waiting device learns that there is none yet, its request with its
// key goes to a backend, and the backend's sealed box comes back to it untouched. Refused once a device exists, while
// no backend is there, and when the backend shows no code.  node relay/src/first-device.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const CLIENT = 'client-token-0123456789';
const AGENT = 'agent-token-0123456789ab';
type Msg = Record<string, unknown> & { type?: string };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-first-'));
const relay = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: () => undefined });
const origin = `http://127.0.0.1:${relay.port}`;

/** A connection with every message it received; `next` waits for the first one matching. */
async function open(url: string, headers: Record<string, string>, first?: object) {
    const ws = new WebSocket(url, { origin, headers });
    const got: Msg[] = [];
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    if (first) ws.send(JSON.stringify(first));
    const next = async (test: (m: Msg) => boolean, ms = 2000) => {
        for (let t = 0; t < ms; t += 20) {
            const hit = got.find(test);
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 20));
        }
        return null;
    };
    return { ws, got, closed, next, send: (m: object) => ws.send(JSON.stringify(m)) };
}
const waitingDevice = () => open(`ws://127.0.0.1:${relay.port}/ws/client`, { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' }, { type: 'pair_wait' });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PK = 'B'.repeat(87);

try {
    // ---- no backend yet
    const lonely = await waitingDevice();
    const w0 = await lonely.next((m) => m.type === 'pair_wait');
    check('no device of the main account: the waiting device hears it may be the first', w0?.first === true, w0);
    lonely.send({ type: 'pair_first', pk: PK });
    check('no backend connected: refused with no_backend', (await lonely.next((m) => m.type === 'pair_first'))?.reason === 'no_backend');
    lonely.ws.close();
    await pause(2100);

    // ---- a backend answers with a sealed box
    const agent = await open(`ws://127.0.0.1:${relay.port}/ws/agent`, { authorization: `Bearer ${AGENT}`, 'x-machine': 'cloud', 'x-accounts': '1' });
    const device = await waitingDevice();
    const id = String((await device.next((m) => m.type === 'pair_wait'))?.id ?? '');
    device.send({ type: 'pair_first', pk: PK });
    const asked = await agent.next((m) => m.type === 'first_device');
    check('the request goes to the backend with id and key', asked?.id === id && asked?.pk === PK, asked);
    device.send({ type: 'pair_first', pk: 'C'.repeat(87) });
    await pause(200);
    check('one request per waiting device', agent.got.filter((m) => m.type === 'first_device').length === 1);
    const box = { pk: 'x'.repeat(87), iv: 'y'.repeat(16), data: 'z'.repeat(120) };
    agent.send({ firstDevice: { id: 'not-this-one', box } });
    await pause(200);
    check('a box for a request not asked for goes nowhere', !device.got.some((m) => m.type === 'pair_wait' && m.box));
    agent.send({ firstDevice: { id, box } });
    const sealed = await device.next((m) => m.type === 'pair_wait' && !!m.box);
    check('the sealed box reaches the waiting device untouched', JSON.stringify(sealed?.box) === JSON.stringify(box), sealed);
    check('… and its connection ends', await Promise.race([device.closed, pause(2000).then(() => -1)]) === 1000);
    await pause(2100);

    // ---- a backend without a code
    const offDevice = await waitingDevice();
    const offId = String((await offDevice.next((m) => m.type === 'pair_wait'))?.id ?? '');
    offDevice.send({ type: 'pair_first', pk: PK });
    await agent.next((m) => m.type === 'first_device' && m.id === offId);
    agent.send({ firstDevice: { id: offId, error: 'off' } });
    check('backend without a code: refused with off', (await offDevice.next((m) => m.type === 'pair_first'))?.reason === 'off');

    // ---- right after another request: busy
    const hasty = await waitingDevice();
    await hasty.next((m) => m.type === 'pair_wait');
    hasty.send({ type: 'pair_first', pk: PK });
    check('two requests within two seconds: busy', (await hasty.next((m) => m.type === 'pair_first'))?.reason === 'busy');
    offDevice.ws.close();
    hasty.ws.close();

    // ---- once a device of the main account exists
    const owner = await open(`ws://127.0.0.1:${relay.port}/ws/client`, {}, { type: 'auth', token: CLIENT, name: 'Phone' });
    check('a device signs in with the password', (await owner.next((m) => m.type === 'auth'))?.ok === true);
    await pause(2100);
    const late = await waitingDevice();
    const w1 = await late.next((m) => m.type === 'pair_wait');
    check('with a device: no first-device offer', w1 !== null && !w1.first, w1);
    late.send({ type: 'pair_first', pk: PK });
    check('with a device: refused with not_first, the backend not asked', (await late.next((m) => m.type === 'pair_first'))?.reason === 'not_first'
        && agent.got.filter((m) => m.type === 'first_device').length === 2);
    late.ws.close();
    owner.ws.close();
    agent.ws.close();
    await Promise.race([agent.closed, pause(1000)]);
    await pause(100);
} finally {
    await relay.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exitCode = failed ? 1 : 0;
