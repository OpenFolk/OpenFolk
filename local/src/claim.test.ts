// A relay of one's own without tokens: the backend says how to claim it, `npm run claim` claims it with the code from
// the relay's log and writes RELAY_URL, and the backend gets in. Real relay and backend processes on free ports; the
// claim tool runs from a copy, so the .env of this checkout stays untouched.
//   node local/src/claim.test.ts
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failures++;
};

const here = import.meta.dirname;
const root = path.join(here, '..', '..');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const relayData = tmp('openfolk-claim-relay-');
const backendData = tmp('openfolk-claim-data-');
// A copy of the tools inside the checkout, so they find node_modules by walking up. Never a link to node_modules:
// deleting a folder with such a link removed real packages under Node 24.
const copy = fs.mkdtempSync(path.join(root, '.test-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const CODE = 'MNPQR-STUVW';
const blank = {
    AGENT_TOKEN: '', USER_PASSWORD: '', CLIENT_TOKEN: '', E2E_KEY: '', APP_URL: '', TOTP_SECRET: '', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', WAKE_MACHINES: '',
    AGENT_ALLOWED_FROM: '', TRUST_PROXY: '',
};

const procs: ChildProcess[] = [];
function run(file: string, env: NodeJS.ProcessEnv): { out: () => string } {
    const p = spawn(process.execPath, [file], { env: { ...process.env, ...blank, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    p.stdout!.on('data', (c) => { out += c; });
    p.stderr!.on('data', (c) => { out += c; });
    return { out: () => out };
}
const until = async (f: () => boolean, ms = 20_000) => {
    for (let i = 0; i < ms / 100 && !f(); i++) await new Promise((r) => setTimeout(r, 100));
    return f();
};

try {
    // The relay with neither token: unclaimed, the code in its log
    const relay = run(path.join(root, 'relay', 'src', 'server.ts'), { RELAY_PORT: String(port), RELAY_DATA: relayData, RELAY_SETUP_CODE: CODE });
    check('unclaimed relay prints the code to its log', await until(() => relay.out().includes(`Setup code: ${CODE}`)), relay.out());

    // A backend pointed at it is refused and says how to claim
    const relayUrl = `ws://127.0.0.1:${port}/ws/agent`;
    const backendEnv = {
        DATA_DIR: backendData, RELAY_URL: relayUrl, MACHINE_NAME: 'claim-test', OPEN_BROWSER: '0', AUTOLOGON_METHOD: 'none', ALLOWED_ROOTS: backendData,
    };
    fs.writeFileSync(path.join(backendData, 'machine-settings.json'), JSON.stringify({ shutdown: false, voicePreload: false }));
    const backend = run(path.join(here, 'index.ts'), backendEnv);
    check('backend in front of an unclaimed relay names npm run claim', await until(() => backend.out().includes('npm run claim')), backend.out().slice(-1500));
    check('the hint comes once, not on every retry', await new Promise((r) => setTimeout(() => r(backend.out().split('npm run claim').length === 2), 4000)));

    // The claim tool from a copy of the checkout (it writes the .env next to it)
    const tools = path.join(copy, 'local', 'tools');
    fs.mkdirSync(tools, { recursive: true });
    for (const f of ['claim.mjs', 'env.mjs']) fs.copyFileSync(path.join(here, '..', 'tools', f), path.join(tools, f));
    fs.writeFileSync(path.join(copy, '.env'), 'MACHINE_NAME=claim-test\nRELAY_URL=\n');
    const claim = (code: string) => spawnSync(process.execPath, [path.join(tools, 'claim.mjs'), `http://127.0.0.1:${port}`, code],
        { env: { ...process.env, ...blank, DATA_DIR: backendData, RELAY_URL: '' }, encoding: 'utf8' });

    const wrong = claim('AAAAA-BBBBB');
    check('wrong code: refused with a reason', wrong.status === 1 && wrong.stderr.includes('Wrong setup code'), wrong.stdout + wrong.stderr);
    const remote = spawnSync(process.execPath, [path.join(tools, 'claim.mjs'), 'http://relay.example.com', CODE], { encoding: 'utf8' });
    check('plain http to a remote host: refused before sending tokens', remote.status === 2 && remote.stderr.includes('HTTPS'), remote.stderr);

    const ok = claim(CODE.toLowerCase());
    check('right code: claimed', ok.status === 0 && ok.stdout.includes('belongs to this backend'), ok.stdout + ok.stderr);
    const env = fs.readFileSync(path.join(copy, '.env'), 'utf8');
    check('.env: RELAY_URL set in place, nothing else touched', env === `MACHINE_NAME=claim-test\nRELAY_URL=${relayUrl}\n`, env);
    check('relay keeps only hashes', !fs.readFileSync(path.join(relayData, 'owner.json'), 'utf8').includes(fs.readFileSync(path.join(backendData, 'agent-token'), 'utf8').trim()));
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    check('relay is claimed', JSON.stringify(health) === '{"ok":true}', health);
    check('the waiting backend gets in with its token', await until(() => backend.out().includes(`connected to ${relayUrl}`), 30_000), backend.out().slice(-1500));
    const again = claim(CODE);
    check('a second claim: the relay has an owner', again.status === 1 && again.stderr.includes('already has an owner'), again.stderr);

    // Relay and backend started together with the same RELAY_SETUP_CODE (docker-compose.server.yml): no step by hand
    const port2 = port + 1;
    const relay2Data = tmp('openfolk-claim-relay2-');
    const backend2Data = tmp('openfolk-claim-data2-');
    try {
        run(path.join(root, 'relay', 'src', 'server.ts'), { RELAY_PORT: String(port2), RELAY_DATA: relay2Data, RELAY_SETUP_CODE: 'WXYZA-BCDEF' });
        const url2 = `ws://127.0.0.1:${port2}/ws/agent`;
        const backend2 = run(path.join(here, 'index.ts'), { ...backendEnv, DATA_DIR: backend2Data, ALLOWED_ROOTS: backend2Data, RELAY_URL: url2, RELAY_SETUP_CODE: 'WXYZA-BCDEF', MACHINE_NAME: 'claim-auto' });
        check('with RELAY_SETUP_CODE the backend claims the relay itself', await until(() => backend2.out().includes('relay claimed with RELAY_SETUP_CODE')), backend2.out().slice(-1500));
        check('and gets in', await until(() => backend2.out().includes(`connected to ${url2}`), 30_000), backend2.out().slice(-1500));
    } finally {
        for (const p of procs.splice(2)) p.kill();
        await new Promise((r) => setTimeout(r, 500));
        for (const d of [relay2Data, backend2Data]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
    }
} catch (e) {
    check(`claim test ran (${(e as Error).message})`, false);
} finally {
    for (const p of procs) p.kill();
    await new Promise((r) => setTimeout(r, 500));
    for (const d of [relayData, backendData, copy]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
}

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
