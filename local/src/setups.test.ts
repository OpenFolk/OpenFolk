// Setups of accounts by an admin (setups.ts) and their way to the account's own machine: the admin keeps setup and
// tokens apart, the bound machine takes a setup only from its admin, clones each bot into a folder of its own with its
// token in a file the bot cannot read, keeps the bots managed, and drops what the setup no longer has. A git server is
// a folder served over HTTP (git's dumb protocol), so the clone goes through the credential helper like a real one.
//   node local/src/setups.test.ts
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-setups-'));
const bots = path.join(dir, 'bots');
fs.mkdirSync(bots);
process.env.DATA_DIR = path.join(dir, 'data');
process.env.ALLOWED_ROOTS = bots;
process.env.MACHINE_NAME = 'laptop';

const { inAccount, setMachineBinding, ownerAccount, accountPath } = await import('./store.ts');
const { setPeople } = await import('./people.ts');
const { saveSetup, setupViews, setupMessage, deleteSetup } = await import('./setups.ts');
const { loadBots } = await import('./bots.ts');
const { checkClientFrame, checkPeerData } = await import('./frames.ts');
const { BotManager } = await import('./agent.ts');
const { engineHome } = await import('./engine-home.ts');
const { PersonRoute } = await import('./person-route.ts');
const { removeTree } = await import('./remove-tree.ts');
import type { AgentFrame, PeerData } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const wait = async (until: () => boolean, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end && !until();) await new Promise((r) => setTimeout(r, 50));
    return until();
};

// ---- A repository on an HTTP server that wants a password, like a private one
const served = path.join(dir, 'served');
const work = path.join(dir, 'work');
fs.mkdirSync(work);
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();
git(work, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(work, 'README.md'), 'dashboard\n');
git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'first', '--allow-empty');
git(work, 'add', '.');
git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'readme');
git(dir, 'clone', '-q', '--bare', work, path.join(served, 'dashboard.git'));
git(path.join(served, 'dashboard.git'), 'update-server-info');
const seenAuth: string[] = [];
const server = http.createServer((req, res) => {
    const auth = String(req.headers.authorization ?? '');
    if (!auth) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="git"' }).end();
        return;
    }
    seenAuth.push(Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString());
    const file = path.join(served, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    fs.readFile(file, (e, data) => (e ? res.writeHead(404).end() : res.writeHead(200).end(data)));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const repo = `http://127.0.0.1:${(server.address() as { port: number }).port}/dashboard.git`;

// ---- The admin's side
setPeople([
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'kunde', name: 'Kunde', admin: false, reach: 'listed', contacts: ['main'] },
    { id: 'anna', name: 'Anna', admin: false, reach: 'all' },
]);
const input = {
    account: 'kunde', handover: 'main',
    bots: [
        { key: 'support', name: 'Support', role: 'Answers questions', tone: '', approval: 'read' as const, repo, gitUser: 'kunde-read', token: 'read-token-123' },
        { key: 'dev', name: 'Entwicklung', role: 'Changes', tone: '', approval: 'risky' as const, repo, gitUser: 'kunde-write', token: 'write-token-456' },
    ],
};
check('a setup frame is valid as the web app sends it', checkClientFrame({ type: 'setup_save', setup: { ...input, bots: input.bots.map((b) => ({ ...b, repo: 'https://git.example.com/t/dashboard.git' })) } }).ok);
check('a setup frame without https is refused', !checkClientFrame({ type: 'setup_save', setup: input }).ok);
check('two bots with one key are refused', !checkClientFrame({ type: 'setup_save', setup: { ...input, bots: [input.bots[0], input.bots[0]].map((b) => ({ ...b, repo: 'https://x.example/y.git' })) } }).ok);

inAccount('main', () => {
    saveSetup(input);
    const view = setupViews()[0];
    check('the browser sees whether a token is stored, never the token', view.bots.every((b) => b.token === true) && !JSON.stringify(view).includes('token-'));
    saveSetup({ ...input, bots: input.bots.map((b) => ({ ...b, token: '' })) });
    const m = setupMessage('kunde');
    check('an empty token keeps the stored one', m?.tokens.support === 'read-token-123' && m.tokens.dev === 'write-token-456', m?.tokens);
    // The relay client checks it on arrival; a real repository has an https address (here the test server's is http)
    const real = m && { ...m, setup: { ...m.setup, bots: m.setup.bots.map((b) => ({ ...b, repo: 'https://git.example.com/t/dashboard.git' })) } };
    check('the message to the machine passes the peer check', !!real && checkPeerData(real).ok, real && checkPeerData(real));
});

// ---- The account's machine: bound to 'kunde', set up by 'main'
setMachineBinding({ account: 'kunde', setupBy: 'main' });
check('the bound account owns the machine', ownerAccount() === 'kunde');
check('it runs on the machine\'s own Claude sign-in', inAccount('kunde', () => engineHome('claude')) === null && inAccount('anna', () => engineHome('claude')) !== null);

const frames: AgentFrame[] = [];
const sent: { to: string; data: PeerData }[] = [];
type Manager = InstanceType<typeof BotManager>;
const kunde = inAccount('kunde', () => {
    const m = new BotManager((f) => { frames.push(f); }) as Manager;
    m.toAccount = (to, data) => { sent.push({ to, data }); };
    return m;
});
inAccount('kunde', () => kunde.boundTo('main'));
check('the bound machine asks its admin for the setup', sent.some((s) => s.to === 'main' && s.data.kind === 'setup_request'));

const message = inAccount('main', () => setupMessage('kunde'))!;
inAccount('kunde', () => kunde.personInbound('anna', message));
await new Promise((r) => setTimeout(r, 200));
check('a setup from anyone but the admin is ignored', inAccount('kunde', () => loadBots()).length === 0);

inAccount('kunde', () => kunde.personInbound('main', message));
const made = () => inAccount('kunde', () => loadBots());
check('the setup makes its bots', await wait(() => made().length === 2), made().map((b) => b.id));
const support = made().find((b) => b.id === 'setup-support');
const dev = made().find((b) => b.id === 'setup-dev');
check('each bot is managed, with its level and the hand-over', support?.managed === 'support' && support.approval === 'read' && dev?.approval === 'risky' && support.contact === 'main');
check('each bot has a clone of its own', !!support && !!dev && support.folder !== dev.folder && fs.existsSync(path.join(support.folder, 'README.md')) && fs.existsSync(path.join(dev.folder, 'README.md')));
check('each clone went through its own token', seenAuth.includes('kunde-read:read-token-123') && seenAuth.includes('kunde-write:write-token-456'), seenAuth);
const config = support ? fs.readFileSync(path.join(support.folder, '.git', 'config'), 'utf8') : '';
check('the token is neither in the address nor in .git/config', !config.includes('read-token') && !config.includes('kunde-read@') && config.includes('credential'));
const tokenFile = inAccount('kunde', () => accountPath('setup-git', 'support.credentials'));
check('the token lies in the account\'s data, in a file the bots\' tools refuse', fs.readFileSync(tokenFile, 'utf8') === 'read-token-123' && /credentials/.test(tokenFile));
// Not with execFileSync: the test server runs in this process and could not answer
if (support) await new Promise((r) => execFile('git', ['fetch', '-q'], { cwd: support.folder, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, r));
check('the clone fetches again with its token', seenAuth.filter((a) => a === 'kunde-read:read-token-123').length >= 2);

// The person cannot change or delete a managed bot
const error = (f: AgentFrame) => f.type === 'error' && 'message' in f && /admin/.test(f.message);
frames.length = 0;
inAccount('kunde', () => kunde.handle({ type: 'bot_save', bot: { ...support!, approval: 'never' } }, 'c1'));
inAccount('kunde', () => kunde.handle({ type: 'bot_delete', botId: 'setup-dev' }, 'c1'));
check('a managed bot is neither changed nor deleted by the account', frames.filter(error).length === 2 && made().find((b) => b.id === 'setup-support')?.approval === 'read');

// A newer setup without the developer bot: it goes, its folder stays; the support bot gets its new name
const folder = dev!.folder;
const next = { ...message, setup: { ...message.setup, bots: [{ ...message.setup.bots[0], name: 'Hilfe' }], updatedAt: new Date().toISOString() } };
inAccount('kunde', () => kunde.personInbound('main', next));
check('a newer setup changes and removes managed bots', await wait(() => made().length === 1 && made()[0].name === 'Hilfe'), made().map((b) => b.name));
check('the folder of a removed bot stays', fs.existsSync(path.join(folder, 'README.md')));

// The admin answers a request with the setup, others get nothing
const adminSent: { to: string; data: PeerData }[] = [];
const admin = inAccount('main', () => {
    const m = new BotManager(() => undefined) as Manager;
    m.toAccount = (to, data, replace) => { adminSent.push({ to, data }); check('the setup replaces an older one in the outbox', replace === true); };
    return m;
});
inAccount('main', () => admin.personInbound('kunde', { kind: 'setup_request' }));
check('the admin answers the account\'s request with its setup', adminSent.length === 1 && adminSent[0].data.kind === 'setup' && adminSent[0].to === 'kunde');
inAccount('main', () => deleteSetup('kunde'));
inAccount('main', () => admin.personInbound('kunde', { kind: 'setup_request' }));
check('without a setup there is nothing to send', adminSent.length === 1);
admin.close();
kunde.close();

// ---- The outbox of the person route: kept until delivered, the newest setup replaces older ones, a week at most
const out: string[] = [];
let online = false;
const route = new PersonRoute((data, from, to, id) => { if (online) out.push(`${from}>${to}:${data.kind}:${id}`); return online; });
route.send('main', 'kunde', { kind: 'setup_request' });
route.send('main', 'kunde', { kind: 'setup_request' }, true);
check('offline: kept, the newer one of a kind replaces the older', route.waiting === 1 && out.length === 0);
online = true;
route.retry();
const id = out[0]?.split(':').pop() ?? '';
check('back online: sent again', out.length === 1);
route.result(id, false);
check('no machine of the account awake: it stays', route.waiting === 1);
route.result(id, true);
check('delivered: it leaves the outbox', route.waiting === 0);
route.send('main', 'kunde', { kind: 'setup_request' });
route.retry(Date.now() + 8 * 24 * 3600_000);
check('older than a week: dropped', route.waiting === 0);
// Machines change while the relay's answer is on its way: not sent a second time then, but later again
out.length = 0;
route.send('main', 'kunde', { kind: 'person_message', entry: { id: 'e1', role: 'user', text: 'hi', ts: new Date().toISOString() }, message: 'message' });
route.retry();
check('waiting for the answer: not sent again at once', out.length === 1, out);
route.retry(Date.now() + 20_000);
check('… but when no answer came', out.length === 2, out);
const sentId = out[0]?.split(':').pop() ?? '';
check('the copy keeps the id', out[1]?.endsWith(`:${sentId}`), out);
// The receiving side takes an id once, also after a restart (a new route reads the file)
check('receiver: first copy taken', !route.repeated(sentId));
check('receiver: second copy dropped', route.repeated(sentId));
check('receiver: still known after a restart', new PersonRoute(() => true).repeated(sentId));

server.close();
// A clone's files may still be held a moment on Windows; the temp folder goes later then
try { removeTree(dir); } catch { /* left for the system's temp cleanup */ }
if (failures) process.exit(1);
console.log('all tests passed');
