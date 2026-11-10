// A setup link end to end, with real processes as on two computers: a relay, the admin's backend and the backend of the
// person set up, each with its own data folder, and a private repository on an HTTPS server that wants a password.
// The admin creates an account, saves its setup and makes the link through the browser frames; `npm run join` redeems
// it on the person's side, whose backend then starts bound to the account, gets the setup end-to-end encrypted from the
// admin's machine and clones both bots with their tokens. Then: what the two sides see of each other, person chats
// both ways, a change of the setup, the link used a second time, and the account deleted.
//   node local/src/setup-link-e2e.test.ts
// Needs git and openssl (for the server's certificate); without openssl the test says so and passes.
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { removeTree } from './remove-tree.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)?.slice(0, 1500)})`}`);
    if (!ok) failures++;
};
const until = async (f: () => boolean, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end && !f();) await new Promise((r) => setTimeout(r, 100));
    return f();
};

const here = import.meta.dirname;
const root = path.join(here, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-setup-e2e-'));
const dir = (name: string) => {
    const p = path.join(home, name);
    fs.mkdirSync(p, { recursive: true });
    return p;
};
const AGENT_TOKEN = crypto.randomBytes(24).toString('hex');
const USER_PASSWORD = crypto.randomBytes(24).toString('hex');
const E2E_KEY = crypto.randomBytes(32).toString('base64');
// This process speaks for the browsers, so it needs the key the link carries
process.env.E2E_KEY = E2E_KEY;
process.env.DATA_DIR = dir('browser');
const { encrypt, decrypt } = await import('./e2e.ts');

// Settings of this computer's own OpenFolk must not reach the processes
const CLEAR = ['RELAY_URL', 'AGENT_TOKEN', 'E2E_KEY', 'MACHINE_NAME', 'USER_PASSWORD', 'CLIENT_TOKEN', 'APP_URL', 'DATA_DIR', 'ALLOWED_ROOTS', 'OPENFOLK_ENV_FILE', 'ELECTRON_RUN_AS_NODE'];
const baseEnv = () => {
    const env: NodeJS.ProcessEnv = { ...process.env, TOTP_SECRET: '', WAKE_METHOD: 'none', WAKEUP_URL: '', WAKE_COMMAND: '', WAKE_MACHINES: '', AGENT_ALLOWED_FROM: '', TRUST_PROXY: '', RELAY_SETUP_CODE: '', OPEN_BROWSER: '0', AUTOLOGON_METHOD: 'none' };
    for (const k of CLEAR) delete env[k];
    return env;
};
const procs: ChildProcess[] = [];
function run(file: string, env: NodeJS.ProcessEnv): { out: () => string; proc: ChildProcess } {
    const p = spawn(process.execPath, [file], { env: { ...baseEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    p.stdout!.on('data', (c) => { out += c; });
    p.stderr!.on('data', (c) => { out += c; });
    return { out: () => out, proc: p };
}

/** A browser at the relay: relay frames plain, backend frames end-to-end encrypted to one machine. */
class Browser {
    frames: Record<string, unknown>[] = [];
    raw = '';
    private ws!: WebSocket;
    private port: number;
    constructor(port: number) {
        this.port = port;
    }
    async open(auth: object): Promise<Record<string, unknown>> {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws/client`, { origin: `http://127.0.0.1:${this.port}` });
        this.ws.on('message', (data) => {
            const text = data.toString();
            this.raw += text;
            const m = JSON.parse(text) as Record<string, unknown>;
            if (m.type === 'e2e') {
                try {
                    const inner = decrypt<Record<string, unknown>>(m as { iv: string; data: string }, 'b2c');
                    this.raw += JSON.stringify(inner);
                    this.frames.push({ ...inner, machine: m.machine });
                } catch {
                    // not for this browser
                }
            } else this.frames.push(m);
        });
        await new Promise<void>((r, j) => { this.ws.on('open', () => r()); this.ws.on('error', j); });
        this.ws.send(JSON.stringify({ type: 'auth', ...auth }));
        await until(() => this.frames.some((f) => f.type === 'auth'), 10_000);
        return this.frames.find((f) => f.type === 'auth') ?? {};
    }
    relay(frame: object): void {
        this.ws.send(JSON.stringify(frame));
    }
    backend(machine: string, frame: object): void {
        this.ws.send(JSON.stringify({ type: 'e2e', ...encrypt(frame, 'c2b'), machine }));
    }
    async next(test: (f: Record<string, unknown>) => boolean, ms = 15_000): Promise<Record<string, unknown> | undefined> {
        const from = this.frames.length;
        await until(() => this.frames.slice(from).some(test), ms);
        return this.frames.slice(from).find(test);
    }
    close(): void {
        this.ws?.close();
    }
}

function haveOpenssl(): boolean {
    try {
        execFileSync('openssl', ['version'], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    // ---- A private repository on HTTPS (git's dumb protocol, Basic auth), with a certificate of its own
    const certs = dir('certs');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem'),
        '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' } });
    const work = dir('work');
    const served = dir('served');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();
    git(work, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(work, 'README.md'), 'dashboard\n');
    git(work, 'add', '.');
    git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'readme');
    git(home, 'clone', '-q', '--bare', work, path.join(served, 'dashboard.git'));
    git(path.join(served, 'dashboard.git'), 'update-server-info');
    const seenAuth: string[] = [];
    const server = https.createServer({ key: fs.readFileSync(path.join(certs, 'key.pem')), cert: fs.readFileSync(path.join(certs, 'cert.pem')) }, (req, res) => {
        const auth = String(req.headers.authorization ?? '');
        if (!auth) {
            res.writeHead(401, { 'www-authenticate': 'Basic realm="git"' }).end();
            return;
        }
        seenAuth.push(Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString());
        const file = path.join(served, decodeURIComponent(new URL(req.url ?? '/', 'https://x').pathname));
        fs.readFile(file, (e, data) => (e ? res.writeHead(404).end() : res.writeHead(200).end(data)));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const repo = `https://127.0.0.1:${(server.address() as { port: number }).port}/dashboard.git`;

    try {
        // ---- The relay and the admin's machine
        const port = 20000 + Math.floor(Math.random() * 20000);
        const relay = run(path.join(root, 'relay', 'src', 'server.ts'), { RELAY_PORT: String(port), RELAY_DATA: dir('relay'), AGENT_TOKEN, USER_PASSWORD, CLIENT_TOKEN: '' });
        check('relay up', await until(() => relay.out().includes('Relay listening')), relay.out());
        const adminData = dir('admin-data');
        fs.writeFileSync(path.join(adminData, 'machine-settings.json'), JSON.stringify({ shutdown: false, voicePreload: false }));
        const admin = run(path.join(here, 'index.ts'), {
            DATA_DIR: adminData, RELAY_URL: `ws://127.0.0.1:${port}/ws/agent`, AGENT_TOKEN, USER_PASSWORD, E2E_KEY, MACHINE_NAME: 'admin-pc',
            ALLOWED_ROOTS: dir('admin-bots'), OPENFOLK_ENV_FILE: path.join(adminData, '.env'),
        });
        check('admin machine connected', await until(() => relay.out().includes('Agent admin-pc connected')), admin.out().slice(-1500));

        // ---- The admin in the browser: an account, its contacts, its setup, the link
        const marco = new Browser(port);
        const signedIn = await marco.open({ token: USER_PASSWORD, name: 'Marco' });
        check('admin signed in', signedIn.ok === true, signedIn);
        marco.relay({ type: 'account_create', name: 'Kunde' });
        const created = await marco.next((f) => f.type === 'account_created');
        const kunde = (created?.account as { id?: string } | undefined)?.id ?? '';
        const firstDevice = (created?.pair as { token?: string } | undefined)?.token ?? '';
        check('account created', !!kunde && !!firstDevice, created);
        marco.relay({ type: 'account_update', id: kunde, reach: 'listed', contacts: ['main'] });
        await marco.next((f) => f.type === 'accounts');
        const bots = [
            { key: 'support', name: 'Support', role: 'Answers questions about the dashboard', tone: '', approval: 'read', repo, gitUser: 'kunde-read', token: 'read-token-123' },
            { key: 'dev', name: 'Entwicklung', role: 'Changes the dashboard', tone: '', approval: 'risky', repo, gitUser: 'kunde-write', token: 'write-token-456' },
        ];
        // The admin's machine learns of the new account's people first
        await new Promise((r) => setTimeout(r, 1500));
        marco.backend('admin-pc', { type: 'setup_save', setup: { account: kunde, handover: 'main', bots } });
        const saved = await marco.next((f) => f.type === 'setups' || f.type === 'error');
        check('setup saved on the admin machine', saved?.type === 'setups' && JSON.stringify(saved).includes('Entwicklung') && !JSON.stringify(saved).includes('token-'), saved);
        marco.backend('admin-pc', { type: 'setup_link', account: kunde });
        const linkFrame = await marco.next((f) => f.type === 'setup_link' || f.type === 'error');
        const link = String(linkFrame?.url ?? '');
        check('setup link made', link.startsWith(`http://127.0.0.1:${port}/#setup=`) && link.includes('&e2e='), linkFrame);

        // ---- The person's computer: join with the link, then start
        const userData = dir('user-data');
        const userEnv = path.join(home, 'user.env');
        fs.writeFileSync(userEnv, '');
        const join = (url: string, machine = 'admin-pc') => {
            try {
                return JSON.parse(execFileSync(process.execPath, [path.join(root, 'local', 'tools', 'join.mjs'), url], {
                    env: { ...baseEnv(), OPENFOLK_JSON: '1', OPENFOLK_ENV_FILE: userEnv, DATA_DIR: userData, MACHINE_NAME: machine }, stdio: 'pipe',
                }).toString().trim()) as Record<string, unknown>;
            } catch (e) {
                const out = (e as { stdout?: Buffer }).stdout?.toString() ?? '';
                return (out ? JSON.parse(out) : { ok: false, error: (e as Error).message }) as Record<string, unknown>;
            }
        };
        // The computer happens to have the name of one of the admin's machines: the relay gives it another
        const joined = join(link);
        const userMachine = String(joined.machine ?? '');
        check('join: the link redeemed, for the account', joined.ok === true && (joined.account as { id?: string } | undefined)?.id === kunde, joined);
        check('join: a name taken gets another', !!userMachine && userMachine !== 'admin-pc', joined);
        const env = fs.readFileSync(userEnv, 'utf8');
        check('join: .env with relay, token, key and the new name', ['RELAY_URL=', 'AGENT_TOKEN=', 'E2E_KEY=', `MACHINE_NAME=${userMachine}`].every((k) => env.includes(k)), env.split('\n').map((l) => l.split('=')[0]));
        check('join: the link works once', join(link).error === 'setup_expired');

        fs.writeFileSync(path.join(userData, 'machine-settings.json'), JSON.stringify({ shutdown: false, voicePreload: false }));
        const userBots = dir('user-bots');
        const user = run(path.join(here, 'index.ts'), { DATA_DIR: userData, OPENFOLK_ENV_FILE: userEnv, ALLOWED_ROOTS: userBots, GIT_SSL_NO_VERIFY: '1' });
        check('person machine connected, bound', await until(() => relay.out().includes(`Agent ${userMachine} connected`) && relay.out().includes(`(bound to account ${kunde})`)), [relay.out().slice(-1500), user.out().slice(-1500)]);
        check('setup applied on the person machine', await until(() => /setup from main: 2 bot\(s\)/.test(user.out()), 60_000), user.out().slice(-2500));
        check('… without problems', !/setup from main: 2 bot\(s\), problems/.test(user.out()), user.out().slice(-1500));
        const binding = JSON.parse(fs.readFileSync(path.join(userData, 'binding.json'), 'utf8')) as { account?: string; setupBy?: string };
        check('binding stored: the account and its admin', binding.account === kunde && binding.setupBy === 'main', binding);
        const support = path.join(userBots, 'dashboard-support');
        const dev = path.join(userBots, 'dashboard-dev');
        check('both repositories cloned, each into its own folder', fs.existsSync(path.join(support, 'README.md')) && fs.existsSync(path.join(dev, 'README.md')), fs.readdirSync(userBots));
        check('the git server got each bot its own token', seenAuth.includes('kunde-read:read-token-123') && seenAuth.includes('kunde-write:write-token-456'), [...new Set(seenAuth)]);
        const gitConfig = fs.readFileSync(path.join(support, '.git', 'config'), 'utf8') + fs.readFileSync(path.join(dev, '.git', 'config'), 'utf8');
        check('no token in the bots\' folders', !gitConfig.includes('token-') && !fs.readdirSync(support).some((f) => f.includes('credentials')));
        check('… but in the account data', fs.readFileSync(path.join(userData, 'accounts', kunde, 'setup-git', 'support.credentials'), 'utf8') === 'read-token-123');
        // Asynchronous: the git server answers in this process
        const fetched = await new Promise<string>((resolve) => execFile('git', ['fetch', '-q'], {
            cwd: support, env: { ...process.env, GIT_SSL_NO_VERIFY: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, timeout: 30_000,
        }, (e, _out, err) => resolve(e ? `${e.message} ${err}` : '')));
        check('fetch with the stored token works', fetched === '', [fs.readFileSync(path.join(support, '.git', 'config'), 'utf8'), fetched.slice(-300)]);

        // ---- The person in the browser (the account's first device)
        const person = new Browser(port);
        check('person signed in', (await person.open({ pair: firstDevice, name: 'Laptop' })).ok === true);
        person.backend(userMachine, { type: 'bots' });
        const list = await person.next((f) => f.type === 'bots');
        const theirs = (list?.bots ?? []) as { id: string; name: string; managed?: string; approval: string; contact?: string }[];
        check('person sees both bots, managed', theirs.length === 2 && theirs.every((b) => b.managed) && theirs.find((b) => b.id === 'setup-support')?.approval === 'read', theirs);
        check('… handing over to the admin', theirs.every((b) => b.contact === 'main'), theirs.map((b) => b.contact));
        person.backend(userMachine, { type: 'bot_delete', botId: 'setup-support' });
        const refused = await person.next((f) => f.type === 'error');
        check('person cannot delete a managed bot', !!refused, person.frames.slice(-3));
        check('person sees no machine of the admin', !person.raw.includes('"admin-pc"'));
        await new Promise((r) => setTimeout(r, 1000));
        check('admin sees nothing of the person machine', !marco.raw.includes(userMachine), userMachine);

        // ---- Person chats both ways
        person.backend(userMachine, { type: 'send', chatId: 'p:main', text: 'Hallo Marco, eine Frage' });
        const arrived = await until(() => {
            marco.backend('admin-pc', { type: 'history', chatId: `p:${kunde}` });
            return marco.raw.includes('Hallo Marco, eine Frage');
        }, 20_000);
        check('person -> admin: the message arrives', arrived, admin.out().slice(-1500));
        marco.backend('admin-pc', { type: 'send', chatId: `p:${kunde}`, text: 'Gern, frag ruhig' });
        const back = await until(() => {
            person.backend(userMachine, { type: 'history', chatId: 'p:main' });
            return person.raw.includes('Gern, frag ruhig');
        }, 20_000);
        check('admin -> person: the answer arrives', back, user.out().slice(-1500));
        // Machines came and went meanwhile (the outbox sends again): each message is in the chat once
        await new Promise((r) => setTimeout(r, 1500));
        const once = async (b: Browser, machine: string, chatId: string, text: string) => {
            b.backend(machine, { type: 'history', chatId });
            const h = await b.next((f) => f.type === 'history' && f.chatId === chatId);
            return ((h?.entries ?? []) as { text?: string }[]).filter((e) => e.text === text).length;
        };
        const counts = [await once(marco, 'admin-pc', `p:${kunde}`, 'Hallo Marco, eine Frage'), await once(person, userMachine, 'p:main', 'Gern, frag ruhig')];
        check('… each message once on either side', counts.join() === '1,1', counts);

        // ---- A change of the setup reaches the machine
        const applied = () => (user.out().match(/setup from main: 2 bot\(s\)/g) ?? []).length;
        const before = applied();
        marco.backend('admin-pc', { type: 'setup_save', setup: { account: kunde, handover: 'main', bots: bots.map((b) => ({ ...b, name: b.key === 'support' ? 'Hilfe' : b.name, token: '' })) } });
        check('a change arrives (applied once more)', await until(() => applied() > before, 30_000), user.out().slice(-1500));
        person.backend(userMachine, { type: 'bots' });
        const renamed = await person.next((f) => f.type === 'bots' && JSON.stringify(f).includes('Hilfe'));
        check('… the person sees the new name', !!renamed);
        check('… the folders stay', fs.readdirSync(userBots).length === 2, fs.readdirSync(userBots));

        // ---- The account deleted: the person machine is signed off
        marco.relay({ type: 'account_delete', id: kunde });
        check('account deleted: the person machine is disconnected', await until(() => user.proc.exitCode !== null || /logged out/.test(user.out().slice(-800)), 20_000), [relay.out().slice(-800), user.out().slice(-800)]);
        await new Promise((r) => setTimeout(r, 2000));
        check('… the admin machine stays connected', !relay.out().includes('Agent admin-pc disconnected'), admin.out().slice(admin.out().indexOf('Error: Account')));
        marco.close();
        person.close();
    } finally {
        server.close();
    }
}

try {
    if (!haveOpenssl()) console.log('skipped: openssl is not installed (needed for the HTTPS git server)');
    else await main();
} catch (e) {
    check(`ran through (${(e as Error).stack})`, false);
} finally {
    for (const p of procs.splice(0)) p.kill();
    await new Promise((r) => setTimeout(r, 800));
    removeTree(home);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
