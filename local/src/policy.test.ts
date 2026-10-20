// Tests for the approval rules:  node local/src/policy.test.ts
import path from 'node:path';

const { needsApproval, secretRead } = await import('./policy.ts');
const { acpTool } = await import('./acp.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const folder = path.resolve('C:/www/project');

// Secrets are refused to reading tools in every approval level, without a question
for (const level of ['never', 'risky', 'write'] as const) {
    const d = needsApproval(level, 'Read', { file_path: path.join(folder, '.env') }, folder);
    check(`${level}: Read .env refused`, d.deny === true && !d.ask, d);
}
check('Read .env.local refused', !!secretRead('Read', { file_path: 'C:/x/.env.local' }));
check('Read a key refused', !!secretRead('Read', { file_path: 'C:/x/server.pem' }));
check('Grep in a .env refused', !!secretRead('Grep', { pattern: 'TOKEN', path: 'C:/x/.env' }));
check('Grep with a glob on .env* refused', !!secretRead('Grep', { pattern: 'TOKEN', glob: '**/.env*' }));
check('Glob for keys refused', !!secretRead('Glob', { pattern: '**/*.pem' }));
check('templates readable (.env.sample, .env.example)', !secretRead('Read', { file_path: 'C:/x/.env.sample' }) && !secretRead('Read', { file_path: 'C:/x/relay/.env.example' }));
check('Read README free', !secretRead('Read', { file_path: 'C:/x/README.md' }) && !needsApproval('risky', 'Read', { file_path: 'C:/x/README.md' }, folder).ask);
check('Grep for the word env free', !secretRead('Grep', { pattern: '\\.env', path: folder }));
check('Write .env asks, not refused', needsApproval('risky', 'Write', { file_path: path.join(folder, '.env') }, folder).ask
    && !needsApproval('risky', 'Write', { file_path: path.join(folder, '.env') }, folder).deny);

// Existing rules stay
check('risky: rm -rf asks', needsApproval('risky', 'Bash', { command: 'rm -rf build' }, folder).ask);
check('risky: git status free', !needsApproval('risky', 'Bash', { command: 'git status' }, folder).ask);
check('risky: write outside the folder asks', needsApproval('risky', 'Write', { file_path: path.join(folder, '..', 'other', 'a.ts') }, folder).ask);
check('write: every Bash asks', needsApproval('write', 'Bash', { command: 'ls' }, folder).ask);
check('never: nothing asks', !needsApproval('never', 'Bash', { command: 'rm -rf /' }, folder).ask);
check('risky: reading MCP tool free', !needsApproval('risky', 'mcp__github__list_issues', {}, folder).ask);
check('risky: writing MCP tool asks', needsApproval('risky', 'mcp__github__create_issue', {}, folder).ask);
check('own tools free', !needsApproval('write', 'mcp__openfolk__send_file', {}, folder).ask);

// ACP: unknown kinds are named after free text and ask; own tools only by name and without a concrete kind
const listing = acpTool({ toolCallId: 'a', title: 'list and delete old branches', kind: 'other' })!;
check('ACP unknown kind with a "list" title asks', listing.name.startsWith('mcp__acp__') && needsApproval('risky', listing.name, listing.input, folder).ask, listing.name);
const shell = acpTool({ toolCallId: 'b', title: 'Run send_file.sh', kind: 'execute', rawInput: { command: './send_file.sh' } }, ['send_file'])!;
check('ACP shell command mentioning an own tool stays a shell command', shell.name !== 'mcp__openfolk__send_file', shell.name);
const edit = acpTool({ toolCallId: 'c', title: 'openfolk: send_file', kind: 'edit', locations: [{ path: 'C:/www/project/a.ts' }] }, ['send_file'])!;
check('ACP edit titled like an own tool stays an edit', edit.name === 'Write', edit.name);
const mention = acpTool({ toolCallId: 'd', title: 'Tell me about send_file', kind: 'other' }, ['send_file'])!;
check('ACP title only mentioning an own tool is not one', mention.name !== 'mcp__openfolk__send_file', mention.name);
check('ACP own tool by title "openfolk: name"', acpTool({ toolCallId: 'e', title: 'openfolk: send_file', kind: 'other' }, ['send_file'])!.name === 'mcp__openfolk__send_file');
check('ACP own tool by exact name', acpTool({ toolCallId: 'f', name: 'remember_fact', title: 'Remember', kind: 'other' }, ['remember_fact'])!.name === 'mcp__openfolk__remember_fact');

if (failures) process.exit(1);
console.log('all tests passed');
