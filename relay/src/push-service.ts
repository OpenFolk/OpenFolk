// App push for every backend: the relay of openfolk.app holds the APNs and FCM credentials of the store apps, so it
// delivers for backends on any relay (their own, a customer's, the desktop app's embedded one), not only for those
// connected to it (bridge.ts). The second exception to "the relay sees no contents" (AGENTS.md): what it sees is what
// Apple and Google see, the preview the backend already reduced by the user's pushPreview, and the device token.
// Nothing is stored; a token is limited to a few notifications per window, so a leaked token cannot be flooded.

import type { NativePushMessage, NativePushSubscription } from '../../shared/protocol.ts';

/** At most this many devices per request: one account rarely has more. */
export const PUSH_SERVICE_MAX_DEVICES = 20;

/** Checks and trims a backend's push: only channels this relay delivers, a title and a link. Null: nothing to send. */
export function cleanPush(input: unknown, channels: readonly string[], maxDevices: number): { subscriptions: NativePushSubscription[]; message: NativePushMessage } | null {
    const p = input as { subscriptions?: unknown; message?: Partial<NativePushMessage> } | null;
    const m = p?.message;
    if (!p || !Array.isArray(p.subscriptions) || !m || typeof m.title !== 'string' || typeof m.url !== 'string') return null;
    const subscriptions = p.subscriptions.filter((s): s is NativePushSubscription =>
        !!s && typeof s === 'object' && channels.includes((s as NativePushSubscription).channel)
        && typeof (s as NativePushSubscription).token === 'string' && (s as NativePushSubscription).token.length >= 8 && (s as NativePushSubscription).token.length <= 4096)
        .slice(0, maxDevices)
        .map((s) => ({ channel: s.channel, token: s.token, ...(typeof s.app === 'string' && s.app ? { app: s.app.slice(0, 200) } : {}), ...(s.env === 'sandbox' ? { env: 'sandbox' as const } : {}) }));
    if (!subscriptions.length) return null;
    const priority = m.priority === 'quiet' || m.priority === 'high' ? m.priority : 'normal';
    return {
        subscriptions,
        message: {
            title: m.title.slice(0, 200), body: typeof m.body === 'string' ? m.body.slice(0, 500) : '', url: m.url.slice(0, 500),
            ...(typeof m.tag === 'string' ? { tag: m.tag.slice(0, 64) } : {}), priority,
            ttlSeconds: typeof m.ttlSeconds === 'number' ? Math.min(Math.max(60, m.ttlSeconds), 7 * 24 * 3600) : 3600,
        },
    };
}

/** Windows per key: at most `max` hits within `ms`. */
type Window = { ms: number; max: number };

/** Counts hits per key in several windows at once; forgets keys whose longest window has passed. */
export class Limiter {
    private hits = new Map<string, number[]>();
    private readonly windows: Window[];
    private readonly now: () => number;
    constructor(windows: Window[], now: () => number = Date.now) {
        this.windows = windows;
        this.now = now;
    }

    /** Records a hit and says whether it is within every window; a refused hit does not count. */
    take(key: string): boolean {
        const t = this.now();
        const longest = Math.max(...this.windows.map((w) => w.ms));
        const list = (this.hits.get(key) ?? []).filter((x) => t - x < longest);
        const ok = this.windows.every((w) => list.filter((x) => t - x < w.ms).length < w.max);
        if (ok) list.push(t);
        if (list.length) this.hits.set(key, list);
        else this.hits.delete(key);
        if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < longest)) this.hits.delete(k);
        return ok;
    }
}

/** Per device: a busy bot day fits, a flood does not. */
export const DEVICE_WINDOWS: Window[] = [{ ms: 10 * 60_000, max: 30 }, { ms: 24 * 3600_000, max: 400 }];
/** Per sending address: a backend with a few accounts and devices, not a sender for strangers' tokens. */
export const SENDER_WINDOWS: Window[] = [{ ms: 60 * 60_000, max: 2000 }];

export interface PushServiceAnswer {
    status: number;
    body: { gone?: string[]; throttled?: number; error?: string };
}

/**
 * One request of a backend (POST /push): `deliver` sends to Apple or Google and returns the subscriptions they no longer
 * know. Answer: the tokens to drop and how many devices were held back by the limit.
 */
export async function handlePushRequest(
    body: unknown, sender: string, channels: readonly string[], limits: { devices: Limiter; senders: Limiter },
    deliver: (subs: NativePushSubscription[], message: NativePushMessage) => Promise<NativePushSubscription[]>,
): Promise<PushServiceAnswer> {
    if (!channels.length) return { status: 404, body: { error: 'no_push_service' } };
    const push = cleanPush(body, channels, PUSH_SERVICE_MAX_DEVICES);
    if (!push) return { status: 400, body: { error: 'invalid' } };
    if (!limits.senders.take(sender)) return { status: 429, body: { error: 'too_many' } };
    const allowed = push.subscriptions.filter((s) => limits.devices.take(`${s.channel}:${s.token}`));
    const gone = allowed.length ? await deliver(allowed, push.message) : [];
    return { status: 200, body: { gone: gone.map((s) => s.token), throttled: push.subscriptions.length - allowed.length } };
}
