// Tests for the open changes of the repos in a bot's folder:  node local/src/git.test.ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitAndPush, fastForward, gitPushCredentials, isSecret, listChanges, openRepos, overlaps, owner, parseStatus, pullRepo, pullRepos, pullText, pushAccess } from './git.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const s = parseStatus('## main...origin/main [ahead 2, behind 1]\0 M src/a.ts\0R  new.ts\0old.ts\0?? folder/\0');
check('head: branch, ahead, behind', s.branch === 'main' && s.ahead === 2 && s.behind === 1, s);
check('files, rename without old path', JSON.stringify(s.files) === JSON.stringify([{ status: ' M', path: 'src/a.ts' }, { status: 'R ', path: 'new.ts' }, { status: '??', path: 'folder/' }]), s.files);
check('repo without commit: branch', parseStatus('## No commits yet on main\0').branch === 'main');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-git-'));
const repo = (rel: string) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(p, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: p });
    fs.writeFileSync(path.join(p, 'readme.md'), 'a');
    execFileSync('git', ['add', '.'], { cwd: p });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x'], { cwd: p });
    return p;
};
const a = repo('a');
fs.writeFileSync(path.join(a, 'readme.md'), 'b');
fs.writeFileSync(path.join(a, 'new ä.txt'), 'c');
repo('group/b');
repo('node_modules/x');
repo('.hidden');

const repos = await listChanges(tmp);
const names = repos.map((r) => r.name).sort();
check('finds sub-repos up to depth 2, without node_modules and hidden ones', JSON.stringify(names) === '["a","group/b"]', names);
const ra = repos.find((r) => r.name === 'a')!;
check('changed and new file, umlaut unquoted', JSON.stringify(ra.files) === JSON.stringify([{ status: ' M', path: 'readme.md' }, { status: '??', path: 'new ä.txt' }]), ra.files);
check('clean repo without files', repos.find((r) => r.name === 'group/b')!.files.length === 0);

// Folder inside a repo: the surrounding repo counts, name = repo folder
const inner = path.join(a, 'sub');
fs.mkdirSync(inner);
const surrounding = await listChanges(inner);
check('folder in repo: surrounding repo', surrounding.length === 1 && surrounding[0].name === 'a' && surrounding[0].path === '', surrounding);

let thrown = false;
await listChanges(path.join(tmp, 'doesnotexist')).catch(() => { thrown = true; });
check('missing folder: error', thrown);

// Overview: every repo with exactly one bot, only open ones
const w = path.resolve('/www');
check('owner: bot inside the repo before bot above', owner(path.join(w, 'app'), [{ id: 'all', folder: w }, { id: 'local', folder: path.join(w, 'app', 'local') }]) === 'local');
check('owner: bot exactly at the repo before subfolder', owner(path.join(w, 'app'), [{ id: 'local', folder: path.join(w, 'app', 'local') }, { id: 'app', folder: path.join(w, 'app') }]) === 'app');
check('owner: otherwise deepest folder above', owner(path.join(w, 'agents', 'mail'), [{ id: 'all', folder: w }, { id: 'agents', folder: path.join(w, 'agents') }]) === 'agents');
check('owner: none matches', owner(path.join(w, 'x'), [{ id: 'y', folder: path.join(w, 'y') }]) === undefined);
fs.writeFileSync(path.join(tmp, 'group', 'b', 'readme.md'), 'new');
const state = await openRepos([{ id: 'all', folder: tmp }, { id: 'inner', folder: inner }, { id: 'gone', folder: path.join(tmp, 'doesnotexist') }]);
check('overview: a with the bot inside the repo, group/b with the bot above, missing folder does not hurt',
    JSON.stringify(Object.keys(state).sort()) === '["all","inner"]' && state.inner.map((r) => `${r.name}|${r.path}`).join() === 'a|'
        && state.all.map((r) => `${r.name}|${r.path}`).join() === 'group/b|group/b' && state.inner[0].files.length === 2, state);
execFileSync('git', ['checkout', '-q', '--', 'readme.md'], { cwd: path.join(tmp, 'group', 'b') });
check('overview: clean repos are missing', JSON.stringify(await openRepos([{ id: 'b', folder: path.join(tmp, 'group') }])) === '{}');

check('secret: .env, keys', isSecret('.env') && isSecret('sub/.env.local') && isSecret('certs/server.key') && isSecret('id_rsa'));
check('not secret: templates, code', !isSecret('.env.sample') && !isSecret('.env.tpl') && !isSecret('src/env.ts') && !isSecret('keys.md'));

// Commit and push against a local remote
const remote = path.join(tmp, 'remote.git');
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
const me = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
Object.assign(process.env, me);
execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: a });
const remoteLog = () => execFileSync('git', ['log', '--format=%s', 'main'], { cwd: remote, encoding: 'utf8' }).trim().split('\n');

fs.writeFileSync(path.join(a, '.env'), 'SECRET=1');
let message = '';
await commitAndPush(tmp, 'a', 'with env').catch((e: Error) => { message = e.message; });
check('new .env prevents the commit', message.includes('.env') && !execFileSync('git', ['log', '--format=%s'], { cwd: a, encoding: 'utf8' }).includes('with env'), message);
fs.rmSync(path.join(a, '.env'));

message = '';
await commitAndPush(tmp, 'a', '  ').catch((e: Error) => { message = e.message; });
check('no commit without message', message === 'Commit message is missing', message);

const ok = await commitAndPush(tmp, 'a', 'Changes via button');
check('commit and first push (sets upstream)', /^a: Commit [0-9a-f]+, pushed$/.test(ok) && remoteLog()[0] === 'Changes via button', ok);
const after = (await listChanges(tmp)).find((r) => r.name === 'a')!;
check('clean afterwards and nothing ahead', after.files.length === 0 && after.ahead === 0, after);

execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'local only'], { cwd: a });
const pushOnly = await commitAndPush(tmp, 'a', '');
check('without open files: push only', pushOnly === 'a: pushed' && remoteLog()[0] === 'local only', pushOnly);

message = '';
await commitAndPush(tmp, '../elsewhere', 'x').catch((e: Error) => { message = e.message; });
check('unknown repo rejected', message.includes('not found'), message);

fs.writeFileSync(path.join(tmp, 'group', 'b', 'new.txt'), 'x');
message = '';
await commitAndPush(tmp, 'group/b', 'without remote').catch((e: Error) => { message = e.message; });
check('push without remote: commit stays, error names both', message.startsWith('group/b: Commit ') && message.includes('push failed'), message);

// Fast-forward: a second checkout of the same remote, as on another machine
const other = path.join(tmp, 'other');
execFileSync('git', ['clone', '-q', remote, other]);
const head = (cwd: string) => execFileSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' }).trim();
const pushFromA = (subject: string) => {
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', subject], { cwd: a });
    execFileSync('git', ['push', '-q'], { cwd: a });
};
check('fast-forward: already current', JSON.stringify(await fastForward(other)) === '{"pulled":0}');
pushFromA('from a 1');
pushFromA('from a 2');
let o = await fastForward(other);
check('fast-forward: takes over new commits', JSON.stringify(o) === '{"pulled":2}' && head(other) === 'from a 2', o);
check('fast-forward: text', pullText('other', o) === 'other: brought up to date (2 new from the remote)', pullText('other', o));

pushFromA('from a 3');
fs.writeFileSync(path.join(other, 'readme.md'), 'edited here');
o = await fastForward(other);
check('fast-forward: local change to a tracked file blocks it, file stays', JSON.stringify(o) === '{"skipped":"local_changes","behind":1}'
    && head(other) === 'from a 2' && fs.readFileSync(path.join(other, 'readme.md'), 'utf8') === 'edited here', o);
check('fast-forward: the overview now shows it behind', (await listChanges(other))[0].behind === 1);
execFileSync('git', ['checkout', '-q', '--', 'readme.md'], { cwd: other });
fs.writeFileSync(path.join(other, 'untracked.txt'), 'x');
o = await fastForward(other);
check('fast-forward: an untracked file does not block it and stays', JSON.stringify(o) === '{"pulled":1}' && fs.existsSync(path.join(other, 'untracked.txt')), o);

pushFromA('from a 4');
execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'only here'], { cwd: other });
o = await fastForward(other);
check('fast-forward: own commits: no merge', JSON.stringify(o) === '{"skipped":"diverged","behind":1}' && head(other) === 'only here', o);
execFileSync('git', ['reset', '-q', '--hard', 'origin/main'], { cwd: other });

check('fast-forward: branch without upstream', JSON.stringify(await fastForward(path.join(tmp, 'group', 'b'))) === '{"skipped":"no_upstream","behind":0}');
execFileSync('git', ['remote', 'set-url', 'origin', path.join(tmp, 'gone.git')], { cwd: other });
o = await fastForward(other);
check('fast-forward: unreachable remote is an error, not a hang', 'error' in o, o);
execFileSync('git', ['remote', 'set-url', 'origin', remote], { cwd: other });

pushFromA('from a 5');
let p = await pullRepo(tmp, 'other');
check('pull button: repo by path in the bot folder', p.ok && p.message.startsWith('other: brought up to date') && head(other) === 'from a 5', p);
p = await pullRepo(tmp, 'other');
check('pull button: nothing new', p.ok && p.message === 'other: already up to date', p);
message = '';
await pullRepo(tmp, '../elsewhere').catch((e: Error) => { message = e.message; });
check('pull button: unknown repo rejected', message.includes('not found'), message);

pushFromA('from a 6');
let results = await pullRepos([{ id: 'x', folder: tmp }, { id: 'y', folder: other }], (root) => overlaps(path.join(other, 'src'), root));
check('all repos: the one a working bot sits in stays', !results.some((r) => path.resolve(r.root) === path.resolve(other)) && head(other) === 'from a 5', results.map((r) => r.name));
results = await pullRepos([{ id: 'x', folder: tmp }, { id: 'y', folder: other }]);
check('all repos: each repo once, other pulled', results.filter((r) => r.name === 'other').length === 1 && head(other) === 'from a 6', results.map((r) => `${r.name}:${JSON.stringify(r.outcome)}`));
check('overlaps: inside either way, not siblings', overlaps(path.join(w, 'a'), path.join(w, 'a', 'b')) && overlaps(path.join(w, 'a', 'b'), path.join(w, 'a')) && !overlaps(path.join(w, 'a'), path.join(w, 'ab')));

// Push credentials via the environment: git asks our own helper instead of the credential manager
const without: NodeJS.ProcessEnv = {};
check('push credentials: nothing set without token', !gitPushCredentials(without, { user: 'bot', token: '', host: 'git.example.test' }) && without.GIT_CONFIG_COUNT === undefined);
const noHost: NodeJS.ProcessEnv = {};
check('push credentials: nothing set without host (no default host)', !gitPushCredentials(noHost, { user: 'bot', token: 'x', host: '' }) && noHost.GIT_CONFIG_COUNT === undefined);
const leftover: NodeJS.ProcessEnv = { GIT_PUSH_USER: 'from-env', GIT_PUSH_TOKEN: 'from-env' };
check('push credentials: values from the .env do not count', !gitPushCredentials(leftover, { user: '', token: '', host: '' }) && leftover.GIT_PUSH_TOKEN === undefined);
const env: NodeJS.ProcessEnv = {
    ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Before', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
};
const cred = { user: ' bot ', token: 'secret-123', host: 'git.example.test' };
check('push credentials: set, existing entries stay', gitPushCredentials(env, cred) && env.GIT_CONFIG_COUNT === '3' && env.GIT_CONFIG_KEY_0 === 'user.name'
    && env.GIT_CONFIG_KEY_1 === 'credential.https://git.example.test.helper' && !Object.values(env).some((v) => v?.includes('secret-123') && v !== 'secret-123'));
gitPushCredentials(env, { ...cred, host: 'other.example.test' });
check('push credentials: a change replaces the entries, does not add more', env.GIT_CONFIG_COUNT === '3' && env.GIT_CONFIG_KEY_1 === 'credential.https://other.example.test.helper');
gitPushCredentials(env, cred);
const answer = execFileSync('git', ['credential', 'fill'], { cwd: tmp, env, input: 'protocol=https\nhost=git.example.test\n\n', encoding: 'utf8', timeout: 20000 });
check('push credentials: git credential fill returns user and token', answer.includes('username=bot\n') && answer.includes('password=secret-123\n'), answer.replace(/password=.*/, 'password=***'));
check('push credentials: earlier entry still applies', execFileSync('git', ['config', 'user.name'], { cwd: tmp, env, encoding: 'utf8' }).trim() === 'Before');

// Push access: judged without asking anyone; this process gets a git token for one host, as the backend does on start
check('push access: SSH cannot be judged', await pushAccess('git@git.example.test:team/repo.git', tmp) === null);
check('push access: token in the address', await pushAccess('https://bot:secret@git.nowhere.invalid/team/repo.git', tmp) === true);
check('push access: no credentials for a host', await pushAccess('https://git.nowhere.invalid/team/repo.git', tmp) === false);
gitPushCredentials(process.env, { user: 'bot', token: 'secret-456', host: 'git.nowhere.invalid' });
check('push access: the git token for that host', await pushAccess('https://git.nowhere.invalid/team/repo.git', tmp) === true);
check('push access: another host still without', await pushAccess('https://other.nowhere.invalid/team/repo.git', tmp) === false);

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) process.exit(1);
