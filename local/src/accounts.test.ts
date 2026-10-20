// Tests for the separation of accounts in the data folder:  node local/src/accounts.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-accounts-'));
process.env.DATA_DIR = dir;
process.env.ALLOWED_ROOTS = dir;
// The machine's owner runs on an API key (machine settings): other accounts must never use it
fs.writeFileSync(path.join(dir, 'machine-settings.json'), JSON.stringify({ claudeAuth: 'apikey' }));
fs.writeFileSync(path.join(dir, 'anthropic-key'), 'sk-test-owner');
// One in the environment never counts
process.env.ANTHROPIC_API_KEY = 'sk-from-env';
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };
const throws = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

const { accountIds, bindAccount, currentAccount, inAccount, readJson, writeJson } = await import('./store.ts');
const { loadBots, saveBot } = await import('./bots.ts');
const { appendEntry, searchHistory } = await import('./history.ts');
const { loadSettings, saveLanguage } = await import('./settings.ts');
const { fileBlocked, saveUploads } = await import('./files.ts');
const { language } = await import('./i18n.ts');

// One account or none: the store does not need a context
check('no account yet: main', currentAccount() === 'main' && accountIds().length === 0);
writeJson('x.json', { a: 1 });
check('written into accounts/main', fs.existsSync(path.join(dir, 'accounts', 'main', 'x.json')) && !fs.existsSync(path.join(dir, 'x.json')));

const bot = (id: string) => ({ id, name: id, role: '', folder: dir, model: 'default' as const, tone: '', avatar: '', approval: 'risky' as const, machine: '' });
inAccount('work', () => saveBot(bot('anna')));
inAccount('main', () => saveBot(bot('bert')));
check('two accounts on disk', accountIds().join() === 'main,work');
check('bots are separate', inAccount('work', () => loadBots().map((b) => b.id).join()) === 'anna' && inAccount('main', () => loadBots().map((b) => b.id).join()) === 'bert');

// Several accounts: without a context nothing may guess
check('several accounts, no context: refuses', throws(() => readJson('x.json', null)).includes('No account context'));
check('several accounts, no context: no bots handed out', throws(() => loadBots()).includes('No account context'));

// The context survives asynchronous work started in it
const later = await inAccount('work', () => new Promise<string>((resolve) => setTimeout(() => resolve(currentAccount()), 10)));
check('timer started in an account stays in it', later === 'work');
const bound = inAccount('work', () => bindAccount(() => loadBots().map((b) => b.id).join()));
check('bound callback runs in its account wherever it is called', inAccount('main', bound) === 'anna');

// Caches are per account: language, search index
inAccount('work', () => saveLanguage('de'));
check('language per account', inAccount('work', () => loadSettings().language) === 'de' && inAccount('main', () => loadSettings().language) === 'en');
check('texts follow the account', inAccount('work', language) === 'de' && inAccount('main', language) === 'en');
const entry = (text: string) => ({ id: text, role: 'user' as const, text, ts: new Date().toISOString(), from: 'me' });
inAccount('work', () => appendEntry('anna', entry('invoice for the customer')));
inAccount('main', () => appendEntry('anna', entry('holiday photos')));
check('search finds only the own account', inAccount('work', () => searchHistory('holiday').length) === 0 && inAccount('main', () => searchHistory('holiday').length) === 1
    && inAccount('work', () => searchHistory('invoice').length) === 1);

// Uploads of another account are not handed out
const [upload] = inAccount('work', () => saveUploads('anna', [{ name: 'a.txt', type: 'text/plain', data: Buffer.from('x').toString('base64') }]));
check('own upload free', inAccount('work', () => !fileBlocked(upload.attachment.path!)));
check('upload of another account blocked', inAccount('main', () => fileBlocked(upload.attachment.path!)));

// Account ids become folder names
check('invalid account id refused', throws(() => inAccount('../main', () => 1)).includes('Invalid account id') && throws(() => inAccount('Work', () => 1)).includes('Invalid'));

// ---------------------------------------------------------------- one BotManager per account (accounts.ts)
const { Accounts } = await import('./accounts.ts');
type Fake = { account: string; started: boolean; closed: boolean; working: boolean; othersInUse: () => boolean; calls: string[] };
const made: Fake[] = [];
const fake = (account: string) => {
    const f: Fake = { account: currentAccount(), started: false, closed: false, working: false, othersInUse: () => false, calls: [] };
    made.push(f);
    check(`manager of ${account} created in its account`, f.account === account);
    return Object.assign(f, {
        start() { f.started = true; f.calls.push(`start:${currentAccount()}`); },
        close() { f.closed = true; },
        busy: () => f.working,
        inUse: () => f.working,
        handle(frame: { type: string }) { f.calls.push(`${frame.type}:${currentAccount()}`); },
        greet() {}, leave() {}, updateAgents() {}, peerInbound() {}, woken() {}, warning() {}, pushGone() {},
    });
};
const router = new Accounts(fake as never, () => undefined);
router.start();
check('before the relay: main only', router.served().join() === 'main' && made[0].calls[0] === 'start:main');
check('other account before the hello: not served', router.handler('work') === null);
router.hello(['main', 'work'], []);
check('hello: the relay\'s accounts served', router.served().join() === 'main,work');
router.handler('work')!.handle({ type: 'ping' } as never, 'c1');
check('frame of an account runs in its context', made[1].calls.includes('ping:work'));
check('invalid account from the relay: no handler', router.handler('../x') === null && router.handler('Main') === null);
made[1].working = true;
check('the other account working counts for shutting down', made[0].othersInUse() && !made[1].othersInUse());
made[1].working = false;

// Deletion: the folder moves aside, the account cannot be touched any more
inAccount('work', () => writeJson('y.json', { b: 2 }));
router.deleted('work');
const trash = fs.readdirSync(path.join(dir, 'deleted-accounts'));
check('deleted: manager closed and no longer served', made[1].closed && router.served().join() === 'main');
check('deleted: data moved to deleted-accounts, not removed', !fs.existsSync(path.join(dir, 'accounts', 'work')) && trash.length === 1
    && fs.existsSync(path.join(dir, 'deleted-accounts', trash[0], 'y.json')));
check('deleted: its data refuses access', throws(() => inAccount('work', () => readJson('y.json', null))).includes('deleted'));
router.deleted('main');
router.deleted('../main');
check('main and invalid ids are never deleted', router.served().join() === 'main' && fs.existsSync(path.join(dir, 'accounts', 'main')));
router.hello(['main', 'other'], ['work']);
check('hello with a deleted account: not served again', router.served().join() === 'main,other');
router.hello(null, []);
check('relay without accounts: back to main only', router.served().join() === 'main' && made[made.length - 1].closed);

// The machine and its logins belong to 'main'
const { BotManager } = await import('./agent.ts');
const sent: { type: string; request?: string; message?: string }[] = [];
const work = inAccount('guest', () => new BotManager((f) => { sent.push(f as never); }));
inAccount('guest', () => work.handle({ type: 'backend_restart' } as never, 'c1'));
check('other account: machine frames refused', sent.at(-1)?.type === 'error' && sent.at(-1)?.request === 'backend_restart' && /owner/.test(sent.at(-1)?.message ?? ''), sent.at(-1));
inAccount('guest', () => work.handle({ type: 'ping' } as never, 'c1'));
check('other account: its own frames still answered', sent.at(-1)?.type === 'pong');
check('refused frame left no restart request', !fs.existsSync(path.join(dir, 'restart.request')));

// ---------------------------------------------------------------- engine folders per account (engine-home.ts)
const home = await import('./engine-home.ts');
const { codexEnv, claudeInstructions } = await import('./codex.ts');
const { transcriptPath } = await import('./vscode.ts');
const { startDeviceLogin } = await import('./engine-login.ts');
const guestEngines = path.join(dir, 'accounts', 'guest', 'engines');
const guestEnv = inAccount('guest', () => home.claudeEnv());
check('other account: own Claude folder in its data', guestEnv.CLAUDE_CONFIG_DIR === path.join(guestEngines, 'claude') && fs.existsSync(path.join(guestEngines, 'claude')));
check('other account: never the owner\'s API key', !('ANTHROPIC_API_KEY' in guestEnv) && inAccount('guest', home.accountAuth) === 'subscription'
    && inAccount('guest', home.claudeSettings) === undefined);
const mainEnv = inAccount('main', () => home.claudeEnv());
check('main: the machine\'s Claude folder and its API key, as before', !('CLAUDE_CONFIG_DIR' in mainEnv) && mainEnv.ANTHROPIC_API_KEY === 'sk-test-owner'
    && inAccount('main', home.accountAuth) === 'apikey');
check('other account: own CODEX_HOME', inAccount('guest', () => codexEnv()).CODEX_HOME === path.join(guestEngines, 'codex') && !('CODEX_HOME' in inAccount('main', () => codexEnv())));
{
    const machine = await import('./machine-settings.ts');
    machine.saveEngineKey('codex', 'sk-openai-owner');
    check('Codex key stored, subscription chosen: ~/.codex as before', !('CODEX_HOME' in inAccount('main', () => codexEnv())));
    machine.saveMachineSettings({ engineAuth: { codex: 'apikey' } });
    check('Codex on the key: a folder of its own, the subscription login stays', inAccount('main', () => codexEnv()).CODEX_HOME === path.join(dir, 'codex-apikey')
        && inAccount('main', () => home.engineKeyFor('codex')) === 'sk-openai-owner');
    check("other account: never the owner's Codex key", inAccount('guest', () => codexEnv()).CODEX_HOME === path.join(guestEngines, 'codex')
        && inAccount('guest', () => home.engineKeyFor('codex')) === '');
    machine.saveMachineSettings({ engineAuth: {} });
    machine.saveEngineKey('codex', '');
}
check('engines without a folder of their own: main only', inAccount('guest', () => home.engineAvailable('codex') && home.engineAvailable('claude') && !home.engineAvailable('copilot')
    && !home.engineAvailable('cursor') && !home.engineAvailable('antigravity')) && inAccount('main', () => home.engineAvailable('copilot')));
check('transcripts in the account\'s Claude folder', inAccount('guest', () => transcriptPath(dir, '0a1b2c3d-0000-4000-8000-000000000000')).startsWith(path.join(guestEngines, 'claude', 'projects')));
fs.writeFileSync(path.join(guestEngines, 'claude', 'CLAUDE.md'), 'GUEST RULES');
check('Codex bots read the account\'s global CLAUDE.md', inAccount('guest', () => claudeInstructions(dir)).includes('GUEST RULES')
    && !inAccount('main', () => claudeInstructions(dir)).includes('GUEST RULES'));
check('sign-in command with the account\'s folder; none for main', (inAccount('guest', home.claudeSignInCommand) ?? '').includes(path.join(guestEngines, 'claude'))
    && inAccount('main', home.claudeSignInCommand) === undefined);

// Device sign-in writes into the account's folder
const fakeCli = path.join(dir, 'fake-login.mjs');
fs.writeFileSync(fakeCli, `import fs from 'node:fs'; fs.writeFileSync(process.argv[2], process.env.CODEX_HOME ?? 'none'); console.log('visit https://example.test/device and enter code AB12-CD34');`);
const seenHome = path.join(dir, 'seen-home.txt');
await new Promise<void>((resolve) => inAccount('guest', () => startDeviceLogin('codex', (r) => { if (r.state !== 'code') resolve(); }, () => [process.execPath, [fakeCli, seenHome]])));
check('device sign-in runs with the account\'s CODEX_HOME', fs.readFileSync(seenHome, 'utf8') === path.join(guestEngines, 'codex'));
sent.length = 0;
inAccount('guest', () => work.handle({ type: 'engine_login', engine: 'copilot' } as never, 'c1'));
check('other account: Copilot sign-in refused, nothing started', (sent.at(-1) as { state?: string } | undefined)?.state === 'failed', sent.at(-1));
// A bot of another account set to Copilot ends its turn with the reason instead of running on the owner's login
const copilotBot = inAccount('guest', () => saveBot({ ...bot('cop'), model: 'copilot' }));
const turnResult = await inAccount('guest', () => new Promise<{ error?: string }>((resolve) => {
    (work as unknown as { startTurn: (b: unknown, spec: object, onDone: (e: { error?: string }) => void) => void })
        .startTurn(copilotBot, { chatId: 'cop', from: 'me', text: 'hi', content: 'hi' }, resolve);
}));
check('other account: a Copilot bot does not run, the reason is said', /Copilot runs only for the owner/.test(turnResult.error ?? ''), turnResult);
work.close();

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
