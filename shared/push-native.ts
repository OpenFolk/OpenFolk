// Push to the mobile apps: Apple Push Notification service (iOS) and Firebase Cloud Messaging (Android), sent directly
// from this machine like Web Push. No extra packages: APNs speaks HTTP/2 with an ES256 token, FCM HTTP v1 with an
// OAuth token from a service account (RS256).
//
// Unlike Web Push the contents are not end-to-end encrypted: Apple and Google see what is sent. The backend reduces
// the text before it sends or hands it to the relay (visibleText, after the shared setting pushPreview): 'title'
// (default, only the title such as the bot's name), 'full' (title and text) or 'none' (only "OpenFolk"). The link
// that opens the chat is always included.
//
// Credentials belong to whoever builds the app (Apple developer account, Firebase project); see mobile/README.md.
// Runs in a backend (local/src/push.ts) or in the relay, which delivers for backends without credentials.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import type { NativePushChannel, NativePushMessage, NativePushSubscription, PushPreview } from './protocol.ts';

export type NativeChannel = NativePushChannel;
export type NativeSubscription = NativePushSubscription;
export type NativeMessage = NativePushMessage;

/** Result per device: delivered, gone (remove the token), or another error (keep it). */
export type NativeResult = { ok: true; env?: 'sandbox' } | { ok: false; gone: boolean; error: string };

// ------------------------------------------------------------------ configuration

interface ApnsConfig {
    key: crypto.KeyObject;
    keyId: string;
    teamId: string;
    /** Bundle id if the app does not report one. */
    topic: string;
    /** 'auto' tries production first and falls back to the sandbox for development builds. */
    env: 'auto' | 'production' | 'sandbox';
}

interface FcmConfig {
    clientEmail: string;
    key: crypto.KeyObject;
    projectId: string;
}

function readKey(file: string | undefined, inline: string | undefined): string | null {
    if (inline) return inline.replace(/\\n/g, '\n');
    if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    return null;
}

let apnsCache: ApnsConfig | null | undefined;
let fcmCache: FcmConfig | null | undefined;

/** APNS_KEY_FILE (.p8 from the Apple developer account) or APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID; APNS_TOPIC, APNS_ENV optional. */
export function apnsConfig(): ApnsConfig | null {
    if (apnsCache !== undefined) return apnsCache;
    const pem = readKey(process.env.APNS_KEY_FILE, process.env.APNS_KEY);
    const keyId = process.env.APNS_KEY_ID ?? '';
    const teamId = process.env.APNS_TEAM_ID ?? '';
    if (!pem || !keyId || !teamId) return (apnsCache = null);
    try {
        const env = process.env.APNS_ENV === 'production' || process.env.APNS_ENV === 'sandbox' ? process.env.APNS_ENV : 'auto';
        apnsCache = { key: crypto.createPrivateKey(pem), keyId, teamId, topic: process.env.APNS_TOPIC ?? '', env };
    } catch (e) {
        console.log(`push: APNs key unusable (${(e as Error).message})`);
        apnsCache = null;
    }
    return apnsCache;
}

/**
 * JSON key of a Firebase service account (project settings, service accounts): FCM_SERVICE_ACCOUNT_FILE, or the JSON
 * itself in FCM_SERVICE_ACCOUNT (containers).
 */
export function fcmConfig(): FcmConfig | null {
    if (fcmCache !== undefined) return fcmCache;
    const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
    const inline = process.env.FCM_SERVICE_ACCOUNT;
    if (!inline && (!file || !fs.existsSync(file))) return (fcmCache = null);
    try {
        const j = JSON.parse(inline || fs.readFileSync(file!, 'utf8')) as { client_email?: string; private_key?: string; project_id?: string };
        if (!j.client_email || !j.private_key || !j.project_id) throw new Error('client_email, private_key or project_id missing');
        fcmCache = { clientEmail: j.client_email, key: crypto.createPrivateKey(j.private_key), projectId: j.project_id };
    } catch (e) {
        console.log(`push: FCM service account unusable (${(e as Error).message})`);
        fcmCache = null;
    }
    return fcmCache;
}

/** Channels this machine can send to; the web app learns them with the VAPID key. */
export function nativeChannels(): NativeChannel[] {
    return [...(apnsConfig() ? ['apns' as const] : []), ...(fcmConfig() ? ['fcm' as const] : [])];
}

/** Forget cached configuration and tokens (tests, changed .env). */
export function resetNativeConfig(): void {
    apnsCache = undefined;
    fcmCache = undefined;
    apnsJwt = null;
    fcmToken = null;
}

// ------------------------------------------------------------------ tokens

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

function jwt(header: object, claims: object, key: crypto.KeyObject, ec: boolean): string {
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = ec
        ? crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
        : crypto.sign('sha256', Buffer.from(input), key);
    return `${input}.${b64url(signature)}`;
}

/** Apple accepts a provider token for up to an hour and asks not to renew it more often than every 20 minutes. */
let apnsJwt: { token: string; at: number } | null = null;
const APNS_JWT_MS = 50 * 60_000;

function apnsToken(c: ApnsConfig, now = Date.now()): string {
    if (apnsJwt && now - apnsJwt.at < APNS_JWT_MS) return apnsJwt.token;
    const token = jwt({ alg: 'ES256', kid: c.keyId }, { iss: c.teamId, iat: Math.floor(now / 1000) }, c.key, true);
    apnsJwt = { token, at: now };
    return token;
}

let fcmToken: { token: string; until: number } | null = null;

async function fcmAccessToken(c: FcmConfig): Promise<string> {
    if (fcmToken && Date.now() < fcmToken.until) return fcmToken.token;
    const iat = Math.floor(Date.now() / 1000);
    const assertion = jwt({ alg: 'RS256', typ: 'JWT' }, {
        iss: c.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
    }, c.key, false);
    const r = await transport.post('https://oauth2.googleapis.com/token', {
        'content-type': 'application/x-www-form-urlencoded',
    }, new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString());
    const j = JSON.parse(r.body || '{}') as { access_token?: string; expires_in?: number; error_description?: string };
    if (r.status !== 200 || !j.access_token) throw new Error(`FCM sign-in failed: ${r.status} ${j.error_description ?? r.body.slice(0, 200)}`);
    fcmToken = { token: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 120) * 1000 };
    return fcmToken.token;
}

// ------------------------------------------------------------------ transport (replaced in tests)

export interface HttpAnswer {
    status: number;
    body: string;
}

export const transport = {
    /** HTTP/2 POST to APNs; one connection per host, reused. */
    apns(host: string, path: string, headers: Record<string, string>, body: string): Promise<HttpAnswer> {
        return new Promise((resolve, reject) => {
            const session = apnsSession(host);
            const req = session.request({ ':method': 'POST', ':path': path, ...headers });
            let status = 0;
            let data = '';
            req.setEncoding('utf8');
            req.on('response', (h) => { status = Number(h[':status']); });
            req.on('data', (chunk: string) => { data += chunk; });
            req.on('end', () => resolve({ status, body: data }));
            req.on('error', reject);
            req.setTimeout(15_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
            req.end(body);
        });
    },
    async post(url: string, headers: Record<string, string>, body: string): Promise<HttpAnswer> {
        const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
        return { status: r.status, body: await r.text() };
    },
};

const sessions = new Map<string, http2.ClientHttp2Session>();

function apnsSession(host: string): http2.ClientHttp2Session {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const session = http2.connect(`https://${host}`);
    session.on('error', () => sessions.delete(host));
    session.on('close', () => sessions.delete(host));
    // Do not keep the process alive for an idle connection
    session.unref();
    sessions.set(host, session);
    return session;
}

// ------------------------------------------------------------------ sending

/** What Apple and Google get to see, per the shared setting pushPreview. */
export function visibleText(m: Pick<NativeMessage, 'title' | 'body'>, preview: PushPreview): { title: string; body: string } {
    if (preview === 'full') return { title: m.title, body: m.body };
    if (preview === 'none') return { title: 'OpenFolk', body: '' };
    return { title: m.title, body: '' };
}

const APNS_HOSTS = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' };

async function sendApns(sub: NativeSubscription, m: NativeMessage): Promise<NativeResult> {
    const c = apnsConfig();
    if (!c) return { ok: false, gone: false, error: 'APNs not configured' };
    const topic = sub.app || c.topic;
    if (!topic) return { ok: false, gone: false, error: 'no app id (APNS_TOPIC)' };
    const payload = {
        aps: {
            alert: m.body ? { title: m.title, body: m.body } : { title: m.title },
            ...(m.priority === 'quiet' ? {} : { sound: 'default' }),
            'thread-id': m.tag ?? 'openfolk',
            // quiet: no sound, no wake of the screen; high: breaks through focus modes that allow time-sensitive ones
            'interruption-level': m.priority === 'quiet' ? 'passive' : m.priority === 'high' ? 'time-sensitive' : 'active',
        },
        url: m.url,
        ...(m.tag ? { tag: m.tag } : {}),
    };
    const headers: Record<string, string> = {
        authorization: `bearer ${apnsToken(c)}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': m.priority === 'quiet' ? '5' : '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + m.ttlSeconds),
        ...(m.tag ? { 'apns-collapse-id': m.tag.slice(0, 64) } : {}),
    };
    const envs: ('production' | 'sandbox')[] = c.env === 'auto' ? (sub.env === 'sandbox' ? ['sandbox'] : ['production', 'sandbox']) : [c.env];
    let last: NativeResult = { ok: false, gone: false, error: 'not sent' };
    for (const env of envs) {
        const r = await transport.apns(APNS_HOSTS[env], `/3/device/${sub.token}`, headers, JSON.stringify(payload));
        if (r.status === 200) return env === 'sandbox' && c.env === 'auto' ? { ok: true, env: 'sandbox' } : { ok: true };
        const reason = (JSON.parse(r.body || '{}') as { reason?: string }).reason ?? '';
        // A development build's token is unknown to production (BadDeviceToken): try the sandbox before giving up
        if (reason === 'BadDeviceToken' && env === 'production' && envs.length > 1) continue;
        last = { ok: false, gone: r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered', error: `APNs ${r.status} ${reason}` };
        break;
    }
    return last;
}

async function sendFcm(sub: NativeSubscription, m: NativeMessage): Promise<NativeResult> {
    const c = fcmConfig();
    if (!c) return { ok: false, gone: false, error: 'FCM not configured' };
    const message = {
        message: {
            token: sub.token,
            notification: m.body ? { title: m.title, body: m.body } : { title: m.title },
            // data values must be strings; the app reads url when the notification is tapped
            data: { url: m.url, tag: m.tag ?? '', priority: m.priority },
            android: {
                priority: m.priority === 'high' ? 'HIGH' : 'NORMAL',
                ttl: `${m.ttlSeconds}s`,
                ...(m.tag ? { collapse_key: m.tag } : {}),
                notification: {
                    ...(m.tag ? { tag: m.tag } : {}),
                    notification_priority: m.priority === 'quiet' ? 'PRIORITY_LOW' : m.priority === 'high' ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT',
                    ...(m.priority === 'quiet' ? {} : { default_sound: true }),
                },
            },
        },
    };
    const r = await transport.post(`https://fcm.googleapis.com/v1/projects/${c.projectId}/messages:send`, {
        authorization: `Bearer ${await fcmAccessToken(c)}`,
        'content-type': 'application/json',
    }, JSON.stringify(message));
    if (r.status === 200) return { ok: true };
    const body = r.body || '';
    // Token of an uninstalled app or from another project
    const gone = r.status === 404 || body.includes('UNREGISTERED') || (r.status === 400 && body.includes('registration token'));
    if (r.status === 401) fcmToken = null;
    return { ok: false, gone, error: `FCM ${r.status} ${body.slice(0, 200)}` };
}

/** Sends `m` as it is: the backend has reduced it to what Apple and Google may see (visibleText). */
export function sendNative(sub: NativeSubscription, m: NativeMessage): Promise<NativeResult> {
    return sub.channel === 'apns' ? sendApns(sub, m) : sendFcm(sub, m);
}
