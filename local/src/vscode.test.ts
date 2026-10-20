// Tests for the VS Code sessions (list, transcript, following live):  node local/src/vscode.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from './remove-tree.ts';

process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-vscode-'));
const { Watcher, Transcript, workingFrom, clean, originFrom, projectDir, listVscodeSessions, transcriptStoreError, transcriptPath } = await import('./vscode.ts');
type HistoryPart = import('./vscode.ts').HistoryPart;

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };

// Resolved like the SDK's listSessions does; a temp folder under an 8.3 short name (CI runners) would differ
const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-project-')));
const VS = { entrypoint: 'claude-vscode', promptSource: 'sdk', turnOrigin: 'human', cwd: folder };
let n = 0;
const ts = () => new Date(Date.UTC(2026, 9, 8, 10, 0, n++)).toISOString();
const user = (text: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', uuid: `u${n}`, timestamp: ts(), ...VS, message: { role: 'user', content: text }, ...extra });
const answer = (content: unknown[], stop: string | null, extra: Record<string, unknown> = {}) => ({ type: 'assistant', uuid: `a${n}`, timestamp: ts(), ...VS, message: { role: 'assistant', content, stop_reason: stop }, ...extra });
const result = (id: string, text: string, isError = false) => user([{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }]);

// ---- clean
check('clean: system-reminder and IDE additions removed', clean('<ide_opened_file>File a.ts</ide_opened_file>Hello<system-reminder>x</system-reminder>') === 'Hello');
check('clean: command as /name args', clean('<command-message>m</command-message>\n<command-name>/model</command-name>\n<command-args>opus</command-args>') === '/model opus');
check('clean: output of local commands empty', clean('<local-command-stdout>Set model</local-command-stdout>') === '');
check('clean: pasted text without markers', clean('<pasted_content id="1a">\nText\n</pasted_content> too') === 'Text\n too');
check('clean: shell input', clean('<bash-input>git status</bash-input>') === '! git status');

// ---- Origin
check('origin: VS Code', originFrom([{ type: 'attachment' }, user('hi')]) === 'vscode');
check('origin: bot with inherited claude-vscode', originFrom([user('hi', { turnOrigin: 'sdk', promptSource: 'sdk' })]) === null);
check('origin: terminal', originFrom([user('hi', { entrypoint: 'cli' })]) === 'terminal');
check('origin: older VS Code session without details', originFrom([user('hi', { promptSource: undefined, turnOrigin: undefined })]) === 'vscode');
check('origin: older bot without turnOrigin', originFrom([user('hi', { entrypoint: 'sdk-ts', turnOrigin: undefined })]) === null);
check('origin: meta message does not count', originFrom([user('x', { isMeta: true, turnOrigin: 'sdk' }), user('hi')]) === 'vscode');
check('origin: no message yet', originFrom([{ type: 'queue-operation' }]) === undefined);

// ---- Transcript
const lines = [
    { type: 'queue-operation', operation: 'enqueue' },
    user('<ide_opened_file>x</ide_opened_file>Count the files'),
    answer([{ type: 'thinking', thinking: '' }], null),
    answer([{ type: 'text', text: 'Counting.' }], null),
    answer([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls | wc -l', description: 'Count files' } }], 'tool_use'),
    result('t1', '22'),
    answer([{ type: 'text', text: 'There are **22**.' }], 'end_turn'),
    user('An image', { isMeta: true }),
    user([{ type: 'text', text: 'And here?' }, { type: 'image', source: {} }]),
    answer([{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:/a.ts' } }], 'tool_use'),
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Subagent' }], stop_reason: 'end_turn' } },
];
const t = new Transcript();
for (const z of lines) t.line(z);
const e = t.entries;
check('transcript: 4 entries (question, answer, question, answer)', e.length === 4 && e.map((x) => x.role).join() === 'user,assistant,user,assistant');
check('transcript: IDE addition removed', e[0].text === 'Count the files' && e[0].from === 'me');
check('transcript: text and tool in one answer', e[1].text === 'Counting.\n\nThere are **22**.' && e[1].tools?.length === 1);
check('transcript: tool with result', e[1].tools?.[0].summary === 'Count files' && e[1].tools?.[0].ok === true && e[1].tools?.[0].result === '22');
check('transcript: image noted, meta skipped', e[2].text === 'And here?\n\n🖼 one image');
check('transcript: subagent skipped, tool running', e[3].text === '' && e[3].tools?.[0].ok === undefined && t.working);
check('transcript: result reports the answer\'s index', t.line(result('t2', 'content', true)) === 3 && e[3].tools?.[0].ok === false);
check('transcript: end of the turn', t.line(answer([{ type: 'text', text: 'Done.' }], 'end_turn')) === 3 && !t.working);
check('transcript: interruption as a note', t.line(user([{ type: 'text', text: '[Request interrupted by user]' }])) === 4 && e[4].role === 'event' && !t.working);

check('workingFrom: tool open', workingFrom([user('a'), answer([{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }], 'tool_use')]));
check('workingFrom: done', !workingFrom([user('a'), answer([{ type: 'text', text: 'x' }], 'end_turn'), answer([], null)]));
check('workingFrom: question asked', workingFrom([answer([{ type: 'text', text: 'x' }], 'end_turn'), user('new')]));

// ---- List
const project = projectDir(folder);
fs.mkdirSync(project, { recursive: true });
const jsonl = (zs: unknown[]) => zs.map((z) => JSON.stringify(z)).join('\n') + '\n';
const ID_VS = '11111111-1111-4111-8111-111111111111';
const ID_BOT = '22222222-2222-4222-8222-222222222222';
const ID_INHERITED = '33333333-3333-4333-8333-333333333333';
const withId = (id: string, zs: Record<string, unknown>[]) => zs.map((z) => ({ ...z, sessionId: id }));
fs.writeFileSync(transcriptPath(folder, ID_VS), jsonl(withId(ID_VS, [user('Build the list'), answer([{ type: 'text', text: 'Sure.' }], 'end_turn'), { type: 'ai-title', aiTitle: 'Build list', sessionId: ID_VS }])));
fs.writeFileSync(transcriptPath(folder, ID_BOT), jsonl(withId(ID_BOT, [user('Bot job', { entrypoint: 'sdk-ts', turnOrigin: 'sdk', promptSource: 'sdk' })])));
fs.writeFileSync(transcriptPath(folder, ID_INHERITED), jsonl(withId(ID_INHERITED, [user('Bot from VS Code terminal', { turnOrigin: 'sdk', promptSource: 'sdk' })])));
const list = await listVscodeSessions(folder, new Set());
check('list: only the real VS Code session', list.length === 1 && list[0].id === ID_VS);
check('list: title, first message, origin, done', list[0]?.title === 'Build list' && list[0]?.firstPrompt === 'Build the list' && list[0]?.origin === 'vscode' && !list[0]?.working);
check('list: bots\' sessions excluded', (await listVscodeSessions(folder, new Set([ID_VS]))).length === 0);
let invalid = false;
try { transcriptPath(folder, '../../secret'); } catch { invalid = true; }
check('transcriptPath: only UUIDs', invalid);

// ---- Subfolders: sessions from `claude` in a subfolder belong to it, unless another bot covers it more precisely
const sub = path.join(folder, 'backend');
const otherBot = path.join(folder, 'other');
const neighbour = folder + '-old'; // same beginning of the project name, but not a subfolder
const ID_SUB = '44444444-4444-4444-8444-444444444444';
const ID_OTHER = '55555555-5555-4555-8555-555555555555';
const ID_NEIGHBOUR = '66666666-6666-4666-8666-666666666666';
for (const [cwd, id, text] of [[sub, ID_SUB, 'In the backend'], [otherBot, ID_OTHER, 'With the other bot'], [neighbour, ID_NEIGHBOUR, 'Neighbour']] as const) {
    fs.mkdirSync(projectDir(cwd), { recursive: true });
    fs.writeFileSync(transcriptPath(cwd, id), jsonl(withId(id, [user(text, { entrypoint: 'cli', cwd }), answer([{ type: 'text', text: 'ok' }], 'end_turn', { cwd })])));
}
const withSub = await listVscodeSessions(folder, new Set(), [folder, otherBot]);
const subEntry = withSub.find((s) => s.id === ID_SUB);
check('subfolder: session from the subfolder included, with folder and origin terminal',
    subEntry?.folder === sub.replace(/\\/g, '/') && subEntry?.origin === 'terminal');
check('subfolder: session in the bot folder without folder', withSub.find((s) => s.id === ID_VS)?.folder === undefined);
check('subfolder: folder of another bot and neighbour folder not', !withSub.some((s) => s.id === ID_OTHER || s.id === ID_NEIGHBOUR));

// ---- Following live
const parts: { part: HistoryPart; cid: string }[] = [];
const m = new Watcher((part, cid) => parts.push({ part, cid }));
const file = transcriptPath(folder, ID_VS);
m.openFor('c1', file, ID_VS);
check('watch: everything from 0 on open', parts.length === 1 && parts[0].part.from === 0 && parts[0].part.entries.length === 2);
m.openFor('c2', file, ID_VS);
check('watch: second browser gets the same state', parts.length === 2 && parts[1].cid === 'c2');
// half line: report nothing yet, only once it is complete
const newLine = JSON.stringify(user('One more question'));
fs.appendFileSync(file, newLine.slice(0, 20));
await new Promise((r) => setTimeout(r, 1600));
check('watch: cut line waits', parts.length === 2);
fs.appendFileSync(file, newLine.slice(20) + '\n');
await new Promise((r) => setTimeout(r, 1600));
const fresh = parts.slice(2);
check('watch: new message to both browsers', fresh.length === 2 && fresh.every((x) => x.part.from === 2 && x.part.entries.length === 1 && x.part.entries[0].text === 'One more question' && x.part.working));
m.close('c1');
fs.appendFileSync(file, JSON.stringify(answer([{ type: 'text', text: 'Answer' }], 'end_turn')) + '\n');
await new Promise((r) => setTimeout(r, 1600));
const after = parts.slice(4);
check('watch: closed browser gets nothing more', after.length === 1 && after[0].cid === 'c2' && after[0].part.from === 3 && !after[0].part.working);
m.close('c2', ID_VS);
check('last: entries from the file', Watcher.last(file, 2).map((x) => x.text).join('|') === 'One more question|Answer');

// ---- Branch off: new file with the history, the original stays unchanged
const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
const before = fs.readFileSync(file, 'utf8');
const { sessionId: branch } = await forkSession(ID_VS, { dir: folder, title: 'Test (OpenFolk)' });
const branchFile = transcriptPath(folder, branch);
check('branch: new session id with its own file', branch !== ID_VS && fs.existsSync(branchFile));
check('branch: history copied', Watcher.last(branchFile, 10).map((x) => x.text).join('|') === 'Build the list|Sure.|One more question|Answer');
check('branch: original unchanged', fs.readFileSync(file, 'utf8') === before);

// ---- Transcript store: link to a drive that is not mounted
const realStore = process.env.CLAUDE_CONFIG_DIR!;
check('store: normal folder is fine', transcriptStoreError() === null);
const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-store-'));
process.env.CLAUDE_CONFIG_DIR = home2;
check('store: missing folder is fine', transcriptStoreError() === null);
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-drive-'));
fs.symlinkSync(target, path.join(home2, 'projects'), 'junction');
check('store: reachable link is fine', transcriptStoreError() === null);
removeTree(target);
check('store: dangling link is reported', transcriptStoreError()?.includes('not reachable') === true);
process.env.CLAUDE_CONFIG_DIR = realStore;
removeTree(home2);

removeTree(process.env.CLAUDE_CONFIG_DIR!);
removeTree(folder);
removeTree(neighbour);
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
