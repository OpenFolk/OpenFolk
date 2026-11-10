// Tests for the Codex sessions from VS Code and the terminal (origin, text, history):  node local/src/codex-sessions.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from './remove-tree.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-codex-sessions-'));
const { codexEntries, codexOrigin, codexText } = await import('./codex-sessions.ts');
type CodexTurn = import('./codex-sessions.ts').CodexTurn;

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (actual ${JSON.stringify(detail)})`}`); if (!ok) failures++; };

// ---- Origin: only people in VS Code or the terminal
check('origin: VS Code extension', codexOrigin({ originator: 'codex_vscode', source: 'vscode' }) === 'vscode');
check('origin: CLI', codexOrigin({ originator: 'codex_cli_rs', source: 'cli' }) === 'terminal');
check('origin: OpenFolk\'s bots (app-server, source vscode) not', codexOrigin({ originator: 'openfolk', source: 'vscode' }) === null);
check('origin: earlier names of the app not', ['navobots', 'claude_bots', 'claude-bot'].every((o) => codexOrigin({ originator: o, source: 'vscode' }) === null));
check('origin: codex exec not', codexOrigin({ originator: 'codex_exec', source: 'exec' }) === null);

// ---- Text: the IDE context before the request goes
const ide = '# Context from my IDE setup:\n\n## Open tabs:\n- a.ts: src/a.ts\n\n## My request for Codex:\nBuild the list\n';
check('text: only the request after the IDE context', codexText(ide) === 'Build the list', codexText(ide));
check('text: the shorter heading too', codexText('# Context from my IDE setup:\n\n## My request:\nHi') === 'Hi');
check('text: a plain message stays', codexText('## My request:\nnot from the IDE') === '## My request:\nnot from the IDE');

// ---- History from the turns
const now = Math.floor(Date.now() / 1000);
const turns: CodexTurn[] = [
    { id: 't1', status: 'completed', startedAt: now - 100, items: [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: ide }] },
        { type: 'reasoning', id: 'r1' },
        { type: 'agentMessage', id: 'a1', text: 'Counting.' },
        { type: 'commandExecution', id: 'c1', command: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "ls"', status: 'completed', exitCode: 0, aggregatedOutput: 'a.ts' },
        { type: 'agentMessage', id: 'a2', text: 'There is **one**.' },
    ] },
    { id: 't2', status: 'interrupted', startedAt: now - 50, items: [
        { type: 'userMessage', id: 'u2', content: [{ type: 'text', text: 'And now?' }, { type: 'image', text: undefined }] },
        { type: 'fileChange', id: 'f1', status: 'failed', changes: [{ path: 'b.ts', diff: '+x' }] },
    ] },
    { id: 't3', status: 'inProgress', startedAt: now - 5, items: [
        { type: 'contextCompaction', id: 'k1' },
        { type: 'userMessage', id: 'u3', content: [{ type: 'text', text: 'Go on' }] },
        { type: 'commandExecution', id: 'c2', command: 'npm test', status: 'inProgress' },
    ] },
];
const { entries, working } = codexEntries(turns, now);
check('history: question, answer, question, answer, interruption, summary, question, answer',
    entries.map((e) => e.role).join() === 'user,assistant,user,assistant,event,event,user,assistant', entries.map((e) => e.role));
check('history: question without the IDE context', entries[0].text === 'Build the list' && entries[0].from === 'me');
check('history: texts and tool in one answer', entries[1].text === 'Counting.\n\nThere is **one**.' && entries[1].tools?.length === 1);
check('history: command with its result', entries[1].tools?.[0].ok === true && entries[1].tools?.[0].result === 'a.ts' && entries[1].tools?.[0].summary === 'ls', entries[1].tools?.[0]);
check('history: image noted', entries[2].text === 'And now?\n\n🖼 one image', entries[2].text);
check('history: failed change', entries[3].tools?.[0].name === 'Edit' && entries[3].tools?.[0].ok === false);
check('history: running tool without a result', entries[7].tools?.[0].ok === undefined && entries[7].tools?.[0].result === undefined);
check('history: a turn in progress is working', working);
check('history: an abandoned turn is not', !codexEntries(turns, now - 3600).working);
check('history: a finished thread is not', !codexEntries(turns.slice(0, 2), now).working);

removeTree(process.env.DATA_DIR!);
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
