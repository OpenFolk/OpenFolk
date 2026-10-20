// Checks the frame check (frames.ts): what the web app and the mobile apps send passes, malformed frames are rejected
// with the field, unknown types are left to the backend's own answer.
//   node local/src/frames.test.ts
// The browser tests additionally run every frame the web app sends there through the same check.
import { checkClientFrame, checkPeerData } from './frames.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures++;
};
const accepted = (name: string, frame: unknown) => {
    const r = checkClientFrame(frame);
    check(name, r.ok, r.ok ? undefined : r.problem);
};
const rejected = (name: string, frame: unknown, field: string) => {
    const r = checkClientFrame(frame);
    check(name, !r.ok && !r.unknown && r.problem.startsWith(field), r);
};

// ---- as the web app builds them (start.js, menus.js, queue.js, chat-features.js)
accepted('new bot (empty id)', { type: 'bot_save', bot: { id: '', name: 'Lena', role: 'Landing pages', folder: 'C:/www/landing', model: 'default', tone: '', avatar: '', approval: 'risky', machine: '' } });
accepted('new group (empty id, no picture yet)', { type: 'group_save', group: { id: '', name: 'Team', avatar: null, members: ['a', 'b'] } });
accepted('new routine (empty id)', { type: 'routine_save', routine: { id: '', botId: 'cloud', name: 'Backup', cron: '0 3 * * *', prompt: 'Check the backup', enabled: true, wake: false } });
accepted('fact', { type: 'knowledge_save', botId: 'cloud', location: { scope: 'all', key: '' }, fact: { name: 'servers', type: 'reference', description: 'Hosts', text: '...' }, oldName: undefined });
accepted('answer to a question', { type: 'approval_reply', id: 'q1', allow: true, answers: { 'Which?': 'A, B' } });
accepted('check a folder', { type: 'folder_check', folder: '/work/website' });
accepted('clone a repository', { type: 'folder_clone', url: 'https://git.example.com/team/website.git' });
accepted('denial with a reason', { type: 'approval_reply', id: 'a1', message: 'not now', allow: false });
accepted('read state', { type: 'seen', state: { cloud: { until: '2026-10-13T08:00:00Z', updatedAt: '2026-10-13T08:00:00Z' }, pdf: { until: undefined, unread: true, updatedAt: '2026-10-13T08:00:00Z' } } });
accepted('message with attachment and quote', { type: 'send', chatId: 'cloud', text: 'see file', attachments: [{ name: 'a.png', type: 'image/png', data: 'AAAA' }], replyTo: { id: 'e1', from: 'me', text: 'earlier' } });
accepted('target machine and unknown extra fields are kept', { type: 'ping', machine: 'desk', future: 1 });
accepted('push settings', { type: 'push_settings', kinds: { done: 'quiet' } });
accepted('sign-in to Codex with a device code', { type: 'engine_login', engine: 'codex', machine: 'cloud' });
rejected('sign-in to Claude: no device code flow', { type: 'engine_login', engine: 'claude' }, 'engine');
accepted('sign-in to Claude in a terminal on the machine', { type: 'claude_sign_in', machine: 'desk' });

// ---- push subscriptions: browser and apps
accepted('Web Push subscription', { type: 'push_subscribe', subscription: { endpoint: 'https://push.example/x', expirationTime: null, keys: { p256dh: 'BP', auth: 'au' } } });
accepted('iOS device token', { type: 'push_subscribe', subscription: { channel: 'apns', token: 'a1b2c3d4e5f6', app: 'io.openfolk.app' } }); // gitleaks:allow
rejected('clone without an address', { type: 'folder_clone', url: '' }, 'url');
accepted('Android FCM token', { type: 'push_subscribe', subscription: { channel: 'fcm', token: 'fcm-token-123456' } });
rejected('unknown push channel', { type: 'push_subscribe', subscription: { channel: 'pigeon', token: 'x'.repeat(20) } }, 'subscription');

// ---- malformed
rejected('message without text', { type: 'send', chatId: 'cloud' }, 'text');
rejected('empty chat id', { type: 'interrupt', chatId: '' }, 'chatId');
rejected('wrong type of a flag', { type: 'favorite', chatId: 'cloud', on: 'yes' }, 'on');
rejected('unknown approval level', { type: 'bot_save', bot: { id: 'x', name: 'X', folder: 'C:/x', approval: 'sometimes' } }, 'bot.approval');
rejected('unknown language', { type: 'language', language: 'fr' }, 'language');
rejected('unknown push priority', { type: 'push_settings', kinds: { done: 'loud' } }, 'kinds');

// ---- unknown types: the backend answers with "does not know the request"
const unknown = checkClientFrame({ type: 'teleport' });
check('unknown type is reported as unknown', !unknown.ok && unknown.unknown && unknown.type === 'teleport');
const none = checkClientFrame('ping');
check('no object: no type', !none.ok && none.unknown && none.type === '');
const proto = checkClientFrame({ type: 'toString' });
check('prototype names are no frame types', !proto.ok && proto.unknown);

// ---- peer data between backends
const peerOk = (name: string, data: unknown) => { const r = checkPeerData(data); check(name, r.ok, r.ok ? undefined : r.problem); };
const peerBad = (name: string, data: unknown, field: string) => { const r = checkPeerData(data); check(name, !r.ok && r.problem.startsWith(field), r.ok ? 'accepted' : r.problem); };
const turn = { chatId: 'cloud', content: 'hi', text: 'hi', from: 'me', chain: [], hop: 0 };
peerOk('job', { kind: 'job', id: 'j1', botId: 'cloud', turn, reply: true });
peerOk('job with content blocks', { kind: 'job', id: 'j1', botId: 'cloud', turn: { ...turn, content: [{ type: 'text', text: 'hi' }] }, reply: false });
peerOk('job_done', { kind: 'job_done', id: 'j1', result: { text: 'ok', tools: [], attachments: [], durationMs: 5, costUsd: 0 } });
peerOk('snapshot', { kind: 'snapshot', snapshot: { bots: [{ id: 'cloud', name: 'Cloud', folder: 'C:/www/cloud' }], groups: [], routines: [], deleted: {}, push: [] } });
peerOk('history', { kind: 'history', chatId: 'cloud', entries: [{ id: 'a', role: 'user', text: 'x', ts: '2026-10-15T08:00:00Z', extra: 1 }] });
peerOk('seen', { kind: 'seen', state: { cloud: { until: '2026-10-15T08:00:00Z', updatedAt: '2026-10-15T08:00:00Z' } } });
peerBad('job without a turn', { kind: 'job', id: 'j1', botId: 'cloud', reply: true }, 'turn');
peerBad('job with a negative hop', { kind: 'job', id: 'j1', botId: 'cloud', turn: { ...turn, hop: -1 }, reply: true }, 'turn.hop');
peerBad('bot in a snapshot without a folder', { kind: 'snapshot', snapshot: { bots: [{ id: 'x', name: 'X' }], groups: [], routines: [], deleted: {}, push: [] } }, 'snapshot.bots.0.folder');
peerBad('history entry with an unknown role', { kind: 'history', chatId: 'cloud', entries: [{ role: 'system', text: 'x', ts: '' }] }, 'entries.0.role');
peerBad('session transfer with zero parts', { kind: 'session_transfer', botId: 'b', folder: 'C:/x', key: 'b', sessionId: 's', part: 0, parts: 0, data: '' }, 'parts');
const kindless = checkPeerData({ kind: 'teleport' });
check('unknown peer kind rejected', !kindless.ok && kindless.problem === 'unknown kind');
check('prototype names are no peer kinds', !checkPeerData({ kind: 'constructor' }).ok);

if (failures) process.exit(1);
console.log('all frame tests passed');
