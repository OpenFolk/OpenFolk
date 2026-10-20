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
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
