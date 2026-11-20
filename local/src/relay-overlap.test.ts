// Tests for a backend that restarts while its predecessor is still connected:  node local/src/relay-overlap.test.ts
// The relay rejects the second sign-in of a machine name (4009). Right after a start that is mostly a redeploy whose
// old container goes a moment later, so the new backend knocks again soon instead of waiting five minutes; once it
// was in, a rejection means a real second backend and the long wait stays.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 0 });
await new Promise((r) => wss.once('listening', r));
const port = (wss.address() as { port: number }).port;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-overlap-'));
process.env.RELAY_URL = `ws://127.0.0.1:${port}/ws/agent`;
process.env.AGENT_TOKEN = 'test-agent-token-0123456789abcdef'; // gitleaks:allow
process.env.MACHINE_NAME = 'nas';
const { RelayClient, overlapRetry } = await import('./relay-client.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

overlapRetry.ms = 150;
overlapRetry.times = 3;
// The relay: the first two sign-ins are rejected (the predecessor still connected), then the machine is let in
let attempts = 0;
let accepted = 0;
wss.on('connection', (ws) => {
    attempts++;
    if (attempts <= 2) { ws.close(4009, 'Machine name is already connected'); return; }
    accepted++;
    ws.send(JSON.stringify({ type: 'agents', online: ['nas'] }));
});
const logs: string[] = [];
const client = new RelayClient();
(client as unknown as { log: (s: string) => void }).log = (s) => { logs.push(s); };
const started = Date.now();
client.start();
for (let i = 0; i < 60 && !accepted; i++) await new Promise((r) => setTimeout(r, 50));
check('rejected twice right after the start: in on the third try, soon', accepted === 1 && attempts === 3 && Date.now() - started < 2000, { attempts, ms: Date.now() - started });
check('… the log says a restart, not a second backend', logs.some((l) => l.includes('previous instance')) && !logs.some((l) => l.startsWith('REJECTED')), logs);

// Once in, a rejection is a real second backend: the long wait
const second = new RelayClient();
const secondLogs: string[] = [];
(second as unknown as { log: (s: string) => void }).log = (s) => { secondLogs.push(s); };
(second as unknown as { accepted: boolean }).accepted = true;
attempts = 0;
wss.removeAllListeners('connection');
wss.on('connection', (ws) => { attempts++; ws.close(4009, 'Machine name is already connected'); });
second.start();
await new Promise((r) => setTimeout(r, 800));
check('after being in: one try, then the long wait', attempts === 1 && secondLogs.some((l) => l.startsWith('REJECTED') && /next attempt in 300 s|300 s/.test(secondLogs.join(' '))), { attempts, secondLogs });

client.stop();
second.stop();
wss.close();
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
