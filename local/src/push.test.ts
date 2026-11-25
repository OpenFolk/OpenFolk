// Checks push delivery without a real push service: the requests are built with web-push
// (VAPID, encryption), the services' answers are simulated.
//   node local/src/push.test.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-push-'));
const { saveSubscription, pushSettings, savePushSettings, mergePushSettings, sendPush } = await import('./push.ts');
const { readJson } = await import('./store.ts');

const requests: { endpoint: string; auth: string; enc: string; length: number; urgency: string; payload: string }[] = [];
// Intercept delivery: request as web-push would send it, answer 201 or 410
(webpush as unknown as { sendNotification: unknown }).sendNotification = async (sub: webpush.PushSubscription, payload: string, opt: webpush.RequestOptions) => {
    const d = webpush.generateRequestDetails(sub, payload, opt);
    requests.push({ endpoint: d.endpoint, auth: String(d.headers.Authorization ?? ''), enc: String(d.headers['Content-Encoding'] ?? ''), length: (d.body as Buffer | null)?.length ?? 0, urgency: String(d.headers.Urgency ?? ''), payload });
    if (sub.endpoint.includes('expired')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    return { statusCode: 201, body: '', headers: {} };
};

function subscription(name: string) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return {
        endpoint: `https://push.example.invalid/${name}`,
        keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
    };
}

saveSubscription(subscription('phone'));
saveSubscription(subscription('expired'));
saveSubscription(subscription('phone')); // duplicate: must be stored only once
await sendPush({ title: 'Test', body: 'x'.repeat(500), url: '/?chat=x', tag: 'x' });

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
check('one delivery attempt per subscription (duplicate merged)', requests.length === 2);
check('VAPID authorization set', requests.every((e) => /^vapid t=.+, k=.+/.test(e.auth)));
check('payload encrypted (aes128gcm)', requests.every((e) => e.enc === 'aes128gcm' && e.length > 0));
check('long texts truncated (payload < 600 B)', requests.every((e) => e.length < 600));
const left = readJson<{ endpoint: string }[]>('push.json', []);
check('expired subscription (410) removed, valid one stays', left.length === 1 && left[0].endpoint.endsWith('/phone'));
let invalid = false;
try { saveSubscription({ endpoint: 'x' }); } catch { invalid = true; }
check('incomplete subscription rejected', invalid);
check('without kind (security warning) with high urgency', requests.every((e) => e.urgency === 'high'));

// Settings: default, priority per kind, off = no delivery, sync by timestamp
const std = pushSettings();
check('default: approval high, done normal', std.kinds.approval === 'high' && std.kinds.done === 'normal' && std.updatedAt === '');
requests.length = 0;
await sendPush({ title: 't', body: 'b', url: '/' }, 'done');
check('done (normal) with urgency normal', requests.length === 1 && requests[0].urgency === 'normal');
const saved = savePushSettings({ done: 'off', routine: 'quiet', awake: 'nonsense' as never });
check('saving takes valid values, ignores invalid ones', saved.kinds.done === 'off' && saved.kinds.routine === 'quiet' && saved.kinds.awake === 'normal' && saved.updatedAt !== '');
requests.length = 0;
await sendPush({ title: 't', body: 'b', url: '/' }, 'done');
check('off: no delivery', requests.length === 0);
await sendPush({ title: 't', body: 'b', url: '/' }, 'routine');
check('quiet: urgency low', requests.length === 1 && requests[0].urgency === 'low');
check('older state of another machine is ignored', !mergePushSettings({ kinds: { ...saved.kinds, done: 'high' }, updatedAt: '2000-01-01T00:00:00Z' }) && pushSettings().kinds.done === 'off');
check('newer state is taken over', mergePushSettings({ kinds: { ...saved.kinds, done: 'high' }, updatedAt: '2999-01-01T00:00:00Z' }) && pushSettings().kinds.done === 'high');
check('missing state (old backend) changes nothing', !mergePushSettings(undefined));

// A notification of another account names it: the link opens that account, the tag stays apart from main's
const { inAccount } = await import('./store.ts');
requests.length = 0;
await inAccount('work', async () => {
    saveSubscription(subscription('work-phone'));
    await sendPush({ title: 't', body: 'b', url: '/?chat=anna', tag: 'anna' });
});
const sent = JSON.parse(requests[0]?.payload ?? '{}') as { url?: string; tag?: string };
check('other account: link and tag carry the account', sent.url === '/?chat=anna&account=work' && sent.tag === 'work:anna');
requests.length = 0;
await inAccount('main', () => sendPush({ title: 't', body: 'b', url: '/?chat=anna', tag: 'anna' }));
const plain = JSON.parse(requests[0]?.payload ?? '{}') as { url?: string; tag?: string };
check('main: link and tag as before', plain.url === '/?chat=anna' && plain.tag === 'anna');

// A desktop in use keeps the phones quiet: answers stay away, requests follow after the delay unless taken up
// The push service of openfolk.app stays out: these tests never reach the network
process.env.PUSH_SERVICE_URL = 'off';
const { attention, mergeSubscriptions, phoneDelay, relayPush, ACTIVE_MS } = await import('./push.ts');
await inAccount('desk', async () => {
    saveSubscription(subscription('desk-pc'), { form: 'desktop' });
    saveSubscription(subscription('desk-phone'), { form: 'phone' });
    saveSubscription(subscription('desk-always'), { form: 'phone', always: true });
    saveSubscription(subscription('desk-old')); // a browser too old to say what it is
});
const to = () => requests.map((r) => r.endpoint.slice(r.endpoint.lastIndexOf('/') + 1)).sort().join(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
phoneDelay.ms = 40;
const inDesk = (kind: Parameters<typeof sendPush>[1], context: Parameters<typeof sendPush>[2]) =>
    inAccount('desk', () => sendPush({ title: 't', body: 'b', url: '/?chat=c', tag: 'c' }, kind, context));
for (const kind of ['done', 'routine', 'message'] as const) {
    requests.length = 0;
    await inDesk(kind, { desk: true });
    await sleep(80);
    check(`desktop in use: ${kind} only to the phone set to always notify`, to() === 'desk-always');
}
for (const kind of ['done', 'approval'] as const) {
    requests.length = 0;
    await inDesk(kind, { desk: false });
    check(`no desktop in use: ${kind} to every device at once`, to() === 'desk-always,desk-old,desk-pc,desk-phone');
}
for (const kind of ['approval', 'handover'] as const) {
    requests.length = 0;
    await inDesk(kind, { desk: true, due: () => true });
    check(`desktop in use: ${kind} at once to all but the phone`, to() === 'desk-always,desk-old,desk-pc');
    await sleep(80);
    check(`desktop in use: ${kind} to the phone after the delay`, to() === 'desk-always,desk-old,desk-pc,desk-phone');
}
requests.length = 0;
let answered = false;
await inDesk('approval', { desk: true, due: () => !answered });
answered = true;
await sleep(80);
check('approval answered (or chat opened) during the delay: the phone gets nothing', to() === 'desk-always,desk-old,desk-pc');
for (const kind of ['awake', 'limit', undefined] as const) {
    requests.length = 0;
    await inDesk(kind, { desk: true });
    check(`desktop in use: ${kind ?? 'security warning'} unchanged, to every device`, to() === 'desk-always,desk-old,desk-pc,desk-phone');
}
await inAccount('desk', async () => {
    const before = readJson<{ endpoint: string; always?: boolean; traitsAt?: string }[]>('push.json', []).find((s) => s.endpoint.endsWith('/desk-phone'));
    saveSubscription(subscription('desk-phone'), { form: 'phone', always: false });
    const same = readJson<{ endpoint: string; traitsAt?: string }[]>('push.json', []).find((s) => s.endpoint.endsWith('/desk-phone'));
    check('subscribing again unchanged keeps the traits\' time', !!before?.traitsAt && same?.traitsAt === before.traitsAt);
    // Another machine turned "always" on later; an old backend's copy without traits changes nothing
    mergeSubscriptions([{ ...subscription('desk-phone'), endpoint: before!.endpoint, form: 'phone', always: true, traitsAt: '2999-01-01T00:00:00Z' }]);
    mergeSubscriptions([{ ...subscription('desk-phone'), endpoint: before!.endpoint }]);
    const merged = readJson<{ endpoint: string; always?: boolean }[]>('push.json', []).find((s) => s.endpoint.endsWith('/desk-phone'));
    check('newer "always notify" of another machine taken over, old copy ignored', merged?.always === true);
    mergeSubscriptions([{ ...subscription('desk-phone'), endpoint: before!.endpoint, form: 'phone', traitsAt: '2000-01-01T00:00:00Z' }]);
    check('older traits of another machine ignored', readJson<{ endpoint: string; always?: boolean }[]>('push.json', []).find((s) => s.endpoint.endsWith('/desk-phone'))?.always === true);
    saveSubscription(subscription('desk-old'), {});
    check('old client subscribing keeps no traits it never sent', !('form' in (readJson<{ endpoint: string }[]>('push.json', []).find((s) => s.endpoint.endsWith('/desk-old')) ?? {})));
});
// An app's device token counts as a phone without saying so, and the relay gets it without the traits
const handed: unknown[] = [];
relayPush.channels = () => ['apns'];
relayPush.send = (subs) => { handed.push(...subs); return true; };
await inAccount('app', async () => {
    saveSubscription({ channel: 'apns', token: 'app-token-1234' }, { form: 'phone' });
    await sendPush({ title: 't', body: 'b', url: '/' }, 'done', { desk: true });
    check('desktop in use: an app (old or new) gets no answer', handed.length === 0);
    await sendPush({ title: 't', body: 'b', url: '/' }, 'approval', { desk: true, due: () => true });
    check('desktop in use: an app\'s request waits', handed.length === 0);
    await sleep(80);
    check('… and reaches the relay after the delay, without the device\'s traits', handed.length === 1 && JSON.stringify(handed[0]) === '{"channel":"apns","token":"app-token-1234"}');
});

// Who is looking: a phone or an old client watching as before, a desktop only while in use and while its report is fresh
const now = Date.now();
check('nobody visible: nobody looking', JSON.stringify(attention([{ visible: false, at: now }, { visible: false, desktop: true, active: true, at: now }], now)) === '{"others":false,"desk":false}');
check('old client visible: watching as before', attention([{ visible: true, at: now }], now).others);
check('phone visible: watching, no desk', JSON.stringify(attention([{ visible: true, desktop: false, at: now }], now)) === '{"others":true,"desk":false}');
check('desktop visible and in use: desk', JSON.stringify(attention([{ visible: true, desktop: true, active: true, at: now }], now)) === '{"others":false,"desk":true}');
check('desktop visible without input: nobody looking', JSON.stringify(attention([{ visible: true, desktop: true, active: false, at: now }], now)) === '{"others":false,"desk":false}');
check('desktop report gone stale: no longer in use', !attention([{ visible: true, desktop: true, active: true, at: now - ACTIVE_MS - 1 }], now).desk);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
