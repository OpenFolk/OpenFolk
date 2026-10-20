// Checks push to the mobile apps without Apple or Google: real keys, intercepted requests. Signatures of the APNs and
// FCM tokens, headers and payload per priority and preview setting, sandbox fallback for development builds, removal
// of tokens of uninstalled apps, and that a machine without credentials leaves the app tokens alone.
//   node local/src/push-native.test.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-push-native-'));
process.env.DATA_DIR = dir;
const apnsKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const fcmKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync(path.join(dir, 'AuthKey.p8'), apnsKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    client_email: 'push@openfolk-test.iam.gserviceaccount.com', project_id: 'openfolk-test',
    private_key: fcmKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
}));
Object.assign(process.env, {
    APNS_KEY_FILE: path.join(dir, 'AuthKey.p8'), APNS_KEY_ID: 'KEY123', APNS_TEAM_ID: 'TEAM456',
    FCM_SERVICE_ACCOUNT_FILE: path.join(dir, 'firebase.json'),
});
delete process.env.APNS_ENV;

const { transport, resetNativeConfig } = await import('../../shared/push-native.ts');
const { saveSubscription, subscriptions, mergeSubscriptions, sendPush, pushChannels } = await import('./push.ts');
const { saveSettings } = await import('./settings.ts');

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures++;
};

interface Call { host?: string; url?: string; path?: string; headers: Record<string, string>; body: string }
let apnsCalls: Call[] = [];
let postCalls: Call[] = [];
/** Answer of APNs per host and token. */
let apnsAnswer: (host: string, token: string) => { status: number; body: string } = () => ({ status: 200, body: '' });
let fcmAnswer: () => { status: number; body: string } = () => ({ status: 200, body: '{"name":"projects/x/messages/1"}' });
transport.apns = async (host, p, headers, body) => {
    apnsCalls.push({ host, path: p, headers, body });
    return apnsAnswer(host, p.split('/').pop()!);
};
transport.post = async (url, headers, body) => {
    postCalls.push({ url, headers, body });
    if (url.startsWith('https://oauth2.googleapis.com/')) return { status: 200, body: JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }) };
    return fcmAnswer();
};

function verifyJwt(token: string, key: crypto.KeyObject, ec: boolean) {
    const [h, c, s] = token.split('.');
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), ec ? { key, dsaEncoding: 'ieee-p1363' } : key, Buffer.from(s, 'base64url'));
    return { ok, header: JSON.parse(Buffer.from(h, 'base64url').toString()), claims: JSON.parse(Buffer.from(c, 'base64url').toString()) };
}

const IPHONE = 'a'.repeat(64);
const DEV_IPHONE = 'b'.repeat(64);
const PIXEL = 'fcm-token-pixel-0123456789';

check('channels: web plus both app channels', pushChannels().join() === 'web,apns,fcm', pushChannels());
saveSubscription({ channel: 'apns', token: IPHONE, app: 'io.openfolk.app' });
saveSubscription({ channel: 'fcm', token: PIXEL, app: 'io.openfolk.app' });
saveSubscription({ channel: 'apns', token: IPHONE, app: 'io.openfolk.app' });
check('same token stored once', subscriptions().length === 2, subscriptions());

// ---- APNs, normal priority, default preview (title only)
await sendPush({ title: 'Cloud agent', body: 'Deploy finished: 3 services restarted', url: '/?chat=cloud', tag: 'cloud' }, 'done');
const a = apnsCalls[0];
check('APNs: production host and device path', a?.host === 'api.push.apple.com' && a.path === `/3/device/${IPHONE}`, a);
check('APNs: topic is the app id, alert push', a?.headers['apns-topic'] === 'io.openfolk.app' && a.headers['apns-push-type'] === 'alert');
check('APNs: priority 10, collapse id = tag', a?.headers['apns-priority'] === '10' && a.headers['apns-collapse-id'] === 'cloud');
const at = verifyJwt(a.headers.authorization.replace(/^bearer /, ''), apnsKeys.publicKey, true);
check('APNs token: ES256 signature valid, key id and team', at.ok && at.header.alg === 'ES256' && at.header.kid === 'KEY123' && at.claims.iss === 'TEAM456', at);
const ap = JSON.parse(a.body);
check('APNs payload: only the title by default, link to the chat', ap.aps.alert.title === 'Cloud agent' && ap.aps.alert.body === undefined && ap.url === '/?chat=cloud', ap);
check('APNs payload: with sound, active', ap.aps.sound === 'default' && ap.aps['interruption-level'] === 'active');

// ---- FCM
const tokenCall = postCalls.find((c) => c.url?.startsWith('https://oauth2.googleapis.com/'));
const assertion = new URLSearchParams(tokenCall?.body ?? '').get('assertion') ?? '';
const ft = verifyJwt(assertion, fcmKeys.publicKey, false);
check('FCM sign-in: RS256 assertion of the service account', ft.ok && ft.header.alg === 'RS256' && ft.claims.iss === 'push@openfolk-test.iam.gserviceaccount.com' && ft.claims.scope.includes('firebase.messaging'), ft);
const send = postCalls.find((c) => c.url?.includes('/messages:send'));
check('FCM: project from the service account, bearer token', send?.url === 'https://fcm.googleapis.com/v1/projects/openfolk-test/messages:send' && send.headers.authorization === 'Bearer ya29.test');
const fm = JSON.parse(send?.body ?? '{}').message;
check('FCM message: token, title only, link as data', fm?.token === PIXEL && fm.notification.title === 'Cloud agent' && fm.notification.body === undefined && fm.data.url === '/?chat=cloud', fm);
check('FCM message: normal priority, collapses per chat', fm?.android.priority === 'NORMAL' && fm.android.collapse_key === 'cloud' && fm.android.notification.tag === 'cloud');

// ---- quiet, full preview; access token reused
apnsCalls = [];
postCalls = [];
saveSettings({ pushPreview: 'full' });
await sendPush({ title: 'Routine', body: 'Backup ok', url: '/?chat=backup' }, 'routine').catch(() => undefined);
// 'routine' is normal by default; set quiet through the settings
const { savePushSettings } = await import('./push.ts');
savePushSettings({ routine: 'quiet' });
apnsCalls = [];
postCalls = [];
await sendPush({ title: 'Routine', body: 'Backup ok', url: '/?chat=backup' }, 'routine');
const q = JSON.parse(apnsCalls[0]?.body ?? '{}');
check('quiet: APNs priority 5, passive, no sound', apnsCalls[0]?.headers['apns-priority'] === '5' && q.aps['interruption-level'] === 'passive' && q.aps.sound === undefined, { headers: apnsCalls[0]?.headers, q });
check('full preview: text included', q.aps?.alert?.body === 'Backup ok', q);
check('FCM access token reused (no new sign-in)', !postCalls.some((c) => c.url?.startsWith('https://oauth2.')));
const qf = JSON.parse(postCalls[0]?.body ?? '{}').message;
check('quiet on Android: low notification priority without sound', qf?.android.notification.notification_priority === 'PRIORITY_LOW' && qf.android.notification.default_sound === undefined, qf);

saveSettings({ pushPreview: 'none' });
apnsCalls = [];
await sendPush({ title: 'Approval', body: 'rm -rf build', url: '/?chat=cloud' });
const n = JSON.parse(apnsCalls[0]?.body ?? '{}');
check('no preview: neither bot nor text, still the link', n.aps?.alert?.title === 'OpenFolk' && n.aps.alert.body === undefined && n.url === '/?chat=cloud', n);
check('without kind (security warning): high, time-sensitive', n.aps?.['interruption-level'] === 'time-sensitive' && apnsCalls[0].headers['apns-priority'] === '10');
saveSettings({ pushPreview: 'title' });

// ---- development build: production does not know the token, the sandbox does
saveSubscription({ channel: 'apns', token: DEV_IPHONE, app: 'io.openfolk.app' });
apnsAnswer = (host, token) => (token === DEV_IPHONE && host === 'api.push.apple.com' ? { status: 400, body: '{"reason":"BadDeviceToken"}' } : { status: 200, body: '' });
apnsCalls = [];
await sendPush({ title: 'x', body: 'y', url: '/' });
const devCalls = apnsCalls.filter((c) => c.path?.endsWith(DEV_IPHONE)).map((c) => c.host);
check('BadDeviceToken in production: sandbox tried', devCalls.join() === 'api.push.apple.com,api.sandbox.push.apple.com', devCalls);
check('sandbox remembered for the token', subscriptions().some((s) => 'token' in s && s.token === DEV_IPHONE && s.env === 'sandbox'), subscriptions());
apnsCalls = [];
await sendPush({ title: 'x', body: 'y', url: '/' });
check('next time straight to the sandbox', apnsCalls.filter((c) => c.path?.endsWith(DEV_IPHONE)).map((c) => c.host).join() === 'api.sandbox.push.apple.com');

// ---- uninstalled apps
apnsAnswer = (host, token) => (token === IPHONE ? { status: 410, body: '{"reason":"Unregistered"}' } : { status: 200, body: '' });
fcmAnswer = () => ({ status: 404, body: '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' });
await sendPush({ title: 'x', body: 'y', url: '/' });
const left = subscriptions().map((s) => ('token' in s ? s.token : s.endpoint));
check('unregistered tokens removed, others kept', left.length === 1 && left[0] === DEV_IPHONE, left);

// ---- other machines: tokens come along with the sync; a machine without credentials keeps but skips them
check('tokens of another machine merged once', mergeSubscriptions([{ channel: 'fcm', token: PIXEL }, { channel: 'fcm', token: PIXEL }, { channel: 'pigeon', token: 'xxxxxxxxxx' }]) === 1);
delete process.env.APNS_KEY_FILE;
delete process.env.FCM_SERVICE_ACCOUNT_FILE;
resetNativeConfig();
apnsCalls = [];
postCalls = [];
await sendPush({ title: 'x', body: 'y', url: '/' });
check('without credentials: only web', pushChannels().join() === 'web');
check('without credentials: no requests, tokens kept', apnsCalls.length === 0 && postCalls.length === 0 && subscriptions().length === 2, subscriptions());

// ---- the relay delivers for channels this machine has no credentials for (relay_hello)
const { relayPush } = await import('./push.ts');
const handed: { subscriptions: unknown[]; message: { title: string; body: string; url: string; priority: string } }[] = [];
relayPush.channels = () => ['fcm'];
relayPush.send = (subscriptions, message) => { handed.push({ subscriptions, message }); return true; };
await sendPush({ title: 'Cloud agent', body: 'Deploy finished', url: '/?chat=cloud', tag: 'cloud' }, 'done');
check('FCM tokens go to the relay, the APNs token (no credentials anywhere) stays home', handed.length === 1 && handed[0].subscriptions.length === 1 && (handed[0].subscriptions[0] as { token: string }).token === PIXEL, handed);
check('relay gets the preview only (title, no text) and the link', handed[0]?.message.title === 'Cloud agent' && handed[0]?.message.body === '' && handed[0]?.message.url === '/?chat=cloud' && handed[0]?.message.priority === 'normal', handed[0]?.message);
check('web app learns the relay\'s channel as deliverable', pushChannels().join() === 'web,fcm');
process.env.APNS_KEY_FILE = path.join(dir, 'AuthKey.p8');
process.env.APNS_KEY_ID = 'KEY123';
process.env.APNS_TEAM_ID = 'TEAM456';
resetNativeConfig();
relayPush.channels = () => ['apns', 'fcm'];
handed.length = 0;
apnsCalls = [];
await sendPush({ title: 'x', body: 'y', url: '/' });
check('own credentials win: APNs sent by this machine, only FCM handed to the relay', apnsCalls.length === 1 && handed.length === 1 && handed[0].subscriptions.length === 1, { apns: apnsCalls.length, handed });
relayPush.channels = () => [];
relayPush.send = () => false;

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all native push tests passed');
