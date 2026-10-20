// Tests for several conversations per bot:  node local/src/conversations.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-conversations-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const { allChats, readHistory, appendEntry } = await import('./history.ts');
const { merge } = await import('./sync.ts');
const { titleFrom } = await import('./agent.ts');
const { botIdOf, isConversation } = await import('../../shared/protocol.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };

check('botIdOf: main chat', botIdOf('skool') === 'skool');
check('botIdOf: conversation', botIdOf('skool~a1b2c3d4') === 'skool');
check('isConversation', isConversation('skool~a1') && !isConversation('skool') && !isConversation('g:team'));

const bot = bots.saveBot({ id: 'test', name: 'Test', role: '', folder: path.resolve(import.meta.dirname, '..', '..'), model: 'default', tone: '', avatar: '', approval: 'never', machine: '' });
const chatId = bots.createConversation(bot.id);
check('create: chatId bot~hex', /^test~[0-9a-f]{8}$/.test(chatId));
check('create: stored without title', bots.findConversation(chatId)?.title === '');
const second = bots.createConversation(bot.id);
check('two conversations, different ids', second !== chatId && bots.findBot('test')!.conversations!.length === 2);

bots.renameConversation(chatId, '  Web store release  ');
check('rename: trimmed', bots.findConversation(chatId)?.title === 'Web store release');

// Editing in the editor must not lose the conversations
bots.saveBot({ ...bot, name: 'Test 2' });
check('editor save keeps conversations', bots.findBot('test')!.conversations!.length === 2);

// Session ids per conversation separate from the main chat
bots.setSessionId('test', 'main-1');
bots.setSessionId(chatId, 'side-1');
check('session ids separate', bots.readSessionId('test') === 'main-1' && bots.readSessionId(chatId) === 'side-1' && bots.findBot('test')!.sessionId === 'main-1');

// Model: the main chat switches the bot, a conversation only itself; the sessions stay
const { BotSession } = await import('./session.ts');
const sessionOf = (key: string) => new BotSession(bots.findBot('test')!, {} as never, key);
bots.setModel('test', 'fable');
check('model in the main chat sets the bot\'s', bots.findBot('test')!.model === 'fable');
check('conversation without its own model follows the bot', sessionOf(chatId).model === 'fable' && sessionOf('test').model === 'fable');
bots.setModel(chatId, 'haiku');
check('conversation with its own model', sessionOf(chatId).model === 'haiku' && bots.findBot('test')!.model === 'fable');
bots.setModel('test', 'default');
check('default means: no setting for the CLI', sessionOf('test').model === undefined && sessionOf(chatId).model === 'haiku');
check('model switch keeps the sessions', bots.readSessionId('test') === 'main-1' && bots.readSessionId(chatId) === 'side-1');
bots.saveBot({ ...bot, name: 'Test 2', model: 'opus' });
check('changing the model in the editor keeps the sessions', bots.readSessionId('test') === 'main-1' && bots.readSessionId(chatId) === 'side-1');
check('editor save keeps the conversation\'s model', bots.findBot('test')!.conversations!.find((c) => chatId.endsWith(c.id))?.model === 'haiku');
let invalid = false;
try { bots.setModel('test', 'opus; rm -rf'); } catch { invalid = true; }
check('invalid model rejected', invalid && bots.findBot('test')!.model === 'opus');

// History: the file keeps the '~', allChats returns the chatId
appendEntry(chatId, { role: 'user', text: 'hello', ts: '2026-10-08T05:00:00Z', from: 'me' });
check('history of the conversation separate', readHistory(chatId).length === 1 && readHistory('test').length === 0);
check('allChats returns the conversation\'s chatId', allChats().includes(chatId));

const title = titleFrom('Please check the web store upload for version 3.2 and report back with the result');
check('titleFrom: cut at a word boundary', title.length <= 42 && title.endsWith(' …') && !title.includes('result'));
check('titleFrom: short text unchanged', titleFrom('Short and sweet') === 'Short and sweet');
check('titleFrom: first non-empty line', titleFrom('\n\nLine one\nLine two') === 'Line one');

const { titleFromKeywords, titlePrompt } = await import('./title.ts');
check('keywords: with separator', titleFromKeywords({ keywords: ['Web store', 'Upload', 'Version 3.2'] }) === 'Web store · Upload · Version 3.2');
check('keywords: quotes, period and duplicates removed', titleFromKeywords({ keywords: ['„Relay“', 'relay', 'Login.'] }) === 'Relay · Login');
const long = titleFromKeywords({ keywords: ['Conversationheadlines', 'Keywordassignment', 'Messenger-Frontend', 'Haiku'] });
check('keywords: cut at the end, at most 40 characters', long.length <= 40 && long.startsWith('Conversationheadlines'));
check('keywords: unusable answer gives empty', titleFromKeywords(undefined) === '' && titleFromKeywords({ keywords: [' ', 3] }) === '');
check('title prompt without voice message head', !titlePrompt('🎤 Voice message\nHello world').includes('🎤') && titlePrompt('Hello world').includes('Hello world'));

bots.setSessionId(second, 'sess-two');
bots.archiveConversation(second, true);
const archived = bots.findBot('test')!.conversations!.find((c) => second.endsWith(c.id))!;
check('archive: stays, with time', !!archived.archived && !!bots.findConversation(second));
check('archive: session id stays for restoring', bots.readSessionId(second) === 'sess-two');
bots.archiveConversation(second, false);
check('restore: no longer archived', bots.findBot('test')!.conversations!.find((c) => second.endsWith(c.id))!.archived === undefined);

bots.removeConversation(second);
check('delete: only this one removed', bots.findBot('test')!.conversations!.length === 1 && !bots.findConversation(second));
check('delete: session id dropped', bots.readSessionId(second) === undefined);

// Sync: deleted on the other machine → history gone here, and it does not come back
const result = merge({ bots: [], groups: [], routines: [], deleted: { [`chat:${chatId}`]: new Date().toISOString() }, push: [], history: {} });
check('sync reports the deleted conversation', result.chatsDeleted.includes(chatId));
check('sync deletes the history', readHistory(chatId).length === 0);
merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { [chatId]: [{ id: 'x', role: 'user', text: 'old', ts: '2026-10-08T05:00:00Z' }] } });
check('deleted conversation does not come back', readHistory(chatId).length === 0);
const alive = bots.createConversation(bot.id);
merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], history: { [alive]: [{ id: 'y', role: 'user', text: 'new', ts: '2026-10-08T05:00:00Z' }] } });
check('history of a conversation is synced', readHistory(alive).length === 1);

if (failures) process.exit(1);
console.log('all tests passed');
