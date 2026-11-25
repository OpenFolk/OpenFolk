// Reporting a message to the relay's admins and blocking a person:  node local/src/report-block.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-report-'));
process.env.DATA_DIR = dir;
process.env.ALLOWED_ROOTS = dir;

const { inAccount } = await import('./store.ts');
const { setPeople, loadPersonChats, mergePersonChats } = await import('./people.ts');
const { readHistory, appendEntry } = await import('./history.ts');
const { saveBot } = await import('./bots.ts');
const { checkClientFrame } = await import('./frames.ts');
const { BotManager } = await import('./agent.ts');
import type { AgentFrame, ClientFrame } from '../../shared/protocol.ts';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

setPeople([
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'lea', name: 'Lea', admin: true, reach: 'all' },
    { id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'admins' },
]);

type Manager = InstanceType<typeof BotManager> & Record<string, unknown>;
const frames: Record<string, AgentFrame[]> = { main: [], lea: [], kunde: [] };
const managers: Record<string, Manager> = {};
for (const id of Object.keys(frames)) managers[id] = inAccount(id, () => new BotManager((f) => { frames[id].push(f); }) as Manager);
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

check('frames: report and person_block pass the check', checkClientFrame({ type: 'report', chatId: 'helper', entryId: 'e1', reason: 'offensive', note: 'x' }).ok
    && checkClientFrame({ type: 'person_block', account: 'kunde', on: true }).ok);
check('frames: an unknown reason is refused', !checkClientFrame({ type: 'report', chatId: 'helper', entryId: 'e1', reason: 'boring' }).ok);

// The customer's bot answered something it should not have
inAccount('kunde', () => saveBot({ id: 'helper', name: 'Helper', role: '', folder: dir, model: 'default', tone: '', avatar: '', approval: 'never', machine: '' }));
const answer = inAccount('kunde', () => appendEntry('helper', { role: 'assistant', text: 'Eine beleidigende Antwort', ts: new Date().toISOString(), botId: 'helper' }));
handle('kunde', { type: 'report', chatId: 'helper', entryId: answer.id!, reason: 'offensive', note: 'Bitte prüfen' });
const sent = last('kunde', 'report_sent') as { admins?: string[] } | undefined;
check('the report goes to every admin the account reaches', sent?.admins?.join() === 'main,lea', sent);
const atMarco = history('main', 'p:kunde').at(-1);
check('the admin gets it in the person chat, with the reason, the note and the bot', !!atMarco && atMarco.from === 'person:kunde'
    && atMarco.text.includes('offensive') && atMarco.text.includes('Bitte prüfen'), atMarco);
check('it quotes the stored answer whole, under the bot\'s name', atMarco?.replyTo?.forwarded === true && atMarco.replyTo.text === 'Eine beleidigende Antwort'
    && atMarco.replyTo.from === 'Helper' && atMarco.replyTo.origin === 'Helper', atMarco?.replyTo);
check('the reporter sees it in their chat with the admin', history('kunde', 'p:lea').at(-1)?.replyTo?.id === answer.id);

const errorsBefore = frames.kunde.filter((f) => f.type === 'error').length;
handle('kunde', { type: 'report', chatId: 'helper', entryId: 'missing', reason: 'other' });
check('a message that is not there: an error, nothing sent', frames.kunde.filter((f) => f.type === 'error').length === errorsBefore + 1
    && history('main', 'p:kunde').length === 1);

// The only admin reporting: nobody to send it to, the app offers the support address
setPeople([{ id: 'main', name: 'Marco', admin: true, reach: 'all' }]);
inAccount('main', () => saveBot({ id: 'solo', name: 'Solo', role: '', folder: dir, model: 'default', tone: '', avatar: '', approval: 'never', machine: '' }));
const own = inAccount('main', () => appendEntry('solo', { role: 'assistant', text: 'Antwort', ts: new Date().toISOString(), botId: 'solo' }));
handle('main', { type: 'report', chatId: 'solo', entryId: own.id!, reason: 'false' });
check('without another admin: the error says so', String((last('main', 'error') as { message?: string } | undefined)?.message).includes('admin'), last('main', 'error'));
setPeople([
    { id: 'main', name: 'Marco', admin: true, reach: 'all' },
    { id: 'lea', name: 'Lea', admin: true, reach: 'all' },
    { id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'admins' },
]);

// Marco blocks the customer
handle('main', { type: 'person_block', account: 'kunde', on: true });
const chats = (last('main', 'people') as { chats?: { id: string; blocked?: boolean }[] } | undefined)?.chats;
check('the block is in the people frame', chats?.find((c) => c.id === 'kunde')?.blocked === true, chats);
const count = history('main', 'p:kunde').length;
handle('kunde', { type: 'send', chatId: 'p:main', text: 'Hallo?' });
check('a blocked person\'s message is dropped', history('main', 'p:kunde').length === count);
check('the sender keeps it in their half', history('kunde', 'p:main').at(-1)?.text === 'Hallo?');
handle('kunde', { type: 'report', chatId: 'helper', entryId: answer.id!, reason: 'harmful' });
check('a report of a blocked person does not reach the admin who blocked them', history('main', 'p:kunde').length === count
    && history('lea', 'p:kunde').length === 2);
const errors = frames.main.filter((f) => f.type === 'error').length;
handle('main', { type: 'send', chatId: 'p:kunde', text: 'Doch noch etwas' });
check('writing to a blocked person: an error, nothing stored', frames.main.filter((f) => f.type === 'error').length === errors + 1 && history('main', 'p:kunde').length === count);

// The block travels to the account's other machines like favorite and mute
const mine = inAccount('main', () => loadPersonChats()).find((c) => c.id === 'kunde');
inAccount('lea', () => mergePersonChats([{ ...mine!, id: 'kunde' }]));
check('sync takes over the block', inAccount('lea', () => loadPersonChats()).find((c) => c.id === 'kunde')?.blocked === true);
inAccount('lea', () => mergePersonChats([{ id: 'kunde', updatedAt: new Date(Date.now() + 1000).toISOString() }]));
check('and the unblock', !inAccount('lea', () => loadPersonChats()).find((c) => c.id === 'kunde')?.blocked);

handle('main', { type: 'person_block', account: 'kunde', on: false });
handle('kunde', { type: 'send', chatId: 'p:main', text: 'Jetzt?' });
check('unblocked: messages arrive again', history('main', 'p:kunde').at(-1)?.text === 'Jetzt?');

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failures` : '\nall ok');
process.exit(failures ? 1 : 0);
