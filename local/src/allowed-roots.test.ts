// A bot's folder is checked against ALLOWED_ROOTS of the machine that runs the job, every time: bots arrive by sync
// from machines that may allow more.  node local/src/allowed-roots.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from './remove-tree.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-roots-'));
process.env.ALLOWED_ROOTS = repo;
const bots = await import('./bots.ts');
const { BotManager } = await import('./agent.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const base = { role: '', model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const inside = bots.saveBot({ ...base, id: 'inside', name: 'Inside', folder: path.join(repo, 'docs') });
// What sync writes for a bot created on a machine with wider roots (sync.ts saves without checkFolder)
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-elsewhere-'));
bots.saveBots([...bots.loadBots(), { ...inside, id: 'synced', name: 'Synced', folder: elsewhere.replace(/\\/g, '/') }]);

type Inner = {
    session: (bot: { id: string }, chatId: string) => { send: (turn: unknown) => void };
    startTurn: (bot: unknown, spec: { chatId: string; from: string; text: string; content: string }, onDone?: (e: { error?: string }) => void) => void;
    peerInbound: (from: string, data: unknown) => void;
};
const sent: { type: string; message?: string; botId?: string }[] = [];
const peers: { kind: string; result?: { error?: string } }[] = [];
const m = new BotManager((f) => { sent.push(f as never); }, (d) => { peers.push(d as never); }) as unknown as Inner;
const started: string[] = [];
m.session = (bot) => ({ send: () => { started.push(bot.id); } });
const turn = (chatId: string) => ({ chatId, from: 'me', text: 'hello', content: 'hello' });

let result: { error?: string } | undefined;
m.startTurn(bots.findBot('inside'), turn('inside'), (e) => { result = e; });
check('folder under ALLOWED_ROOTS: session started', started.includes('inside') && result === undefined, started);

m.startTurn(bots.findBot('synced'), turn('synced'), (e) => { result = e; });
check('synced folder outside ALLOWED_ROOTS: no session', !started.includes('synced'), started);
check('the job ends with an error', !!result?.error?.includes(elsewhere.replace(/\\/g, '/')), result);
check('the chat shows the error', sent.some((f) => f.type === 'error' && f.botId === 'synced'), sent);

m.peerInbound('other', { kind: 'job', id: 'j1', botId: 'synced', turn: { ...turn('synced'), chain: [], hop: 0 }, reply: true });
const done = peers.find((p) => p.kind === 'job_done');
check('job from another machine: refused, answered with the error', !started.includes('synced') && !!done?.result?.error, peers);

// A junction inside the allowed root that leads out of it counts as outside
const link = path.join(repo, `.openfolk-roots-link-${process.pid}`);
try {
    fs.symlinkSync(elsewhere, link, 'junction');
    bots.saveBots([...bots.loadBots(), { ...inside, id: 'linked', name: 'Linked', folder: link.replace(/\\/g, '/') }]);
    m.startTurn(bots.findBot('linked'), turn('linked'));
    check('folder that is a link out of ALLOWED_ROOTS: no session', !started.includes('linked'), started);
} finally {
    removeTree(link);
    removeTree(elsewhere);
}

if (failures) process.exit(1);
console.log('all tests passed');
process.exit(0);
