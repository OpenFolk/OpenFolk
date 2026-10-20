// Push directly from the home machine: Web Push to the browsers' push services (end-to-end encrypted) and, through
// push-native.ts, APNs and FCM to the mobile apps. For app channels this machine has no credentials for, the relay
// delivers if it has them (relay_hello); then the relay sees what Apple and Google see.

import webpush, { type PushSubscription } from 'web-push';
import { nativeChannels, sendNative, visibleText, type NativeChannel, type NativeSubscription } from '../../shared/push-native.ts';
import { config } from './config.ts';
import { pushPreview } from './settings.ts';
import { currentAccount, DEFAULT_ACCOUNT, readJson, readMachineJson, writeJson, writeMachineJson } from './store.ts';
import type { NativePushMessage, PushKind, PushPriority, PushSettings } from '../../shared/protocol.ts';

/** The relay as a second way to the apps (index.ts wires the relay client in). */
export const relayPush: {
    channels: () => NativeChannel[];
    send: (subscriptions: NativeSubscription[], message: NativePushMessage) => boolean;
} = { channels: () => [], send: () => false };

/** A browser's Web Push subscription or an app installation's device token. */
export type StoredSubscription = PushSubscription | NativeSubscription;

const isNativeSub = (s: StoredSubscription): s is NativeSubscription => 'channel' in s;
const sameSub = (a: StoredSubscription, b: StoredSubscription) => isNativeSub(a)
    ? isNativeSub(b) && a.channel === b.channel && a.token === b.token
    : !isNativeSub(b) && a.endpoint === b.endpoint;

/** Checks and trims what a browser, an app or another machine sent; null if it is no subscription. */
function cleanSubscription(input: unknown): StoredSubscription | null {
    const s = input as Partial<PushSubscription & NativeSubscription> | null;
    if (!s || typeof s !== 'object') return null;
    if ((s.channel === 'apns' || s.channel === 'fcm') && typeof s.token === 'string' && s.token.length >= 8 && s.token.length <= 4096) {
        return { channel: s.channel, token: s.token, ...(typeof s.app === 'string' && s.app ? { app: s.app } : {}), ...(s.env === 'sandbox' ? { env: 'sandbox' as const } : {}) };
    }
    if (typeof s.endpoint === 'string' && s.keys?.p256dh && s.keys?.auth) return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
    return null;
}

/** Push channels this machine can deliver to: always Web Push, the apps' channels once configured here or on the relay. */
export function pushChannels(): ('web' | NativeChannel)[] {
    return ['web', ...new Set([...nativeChannels(), ...relayPush.channels()])];
}

/** Drops app device tokens the push services no longer know (reported by the relay). */
export function removeSubscriptions(gone: NativeSubscription[]): number {
    const list = subscriptions();
    const next = list.filter((a) => !gone.some((g) => sameSub(a, g)));
    if (next.length !== list.length) writeJson('push.json', next);
    return list.length - next.length;
}

export const PUSH_KINDS: PushKind[] = ['done', 'routine', 'approval', 'awake', 'limit'];
const PRIORITIES: PushPriority[] = ['off', 'quiet', 'normal', 'high'];
const DEFAULTS: Record<PushKind, PushPriority> = { done: 'normal', routine: 'normal', approval: 'high', awake: 'normal', limit: 'normal' };
const FILE = 'push-settings.json';

export function pushSettings(): PushSettings {
    const e = readJson<Partial<PushSettings>>(FILE, {});
    const kinds = { ...DEFAULTS };
    for (const k of PUSH_KINDS) if (PRIORITIES.includes(e.kinds?.[k] as PushPriority)) kinds[k] = e.kinds![k];
    return { kinds, updatedAt: e.updatedAt ?? '' };
}

/** Change the priority of single kinds; unknown kinds and values are ignored. */
export function savePushSettings(kinds: Partial<Record<PushKind, PushPriority>>): PushSettings {
    const e = pushSettings();
    for (const k of PUSH_KINDS) if (PRIORITIES.includes(kinds[k] as PushPriority)) e.kinds[k] = kinds[k]!;
    e.updatedAt = new Date().toISOString();
    writeJson(FILE, e);
    return e;
}

/** Take over the state of another machine if it is newer; true = changed. */
export function mergePushSettings(other: PushSettings | undefined): boolean {
    if (!other?.updatedAt || other.updatedAt <= pushSettings().updatedAt) return false;
    const e = pushSettings();
    for (const k of PUSH_KINDS) if (PRIORITIES.includes(other.kinds?.[k])) e.kinds[k] = other.kinds[k];
    e.updatedAt = other.updatedAt;
    writeJson(FILE, e);
    return true;
}

interface Vapid {
    publicKey: string;
    privateKey: string;
}

let vapid: Vapid | null = null;

/**
 * Contact for the push services (VAPID subject): the public https address of the web app or the relay; the push
 * services accept no plain http, so an embedded relay gets a mailto: placeholder.
 */
export function vapidSubject(appUrl = process.env.APP_URL, relayUrl = config.relayUrl): string {
    for (const raw of [appUrl, relayUrl]) {
        try {
            const u = new URL((raw ?? '').trim().replace(/^wss:/, 'https:'));
            if (u.protocol === 'https:') return u.origin;
        } catch { /* not an address */ }
    }
    return 'mailto:admin@localhost';
}

function keys(): Vapid {
    if (vapid) return vapid;
    // Several machines need the same key pair, otherwise the push services reject the second machine's
    // messages: then set both values in the .env of every machine.
    const pub = process.env.PUSH_VAPID_PUBLIC_KEY;
    const priv = process.env.PUSH_VAPID_PRIVATE_KEY;
    vapid = pub && priv ? { publicKey: pub, privateKey: priv } : readMachineJson<Vapid | null>('vapid.json', null);
    if (!vapid) {
        vapid = webpush.generateVAPIDKeys();
        writeMachineJson('vapid.json', vapid);
    }
    webpush.setVapidDetails(vapidSubject(), vapid.publicKey, vapid.privateKey);
    return vapid;
}

/** The key pair for answering a joined machine (join.ts). */
export function vapidKeys(): Vapid {
    return keys();
}

/**
 * Takes over the key pair the other machines share, unless the .env sets one. Browsers subscribed with this
 * machine's earlier key subscribe again with the new one on their next connect (push_key).
 */
export function adoptVapid(v: Vapid): boolean {
    if (process.env.PUSH_VAPID_PUBLIC_KEY && process.env.PUSH_VAPID_PRIVATE_KEY) return false;
    writeMachineJson('vapid.json', v);
    vapid = null;
    keys();
    return true;
}

export function publicKey(): string {
    return keys().publicKey;
}

export function subscriptions(): StoredSubscription[] {
    return readJson<StoredSubscription[]>('push.json', []);
}

/** Take over the subscriptions of another machine; returns the number of new ones. */
export function mergeSubscriptions(others: unknown[]): number {
    const list = subscriptions();
    let added = 0;
    for (const f of others) {
        const s = cleanSubscription(f);
        if (!s || list.some((a) => sameSub(a, s))) continue;
        list.push(s);
        added++;
    }
    if (added) writeJson('push.json', list);
    return added;
}

export function saveSubscription(sub: unknown): void {
    const s = cleanSubscription(sub);
    if (!s) throw new Error('Invalid push subscription');
    const list = subscriptions().filter((a) => !sameSub(a, s));
    list.push(s);
    writeJson('push.json', list);
}

export interface PushMessage {
    title: string;
    body: string;
    /** Relative link, e.g. /?chat=cloud */
    url: string;
    /** The same tag replaces an older notification of the same chat. */
    tag?: string;
}

/** Delivery per priority: urgency for the push service and how long it keeps trying. */
const DELIVERY: Record<Exclude<PushPriority, 'off'>, { urgency: 'low' | 'normal' | 'high'; TTL: number }> = {
    quiet: { urgency: 'low', TTL: 3600 },
    normal: { urgency: 'normal', TTL: 3600 },
    high: { urgency: 'high', TTL: 24 * 3600 },
};

/**
 * Sends to all subscriptions. `kind` decides via the settings whether and with which priority; without `kind`
 * (security warnings) always with high priority.
 */
export async function sendPush(n: PushMessage, kind?: PushKind): Promise<void> {
    // A device can be signed in to several accounts: the notification opens its own one, and the same chat id in two
    // accounts does not replace the other's notification
    const account = currentAccount();
    if (account !== DEFAULT_ACCOUNT) {
        n = { ...n, url: `${n.url}${n.url.includes('?') ? '&' : '?'}account=${encodeURIComponent(account)}`, ...(n.tag ? { tag: `${account}:${n.tag}` } : {}) };
    }
    const priority: PushPriority = kind ? pushSettings().kinds[kind] : 'high';
    if (priority === 'off') return;
    const list = subscriptions();
    if (list.length === 0) return;
    keys();
    const body = n.body.length > 240 ? n.body.slice(0, 239) + '…' : n.body;
    // `prio` carries the same value for service workers that still read the old field name
    const payload = JSON.stringify({ ...n, priority, prio: priority, body });
    const native = nativeChannels();
    const gone: StoredSubscription[] = [];
    const sandbox: StoredSubscription[] = [];
    // Without own credentials for a channel the relay delivers, with the text already reduced to the preview
    const viaRelay = list.filter((s): s is NativeSubscription => isNativeSub(s) && !native.includes(s.channel) && relayPush.channels().includes(s.channel));
    if (viaRelay.length) {
        const text = visibleText({ title: n.title, body }, pushPreview());
        relayPush.send(viaRelay, { ...text, url: n.url, ...(n.tag ? { tag: n.tag } : {}), priority, ttlSeconds: DELIVERY[priority].TTL });
    }
    await Promise.all(list.map(async (sub) => {
        if (isNativeSub(sub)) {
            // Another machine or the relay may have the credentials; this one skips the channel
            if (!native.includes(sub.channel)) return;
            try {
                const r = await sendNative(sub, { ...visibleText({ title: n.title, body }, pushPreview()), url: n.url, tag: n.tag, priority, ttlSeconds: DELIVERY[priority].TTL });
                if (r.ok && r.env === 'sandbox' && sub.env !== 'sandbox') sandbox.push(sub);
                if (!r.ok && r.gone) gone.push(sub);
                if (!r.ok && !r.gone) console.log(`push: ${r.error}`);
            } catch (e) {
                console.log(`push: ${sub.channel} ${(e as Error).message}`);
            }
            return;
        }
        try {
            await webpush.sendNotification(sub, payload, DELIVERY[priority]);
        } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) gone.push(sub);
            else console.log(`push: error ${status ?? ''} ${(e as Error).message}`);
        }
    }));
    if (gone.length || sandbox.length) {
        // Re-read: a device may have subscribed meanwhile
        const next = subscriptions()
            .filter((a) => !gone.some((g) => sameSub(a, g)))
            .map((a) => (isNativeSub(a) && sandbox.some((s) => sameSub(a, s)) ? { ...a, env: 'sandbox' as const } : a));
        writeJson('push.json', next);
    }
}
