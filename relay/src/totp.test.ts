// The second factor set up in the app: secret, confirmation, sign-in with the code, switching off, the old
// TOTP_SECRET taken over once.   node relay/src/totp.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { totpCode } from './devices.ts';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-totp-'));
const CLIENT = 'client-token-0123456789';
const AGENT = 'agent-token-0123456789ab';
type Msg = Record<string, unknown> & { type?: string };
const quiet = () => undefined;

async function client(port: number, auth: object) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/client`, { origin: `http://127.0.0.1:${port}` });
    const got: Msg[] = [];
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString()) as Msg));
    await new Promise((r) => ws.on('open', r));
    const next = async (type: string, from = got.length) => {
        for (let i = 0; i < 40; i++) {
            const hit = got.slice(from).find((m) => m.type === type);
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 50));
        }
        return null;
    };
    const send = (m: object) => ws.send(JSON.stringify(m));
    send({ type: 'auth', ...auth });
    const reply = await next('auth');
    /** Sends and waits for the answer of `type` (or an error). */
    const ask = async (m: object, type: string) => {
        const from = got.length;
        send(m);
        for (let i = 0; i < 40; i++) {
            const hit = got.slice(from).find((x) => x.type === type || x.type === 'error');
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 50));
        }
        return null;
    };
    return { ws, reply, ask };
}

const dataDir = tmp();
const relay = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, dataDir, wake: parseWakeConfig({}), log: quiet });
const health = async () => (await (await fetch(`http://127.0.0.1:${relay.port}/health`)).json()) as { totp?: boolean };

const owner = await client(relay.port, { token: CLIENT, name: 'Laptop' });
check('signed in without a code while none is set up', owner.reply?.ok === true, owner.reply);
check('status: off, may be set up', JSON.stringify(await owner.ask({ type: 'totp_status' }, 'totp')) === '{"type":"totp","active":false,"available":true}');
const setup = await owner.ask({ type: 'totp_begin', label: 'bot.example.com' }, 'totp_setup');
const secret = String(setup?.secret ?? '');
check('setup: a Base32 secret and the address for the QR code', /^[A-Z2-7]{32}$/.test(secret) && String(setup?.uri).startsWith('otpauth://totp/OpenFolk:bot.example.com?secret='), setup);
check('not active before it is confirmed', !(await health()).totp);
check('wrong code: refused', (await owner.ask({ type: 'totp_confirm', code: '000000' }, 'totp'))?.code === 'totp_wrong_code');
check('right code: on', (await owner.ask({ type: 'totp_confirm', code: totpCode(secret) }, 'totp'))?.active === true);
check('health says so', (await health()).totp === true);
check('stored in the data folder', JSON.parse(fs.readFileSync(path.join(dataDir, 'totp.json'), 'utf8')).secret === secret);

const noCode = await client(relay.port, { token: CLIENT });
check('a new device without the code: asked for it', noCode.reply?.code === 'totp_required', noCode.reply);
noCode.ws.close();
const withCode = await client(relay.port, { token: CLIENT, totp: totpCode(secret, Date.now() - 30_000) });
check('with the code: signed in', withCode.reply?.ok === true, withCode.reply);
withCode.ws.close();

check('switching off needs a valid code', (await owner.ask({ type: 'totp_off', code: '123456' }, 'totp'))?.code === 'totp_wrong_code');
check('switched off with a code', (await owner.ask({ type: 'totp_off', code: totpCode(secret, Date.now() + 30_000) }, 'totp'))?.active === false);
check('health: no code any more', !(await health()).totp && !fs.existsSync(path.join(dataDir, 'totp.json')));
owner.ws.close();
await relay.close();

// The old TOTP_SECRET of the environment: taken over once, afterwards the file counts
const oldDir = tmp();
const logs: string[] = [];
const old = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, totpSecret: 'JBSWY3DPEHPK3PXP', dataDir: oldDir, wake: parseWakeConfig({}), log: (t) => logs.push(t) });
check('TOTP_SECRET taken over into the file, with a hint', JSON.parse(fs.readFileSync(path.join(oldDir, 'totp.json'), 'utf8')).secret === 'JBSWY3DPEHPK3PXP'
    && logs.some((l) => l.includes('taken over')));
await old.close();
const later = await startRelay({ port: 0, host: '127.0.0.1', clientToken: CLIENT, agentToken: AGENT, totpSecret: 'GEZDGNBVGY3TQOJQ', dataDir: oldDir, wake: parseWakeConfig({}), log: (t) => logs.push(t) }); // gitleaks:allow
check('a different one later: ignored, the file counts', JSON.parse(fs.readFileSync(path.join(oldDir, 'totp.json'), 'utf8')).secret === 'JBSWY3DPEHPK3PXP'
    && logs.some((l) => l.includes('is ignored')));
await later.close();

if (failed) process.exit(1);
console.log('all tests passed');
