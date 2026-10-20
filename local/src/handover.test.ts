// Tests for handing a session over to the machine (IDE, terminal):  node local/src/handover.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from './remove-tree.ts';

// The job folder lies in the home folder; a home of its own keeps the test away from a running desktop app
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-handover-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.DATA_DIR = path.join(home, 'data');
const { handoverCommand, handoverTargets, handoverJobs, handOverByJob, runHandover, signInCommand } = await import('./handover.ts');
const { saveMachineSettings } = await import('./machine-settings.ts');

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures++;
};
const fails = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

const ID = '11111111-1111-4111-8111-111111111111';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-handover-folder-'));

// ---- Templates
check('targets: both by default', handoverTargets().join() === 'ide,terminal', handoverTargets());
const ide = handoverCommand('ide', folder, ID);
check('default IDE: opens the folder, then the session in Claude Code for VS Code',
    ide.startsWith(`code "${path.resolve(folder)}"`) && ide.includes(`vscode://anthropic.claude-code/open?session=${ID}`), ide);
const terminal = handoverCommand('terminal', folder, ID);
check('default terminal: resumes the session with Claude Code', terminal.includes(`--resume ${ID}`) && /claude/i.test(terminal), terminal);
process.env.HANDOVER_TERMINAL = 'my-term --cwd "{folder}" -- claude -r {session} {session}';
check('own template: every placeholder filled in', handoverCommand('terminal', folder, ID) === `my-term --cwd "${path.resolve(folder)}" -- claude -r ${ID} ${ID}`);
delete process.env.HANDOVER_TERMINAL;
saveMachineSettings({ handoverTerminal: false });
check('off in the settings: the target is not offered and refused', handoverTargets().join() === 'ide' && fails(() => handoverCommand('terminal', folder, ID)).includes('does not offer'));
saveMachineSettings({ handoverTerminal: true });
process.env.OPENFOLK_CONTAINER = '1';
check('container: nothing offered', handoverTargets().length === 0);
delete process.env.OPENFOLK_CONTAINER;
const signIn = signInCommand() ?? '';
check('sign-in terminal: Claude Code in the home folder, nothing to resume', signIn.includes(home) && /claude/i.test(signIn) && !signIn.includes('--resume'), signIn);
process.env.HANDOVER_TERMINAL = 'my-term -- claude -r {session}';
check('sign-in terminal: an own handover template does not change it', signInCommand() === signIn);
delete process.env.HANDOVER_TERMINAL;
process.env.OPENFOLK_CONTAINER = '1';
check('sign-in terminal: none in a container', signInCommand() === null);
delete process.env.OPENFOLK_CONTAINER;
check('session id: only UUIDs', fails(() => handoverCommand('ide', folder, '../x & calc')).includes('Invalid session id'));

// ---- Running directly
const node = `"${process.execPath}"`;
await runHandover(`${node} -e "require('fs').writeFileSync('ran.txt', process.cwd())"`, folder);
check('run: in the folder', fs.readFileSync(path.join(folder, 'ran.txt'), 'utf8') === folder);
const failed = await runHandover(`${node} -e "console.error('no such window'); process.exit(3)"`, folder).then(() => '', (e: Error) => e.message);
check('run: an error with its last line of output', failed === 'no such window', failed);
const silent = await runHandover(`${node} -e "process.exit(2)"`, folder).then(() => '', (e: Error) => e.message);
check('run: an error without output names the code', silent.includes('code 2'), silent);
const started = Date.now();
await runHandover(`${node} -e "setTimeout(() => {}, 3000)"`, os.tmpdir(), 300);
check('run: a command that keeps running (a terminal) counts as done', Date.now() - started < 2000);

// ---- Through the desktop app: job file, answer as a file
const jobs = handoverJobs();
check('jobs: under the home folder', jobs === path.join(home, '.openfolk', 'handover'), jobs);
const waitForJob = async () => {
    for (let i = 0; i < 40; i++) {
        const f = fs.existsSync(jobs) ? fs.readdirSync(jobs).find((x) => x.endsWith('.json')) : undefined;
        if (f) return f;
        await new Promise((r) => setTimeout(r, 50));
    }
    return undefined;
};
let running = handOverByJob('code "x"', folder, 5000);
let job = await waitForJob();
const content = job ? JSON.parse(fs.readFileSync(path.join(jobs, job), 'utf8')) : {};
check('job: command and folder', content.command === 'code "x"' && content.cwd === folder, content);
fs.rmSync(path.join(jobs, job!));
fs.writeFileSync(path.join(jobs, job!.replace('.json', '.done')), '{}');
check('job: done', await running.then(() => true, () => false));
running = handOverByJob('code "x"', folder, 5000);
job = await waitForJob();
fs.rmSync(path.join(jobs, job!));
fs.writeFileSync(path.join(jobs, job!.replace('.json', '.failed')), JSON.stringify({ message: 'code not found' }));
check('job: the desktop app\'s error', await running.then(() => false, (e: Error) => e.message === 'code not found'));
const nobody = await handOverByJob('code "x"', folder, 600).then(() => '', (e: Error) => e.message);
check('job: without a desktop app an error and the job is gone', nobody.includes('No desktop app') && fs.readdirSync(jobs).length === 0, nobody);

removeTree(folder);
removeTree(home);
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
