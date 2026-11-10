// The wake agent (WAKE_METHOD=agent): a real relay and the real wake-agent/wake-agent.mjs as a process of its own,
// sending its packet to a UDP port of this test instead of the network.   node relay/src/wake-agent.test.ts
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { startRelay } from './relay.ts';
import { handleWakeRequest, parseWakeConfig, wake, wakeAgents } from './wakeup.ts';
import type { ServerFrame } from '../../shared/protocol.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const until = async (fn: () => boolean, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end && !fn();) await new Promise((r) => setTimeout(r, 50));
    return fn();
};
const TOKEN = 'w'.repeat(40);
const agentScript = path.resolve(import.meta.dirname, '..', '..', 'wake-agent', 'wake-agent.mjs');
const { magicPacket, wakeUrl } = await import(pathToFileURL(agentScript).href);

// ---- The settings
check('WAKE_AGENT_TOKEN alone: agent', parseWakeConfig({ WAKE_AGENT_TOKEN: TOKEN, WAKE_MACHINES: 'desk=aa:bb:cc:dd:ee:ff' }).method === 'agent');
const short = parseWakeConfig({ WAKE_METHOD: 'agent', WAKE_AGENT_TOKEN: 'short', WAKE_MACHINES: 'desk=aa:bb:cc:dd:ee:ff' });
check('agent with a short token: off, with reason', short.method === 'none' && Boolean(short.problem?.includes('WAKE_AGENT_TOKEN')), short);
check('agent without MAC addresses: off', parseWakeConfig({ WAKE_AGENT_TOKEN: TOKEN, WAKE_MACHINES: 'desk' }).method === 'none');
check('agent: the relay address as its WebSocket', wakeUrl('https://bots.example.com/') === 'wss://bots.example.com/ws/wake' && wakeUrl('http://127.0.0.1:8787') === 'ws://127.0.0.1:8787/ws/wake');
check('agent: the same magic packet as the relay', magicPacket('AA-BB-CC-DD-EE-FF').length === 102 && magicPacket('nope') === null);

// ---- A relay that wakes through the agent
const udp = dgram.createSocket('udp4');
const packets: Buffer[] = [];
udp.on('message', (m) => packets.push(m));
await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()));
const udpPort = udp.address().port;
const logs: string[] = [];
const relay = await startRelay({
    port: 0, host: '127.0.0.1', clientToken: 'client-token-0123456789', agentToken: 'agent-token-0123456789ab',
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-wake-agent-')),
    wake: parseWakeConfig({ WAKE_METHOD: 'agent', WAKE_AGENT_TOKEN: TOKEN, WAKE_MACHINES: 'desk=aa:bb:cc:dd:ee:ff' }), log: (t) => logs.push(t),
});
const status = () => new Promise<ServerFrame>((r) => void handleWakeRequest({ type: 'wake_status' } as never, r, () => undefined));

const before = await status();
check('no agent yet: the status says so', 'error' in before && String(before.error).includes('No wake agent'), before);
check('no agent yet: waking fails with the reason', await wake('desk').then(() => '', (e: Error) => e.message).then((m) => m.includes('No wake agent')));

// A wrong token is refused and closed
const wrong = new WebSocket(`ws://127.0.0.1:${relay.port}/ws/wake`);
const closed = await new Promise<number>((r) => {
    wrong.on('open', () => wrong.send(JSON.stringify({ type: 'auth', token: 'x'.repeat(40) })));
    wrong.on('close', (code) => r(code));
});
check('a wrong token: closed with 4003, nothing registered', closed === 4003 && wakeAgents().length === 0, closed);

const agent = spawn(process.execPath, [agentScript], {
    env: { ...process.env, RELAY_URL: `http://127.0.0.1:${relay.port}`, WAKE_AGENT_TOKEN: TOKEN, WOL_ADDRESS: '127.0.0.1', WOL_PORT: String(udpPort), AGENT_NAME: 'pi' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let agentLog = '';
agent.stdout.on('data', (d) => { agentLog += d; });
agent.stderr.on('data', (d) => { agentLog += d; });
check('the agent connects and signs in', await until(() => wakeAgents().includes('pi')), agentLog);
const after = await status();
check('with the agent: the status has no error', !('error' in after && after.error), after);

let woke = '';
await wake('desk').catch((e: Error) => { woke = e.message; });
check('waking: the relay asks the agent, it answers ok', woke === '', woke);
check('the agent sent the magic packet for that MAC', await until(() => packets.length === 1) && packets[0].length === 102 && packets[0].subarray(6, 12).toString('hex') === 'aabbccddeeff', packets.length);
check('an unknown machine never reaches the agent', await wake('other').then(() => false, () => true) && packets.length === 1);

// The relay goes away: the agent is dropped (it tries again by itself, every 5 s up to every 5 min)
await relay.close();
check('relay gone: the agent is no longer registered', await until(() => wakeAgents().length === 0));
agent.kill();
await new Promise((r) => agent.once('exit', r));
udp.close();
check('the relay logged the agent by name', logs.some((l) => l.includes('Wake agent "pi" connected')), logs);

if (failed) process.exit(1);
console.log('all tests passed');
process.exit(0);
