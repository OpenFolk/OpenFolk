// Tests for open approval cards that end without a tap:  node local/src/approval-close.test.ts
// A new message of the user in the same chat closes the cards (the bot is told nothing happened and to stop), but not
// in a group; a card nobody answers within 30 minutes ends as expired, which the web app keeps visible.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-approval-close-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-approval-close-data-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-approval-close-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = root;
const { BotManager } = await import('./agent.ts');
const { removeTree } = await import('./remove-tree.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

type Result = { behavior: string; message?: string };
type Inner = {
    handle: (f: unknown, cid: string) => void;
    updateAgents: (o: string[]) => void;
    approval: (s: unknown, turn: unknown, tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<Result>;
};
const frames: { type: string; [k: string]: unknown }[] = [];
const m = new BotManager((f) => { frames.push(f as { type: string }); }) as unknown as Inner;
m.updateAgents(['workstation']);

// No bot behind the chats: the message stops after closing the cards, before a session would start
const session = (id: string) => ({ bot: { id, name: id, approval: 'risky', folder: root.replace(/\\/g, '/') }, state: 'thinking', setState() {} });
const ask = (chatId: string) => m.approval(session(chatId.replace(/^g:/, '')), { chatId }, 'Bash', { command: 'rm -rf build' }, new AbortController().signal);
const settled = (p: Promise<Result>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 200))]);

// ---- a new message in the same chat
const asked = ask('ghost');
const card = frames.find((f) => f.type === 'approval');
check('the card goes out', card !== undefined);
frames.length = 0;
m.handle({ type: 'send', chatId: 'ghost', text: 'Leave the build folder, do the docs first.' }, 'c1');
const result = await settled(asked);
check('a new message denies the request', result?.behavior === 'deny', result);
check('… and tells the bot to stop and wait for the message', /new message/.test(result?.message ?? '') && /end this turn/.test(result?.message ?? ''), result?.message);
const done = frames.find((f) => f.type === 'approval_done');
check('the card closes, not as expired', done !== undefined && !done.expired && /new message/.test(String(done.result)), done);

// ---- a group: the message may be for another member
const inGroup = ask('g:team');
frames.length = 0;
m.handle({ type: 'send', chatId: 'g:team', text: '@Other please look at it' }, 'c1');
check('a message in a group leaves the card open', (await settled(inGroup)) === null && !frames.some((f) => f.type === 'approval_done'), frames.map((f) => f.type));

// ---- nobody answers within 30 minutes
const realTimeout = globalThis.setTimeout;
let expire: (() => void) | undefined;
globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    if (ms === 30 * 60_000) expire = fn;
    return realTimeout(() => undefined, 0);
}) as typeof setTimeout;
const late = ask('late');
globalThis.setTimeout = realTimeout;
frames.length = 0;
expire?.();
const lateResult = await settled(late);
const expired = frames.find((f) => f.type === 'approval_done');
check('no answer in time: denied', lateResult?.behavior === 'deny', lateResult);
check('… and marked as expired, saying nothing happened', expired?.expired === true && /nothing happened/.test(String(expired.result)), expired);

try { removeTree(root); removeTree(process.env.DATA_DIR!); removeTree(process.env.CLAUDE_CONFIG_DIR!); } catch { /* left for the system's temp cleanup */ }
if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
