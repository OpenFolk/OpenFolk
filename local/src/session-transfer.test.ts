// Tests for the session transfer when a bot changes machines:  node local/src/session-transfer.test.ts
// One backend plays both sides: as the previous machine it sends the transcripts, as the new one it puts them together.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-transfer-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-transfer-claude-'));
process.env.MACHINE_NAME = 'workstation';
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const { CHUNK_BYTES, TransferReceiver, pendingTransfers, transferParts } = await import('./session-transfer.ts');
const { transcriptPath } = await import('./vscode.ts');
const { BotManager } = await import('./agent.ts');
type PeerData = import('../../shared/protocol.ts').PeerData;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const folder = path.resolve(import.meta.dirname, '..', '..');
const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: 'workstation' };
const bot = bots.saveBot({ ...base, id: 'helper', name: 'Helper' });
const chatC = bots.createConversation('helper');
const ID_MAIN = '11111111-1111-4111-8111-111111111111';
const ID_C = '22222222-2222-4222-8222-222222222222';
// Main chat larger than one chunk, conversation small
const large = Buffer.from(Array.from({ length: 30000 }, (_, i) => JSON.stringify({ type: 'user', i, text: 'x'.repeat(60) })).join('\n') + '\n');
fs.mkdirSync(path.dirname(transcriptPath(folder, ID_MAIN)), { recursive: true });
fs.writeFileSync(transcriptPath(folder, ID_MAIN), large);
fs.writeFileSync(transcriptPath(folder, ID_C), '{"type":"user"}\n');
bots.setSessionId('helper', ID_MAIN);
bots.setSessionId(chatC, ID_C);

// ---- Chunking and putting together
const parts = transferParts('helper', folder, folder, 'helper', ID_MAIN);
check('several chunks for more than 1 MB', parts.length === Math.ceil(large.length / CHUNK_BYTES) && parts.length > 1, parts.length);
check('no chunks without a transcript', transferParts('helper', folder, folder, 'helper', '33333333-3333-4333-8333-333333333333').length === 0);
const e = new TransferReceiver();
fs.rmSync(transcriptPath(folder, ID_MAIN));
const results = parts.toReversed().map((x) => e.chunk(x));
check('done only with the last missing chunk, order does not matter', results.slice(0, -1).every((x) => x === null) && results.at(-1) === transcriptPath(folder, ID_MAIN));
check('file byte-identical', fs.readFileSync(transcriptPath(folder, ID_MAIN)).equals(large));
let rejected = false;
try { e.chunk({ ...parts[0], part: 99 }); } catch { rejected = true; }
check('invalid chunk rejected', rejected);

// ---- Previous machine: a switch to a sleeping target is scheduled, sent on wake-up
const sent: { d: PeerData; to?: string }[] = [];
type Inner = {
    handle: (f: unknown, cid: string) => void;
    peerInbound: (from: string, d: PeerData) => void;
    updateAgents: (o: string[]) => void;
    sessions: Map<string, unknown>;
    state: (s: unknown, st: string) => void;
};
const m = new BotManager(() => undefined, (d, to) => { sent.push({ d, to }); }) as unknown as Inner;
const transfers = () => sent.filter((g) => g.d.kind === 'session_transfer') as { d: Extract<PeerData, { kind: 'session_transfer' }>; to?: string }[];
m.updateAgents(['workstation']);
m.handle({ type: 'bot_save', bot: { ...base, id: 'helper', name: 'Helper', machine: 'office' } }, 'c1');
check('target asleep: scheduled, nothing sent', pendingTransfers().helper?.machine === 'office' && transfers().length === 0, pendingTransfers());

// Bot is working right now: keep waiting even after the wake-up
m.sessions.set('helper', { bot, key: 'helper', state: 'thinking', currentTurn: { chatId: 'helper' }, waiting: () => 0, backgroundTasks: [], close: () => undefined });
m.updateAgents(['workstation', 'office']);
check('bot working: keeps waiting', transfers().length === 0 && pendingTransfers().helper?.machine === 'office');
const session = { bot, key: 'helper', state: 'idle', currentTurn: null, waiting: () => 0, waitingPerChat: () => ({}), backgroundTasks: [], activity: '', closed: false, close() { this.closed = true; } };
m.sessions.set('helper', session);
m.state(session, 'idle');
await wait(1300);
const u = transfers();
check('done: main chat and conversation to OFFICE', u.length === parts.length + 1 && u.every((g) => g.to === 'office')
    && u.some((g) => g.d.key === chatC && g.d.sessionId === ID_C), u.map((g) => `${g.d.key}#${g.d.part}`));
check('process here stopped, schedule gone', session.closed && !m.sessions.has('helper') && !pendingTransfers().helper);
const snapshotFirst = sent.findIndex((g) => g.d.kind === 'snapshot' && g.to === 'office') < sent.findIndex((g) => g.d.kind === 'session_transfer');
check('the new machine gets the state before the transcripts', snapshotFirst);

// ---- New machine: accept chunks, set the session id
fs.rmSync(transcriptPath(folder, ID_MAIN));
bots.setSessionId('helper', undefined);
for (const g of u.filter((x) => x.d.key === 'helper')) m.peerInbound('workstation', g.d);
check('received: transcript stored and session set', fs.readFileSync(transcriptPath(folder, ID_MAIN)).equals(large) && bots.readSessionId('helper') === ID_MAIN);
const foreign = { ...u[0].d, key: 'other', folder: 'C:/Windows' };
m.peerInbound('workstation', foreign);
check('foreign key or folder outside is dropped', bots.readSessionId('other') === undefined);

// ---- Old backend: the same chunks with German field names are mapped (see migrate.ts)
fs.rmSync(transcriptPath(folder, ID_C));
const { migratePeerData } = await import('./migrate.ts');
const old = u.find((x) => x.d.key === chatC)!.d;
const legacy = { art: 'session_umzug', botId: old.botId, folder: old.folder, schluessel: old.key, sessionId: old.sessionId, teil: old.part, teile: old.parts, daten: old.data };
m.peerInbound('workstation', migratePeerData(legacy));
check('chunk from an old backend accepted', fs.existsSync(transcriptPath(folder, ID_C)));

// ---- Switch back to this machine: nothing to do
sent.length = 0;
m.handle({ type: 'bot_save', bot: { ...base, id: 'helper', name: 'Helper', machine: 'workstation' } }, 'c1');
check('bot did not run here: no transfer from here', transfers().length === 0 && !pendingTransfers().helper);

// ---- Moved on another machine into a folder there: the sessions follow from the folder here into that one
sent.length = 0;
bots.setSessionId('helper', ID_MAIN);
const moved = { ...bots.findBot('helper')!, sessionId: undefined, machine: 'office', folder: '/work/helper', updatedAt: new Date(Date.now() + 60_000).toISOString() };
m.peerInbound('office', { kind: 'snapshot', snapshot: { bots: [moved], groups: [], routines: [], deleted: {}, push: [] } });
const followed = transfers();
check('moved elsewhere: transcripts read here, stored under the folder there', followed.length > 0 && followed.every((g) => g.to === 'office' && g.d.folder === '/work/helper')
    && followed.some((g) => g.d.key === 'helper' && g.d.sessionId === ID_MAIN), followed.map((g) => `${g.d.key} ${g.d.folder}`));
check('session ids here kept for the handover', bots.readSessionId('helper') === ID_MAIN);

// ---- Saving here for a bot that lives on another machine: only an unchanged folder is accepted
let refused = '';
try { bots.saveBot({ ...base, id: 'helper', name: 'Renamed', machine: 'office', folder: '/work/other' }); } catch (err) { refused = (err as Error).message; }
check('other folder on another machine refused', refused.includes('OFFICE'), refused);
check('unchanged folder on another machine accepted', bots.saveBot({ ...base, id: 'helper', name: 'Renamed', machine: 'office', folder: '/work/helper' }).name === 'Renamed');
check('without a machine (old app): stays where it lives', bots.saveBot({ ...base, id: 'helper', name: 'Helper', machine: '', folder: '/work/helper' }).machine === 'office');
check('new bot without a machine lives here', bots.saveBot({ ...base, id: '', name: 'Fresh', machine: '' }).machine === 'workstation');

for (const d of [process.env.DATA_DIR!, process.env.CLAUDE_CONFIG_DIR!]) fs.rmSync(d, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
