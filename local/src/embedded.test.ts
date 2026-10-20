// The backend without RELAY_URL: it generates its tokens, runs the relay in its own process on 127.0.0.1 and pairs
// a device through it. Runs a real backend on a free port with an empty data folder of its own.
//   node local/src/embedded.test.ts
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failures++;
};

const here = import.meta.dirname;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-embedded-'));
const port = 20000 + Math.floor(Math.random() * 20000);
// Empty values are "set" for the .env loader, so the .env of this checkout cannot point the test elsewhere
const env = {
    ...process.env, DATA_DIR: data, RELAY_PORT: String(port), MACHINE_NAME: 'embedded-test', RELAY_URL: '', AGENT_TOKEN: '', USER_PASSWORD: '', CLIENT_TOKEN: '',
    E2E_KEY: '', APP_URL: '', TOTP_SECRET: '', RELAY_LISTEN: '', OPEN_BROWSER: '0', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', WAKE_MACHINES: '',
    AUTOLOGON_METHOD: 'none', ALLOWED_ROOTS: data,
    // A Claude Code without a sign-in: the setup checklist has to notice it
    CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-claude-home-')),
};
fs.writeFileSync(path.join(data, 'machine-settings.json'), JSON.stringify({ shutdown: false, voicePreload: false }));
const backend = spawn(process.execPath, [path.join(here, 'index.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
backend.stdout.on('data', (c) => { output += c; });
backend.stderr.on('data', (c) => { output += c; });
const waitFor = async (text: string, ms = 20_000) => {
    for (let i = 0; i < ms / 100 && !output.includes(text); i++) await new Promise((r) => setTimeout(r, 100));
    return output.includes(text);
};

try {
    check('relay embedded on 127.0.0.1', await waitFor(`127.0.0.1:${port}`), output.slice(-2000));
    check('backend connects to its own relay', await waitFor('connected to ws://127.0.0.1'), output.slice(-2000));
    check('without a terminal: no link in the log, the hint to npm run pair instead', await waitFor('npm run pair') && !output.includes('#pair='), output.slice(-1500));

    const hex = (name: string) => /^[0-9a-f]{64}$/.test(fs.readFileSync(path.join(data, name), 'utf8').trim());
    check('agent token generated', hex('agent-token'));
    check('password generated', hex('client-token'));
    check('end-to-end key generated', fs.readFileSync(path.join(data, 'e2e-key'), 'utf8').trim().length === 43);
    check('relay data in data/relay', fs.existsSync(path.join(data, 'relay')));

    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json() as Record<string, unknown>;
    check('relay health: claimed by the backend', JSON.stringify(health) === '{"ok":true}', health);

    // npm run pair against the embedded relay: a link with token and key for this address
    const pair = spawnSync(process.execPath, [path.join(here, '..', 'tools', 'e2e.mjs'), 'link'], { env, encoding: 'utf8' });
    const link = /(http:\/\/127\.0\.0\.1:\d+\/#pair=[\w-]+&e2e=[\w-]+)/.exec(pair.stdout)?.[1] ?? '';
    check('npm run pair: link with sign-in token and key', link.startsWith(`http://127.0.0.1:${port}/#pair=`), pair.stdout + pair.stderr);

    // The link signs a browser in
    const token = /pair=([\w-]+)/.exec(link)?.[1] ?? '';
    const signedIn = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/client`, { origin: `http://127.0.0.1:${port}` });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', pair: token, name: 'test' })));
        ws.on('message', (m) => { const f = JSON.parse(m.toString()); if (f.type === 'auth') { ws.close(); resolve(f.ok === true); } });
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
    });
    check('the link signs a device in', signedIn);

    // The generated password works too
    const password = spawnSync(process.execPath, [path.join(here, '..', 'tools', 'e2e.mjs'), 'password'], { env, encoding: 'utf8' });
    check('password tool shows the generated password', password.stdout.includes(fs.readFileSync(path.join(data, 'client-token'), 'utf8').trim()));

    // npm run env writes what a further machine needs, never the password
    // A copy of the tools inside the checkout, so they find node_modules by walking up. Never a link to
    // node_modules: deleting a folder with such a link removed real packages under Node 24.
    const envDir = fs.mkdtempSync(path.join(here, '..', '..', '.test-'));
    const tools = path.join(envDir, 'local', 'tools');
    fs.mkdirSync(tools, { recursive: true });
    for (const f of ['e2e.mjs', 'env.mjs']) fs.copyFileSync(path.join(here, '..', 'tools', f), path.join(tools, f));
    const written = spawnSync(process.execPath, [path.join(tools, 'e2e.mjs'), 'env'], { env, encoding: 'utf8' });
    const envFile = fs.existsSync(path.join(envDir, '.env')) ? fs.readFileSync(path.join(envDir, '.env'), 'utf8') : '';
    check('npm run env: E2E_KEY and AGENT_TOKEN into the .env', /^E2E_KEY=.{43}$/m.test(envFile) && /^AGENT_TOKEN=[0-9a-f]{64}$/m.test(envFile), written.stdout + written.stderr);
    check('npm run env: no password, no comments', !/USER_PASSWORD|CLIENT_TOKEN/.test(envFile) && !/^#/m.test(envFile));
    fs.rmSync(envDir, { recursive: true, force: true });

    // The engines: Claude without a sign-in is noticed, said in the log and kept for the setup checklist
    const enginesFile = path.join(data, 'accounts', 'main', 'engines.json');
    const noticed = await waitFor('Claude Code', 60_000) && fs.existsSync(enginesFile);
    const engines = noticed ? JSON.parse(fs.readFileSync(enginesFile, 'utf8')) : {};
    check('Claude without a sign-in: noticed and named in the log', engines.claude === 'sign_in' && /claude in a terminal|claude im Terminal/.test(output), { engines, log: output.slice(-800) });
} catch (e) {
    check(`embedded backend ran (${(e as Error).message})`, false, output.slice(-2000));
} finally {
    backend.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 });
    fs.rmSync(env.CLAUDE_CONFIG_DIR, { recursive: true, force: true, maxRetries: 5 });
}

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
