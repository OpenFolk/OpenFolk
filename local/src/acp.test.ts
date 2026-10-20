// Tests for the ACP connection (Cursor): helpers and a whole run against a fake agent
// (testdata/acp-agent.mjs, real process, real ACP, tools via the MCP server over HTTP):  node local/src/acp.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-acp-'));
const { ACP_AGENTS, AcpRun, acpModels, acpTool, acpInput, ANTIGRAVITY, antigravityVersion, COPILOT, cursorVersion, OPENCODE, questionAnswers, choose } = await import('./acp.ts');
const { handle, toolAccess } = await import('./mcp-http.ts');
const { needsApproval } = await import('./policy.ts');
const { engineOf, engineModelId, codexModelId, modelDisplayName } = await import('../../shared/protocol.ts');
type AcpAgent = import('./acp.ts').AcpAgent;
type EngineTarget = import('./codex.ts').EngineTarget;
type ToolCall = import('../../shared/protocol.ts').ToolCall;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

// Engine from the model
check('cursor is Cursor', engineOf('cursor') === 'cursor' && engineModelId('cursor') === undefined);
check('cursor:<id>', engineOf('cursor:gpt-x') === 'cursor' && engineModelId('cursor:gpt-x') === 'gpt-x' && codexModelId('cursor:gpt-x') === undefined);
check('codex stays Codex', engineOf('codex:a') === 'codex' && engineModelId('codex:a') === 'a' && codexModelId('codex:a') === 'a');
check('Claude without prefix', engineOf('opus') === 'claude' && engineOf('cursorish') === 'claude' && engineModelId('opus') === undefined);
check('display shows the model behind "cursor"', modelDisplayName('cursor', [{ value: 'cursor', resolvedModel: 'cursor:a', displayName: 'Cursor' }, { value: 'cursor:a', resolvedModel: 'cursor:a', displayName: 'A (Cursor)' }]) === 'A (Cursor)');

// Newest version of the Cursor CLI
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-agent-'));
    for (const v of ['2026.9.30-aaa111', '2026.10.01-e373342', '2026.10.01-12-30-00-bbb222', 'broken']) fs.mkdirSync(path.join(dir, 'versions', v), { recursive: true });
    const v = cursorVersion(dir);
    check('newest version, date compared with two digits', !!v && v.name.startsWith('2026.10.01'), v);
    check('none without a versions folder', cursorVersion(path.join(dir, 'nothing')) === null);
}

// Tool calls as in Claude Code
{
    const command = acpTool({ toolCallId: 'a', title: 'Run git status', kind: 'execute', rawInput: { command: 'git status' } })!;
    check('execute becomes shell', ['PowerShell', 'Bash'].includes(command.name) && command.input.command === 'git status' && command.call.summary === 'Run git status', command);
    const list = acpTool({ toolCallId: 'a', title: 'x', kind: 'execute', rawInput: { command: ['rm', '-rf', 'x'] } })!;
    check('command as a list', list.input.command === 'rm -rf x');
    const edit = acpTool({ toolCallId: 'b', title: 'Edit', kind: 'edit', locations: [{ path: 'C:/p/a.ts' }], content: [{ type: 'diff', path: 'C:/p/b.ts', newText: 'x' }] })!;
    check('edit becomes Write with all files, shown as Edit', edit.name === 'Write' && JSON.stringify(edit.input.files) === '["C:/p/a.ts","C:/p/b.ts"]' && edit.call.name === 'Edit', edit);
    check('reading free, thinking invisible', acpTool({ toolCallId: 'c', title: 'Read', kind: 'read', locations: [{ path: 'a' }] })!.name === 'Read' && acpTool({ toolCallId: 'd', title: 'x', kind: 'think' }) === null);
    check('own tool recognized by its name', acpTool({ toolCallId: 'e', title: 'openfolk: send_file', kind: 'other' }, ['send_file'])!.name === 'mcp__openfolk__send_file');
    check('own tool in OpenCode\'s form', acpTool({ toolCallId: 'e', title: 'openfolk_send_file', kind: 'other' }, ['send_file'])!.name === 'mcp__openfolk__send_file');
    check('a command mentioning openfolk_send_file stays a command', acpTool({ toolCallId: 'e', title: 'openfolk_send_file', kind: 'execute', rawInput: { command: 'x' } }, ['send_file'])!.name !== 'mcp__openfolk__send_file');
    const foreign = acpTool({ toolCallId: 'f', title: 'Slack: Post Message', kind: 'other' })!;
    check('foreign tool as MCP with a question', foreign.name === 'mcp__acp__slack_post_message' && needsApproval('risky', foreign.name, foreign.input, 'C:/p').ask, foreign.name);
    check('own tool without a question', !needsApproval('write', 'mcp__openfolk__remember_note', {}, 'C:/p').ask);
}

// Options of the permission request and answers of the question
{
    const o = [{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'allow-always', kind: 'allow_always' }, { optionId: 'reject-once', kind: 'reject_once' }];
    check('allow', choose(o, { behavior: 'allow', updatedInput: {} }) === 'allow-once');
    check('allow always', choose(o, { behavior: 'allow', updatedInput: {}, updatedPermissions: [{} as never] }) === 'allow-always');
    check('reject', choose(o, { behavior: 'deny', message: '' }) === 'reject-once');
    check('none without a matching option', choose([{ optionId: 'x', kind: 'allow_once' }], { behavior: 'deny', message: '' }) === undefined);
    const f = [{ id: 'q', prompt: 'Which?', options: [{ id: 'a', label: 'Tea' }, { id: 'b', label: 'Coffee' }, { id: 'c', label: 'Water' }], allowMultiple: true }];
    check('multiple choice as ids', JSON.stringify(questionAnswers(f, { 'Which?': 'Tea, Water' })) === '[{"questionId":"q","selectedOptionIds":["a","c"]}]');
}

// Prompt: text and images
{
    const e = acpInput([{ type: 'text', text: 'Hi' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==' } }, { type: 'document', source: { type: 'base64', data: 'x' } }]);
    check('text and image, no PDF', e.length === 2 && e[1].mimeType === 'image/png' && e[1].data === 'QQ==', e);
    check('without image capability only text', acpInput([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }], false)[0].type === 'text');
}

// MCP server: protocol without HTTP, then over HTTP with protection
const noted: string[] = [];
const tools = [{ name: 'remember_note', description: 'notes', schema: { type: 'object', properties: { note: { type: 'string' } } }, run: async (a: Record<string, unknown>) => { noted.push(String(a.note)); return { text: 'Noted.' }; } }];
{
    const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, tools) as { result: { protocolVersion: string } };
    check('unknown protocol version: newest', init.result.protocolVersion === '2025-11-25');
    check('notification without answer', (await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools)) === null);
    const wrong = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gone' } }, tools) as { error: { code: number } };
    check('unknown tool is an error', wrong.error.code === -32602);
    const z = await toolAccess(tools);
    const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    check('only 127.0.0.1', z.url.startsWith('http://127.0.0.1:'));
    check('wrong path 404', (await post(z.url.replace(/[0-9a-f]+$/, 'abc'), {})).status === 404);
    check('with Origin (web page) 404', (await post(z.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' })).status === 404);
    check('GET 405', (await fetch(z.url)).status === 405);
    const r = await (await post(z.url, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }])).json() as unknown[];
    check('batch answered without notifications', Array.isArray(r) && r.length === 1);
    z.close();
    check('closed access 404', (await post(z.url, { jsonrpc: '2.0', id: 1, method: 'ping' })).status === 404);
}

// Whole run against the fake agent
const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testdata', 'acp-agent.mjs');
const agent = (env: Record<string, string> = {}): AcpAgent => ({
    engine: 'cursor', name: 'Test', signIn: 'test_login', notSignedIn: () => 'Test is not signed in.',
    command: () => ({ command: process.execPath, args: [fake], env: { ...process.env, ...env } }),
});

const models = await acpModels(agent());
check('models from the session option', models.map((m) => m.value).join() === 'cursor,cursor:auto,cursor:gpt-x' && models[0].resolvedModel === 'cursor:auto' && models[2].displayName === 'GPT X (Test)', models);
check('no models without a login', (await acpModels(agent({ FAKE_NOT_SIGNED_IN: '1' })).catch(() => 'error')) === 'error');
check('no models without installation', (await acpModels({ ...agent(), command: () => { throw new Error('not installed'); } })).length === 0);

interface Log { text: string; tools: ToolCall[]; results: string[]; done: (string | undefined)[]; notices: string[]; threads: string[]; account: string[]; context: number[]; approvals: { tool: string; input: Record<string, unknown> }[] }
const p: Log = { text: '', tools: [], results: [], done: [], notices: [], threads: [], account: [], context: [], approvals: [] };
let answer: (tool: string) => Promise<unknown> = async () => ({ behavior: 'allow', updatedInput: {} });
let doneSignal: (() => void) | null = null;
const target: EngineTarget = {
    threadId: (id) => p.threads.push(id), account: (k) => p.account.push(`${k.version} ${k.model}`), limits: () => undefined, notice: (x) => p.notices.push(x),
    textStarts: () => { p.text += '\n\n'; }, delta: (x) => { p.text += x; },
    tool: (c) => p.tools.push(c), toolResult: (id, ok, r) => p.results.push(`${id} ${ok} ${r}`), context: (n) => p.context.push(n),
    done: (f) => { p.done.push(f); doneSignal?.(); },
    approval: async (tool, input, signal) => {
        p.approvals.push({ tool, input });
        return await Promise.race([answer(tool), new Promise((ok) => signal.addEventListener('abort', () => ok({ behavior: 'deny', message: 'aborted' })))]) as never;
    },
};
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-bot-'));
const start = (extra: Record<string, unknown> = {}) => ({ folder, instructions: 'You are a test bot.', tools, ...extra });
const job = async (run: InstanceType<typeof AcpRun>, text: string | Record<string, unknown>[], extra: Record<string, unknown> = {}) => {
    p.text = '';
    const f = new Promise<void>((ok) => { doneSignal = ok; });
    await run.send(text, start(extra));
    await f;
    return p.text;
};

{
    const run = new AcpRun(agent(), target);
    check('first message with instructions', (await job(run, 'hello')) === '[with instructions] Hello world' && p.done.at(-1) === undefined, p.text);
    check('session remembered, account reported', p.threads.at(-1) === 's-new' && p.account.at(-1) === '9.9 Auto', { t: p.threads, k: p.account });
    check('context from usage_update', p.context.at(-1) === 1234);
    check('second message without instructions', (await job(run, 'hello')) === 'Hello world', p.text);

    answer = async () => ({ behavior: 'allow', updatedInput: {}, updatedPermissions: [{}] });
    const t = await job(run, 'command');
    check('command: approval as shell, "always" becomes allow-always', p.approvals.at(-1)?.input.command === 'git status' && t.endsWith('Answer allow-always'), { f: p.approvals.at(-1), t });
    check('tool with result, text afterwards in a new paragraph', p.tools.at(-1)?.id === 't1' && p.results.at(-1) === 't1 true clean' && t.includes('\n\nAnswer'), { e: p.results.at(-1), t });
    answer = async () => ({ behavior: 'deny', message: 'no' });
    check('rejection becomes reject-once', (await job(run, 'command')).endsWith('Answer reject-once') && p.results.at(-1) === 't1 false rejected');

    answer = async () => ({ behavior: 'allow', updatedInput: {} });
    await job(run, 'change');
    check('file change as Write with diff', p.approvals.at(-1)?.tool === 'Write' && String(p.approvals.at(-1)?.input.content).includes('- old') && JSON.stringify(p.approvals.at(-1)?.input.files) === '["C:/p/a.txt"]', p.approvals.at(-1));

    const w = await job(run, 'tool');
    check('agent calls a tool via MCP/HTTP', noted.includes('Tea') && w.includes('MCP 2025-06-18 remember_note') && p.tools.at(-1)?.name === 'mcp__openfolk__remember_note', { w, g: noted });

    answer = async (tool) => (tool === 'AskUserQuestion' ? { behavior: 'allow', updatedInput: { answers: { 'Tea or coffee?': 'Coffee' } } } : { behavior: 'allow', updatedInput: {} });
    const q = await job(run, 'question');
    const card = p.approvals.at(-1)!;
    check('question via the card', card.tool === 'AskUserQuestion' && JSON.stringify(card.input).includes('Tea or coffee?') && q.includes('"selectedOptionIds":["o2"]'), { card, q });
    answer = async () => ({ behavior: 'deny', message: 'later' });
    check('question rejected: skipped', (await job(run, 'question')).includes('"outcome":"skipped"'));

    check('switch model', (await job(run, 'model', { model: 'gpt-x' })) === 'Model gpt-x' && p.account.at(-1) === '9.9 GPT X', { t: p.text, k: p.account.at(-1) });
    await job(run, 'model', { model: 'doesnotexist' });
    check('unknown model: notice, stays', !!p.notices.at(-1)?.includes('not available') && p.text === 'Model gpt-x', { h: p.notices.at(-1), t: p.text });

    check('image goes along', (await job(run, [{ type: 'text', text: 'image' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==' } }])) === 'Image received');

    // Stop in the middle of an approval
    answer = () => new Promise(() => undefined);
    p.text = '';
    const f = new Promise<void>((ok) => { doneSignal = ok; });
    void run.send('wait', start());
    await new Promise((ok) => setTimeout(ok, 500));
    await run.interrupt();
    await f;
    check('stop: open approval aborted, interrupted', p.done.at(-1) === 'Interrupted', p.done.at(-1));
    run.close();
    check('process ended', !run.running);
}

{
    // Resume: the old history does not appear in the chat, no instructions any more
    const run = new AcpRun(agent(), target);
    check('resumed without old history', (await job(run, 'hello', { threadId: 's-old' })) === 'Hello world' && p.threads.at(-1) === 's-old', p.text);
    run.close();
    const gone = new AcpRun(agent(), target);
    check('cannot resume: new session with instructions', (await job(gone, 'hello', { threadId: 'gone' })) === '[with instructions] Hello world' && p.threads.at(-1) === 's-new' && !!p.notices.at(-1)?.includes('could not be continued'), { t: p.text, h: p.notices.at(-1) });
    gone.close();
    const without = new AcpRun(agent({ FAKE_NOT_SIGNED_IN: '1' }), target);
    await job(without, 'hello');
    check('without login: clear message', !!p.done.at(-1)?.startsWith('Test is not signed in.') && p.done.at(-1)!.includes('Please run agent login'), p.done.at(-1));
    const early = new AcpRun({ ...agent(), signedIn: async () => false }, target);
    await job(early, 'hello');
    check('login check beforehand: no authenticate', p.done.at(-1) === 'Test is not signed in.', p.done.at(-1));
    // Like Copilot: no authenticate, without a login only session/new fails
    const noAuth = { ...agent({ FAKE_SESSION_WITHOUT_LOGIN: '1' }), signIn: undefined };
    await job(new AcpRun(noAuth, target), 'hello');
    check('session/new without login: clear message', p.done.at(-1) === 'Test is not signed in. (Authentication required)', p.done.at(-1));
    check('model list without login: clear message', (await acpModels(noAuth).catch((e: Error) => e.message)) === 'Test is not signed in. (Authentication required)');
    const withAuth = new AcpRun({ ...agent(), signIn: undefined }, target);
    check('without authenticate but with login it runs', (await job(withAuth, 'hello')) === '[with instructions] Hello world', p.text);
    withAuth.close();
}

// Copilot: start of the CLI and environment
{
    process.env.COPILOT_PROVIDER_BASE_URL = 'https://foreign.example';
    process.env.COPILOT_ALLOW_ALL = 'true';
    process.env.GH_TOKEN = 'foreign';
    process.env.COPILOT_GITHUB_TOKEN = 'foreign';
    let installed = true;
    let b;
    try {
        b = COPILOT.command();
    } catch {
        // optional dependency, left out with `npm install --omit=optional`: check the arguments and the environment
        installed = false;
        process.env.COPILOT_BIN = 'copilot';
        b = COPILOT.command();
        delete process.env.COPILOT_BIN;
    }
    check(`Copilot as ACP server without self-update${installed ? '' : ' (CLI not installed, binary not checked)'}`,
        b.args.join(' ') === '--acp --stdio --no-auto-update' && /copilot(\.exe)?$/.test(b.command) && (!installed || fs.existsSync(b.command)), b);
    check('BYOK, "allow all" and tokens from the environment removed: the stored login counts', !b.env.COPILOT_PROVIDER_BASE_URL && !b.env.COPILOT_ALLOW_ALL
        && !b.env.GH_TOKEN && !b.env.COPILOT_GITHUB_TOKEN);
    delete process.env.COPILOT_PROVIDER_BASE_URL;
    delete process.env.COPILOT_ALLOW_ALL;
    delete process.env.GH_TOKEN;
    delete process.env.COPILOT_GITHUB_TOKEN;
    check('copilot is Copilot', engineOf('copilot:gpt-x') === 'copilot' && engineModelId('copilot:gpt-x') === 'gpt-x' && ACP_AGENTS.copilot === COPILOT && ACP_AGENTS.cursor.engine === 'cursor');
}

// OpenCode: start, environment without API keys, permissions, labels
{
    process.env.GEMINI_API_KEY = 'secret';
    process.env.AWS_ACCESS_KEY_ID = 'secret';
    process.env.AGENT_TOKEN = 'secret';
    process.env.OPENCODE_CONFIG = 'C:/elsewhere.json';
    process.env.OPENFOLK_KEEP = 'stays';
    let b: ReturnType<typeof OPENCODE.command>;
    let installed = true;
    try {
        b = OPENCODE.command();
    } catch {
        installed = false;
        process.env.OPENCODE_BIN = 'opencode';
        b = OPENCODE.command();
        delete process.env.OPENCODE_BIN;
    }
    check(`OpenCode as ACP server${installed ? '' : ' (not installed, binary not checked)'}`, b.args.join(' ') === 'acp' && /opencode(\.exe)?$/.test(b.command) && (!installed || fs.existsSync(b.command)), b.command);
    check('no API keys, secrets or foreign config for OpenCode', !b.env.GEMINI_API_KEY && !b.env.AWS_ACCESS_KEY_ID && !b.env.AGENT_TOKEN && !b.env.OPENCODE_CONFIG && b.env.OPENFOLK_KEEP === 'stays' && !!(b.env.PATH ?? b.env.Path));
    const perm = JSON.parse(b.env.OPENCODE_CONFIG_CONTENT ?? '{}').permission ?? {};
    check('OpenCode asks before edits and commands', perm.edit === 'ask' && perm.bash === 'ask', perm);
    for (const k of ['GEMINI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AGENT_TOKEN', 'OPENCODE_CONFIG', 'OPENFOLK_KEEP']) delete process.env[k];
    check('free model labeled', OPENCODE.modelLabel!('OpenCode/Big Pickle', 'opencode/big-pickle').startsWith('Big Pickle') && OPENCODE.modelLabel!('OpenCode/Big Pickle', 'opencode/big-pickle') !== 'Big Pickle');
    check('own provider without label', OPENCODE.modelLabel!('GPT 6', 'openai/gpt-6') === 'GPT 6');
    check('opencode is OpenCode, model id with slash', engineOf('opencode:opencode/big-pickle') === 'opencode' && engineModelId('opencode:opencode/big-pickle') === 'opencode/big-pickle' && ACP_AGENTS.opencode === OPENCODE);
}

// Keys of the machine settings: only in 'apikey' mode, each engine through its own way
{
    const machine = await import('./machine-settings.ts');
    const cursorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-agent-'));
    fs.mkdirSync(path.join(cursorDir, 'versions', '2026.10.01-e373342'), { recursive: true });
    process.env.CURSOR_AGENT_DIR = cursorDir;
    const agy = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-key-'));
    fs.mkdirSync(path.join(agy, '1.3.0'));
    process.env.ANTIGRAVITY_ACP_DIR = agy;
    process.env.COPILOT_BIN = 'copilot';
    for (const e of ['cursor', 'copilot', 'antigravity'] as const) machine.saveEngineKey(e, `key-${e}`);
    const cursor = ACP_AGENTS.cursor;
    check('stored keys stay unused with the subscription', !cursor.command().env.CURSOR_API_KEY && !COPILOT.command().env.COPILOT_GITHUB_TOKEN
        && !ANTIGRAVITY.command().env.GEMINI_API_KEY && ANTIGRAVITY.signIn === 'oauth-personal');
    machine.saveMachineSettings({ engineAuth: { cursor: 'apikey', copilot: 'apikey', antigravity: 'apikey' } });
    check('key mode: Cursor gets CURSOR_API_KEY', cursor.command().env.CURSOR_API_KEY === 'key-cursor');
    check('key mode: Copilot gets COPILOT_GITHUB_TOKEN', COPILOT.command().env.COPILOT_GITHUB_TOKEN === 'key-copilot');
    check('key mode: Antigravity signs in with the Gemini key', ANTIGRAVITY.command().env.GEMINI_API_KEY === 'key-antigravity' && ANTIGRAVITY.signIn === 'gemini-api-key'
        && await ANTIGRAVITY.signedIn!());
    machine.saveMachineSettings({ engineAuth: {} });
    for (const e of ['cursor', 'copilot', 'antigravity'] as const) machine.saveEngineKey(e, '');
    for (const d of [cursorDir, agy]) fs.rmSync(d, { recursive: true, force: true });
    delete process.env.CURSOR_AGENT_DIR;
    delete process.env.ANTIGRAVITY_ACP_DIR;
    delete process.env.COPILOT_BIN;
}

// Antigravity: version, start, login check
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-acp-'));
    for (const v of ['1.3.0', '1.10.0', '1.9.2', 'broken']) fs.mkdirSync(path.join(dir, v), { recursive: true });
    check('newest version numerically', antigravityVersion(dir)?.name === '1.10.0', antigravityVersion(dir));
    check('none without a folder', antigravityVersion(path.join(dir, 'nothing')) === null);
    process.env.ANTIGRAVITY_ACP_DIR = dir;
    process.env.GEMINI_API_KEY = 'secret';
    process.env.GH_TOKEN = 'stays';
    const b = ANTIGRAVITY.command();
    check('start from the newest version without arguments', b.args.length === 0 && b.command.includes('1.10.0') && /agy_acp_server/.test(b.command), b.command);
    check('Gemini API key removed, others stay', !b.env.GEMINI_API_KEY && b.env.GH_TOKEN === 'stays');
    delete process.env.ANTIGRAVITY_ACP_DIR;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GH_TOKEN;
    check('no models without installation', (await acpModels({ ...ANTIGRAVITY, command: () => { throw new Error('missing'); } })).length === 0);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-home-'));
    process.env.GEMINI_HOME = home;
    check('without credentials file not signed in', (await ANTIGRAVITY.signedIn!()) === false);
    fs.mkdirSync(path.join(home, 'antigravity-acp'));
    fs.writeFileSync(path.join(home, 'antigravity-acp', 'settings.json'), JSON.stringify({ auth: { type: 'oauth-personal' } }));
    check('settings without credentials not signed in', (await ANTIGRAVITY.signedIn!()) === false);
    fs.writeFileSync(path.join(home, 'antigravity-acp', 'oauth_creds.json'), '{}');
    check('signed in with credentials', (await ANTIGRAVITY.signedIn!()) === true);
    fs.writeFileSync(path.join(home, 'antigravity-acp', 'settings.json'), JSON.stringify({ auth: { type: 'gemini-api-key' } }));
    check('API key as sign-in does not count', (await ANTIGRAVITY.signedIn!()) === false);
    delete process.env.GEMINI_HOME;
    check('antigravity is Antigravity', engineOf('antigravity:g') === 'antigravity' && engineModelId('antigravity:g') === 'g' && ACP_AGENTS.antigravity === ANTIGRAVITY);
    check('model list checks the login beforehand', (await acpModels({ ...agent(), signedIn: async () => false }).catch((e: Error) => e.message)) === 'Test is not signed in.');
}

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
