// Person chats between accounts and the bots' hand-over to a person:  node local/src/people.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-people-'));
process.env.DATA_DIR = dir;
process.env.ALLOWED_ROOTS = dir;

const { inAccount, accountPath } = await import('./store.ts');
const { setPeople, contactsOf, loadPersonChats } = await import('./people.ts');
const { readHistory, historyFile } = await import('./history.ts');
const { saveBot, isMuted } = await import('./bots.ts');
const { snapshot, merge } = await import('./sync.ts');
const { botTools } = await import('./bot-tools.ts');
const { searchHistoryText, readHistoryText } = await import('./history-tools.ts');
const { checkClientFrame } = await import('./frames.ts');
const { BotManager } = await import('./agent.ts');
import type { AgentFrame, ClientFrame, HistoryEntry, PeerData } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

setPeople([
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'anna', name: 'Anna', admin: false, reach: 'all' },
    { id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'admins' },
]);
check('a customer reaches only the admins', contactsOf('kunde').map((p) => p.id).join() === 'main');
check('a team member reaches the team, not the customer', contactsOf('anna').map((p) => p.id).join() === 'main');
check('an admin reaches everyone but itself', contactsOf('main').map((p) => p.id).join() === 'anna,kunde');
check('an account the relay does not list reaches nobody', contactsOf('ghost').length === 0);

// Three accounts on this machine, wired like accounts.ts does
type Manager = InstanceType<typeof BotManager> & Record<string, unknown>;
const frames: Record<string, AgentFrame[]> = { main: [], anna: [], kunde: [] };
const managers: Record<string, Manager> = {};
for (const id of Object.keys(frames)) {
    managers[id] = inAccount(id, () => new BotManager((f) => { frames[id].push(f); }) as Manager);
}
for (const [id, m] of Object.entries(managers)) {
    m.otherAccount = (other, fn) => {
        if (!managers[other] || other === id) return false;
        inAccount(other, () => fn(managers[other]));
        return true;
    };
}
const handle = (account: string, frame: ClientFrame) => inAccount(account, () => managers[account].handle(frame, 'c1'));
const last = (account: string, type: string) => frames[account].findLast((f) => f.type === type) as Record<string, unknown> | undefined;
const history = (account: string, chatId: string) => inAccount(account, () => readHistory(chatId));

check('frames: people and person_chat_delete pass the check', checkClientFrame({ type: 'people' }).ok && checkClientFrame({ type: 'person_chat_delete', account: 'kunde' }).ok);

handle('kunde', { type: 'people' });
const people = last('kunde', 'people') as { list: { id: string }[] } | undefined;
check('people frame: the contacts of the account', people?.list.map((p) => p.id).join() === 'main', people);

// A message from the customer to Marco
handle('kunde', { type: 'send', chatId: 'p:main', text: 'Hallo Marco, die Rechnung fehlt.' });
const sent = history('kunde', 'p:main');
const got = history('main', 'p:kunde');
check('sender keeps it as its own', sent.length === 1 && sent[0].from === 'me', sent);
check('receiver gets it from the person, same id', got.length === 1 && got[0].from === 'person:kunde' && got[0].id === sent[0].id, got);
check('both sides see it at once', (last('kunde', 'user') as { chatId?: string })?.chatId === 'p:main' && (last('main', 'user') as { chatId?: string })?.chatId === 'p:kunde');
check('stored as person-<id>.jsonl', inAccount('main', () => path.basename(historyFile('p:kunde'))) === 'person-kunde.jsonl');

// A reply with a quote and a file
const file = Buffer.from('invoice').toString('base64');
handle('main', { type: 'send', chatId: 'p:kunde', text: 'Kommt sofort', attachments: [{ name: 'rechnung.txt', type: 'text/plain', data: file }], replyTo: { id: got[0].id!, from: 'person:kunde', text: got[0].text } });
const reply = history('kunde', 'p:main').at(-1)!;
check('a quote of the receiver\'s own message turns into "me"', reply.replyTo?.from === 'me', reply.replyTo);
check('the reply comes from the person', reply.from === 'person:main');
const copy = reply.attachments?.[0]?.path ?? '';
check('the file is copied into the receiver\'s uploads', copy.startsWith(inAccount('kunde', () => accountPath('uploads')).replace(/\\/g, '/')) && fs.existsSync(copy), copy);

// Voice messages go without transcription
handle('main', { type: 'send', chatId: 'p:kunde', text: '', attachments: [{ name: 'voice.webm', type: 'audio/webm', data: file }] });
check('a voice message arrives as it is', history('kunde', 'p:main').at(-1)?.voice === true);

// Reach
const before = frames.anna.length;
handle('anna', { type: 'send', chatId: 'p:kunde', text: 'Hi' });
check('a team member cannot write to a customer', history('kunde', 'p:anna').length === 0 && frames.anna.slice(before).some((f) => f.type === 'error'));
handle('kunde', { type: 'send', chatId: 'p:ghost', text: 'Hi' });
check('nor to an account that is not there', history('kunde', 'p:ghost').length === 0);

// Favorite, mute, delete
handle('main', { type: 'favorite', chatId: 'p:kunde', on: true });
handle('main', { type: 'mute', chatId: 'p:kunde', on: true });
const flags = (last('main', 'people') as { chats: { id: string; favorite?: boolean; muted?: boolean }[] }).chats.find((c) => c.id === 'kunde');
check('favorite and mute per person chat', flags?.favorite === true && flags?.muted === true, flags);
check('muted person chat counts as muted', inAccount('main', () => isMuted('p:kunde')));
const old: HistoryEntry[] = history('main', 'p:kunde');
handle('main', { type: 'person_chat_delete', account: 'kunde' });
check('deleting empties this half only', history('main', 'p:kunde').length === 0 && history('kunde', 'p:main').length === 3);
check('… and drops favorite and mute', !inAccount('main', () => loadPersonChats()[0].favorite) && !inAccount('main', () => isMuted('p:kunde')));
inAccount('main', () => merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { 'p:kunde': old } }));
check('another machine\'s copy does not bring it back', history('main', 'p:kunde').length === 0);
handle('kunde', { type: 'send', chatId: 'p:main', text: 'Noch eine Frage' });
check('a new message arrives after deleting', history('main', 'p:kunde').length === 1);
const snap = inAccount('main', () => snapshot(true));
check('the snapshot carries the person chats and their history', !!snap.personChats?.some((c) => c.id === 'kunde' && c.cleared) && snap.history?.['p:kunde']?.length === 1);
const cleared = inAccount('anna', () => merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { 'p:main': old }, personChats: [{ id: 'main', cleared: '2999-01-01T00:00:00.000Z', updatedAt: '2999-01-01T00:00:00.000Z' }] }));
check('a deletion from another machine is taken over', cleared.personChats && history('anna', 'p:main').length === 0);

// Bots do not read person chats
inAccount('main', () => saveBot({ id: 'helper', name: 'Helper', role: '', folder: dir, model: 'default', tone: '', avatar: '', approval: 'never', machine: '' }));
const found = inAccount('main', () => searchHistoryText({ query: 'Frage' }, 'helper', []));
check('search_history skips person chats', found.text.startsWith('No hits'), found.text);
check('read_history refuses a person chat', inAccount('main', () => readHistoryText({ chat: 'p:kunde', entry_id: 'x' }, 'helper')).error === true);

// Hand-over from a support bot of the customer account to Marco
const support = inAccount('kunde', () => saveBot({ id: 'support', name: 'Support', role: '', folder: dir, model: 'default', tone: '', avatar: '', approval: 'never', machine: '', contact: 'main' }));
const plain = inAccount('kunde', () => saveBot({ id: 'plain', name: 'Plain', role: '', folder: dir, model: 'default', tone: '', avatar: '', approval: 'never', machine: '' }));
const names = (bot: typeof support) => botTools({ bot, currentTurn: null, key: bot.id } as never, {} as never).map((x) => x.name);
check('hand_over only for a bot with a contact', names(support).includes('hand_over') && !names(plain).includes('hand_over'));
check('the contact is stored with the bot', support.contact === 'main');
const host = (managers.kunde as unknown as { toolHost: { handOver: (s: unknown, summary: string) => { content: { text: string }[]; isError: boolean } } }).toolHost;
const session = { bot: support, currentTurn: { chatId: 'support' }, key: 'support' };
const r1 = inAccount('kunde', () => host.handOver(session, 'Kunde braucht die Rechnung 2026-11 neu.'));
check('hand-over succeeds', !r1.isError, r1.content[0].text);
const event = history('kunde', 'support').at(-1);
check('the bot chat gets an event with a link to the person', event?.role === 'event' && event.person === 'main', event);
const note = history('main', 'p:kunde').at(-1);
check('the contact gets the summary in the person chat', note?.role === 'event' && note.text.includes('Rechnung 2026-11'), note);
check('… so does the customer\'s half', history('kunde', 'p:main').at(-1)?.text.includes('Rechnung 2026-11') === true);
const r2 = inAccount('kunde', () => host.handOver(session, 'Nochmal'));
check('a second hand-over right after is refused', r2.isError);
const lonely = { bot: { ...support, contact: 'anna' }, currentTurn: { chatId: 'support' }, key: 'support' };
check('a contact the account cannot reach is refused', inAccount('kunde', () => host.handOver({ ...lonely, currentTurn: { chatId: 'support~ab12' } }, 'x')).isError);

// Chosen contacts ('listed'): only those named, and only if the other side does not limit itself either
setPeople([
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'anna', name: 'Anna', admin: false, reach: 'all' },
    { id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'listed', contacts: ['anna'] },
    { id: 'other', name: 'Other', admin: false, reach: 'listed', contacts: ['kunde'] },
]);
check('listed: reaches exactly the accounts it names, an admin too only if named', contactsOf('kunde').map((p) => p.id).join() === 'anna');
check('listed: an admin it does not name does not reach it', !contactsOf('main').some((p) => p.id === 'kunde'));
check('listed on both sides: both have to name each other', !contactsOf('other').some((p) => p.id === 'kunde'));

// Across machines: the customer's account lives on a machine of its own, Marco's half arrives through the relay
setPeople([
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'listed', contacts: ['main'] },
]);
const routed: { to: string; data: PeerData }[] = [];
managers.kunde.otherAccount = () => false;
managers.kunde.toAccount = (to, data) => { routed.push({ to, data }); };
handle('kunde', { type: 'send', chatId: 'p:main', text: 'Von meinem Rechner', attachments: [{ name: 'notiz.txt', type: 'text/plain', data: Buffer.from('notiz').toString('base64') }] });
const out = routed.at(-1);
check('a person on another machine: the message goes through the relay, with its file', out?.to === 'main' && out.data.kind === 'person_message'
    && out.data.message === 'message' && Object.values(out.data.files ?? {})[0] === Buffer.from('notiz').toString('base64'), out?.data.kind);
const theirs = history('kunde', 'p:main').at(-1);
check('the sender keeps its half as always', theirs?.text === 'Von meinem Rechner' && theirs.from === 'me');
// What arrives on Marco's machine; the sender's file path does not exist there
if (out?.data.kind === 'person_message') {
    const moved = { ...out.data, entry: { ...out.data.entry, attachments: out.data.entry.attachments?.map((a) => ({ ...a, path: '/elsewhere/notiz.txt', machine: 'laptop' })) },
        files: { '/elsewhere/notiz.txt': Object.values(out.data.files ?? {})[0] } };
    inAccount('main', () => managers.main.personInbound('kunde', moved));
}
const arrived = history('main', 'p:kunde').at(-1);
const arrivedFile = arrived?.attachments?.[0]?.path ?? '';
check('it arrives in the receiver\'s half from the person, with the file in its uploads', arrived?.from === 'person:kunde' && arrived.text === 'Von meinem Rechner'
    && fs.existsSync(arrivedFile) && fs.readFileSync(arrivedFile, 'utf8') === 'notiz', arrived);
const count = history('main', 'p:anna').length;
inAccount('main', () => managers.main.personInbound('anna', { kind: 'person_message', entry: { id: 'x1', role: 'user', text: 'Hi', ts: new Date().toISOString(), from: 'me' }, message: 'message' }));
check('from an account this one does not reach: dropped', history('main', 'p:anna').length === count);

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
