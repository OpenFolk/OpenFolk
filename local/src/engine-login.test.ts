// Sign-in with a device code: the link and the code from the CLIs' real output, the outcome, one sign-in at a time.
// Claude's sign-in in the browser: started, the outcome, a second tap starting over.
//   node local/src/engine-login.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
type LoginReport = import('./engine-login.ts').LoginReport | import('./engine-login.ts').ClaudeLoginReport;

// The sign-in runs in the current account; the real local/data may hold several, so a data folder of its own
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-engine-login-'));
const { parseDeviceCode, startClaudeLogin, startDeviceLogin } = await import('./engine-login.ts');

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`);
    if (!ok) failed++;
};

// Output of `codex login --device-auth` 0.162 (colors included) and `copilot login --device-code`
const CODEX = '\nWelcome to Codex [v\x1b[90m0.162.1\x1b[0m]\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n'
    + '1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n'
    + '2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mAB12-CD34E\x1b[0m\n';
const COPILOT = 'To authenticate, visit https://github.com/login/device and enter code 1A2B-3C4D\nWaiting for authorization...\n';

check('codex: link and code without colors', JSON.stringify(parseDeviceCode(CODEX)) === '{"url":"https://auth.openai.com/codex/device","code":"AB12-CD34E"}', parseDeviceCode(CODEX));
check('copilot: link and code from one line', JSON.stringify(parseDeviceCode(COPILOT)) === '{"url":"https://github.com/login/device","code":"1A2B-3C4D"}', parseDeviceCode(COPILOT));
check('only the link so far: nothing yet', parseDeviceCode(CODEX.slice(0, CODEX.indexOf('2. Enter'))) === null);

// A stand-in CLI: prints the copilot text, then ends with the exit code given
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-login-'));
const fake = path.join(dir, 'fake-cli.mjs');
fs.writeFileSync(fake, `process.stdout.write(${JSON.stringify(COPILOT)}); setTimeout(() => { console.error('Authorization failed: expired'); process.exit(Number(process.argv[2])); }, 300);`);
const run = (exit: number) => new Promise<LoginReport[]>((resolve) => {
    const reports: LoginReport[] = [];
    startDeviceLogin('copilot', (r) => {
        reports.push(r);
        if (r.state !== 'code') resolve(reports);
    }, () => [process.execPath, [fake, String(exit)]]);
});

const ok = await run(0);
check('sign-in: first the code, then done', ok.length === 2 && ok[0].state === 'code' && (ok[0] as { code: string }).code === '1A2B-3C4D' && ok[1].state === 'done', ok);
const bad = await run(1);
check('failed sign-in: the last line of the CLI as the reason', bad[1]?.state === 'failed' && (bad[1] as { message: string }).message === 'Authorization failed: expired', bad);

// A second request while one runs gets the same code instead of a second process
const first: LoginReport[] = [];
const second: LoginReport[] = [];
let starts = 0;
const cmd = () => { starts++; return [process.execPath, [fake, '0']] as [string, string[]]; };
await new Promise<void>((resolve) => {
    startDeviceLogin('copilot', (r) => {
        first.push(r);
        if (r.state === 'code') startDeviceLogin('copilot', (r2) => second.push(r2), cmd);
        if (r.state === 'done') resolve();
    }, cmd);
});
check('second request while running: same code, one process', starts === 1 && second.length === 1 && second[0].state === 'code' && (second[0] as { code: string }).code === '1A2B-3C4D', { starts, second });

// Claude: `claude auth login` opens the browser itself and ends once the redirect came back; output of 2.1.306
const CLAUDE = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\nPaste code here if prompted > ";
const claudeFake = path.join(dir, 'fake-claude.mjs');
fs.writeFileSync(claudeFake, `process.stdout.write(${JSON.stringify(CLAUDE)}); setTimeout(() => process.exit(Number(process.argv[2])), Number(process.argv[3]));`);
const claude = (exit: number, ms = 300) => () => [process.execPath, [claudeFake, String(exit), String(ms)]] as [string, string[]];
const claudeRun = (exit: number) => new Promise<LoginReport[]>((resolve) => {
    const reports: LoginReport[] = [];
    startClaudeLogin((r) => {
        reports.push(r);
        if (r.state !== 'browser') resolve(reports);
    }, claude(exit));
});
const signedIn = await claudeRun(0);
check('claude: browser, then done, and nothing of the link passed on', JSON.stringify(signedIn) === '[{"state":"browser"},{"state":"done"}]', signedIn);
const notSignedIn = await claudeRun(1);
check('claude failed: no prompt as the reason', notSignedIn[1]?.state === 'failed' && !(notSignedIn[1] as { message: string }).message.includes('Paste code'), notSignedIn);

// A second tap starts over (a browser tab closed too early); the replaced process ends without a word
const replaced: LoginReport[] = [];
startClaudeLogin((r) => replaced.push(r), claude(1, 60_000));
await new Promise((r) => setTimeout(r, 200));
const again = await new Promise<LoginReport[]>((resolve) => {
    const reports: LoginReport[] = [];
    startClaudeLogin((r) => {
        reports.push(r);
        if (r.state !== 'browser') resolve(reports);
    }, claude(0));
});
await new Promise((r) => setTimeout(r, 200));
check('claude, second tap: the new one signs in, the first says only "browser"', JSON.stringify(again) === '[{"state":"browser"},{"state":"done"}]'
    && JSON.stringify(replaced) === '[{"state":"browser"}]', { again, replaced });

const missing: LoginReport[] = [];
startDeviceLogin('codex', (r) => missing.push(r), () => { throw new Error('The Codex CLI is not installed'); });
check('CLI not installed: failed with the reason', missing[0]?.state === 'failed' && (missing[0] as { message: string }).message.includes('not installed'), missing);

fs.rmSync(dir, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('all tests passed');
