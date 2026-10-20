// Tests for the Codex connection (without a Codex process, notifications rebuilt):  node local/src/codex.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-codex-'));
const { CodexRun, claudeInstructions, codexInput, withoutShell } = await import('./codex.ts');
const { BotSession, newTurn } = await import('./session.ts');
const { needsApproval } = await import('./policy.ts');
const { codexModelId, engineOf } = await import('../../shared/protocol.ts');
type EngineTarget = import('./codex.ts').EngineTarget;
type ToolCall = import('../../shared/protocol.ts').ToolCall;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

// Engine from the model
check('codex is Codex', engineOf('codex') === 'codex' && codexModelId('codex') === undefined);
check('codex:<id> is Codex with a model', engineOf('codex:gpt-6-sol') === 'codex' && codexModelId('codex:gpt-6-sol') === 'gpt-6-sol');
check('opus and default are Claude', engineOf('opus') === 'claude' && engineOf('default') === 'claude' && engineOf(undefined) === 'claude');

// Commands without the shell around them
check('PowerShell wrapper removed', withoutShell(`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Set-Content -LiteralPath 'number.txt' -Value '4711'"`) === `Set-Content -LiteralPath 'number.txt' -Value '4711'`);
check('PowerShell with -NoProfile', withoutShell(`"C:\\x\\powershell.exe" -NoProfile -Command "Get-Content a.txt"`) === 'Get-Content a.txt');
check('bash -lc', withoutShell(`/bin/bash -lc 'ls -la'`) === 'ls -la');
check('Git Bash with a space in the path', withoutShell(`"C:\\Program Files\\Git\\usr\\bin\\bash.exe" -lc 'rm -f a.tmp'`) === 'rm -f a.tmp');
check('other command stays', withoutShell('git status') === 'git status');

// Input: text and images, PDFs only via the path in the text
{
    const e = codexInput([
        { type: 'text', text: 'See attachment' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'x' }, title: 'a.pdf' },
    ]);
    check('text, image, no PDF', e.length === 2 && e[0].type === 'text' && e[1].type === 'image' && e[1].url === 'data:image/png;base64,QUJD', e);
    check('string becomes text', codexInput('hello')[0].text === 'hello');
}

// CLAUDE.md as in Claude Code: global, per folder from top to bottom, with @ includes
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-'));
    const home = path.join(root, 'home');
    const project = path.join(root, 'www', 'project');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'GLOBAL');
    fs.writeFileSync(path.join(root, 'www', 'CLAUDE.md'), 'TOP\n@rules.md\n```\n@not.md\n```\n@missing.md');
    fs.writeFileSync(path.join(root, 'www', 'rules.md'), 'RULES\n@../www/CLAUDE.md');
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'PROJECT');
    const a = claudeInstructions(project, path.join(home, '.claude'));
    const pos = (x: string) => a.indexOf(x);
    check('order global, top, project', pos('GLOBAL') >= 0 && pos('GLOBAL') < pos('TOP') && pos('TOP') < pos('PROJECT'), a);
    check('@rules.md included', a.includes('RULES') && !a.includes('@rules.md'));
    check('cycle stops, code block and missing file stay', a.includes('@../www/CLAUDE.md') && a.includes('@not.md') && a.includes('@missing.md'));
    const beside = claudeInstructions(path.join(root, 'empty'), path.join(root, 'nobody', '.claude'));
    check('neighbour folder not included', !/GLOBAL|TOP|PROJECT/.test(beside), beside);
}

// Approval for a Codex patch over several files
{
    const folder = path.resolve('C:/www/project');
    const inside = needsApproval('risky', 'Write', { files: [path.join(folder, 'a.ts'), path.join(folder, 'b.ts')] }, folder);
    const outside = needsApproval('risky', 'Write', { files: [path.join(folder, 'a.ts'), path.resolve('C:/www/other/b.ts')] }, folder);
    const env = needsApproval('risky', 'Write', { files: [path.join(folder, '.env')] }, folder);
    check('patch inside the folder without a question', !inside.ask);
    check('one file outside is enough to ask', outside.ask && outside.reason === 'writes outside the bot folder', outside);
    check('.env in the patch asks', env.ask && env.reason === 'sensitive file');
}

// CodexRun: map notifications and requests of the app-server onto the session
type Inner = { notification(m: string, p: Record<string, unknown>): void; request(m: string, p: Record<string, unknown>, id: number): Promise<unknown>; thread: string; turnId: string | null; tools: Map<string, unknown> };
const log: string[] = [];
const tools: ToolCall[] = [];
const approvals: { tool: string; input: Record<string, unknown> }[] = [];
let approvalAnswer: Record<string, unknown> = { behavior: 'allow', updatedInput: {} };
const target: EngineTarget = {
    threadId: (id) => log.push(`thread ${id}`), account: () => undefined, limits: () => undefined, notice: (x) => log.push(`notice ${x}`),
    textStarts: () => log.push('text'), delta: (x) => log.push(`delta ${x}`),
    tool: (c) => tools.push(c), toolResult: (id, ok, r) => log.push(`result ${id} ${ok} ${r}`), context: (n) => log.push(`context ${n}`),
    done: (f) => log.push(`done ${f ?? ''}`),
    approval: async (tool, input) => { approvals.push({ tool, input }); return approvalAnswer as never; },
};
const run = new CodexRun(target);
const l = run as unknown as Inner;
l.thread = 't1';
l.turnId = 'u1';
l.tools = new Map([['remember_note', { name: 'remember_note', description: '', schema: {}, run: async (a: Record<string, unknown>) => ({ text: `noted: ${a.note}` }) }]]);

l.notification('item/started', { threadId: 't1', item: { type: 'agentMessage', id: 'm1' } });
l.notification('item/agentMessage/delta', { threadId: 't1', delta: 'Hello' });
l.notification('item/agentMessage/delta', { threadId: 'other', delta: 'foreign' });
check('text and foreign thread', log.join('|') === 'text|delta Hello', log);

l.notification('item/started', { threadId: 't1', item: { type: 'commandExecution', id: 'c1', command: `"C:\\x\\powershell.exe" -Command "git status"` } });
check('command as a tool', tools.at(-1)?.name === 'PowerShell' && tools.at(-1)?.summary === 'git status', tools.at(-1));
l.notification('item/completed', { threadId: 't1', item: { type: 'commandExecution', id: 'c1', status: 'completed', exitCode: 1, aggregatedOutput: 'fatal' } });
check('exit code 1 is an error', log.at(-1) === 'result c1 false fatal', log.at(-1));

{
    approvalAnswer = { behavior: 'allow', updatedInput: {}, updatedPermissions: [{}] };
    const r = await l.request('item/commandExecution/requestApproval', { itemId: 'c2', command: `"C:\\x\\powershell.exe" -Command "Remove-Item a.txt"`, reason: 'clean up' }, 1) as { decision: string };
    check('command approval "always" becomes acceptForSession', r.decision === 'acceptForSession' && approvals.at(-1)?.input.command === 'Remove-Item a.txt', { r, f: approvals.at(-1) });
    approvalAnswer = { behavior: 'deny', message: 'no' };
    const r2 = await l.request('item/commandExecution/requestApproval', { itemId: 'c3', command: 'rm -rf x' }, 2) as { decision: string };
    check('rejection becomes decline', r2.decision === 'decline');
}

{
    l.notification('item/started', { threadId: 't1', item: { type: 'fileChange', id: 'f1', changes: [{ path: 'C:/p/a.ts', diff: '+x' }, { path: 'C:/p/b.ts', diff: '-y' }] } });
    check('patch as Edit', tools.at(-1)?.name === 'Edit' && !!tools.at(-1)?.summary.includes('a.ts'), tools.at(-1));
    approvalAnswer = { behavior: 'allow', updatedInput: {} };
    const r = await l.request('item/fileChange/requestApproval', { itemId: 'f1' }, 3) as { decision: string };
    const f = approvals.at(-1)!;
    check('patch approval with all files', r.decision === 'accept' && f.tool === 'Write' && JSON.stringify(f.input.files) === '["C:/p/a.ts","C:/p/b.ts"]' && String(f.input.content).includes('+x'), f);
}

{
    const r = await l.request('item/tool/call', { tool: 'remember_note', arguments: { note: 'Tea' } }, 4) as { success: boolean; contentItems: { text: string }[] };
    check('tool of the backend', r.success && r.contentItems[0].text === 'noted: Tea', r);
    const r2 = await l.request('item/tool/call', { tool: 'doesnotexist', arguments: {} }, 5) as { success: boolean };
    check('unknown tool', r2.success === false);
    approvalAnswer = { behavior: 'allow', updatedInput: { answers: { 'Tea or coffee?': 'Tea' } } };
    const r3 = await l.request('item/tool/call', { tool: 'AskUserQuestion', arguments: { questions: [{ question: 'Tea or coffee?', header: 'Drink', options: [] }] } }, 6) as { contentItems: { text: string }[] };
    check('question via the approval card', approvals.at(-1)?.tool === 'AskUserQuestion' && r3.contentItems[0].text.includes('Tea'), r3);
    const r4 = await l.request('item/tool/requestUserInput', { questions: [{ id: 'q1', header: 'D', question: 'Tea or coffee?', options: [{ label: 'Tea', description: '' }] }] }, 7) as { answers: Record<string, { answers: string[] }> };
    check('request_user_input', r4.answers.q1.answers[0] === 'Tea', r4);
    let thrown = false;
    await l.request('item/permissions/requestApproval', {}, 8).catch(() => { thrown = true; });
    check('unknown request becomes an error', thrown);
}

l.notification('thread/tokenUsage/updated', { threadId: 't1', tokenUsage: { last: { inputTokens: 17000 } } });
check('context from tokenUsage', log.at(-1) === 'context 17000');
l.notification('turn/completed', { threadId: 't1', turn: { id: 'other', status: 'completed', error: null } });
check('foreign turn ends nothing', !log.at(-1)?.startsWith('done'));
l.notification('turn/completed', { threadId: 't1', turn: { id: 'u1', status: 'interrupted', error: null } });
check('interrupted', log.at(-1) === 'done Interrupted', log.at(-1));
l.turnId = 'u2';
l.notification('error', { threadId: 't1', willRetry: false, error: { message: 'Limit reached' } });
l.notification('turn/completed', { threadId: 't1', turn: { id: 'u2', status: 'failed', error: null } });
check('error message from error', log.at(-1) === 'done Limit reached', log.at(-1));

// BotSession: switching between Claude and Codex
{
    const bot = { id: 'b', name: 'B', role: '', folder: '.', model: 'opus', tone: '', avatar: '', approval: 'never', machine: '', sessionId: 'abc-claude', createdAt: '', updatedAt: '' };
    const context: number[] = [];
    const none = () => undefined;
    const hooks = { background: none, context: (_s: unknown, n: number) => context.push(n), started: none, discarded: none, delta: none, tool: none, toolResult: none, done: none, state: none, error: none, account: none, usage: none, approval: none, tools: none, engineTools: () => [], codexLimits: none };
    const s = new BotSession(bot as never, hooks as never);
    check('Claude stays Claude', (await s.switchModel()) === false && s.engine === 'claude');
    bot.model = 'codex';
    check('switch to Codex detected', s.engine === 'codex' && (await s.switchModel()) === true && context.at(-1) === 0);
    const i = s as unknown as { engineStart(m: string): { threadId?: string; model?: string; instructions: string } };
    check('Claude session is not continued as a Codex thread', i.engineStart('codex').threadId === undefined);
    bot.sessionId = 'codex:t-9';
    bot.model = 'codex:gpt-6-sol';
    const st = i.engineStart('codex');
    check('Codex thread and model', st.threadId === 't-9' && st.model === 'gpt-6-sol' && st.instructions.includes('You are "B"'), st);
    check('Codex stays Codex', (await s.switchModel()) === false);
    const opt = (s as unknown as { options(): { resume?: string } });
    bot.model = 'opus';
    check('Codex thread is not given to Claude', opt.options().resume === undefined);
    void newTurn;
}

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
