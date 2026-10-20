import { createHash, timingSafeEqual } from 'node:crypto';

export function tokenEquals(a: string | undefined, b: string): boolean {
    if (!a || !b) return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** The relay keeps passwords and agent tokens only as this hash, whether they came from the environment or a claim. */
export function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

/** Whether `raw` is the token behind `hash`; false if either is empty. */
export function tokenMatches(hash: string, raw: string | undefined): boolean {
    return !!hash && !!raw && tokenEquals(hashToken(raw), hash);
}

/** Login throttle: after MAX failed attempts per IP, block for WINDOW milliseconds. */
const MAX = 5;
const WINDOW = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

/** Additionally a global limit against attempts from many addresses: at most GLOBAL_MAX failures per hour. */
const GLOBAL_MAX = 30;
const GLOBAL_WINDOW = 60 * 60_000;
let globalFailures: number[] = [];

export function isBlocked(ip: string): boolean {
    const e = failures.get(ip);
    if (!e) return false;
    if (Date.now() - e.since > WINDOW) {
        failures.delete(ip);
        return false;
    }
    return e.count >= MAX;
}

/**
 * Global limit reached? Applies to password logins only: an attacker must not be able to lock out devices
 * that are already signed in (device keys).
 */
export function isGloballyBlocked(): boolean {
    const limit = Date.now() - GLOBAL_WINDOW;
    globalFailures = globalFailures.filter((t) => t > limit);
    return globalFailures.length >= GLOBAL_MAX;
}

export function recordFailure(ip: string): void {
    // Expired entries otherwise stay until the same address comes back; addresses are cheap to vary
    if (failures.size > 1000) for (const [k, v] of failures) if (Date.now() - v.since > WINDOW) failures.delete(k);
    const e = failures.get(ip);
    if (!e || Date.now() - e.since > WINDOW) failures.set(ip, { count: 1, since: Date.now() });
    else e.count++;
    globalFailures.push(Date.now());
}

export function recordSuccess(ip: string): void {
    failures.delete(ip);
}

/** Checks whether an IPv4 address lies in one of the entries (IP or CIDR). IPv6 only exact. */
export function ipAllowed(ip: string, list: string[]): boolean {
    if (list.length === 0) return true;
    const plain = ip.replace(/^::ffff:/, '');
    for (const entry of list) {
        const [net, bits] = entry.split('/');
        if (!bits) {
            if (plain === net) return true;
            continue;
        }
        const a = ipv4ToNumber(plain);
        const n = ipv4ToNumber(net);
        if (a === null || n === null) continue;
        const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
        if (((a & mask) >>> 0) === ((n & mask) >>> 0)) return true;
    }
    return false;
}

function ipv4ToNumber(ip: string): number | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((t) => !Number.isInteger(t) || t < 0 || t > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Private, loopback and link-local networks: a reverse proxy next to the relay connects from one of these. */
const PROXY_NETS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'];

function isPrivate(ip: string): boolean {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6) || v6.startsWith('fe80:')) return true;
    return ipAllowed(ip, PROXY_NETS);
}

/** TRUST_PROXY: empty or 'auto', otherwise the number of reverse proxies in front of the relay (0 = none). */
export function parseTrustProxy(value: string | undefined): number | 'auto' {
    const v = (value ?? '').trim().toLowerCase();
    const n = Number(v);
    return v && v !== 'auto' && Number.isInteger(n) && n >= 0 ? n : 'auto';
}

/**
 * Client address of a request. Every proxy appends the address it saw to X-Forwarded-For, so only the entry `hops`
 * from the right is trustworthy; everything left of it the client wrote itself. 'auto' trusts one proxy, and only when
 * the direct peer is a private or loopback address: a relay reachable straight from the internet then ignores the
 * header instead of letting anyone choose their address for the login throttle and AGENT_ALLOWED_FROM.
 */
export function clientAddress(remote: string, forwardedFor: string | string[] | undefined, trust: number | 'auto'): string {
    const hops = trust === 'auto' ? (isPrivate(remote) ? 1 : 0) : trust;
    if (!hops || !forwardedFor) return remote;
    const list = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor).split(',').map((s) => s.trim()).filter(Boolean);
    return list[Math.max(0, list.length - hops)] ?? remote;
}

/**
 * Origins allowed to open /ws/client: the relay's own address, and the mobile apps, which bring the web app along
 * (Capacitor: capacitor://localhost on iOS, https://localhost on Android). Requests without Origin (not a browser)
 * pass; they need the password like everyone else. A foreign web page is refused before it can try passwords.
 */
export function originAllowed(origin: string | undefined, ...hosts: (string | string[] | undefined)[]): boolean {
    if (!origin) return true;
    if (['capacitor://localhost', 'https://localhost', 'http://localhost'].includes(origin)) return true;
    try {
        const own = new URL(origin).host;
        // Host as the proxy passes it on, or X-Forwarded-Host for a proxy that rewrites Host
        return hosts.flat().flatMap((h) => (h ?? '').split(',')).some((h) => h.trim().toLowerCase() === own);
    } catch {
        return false;
    }
}

/** Connections that have not signed in yet, per address and in total, to bound what a flood can hold open. */
const MAX_PENDING_PER_IP = 10;
const MAX_PENDING = 500;
const pending = new Map<string, number>();
let pendingTotal = 0;

/** Counts a connection that has not signed in yet; false if the address or the relay has too many. */
export function pendingLogin(ip: string): boolean {
    const n = pending.get(ip) ?? 0;
    if (n >= MAX_PENDING_PER_IP || pendingTotal >= MAX_PENDING) return false;
    pending.set(ip, n + 1);
    pendingTotal++;
    return true;
}

/** The connection signed in or closed. */
export function pendingDone(ip: string): void {
    const n = pending.get(ip) ?? 0;
    if (n <= 0) return;
    if (n === 1) pending.delete(ip);
    else pending.set(ip, n - 1);
    pendingTotal--;
}
