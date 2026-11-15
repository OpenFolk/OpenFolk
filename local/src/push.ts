// Push directly from the home machine: Web Push to the browsers' push services (end-to-end encrypted) and, through
// push-native.ts, APNs and FCM to the mobile apps. For app channels this machine has no credentials for, the relay
// delivers if it has them (relay_hello); then the relay sees what Apple and Google see.

import webpush, { type PushSubscription } from 'web-push';
import { nativeChannels, sendNative, visibleText, type NativeChannel, type NativeSubscription } from '../../shared/push-native.ts';
import { config } from './config.ts';
import { pushPreview } from './settings.ts';
import { currentAccount, DEFAULT_ACCOUNT, readJson, readMachineJson, writeJson, writeMachineJson } from './store.ts';
import type { DeviceForm, NativePushMessage, PushKind, PushPriority, PushSettings } from '../../shared/protocol.ts';

/** The relay as a second way to the apps (index.ts wires the relay client in). */
export const relayPush: {
    channels: () => NativeChannel[];
    send: (subscriptions: NativeSubscription[], message: NativePushMessage) => boolean;
} = { channels: () => [], send: () => false };

/** What a device said about itself with its subscription (push_subscribe); synced with it, the newer state wins. */
export interface DeviceTraits {
    form?: DeviceForm;
    /** The device opted out of staying quiet while a desktop is in use. */
    always?: true;
    traitsAt?: string;
}

/** A browser's Web Push subscription or an app installation's device token. */
export type StoredSubscription = (PushSubscription | NativeSubscription) & DeviceTraits;

const isNativeSub = (s: StoredSubscription): s is NativeSubscription & DeviceTraits => 'channel' in s;
const sameSub = (a: StoredSubscription, b: StoredSubscription) => isNativeSub(a)
    ? isNativeSub(b) && a.channel === b.channel && a.token === b.token
    : !isNativeSub(b) && a.endpoint === b.endpoint;
/** The apps run on phones and tablets only; a browser says what it is (old ones do not, they count as neither). */
const isPhone = (s: StoredSubscription) => isNativeSub(s) || s.form === 'phone';

function traitsOf(s: Partial<DeviceTraits>): DeviceTraits {
    return {
        ...(s.form === 'desktop' || s.form === 'phone' ? { form: s.form } : {}),
        ...(s.always === true ? { always: true as const } : {}),
        ...(typeof s.traitsAt === 'string' && s.traitsAt.length <= 40 ? { traitsAt: s.traitsAt } : {}),
    };
}

/** Checks and trims what a browser, an app or another machine sent; null if it is no subscription. */
function cleanSubscription(input: unknown): StoredSubscription | null {
    const s = input as Partial<PushSubscription & NativeSubscription & DeviceTraits> | null;
    if (!s || typeof s !== 'object') return null;
    if ((s.channel === 'apns' || s.channel === 'fcm') && typeof s.token === 'string' && s.token.length >= 8 && s.token.length <= 4096) {
        return { channel: s.channel, token: s.token, ...(typeof s.app === 'string' && s.app ? { app: s.app } : {}), ...(s.env === 'sandbox' ? { env: 'sandbox' as const } : {}), ...traitsOf(s) };
    }
    if (typeof s.endpoint === 'string' && s.keys?.p256dh && s.keys?.auth) return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ...traitsOf(s) };
    return null;
}

/** The subscription without the device's traits: what the relay gets for delivery. */
const bare = ({ channel, token, app, env }: NativeSubscription): NativeSubscription => ({ channel, token, ...(app ? { app } : {}), ...(env ? { env } : {}) });

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

export const PUSH_KINDS: PushKind[] = ['done', 'routine', 'approval', 'awake', 'limit', 'message', 'handover'];
const PRIORITIES: PushPriority[] = ['off', 'quiet', 'normal', 'high'];
const DEFAULTS: Record<PushKind, PushPriority> = { done: 'normal', routine: 'normal', approval: 'high', awake: 'normal', limit: 'normal', message: 'normal', handover: 'high' };
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

/** Take over the subscriptions of another machine and newer device traits; returns the number of new ones. */
export function mergeSubscriptions(others: unknown[]): number {
    const list = subscriptions();
    let added = 0;
    let changed = false;
    for (const f of others) {
        const s = cleanSubscription(f);
        if (!s) continue;
        const i = list.findIndex((a) => sameSub(a, s));
        if (i < 0) {
            list.push(s);
            added++;
        } else if (s.traitsAt && s.traitsAt > (list[i].traitsAt ?? '')) {
            // Old backends drop the traits; their copy has no time and never wins
            const { form: _form, always: _always, traitsAt: _at, ...rest } = list[i];
            list[i] = { ...rest, ...traitsOf(s) } as StoredSubscription;
            changed = true;
        }
    }
    if (added || changed) writeJson('push.json', list);
    return added;
}

/** Stores a device's subscription; `traits` from the frame, missing ones (old clients) keep what was stored. */
export function saveSubscription(sub: unknown, traits: { form?: DeviceForm; always?: boolean } = {}): void {
    const s = cleanSubscription(sub);
    if (!s) throw new Error('Invalid push subscription');
    const all = subscriptions();
    const old = all.find((a) => sameSub(a, s));
    const form = traits.form ?? old?.form ?? s.form;
    const always = traits.always ?? (old ? old.always : s.always) ?? false;
    const same = old && form === old.form && always === Boolean(old.always);
    const traitsAt = same ? old?.traitsAt : form || always ? new Date().toISOString() : old?.traitsAt;
    const { form: _form, always: _always, traitsAt: _at, ...rest } = s;
    const list = all.filter((a) => !sameSub(a, s));
    list.push({ ...rest, ...traitsOf({ form, always: always || undefined, traitsAt }) } as StoredSubscription);
    writeJson('push.json', list);
}

/** What a connected client last said in `presence`, with the time it arrived. */
export interface Presence {
    visible: boolean;
    desktop?: boolean;
    active?: boolean;
    at: number;
}

/**
 * A desktop's report of being in use holds this long: its two minutes without input plus the minute it may wait
 * before reporting again. Without a fresh report (a socket that died quietly) the desktop no longer counts.
 */
export const ACTIVE_MS = 3 * 60_000;

/**
 * Who is looking: `others` = a visible client that counts as watching the way it always did (a phone, or a client too
 * old to say what it is), `desk` = a desktop in use. A visible desktop without input is neither: whoever left it gets
 * the push on the phone.
 */
export function attention(clients: Iterable<Presence>, now = Date.now()): { others: boolean; desk: boolean } {
    let others = false;
    let desk = false;
    for (const c of clients) {
        if (!c.visible) continue;
        if (c.desktop !== true) others = true;
        else if (c.active && now - c.at < ACTIVE_MS) desk = true;
    }
    return { others, desk };
}

/** How long a phone's request waits while a desktop is in use (an object so the tests can shorten it). */
export const phoneDelay = { ms: 3 * 60_000 };

export interface PushContext {
    /** A desktop is in use (attention()). */
    desk?: boolean;
    /** For a phone's delayed notification: still worth sending when the wait is over (not answered, chat not opened). */
    due?: () => boolean;
}

/**
 * Whether a subscription gets a notification now, after phoneDelay or not at all, while a desktop is in use. Answers
 * and routine results are read at the desk; requests (approval, hand-over) reach the phone once nobody at the desk
 * took them up. Everything else, and a device set to "always notify", as without a desktop.
 */
export function route(kind: PushKind | undefined, desk: boolean, s: StoredSubscription): 'now' | 'later' | 'skip' {
    if (!desk || !kind || s.always) return 'now';
    switch (kind) {
        case 'approval':
        case 'handover':
            return isPhone(s) ? 'later' : 'now';
        case 'done':
        case 'routine':
        case 'message':
            // The desk is watching: what the old rule did for every visible client
            return 'skip';
        default:
            return 'now';
    }
}

export interface PushMessage {
    title: string;
    body: string;
    /** Relative link, e.g. /?chat=cloud */
    url: string;
    /** The same tag replaces an older notification of the same chat. */
    tag?: string;
}

/** The web app's address as the apps store it: APP_URL, otherwise the relay's own (pairing.ts has the same rule). */
function relayOrigin(): string {
    const raw = process.env.APP_URL?.trim() || config.relayUrl;
    const u = new URL(raw);
    u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
    return u.origin;
}

/** The message for the apps: `relay=` in the link, the relay's host in front of the tag. */
export function withRelay(n: PushMessage): PushMessage {
    const origin = relayOrigin();
    return { ...n, url: `${n.url}${n.url.includes('?') ? '&' : '?'}relay=${encodeURIComponent(origin)}`, ...(n.tag ? { tag: `${new URL(origin).host}:${n.tag}` } : {}) };
}

/** Delivery per priority: urgency for the push service and how long it keeps trying. */
const DELIVERY: Record<Exclude<PushPriority, 'off'>, { urgency: 'low' | 'normal' | 'high'; TTL: number }> = {
    quiet: { urgency: 'low', TTL: 3600 },
    normal: { urgency: 'normal', TTL: 3600 },
    high: { urgency: 'high', TTL: 24 * 3600 },
};

/**
 * Sends to all subscriptions. `kind` decides via the settings whether and with which priority; without `kind`
 * (security warnings) always with high priority. While a desktop is in use (`context.desk`) route() holds some back.
 */
export async function sendPush(n: PushMessage, kind?: PushKind, context: PushContext = {}): Promise<void> {
    // A device can be signed in to several accounts: the notification opens its own one, and the same chat id in two
    // accounts does not replace the other's notification
    const account = currentAccount();
    if (account !== DEFAULT_ACCOUNT) {
        n = { ...n, url: `${n.url}${n.url.includes('?') ? '&' : '?'}account=${encodeURIComponent(account)}`, ...(n.tag ? { tag: `${account}:${n.tag}` } : {}) };
    }
    const priority: PushPriority = kind ? pushSettings().kinds[kind] : 'high';
    if (priority === 'off') return;
    const now: StoredSubscription[] = [];
    const later: StoredSubscription[] = [];
    for (const s of subscriptions()) {
        const r = route(kind, Boolean(context.desk), s);
        if (r === 'now') now.push(s);
        else if (r === 'later') later.push(s);
    }
    if (later.length) {
        const message = n;
        // In memory only: a restart of the backend drops what is still waiting. The timer runs in this account's context.
        setTimeout(() => {
            if (context.due && !context.due()) return;
            // Re-read: a token may have been dropped meanwhile
            const still = subscriptions().filter((s) => later.some((l) => sameSub(l, s)));
            deliver(still, message, priority).catch((e) => console.log(`push: ${(e as Error).message}`));
        }, phoneDelay.ms).unref();
    }
    await deliver(now, n, priority);
}

async function deliver(list: StoredSubscription[], n: PushMessage, priority: Exclude<PushPriority, 'off'>): Promise<void> {
    if (list.length === 0) return;
    keys();
    const body = n.body.length > 240 ? n.body.slice(0, 239) + '…' : n.body;
    // `prio` carries the same value for service workers that still read the old field name
    const payload = JSON.stringify({ ...n, priority, prio: priority, body });
    // An app can be signed in to several relays (one per customer): its notification names the relay to open, and the
    // same chat id on two relays does not replace the other's notification. A browser's push is per origin anyway.
    n = withRelay(n);
    const native = nativeChannels();
    const gone: StoredSubscription[] = [];
    const sandbox: StoredSubscription[] = [];
    // Without own credentials for a channel the relay delivers, with the text already reduced to the preview
    const viaRelay = list.filter((s): s is NativeSubscription => isNativeSub(s) && !native.includes(s.channel) && relayPush.channels().includes(s.channel));
    if (viaRelay.length) {
        const text = visibleText({ title: n.title, body }, pushPreview());
        relayPush.send(viaRelay.map(bare), { ...text, url: n.url, ...(n.tag ? { tag: n.tag } : {}), priority, ttlSeconds: DELIVERY[priority].TTL });
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
