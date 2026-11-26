// The push service for every backend (push-service.ts, POST /push on the relay of openfolk.app): trims what it gets,
// limits per device token and per sender, reports tokens Apple and Google no longer know; without PUSH_SERVICE the
// address does not exist.
//   node relay/src/push-service.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanPush, cleanReport, handlePushRequest, Limiter, PUSH_SERVICE_MAX_DEVICES, REPORT_FILE } from './push-service.ts';
import { startRelay } from './relay.ts';
import { parseWakeConfig } from './wakeup.ts';
import type { NativePushMessage, NativePushSubscription } from '../../shared/protocol.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failed++;
};

const sub = (token: string, channel = 'apns') => ({ channel, token, app: 'io.openfolk.app', extra: 'dropped' });
const message = { title: 'Fred', body: 'x'.repeat(900), url: '/?chat=fred', tag: 't', priority: 'loud', ttlSeconds: 5 };

// ---- trimming
const c = cleanPush({ subscriptions: [sub('aaaaaaaa'), sub('bbbbbbbb', 'fcm'), sub('short'), sub('cccccccc', 'web')], message }, ['apns', 'fcm'], 10);
check('only channels it delivers, tokens of a sane length, nothing extra', c?.subscriptions.map((s) => s.token).join() === 'aaaaaaaa,bbbbbbbb' && !('extra' in (c?.subscriptions[0] ?? {})), c?.subscriptions);
check('the text cut, an unknown priority normal, the lifetime at least a minute', c?.message.body.length === 500 && c.message.priority === 'normal' && c.message.ttlSeconds === 60, c?.message);
check('no title or link: nothing', cleanPush({ subscriptions: [sub('aaaaaaaa')], message: { body: 'x' } }, ['apns'], 10) === null);

// ---- the limiter
let now = 0;
const l = new Limiter([{ ms: 1000, max: 2 }, { ms: 10_000, max: 3 }], () => now);
const takes = [l.take('a'), l.take('a'), l.take('a')];
now = 1500;
const later = [l.take('a'), l.take('a')];
check('within a window, refused over it; the longer window holds too', takes.join() === 'true,true,false' && later.join() === 'true,false', { takes, later });
check('another key counts apart', l.take('b'));

// ---- a request
const delivered: NativePushSubscription[][] = [];
const deliver = async (subs: NativePushSubscription[], _m: NativePushMessage) => { delivered.push(subs); return subs.filter((s) => s.token === 'gone0000'); };
const limits = { devices: new Limiter([{ ms: 60_000, max: 2 }]), senders: new Limiter([{ ms: 60_000, max: 3 }]) };
const body = { subscriptions: [sub('aaaaaaaa'), sub('gone0000')], message };
const a1 = await handlePushRequest(body, '1.2.3.4', ['apns'], limits, deliver);
check('delivered, the gone token reported', a1.status === 200 && a1.body.gone?.join() === 'gone0000' && a1.body.throttled === 0 && delivered[0].length === 2, a1);
await handlePushRequest(body, '1.2.3.4', ['apns'], limits, deliver);
const a3 = await handlePushRequest({ subscriptions: [sub('aaaaaaaa'), sub('dddddddd')], message }, '1.2.3.4', ['apns'], limits, deliver);
check('a device over its limit is held back, the others go out', a3.status === 200 && a3.body.throttled === 1 && delivered[2].map((s) => s.token).join() === 'dddddddd', a3);
const a4 = await handlePushRequest(body, '1.2.3.4', ['apns'], limits, deliver);
check('a sender over its limit: 429, nothing delivered', a4.status === 429 && delivered.length === 3, a4);
check('without credentials: 404', (await handlePushRequest(body, '5.6.7.8', [], limits, deliver)).status === 404);
check('at most this many devices per request', cleanPush({ subscriptions: Array.from({ length: 50 }, (_, i) => sub(`token${String(i).padStart(4, '0')}`)), message }, ['apns'], PUSH_SERVICE_MAX_DEVICES)?.subscriptions.length === PUSH_SERVICE_MAX_DEVICES);

// ---- the address on the relay: only with the switch
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-push-service-'));
const quiet = () => undefined;
const base = { port: 0, host: '127.0.0.1', clientToken: 'c'.repeat(32), agentToken: 'a'.repeat(32), wake: parseWakeConfig({}), log: quiet };
const post = (port: number) => fetch(`http://127.0.0.1:${port}/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const off = await startRelay({ ...base, dataDir: tmp() });
check('without PUSH_SERVICE: no such address', (await post(off.port)).status === 405);
await off.close();
const onDir = tmp();
const on = await startRelay({ ...base, dataDir: onDir, pushService: true });
const r = await post(on.port);
check('with PUSH_SERVICE but without APNs/FCM credentials: 404 with the reason', r.status === 404 && (await r.json() as { error: string }).error === 'no_push_service');

// ---- reports for the publisher
const at = '2026-11-26T12:00:00.000Z';
const cr = cleanReport({ reason: 'offensive', author: 'person', text: 'Rude', note: ' n ', model: 'Sonnet', version: '0.8.0', account: 'x', ip: '1.2.3.4' }, at);
check('a report keeps reason, author, text, note, model and version, nothing else', JSON.stringify(cr)
    === JSON.stringify({ at, reason: 'offensive', author: 'person', text: 'Rude', note: 'n', model: 'Sonnet', version: '0.8.0' }), cr);
check('no text or an unknown reason: no report', cleanReport({ reason: 'offensive', text: ' ' }, at) === null && cleanReport({ reason: 'boring', text: 'x' }, at) === null);
const report = (port: number, b: unknown) => fetch(`http://127.0.0.1:${port}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const good = { reason: 'harmful', author: 'bot', text: 'A bad answer', model: 'Haiku' };
const r1 = await report(on.port, good);
const r2 = await report(on.port, { reason: 'harmful' });
const lines = fs.readFileSync(path.join(onDir, REPORT_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { text: string });
check('POST /report: stored, an invalid one refused', r1.status === 200 && r2.status === 400 && lines.length === 1 && lines[0].text === 'A bad answer', { r1: r1.status, r2: r2.status, lines });
let last = 200;
for (let i = 0; i < 10 && last === 200; i++) last = (await report(on.port, good)).status;
check('POST /report: limited per sender', last === 429, last);
await on.close();
const off2 = await startRelay({ ...base, dataDir: tmp() });
check('without PUSH_SERVICE: no /report either', (await report(off2.port, good)).status === 405);
await off2.close();

if (failed) process.exit(1);
console.log('all push service tests passed');
