// Relay: serves the web app and passes WebSocket frames between browsers (/ws/client, login with the password)
// and the backends of the user's machines (/ws/agent, Authorization: Bearer <agent token>, X-Machine: <name>).
// Wakes machines as set in WAKE_METHOD (wake service, Wake-on-LAN or a command; see wakeup.ts).
//
// startRelay() runs it in any process: server.ts (the relay on its own, in the container) and a backend without
// RELAY_URL (the relay embedded on 127.0.0.1). Without tokens the relay starts unclaimed (owner.ts): it waits for
// the first backend that knows the setup code from its log. Further accounts (accounts.ts) share the relay; the
// owner's is 'main'.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MessageCode, PairBox, RelayFrame, RelayRequest, ServerFrame } from '../../shared/protocol.ts';
import { Accounts, MAIN } from './accounts.ts';
import { Bridge, type ClientContext } from './bridge.ts';
import {
    clientAddress, ipAllowed, isBlocked, isGloballyBlocked, originAllowed, pendingDone, pendingLogin, recordFailure, recordSuccess, tokenMatches,
} from './auth.ts';
import { Devices, newTotpSecret, TotpStore, totpUri, totpVerify, totpVerifyOnce } from './devices.ts';
import { MachinesSeen } from './machines-seen.ts';
import { migrateRelayData } from './migrate.ts';
import { MachineTokens, Owner, UNCLAIMED_PAGE, type Credentials } from './owner.ts';
import { handleWakeRequest, setWakeConfig, wake, wakeConfigured, wakeSummary, wakeableMachines, type WakeConfig } from './wakeup.ts';
import { WakeScheduler } from './wake-schedule.ts';
import { nativeChannels, sendNative } from '../../shared/push-native.ts';

export interface RelayOptions {
    /** 0 picks a free port (tests). */
    port: number;
    /** Address to listen on; default all interfaces. The embedded relay listens on 127.0.0.1 only. */
    host?: string;
    /** Password of the web app and token of the backends; both or neither (then claim mode, owner.ts). */
    clientToken?: string;
    agentToken?: string;
    /** Code a backend needs to claim an unclaimed relay; generated and logged when missing. */
    setupCode?: string;
    /** Devices, machines seen, the wake schedule and the owner of a claimed relay. */
    dataDir: string;
    /** Folder with index.html; default the webapp/ next to relay/. */
    webappDir?: string;
    totpSecret?: string;
    /** Reverse proxies in front of the relay whose X-Forwarded-For counts (auth.ts, clientAddress). */
    trustProxy?: number | 'auto';
    /** Only these source addresses may use /ws/agent (IP or CIDR); empty = all. */
    agentAllowedFrom?: string[];
    /** Default: from the environment (WAKE_METHOD and the rest, wakeup.ts). */
    wake?: WakeConfig;
    heartbeatMs?: number;
    log?: (text: string) => void;
}

export interface RelayHandle {
    port: number;
    /** Closes every connection with 1012 "Service Restart" and stops listening. */
    close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (the folder with webapp/): two levels up from src/, deeper when running the build in dist/. */
export const repoRoot = (() => {
    for (let d = here; ; d = path.dirname(d)) {
        if (fs.existsSync(path.join(d, 'webapp', 'index.html'))) return d;
        if (path.dirname(d) === d) return path.resolve(here, '..', '..');
    }
})();

const require = createRequire(import.meta.url);
// Folder of the package's main file (lib/ or dist/); the browser builds live there too
const packageDir = (name: string) => path.dirname(require.resolve(name));
const vendor: Record<string, string> = {
    '/vendor/marked.umd.js': path.join(packageDir('marked'), 'marked.umd.js'),
    '/vendor/purify.min.js': path.join(packageDir('dompurify'), 'purify.min.js'),
    '/vendor/qrcode.js': path.join(packageDir('qrcode-generator'), 'qrcode.js'),
    '/vendor/jsQR.js': path.join(packageDir('jsqr'), 'jsQR.js'),
};
const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/** What a browser may send before it has signed in: the auth frame (key, token, name, code). */
const PRE_AUTH_BYTES = 16 * 1024;
/** How long a device showing a QR code waits for its approval, and how many may wait at once. */
const PAIR_WAIT_MS = 10 * 60_000;
const MAX_PAIR_WAITING = 200;

/**
 * Security headers for everything the relay serves. The web app loads only its own files (including subfolders
 * such as js/ and i18n/); images and recordings come as data:/blob:, the WebSocket connects to the same origin.
 */
function securityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
        + "media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; font-src 'self'; "
        + "form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

/** Readable device name from the user agent, if the browser does not send one. */
function deviceName(ua: string): string {
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const system = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return system ? `${browser} on ${system}` : browser;
}

/** Body of a small JSON request (the claim); null when it is too large or not JSON. */
function readJson(req: http.IncomingMessage, limit: number): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > limit) {
                resolve(null);
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => {
            try {
                const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                resolve(v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
            } catch {
                resolve(null);
            }
        });
        req.on('error', () => resolve(null));
    });
}

export async function startRelay(o: RelayOptions): Promise<RelayHandle> {
    const log = o.log ?? ((text: string) => console.log(`${new Date().toISOString()} ${text}`));
    const trustProxy = o.trustProxy ?? 'auto';
    const agentAllowedFrom = o.agentAllowedFrom ?? [];
    const webappDir = o.webappDir ?? path.join(repoRoot, 'webapp');
    const dataDir = o.dataDir;
    if (o.wake) setWakeConfig(o.wake);

    migrateRelayData(dataDir, log);
    const owner = new Owner(dataDir, o.clientToken, o.agentToken, o.setupCode);
    const devices = new Devices(dataDir);
    const accounts = new Accounts(dataDir);
    const totp = new TotpStore(dataDir, o.totpSecret ?? '', log);
    const machineTokens = new MachineTokens(dataDir);
    /** Secrets being set up, per device, until confirmed with a code from the app (10 minutes). */
    const totpPending = new Map<string, { secret: string; until: number }>();
    const timers: NodeJS.Timeout[] = [];

    const clientIp = (req: http.IncomingMessage) => clientAddress(req.socket.remoteAddress ?? '', req.headers['x-forwarded-for'], trustProxy);
    /** The current tokens; null while the relay is unclaimed. */
    const creds = (): Credentials | null => owner.credentials;
    /** A backend's token: the shared AGENT_TOKEN, or a machine's own (with `machine`: only that machine's). */
    const agentOk = (c: Credentials, raw: string, machine?: string) => tokenMatches(c.agentHash, raw) || machineTokens.matches(raw, machine);

    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        securityHeaders(req, res);
        // A backend claims an unclaimed relay with the code from the relay's log (owner.ts)
        if (req.method === 'POST' && url.pathname === '/claim') {
            const ip = clientIp(req);
            if (creds()) {
                res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'already_claimed' }));
                return;
            }
            if (isBlocked(ip) || isGloballyBlocked()) {
                res.writeHead(429).end();
                return;
            }
            void readJson(req, 4096).then((body) => {
                const result = body ? owner.claim(String(body.code ?? ''), String(body.clientToken ?? ''), String(body.agentToken ?? '')) : 'invalid';
                if (result === 'ok') {
                    recordSuccess(ip);
                    log(`Relay claimed by a backend from ${ip}`);
                    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true }));
                    return;
                }
                if (result === 'wrong_code') recordFailure(ip);
                log(`Claim from ${ip} refused (${result})`);
                res.writeHead(result === 'wrong_code' ? 403 : 400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: result }));
            });
            return;
        }
        // A backend mints an invitation for one more machine (the app's "Add machine"; it adds the end-to-end key)
        if (req.method === 'POST' && url.pathname === '/machine-invite') {
            const ip = clientIp(req);
            const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
            const c = creds();
            if (!c || !ipAllowed(ip, agentAllowedFrom) || isBlocked(ip) || !agentOk(c, auth)) {
                recordFailure(ip);
                res.writeHead(401).end();
                return;
            }
            const invite = machineTokens.invite();
            log(`Invitation for a new machine minted for ${ip}, valid until ${invite.expiresAt}`);
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(invite));
            return;
        }
        // A new machine redeems its invitation (npm run join) and gets an agent token of its own
        if (req.method === 'POST' && url.pathname === '/join') {
            const ip = clientIp(req);
            if (!creds() || !ipAllowed(ip, agentAllowedFrom) || isBlocked(ip) || isGloballyBlocked()) {
                res.writeHead(creds() ? 429 : 503).end();
                return;
            }
            void readJson(req, 2048).then((body) => {
                const machine = String(body?.machine ?? '').toLowerCase();
                const r = body ? machineTokens.join(String(body.token ?? ''), machine) : 'invalid';
                if (r === 'invalid') {
                    recordFailure(ip);
                    log(`Join from ${ip} refused`);
                    res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_invitation' }));
                    return;
                }
                recordSuccess(ip);
                log(`Machine ${machine} joined from ${ip}`);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ agentToken: r.token }));
            });
            return;
        }
        // A backend mints a one-time pairing token for a new device (it builds the link and adds the end-to-end key)
        if (req.method === 'POST' && url.pathname === '/pair') {
            const ip = clientIp(req);
            const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
            const c = creds();
            if (!c || !ipAllowed(ip, agentAllowedFrom) || isBlocked(ip) || !agentOk(c, auth)) {
                recordFailure(ip);
                res.writeHead(401).end();
                return;
            }
            // The body names the account the device will belong to; none (backends before accounts) = 'main'
            void readJson(req, 1024).then((body) => {
                const account = typeof body?.account === 'string' ? body.account : MAIN;
                if (!accounts.get(account)) {
                    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unknown_account' }));
                    return;
                }
                const pairing = devices.createPairing(Date.now(), account);
                log(`Pairing link minted for ${ip}${account === MAIN ? '' : ` (account ${account})`}, valid until ${pairing.expiresAt}`);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify(pairing));
            });
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end();
            return;
        }
        if (url.pathname === '/health') {
            // The mobile apps ask from their own origin before signing in
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            // Deliberately without machine names: the page is public. `totp`: the login form shows the code field
            res.end(JSON.stringify({ ok: true, ...(creds() ? {} : { unclaimed: true }), ...(totp.secret ? { totp: true } : {}) }));
            return;
        }
        // Unclaimed: the start page explains where the code is instead of offering a login nobody can pass
        if (!creds() && (url.pathname === '/' || url.pathname === '/index.html')) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : UNCLAIMED_PAGE);
            return;
        }
        let file = vendor[url.pathname];
        if (!file) {
            const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            file = path.join(webappDir, path.normalize(rel));
            if (!file.startsWith(webappDir + path.sep)) {
                res.writeHead(403).end();
                return;
            }
        }
        fs.stat(file, (err, st) => {
            if (err || !st.isFile()) {
                res.writeHead(404).end('not found');
                return;
            }
            // no-cache means "ask first": with the ETag the answer is a 304 without the file as long as nothing changed
            const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
            const headers = {
                'content-type': mime[path.extname(file!)] ?? 'application/octet-stream',
                'cache-control': url.pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
                etag,
            };
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304, headers).end();
                return;
            }
            fs.readFile(file!, (readErr, content) => {
                if (readErr) {
                    res.writeHead(404).end('not found');
                    return;
                }
                res.writeHead(200, headers);
                res.end(req.method === 'HEAD' ? undefined : content);
            });
        });
    });

    const bridge: Bridge = new Bridge((request, reply, context) => {
        if (request.type === 'devices') {
            reply({ type: 'devices', list: devices.all(context.account), current: context.device });
            return;
        }
        if (request.type === 'device_logout') {
            if (devices.remove(request.id, context.account)) {
                log(`Device ${request.id} logged out (by device ${context.device})`);
                // reply first, then disconnect – logging out one's own device is allowed
                reply({ type: 'devices', list: devices.all(context.account), current: context.device });
                bridge.disconnectDevice(request.id);
            } else {
                reply({ type: 'devices', list: devices.all(context.account), current: context.device });
            }
            return;
        }
        if (request.type === 'accounts' || request.type === 'account_create' || request.type === 'account_update' || request.type === 'account_delete'
            || request.type === 'account_invite') {
            accountRequest(request, reply, context);
            return;
        }
        if (request.type === 'pair_request' || request.type === 'pair_approve') {
            pairRequest(request, reply, context);
            return;
        }
        if (request.type === 'totp_status' || request.type === 'totp_begin' || request.type === 'totp_confirm' || request.type === 'totp_off') {
            totpRequest(request, reply, context);
            return;
        }
        if (request.type === 'machine_tokens' || request.type === 'machine_token_remove') {
            // Machines serve every account; only the owner sees and removes them
            if (context.account !== MAIN) {
                reply({ type: 'error', code: 'not_allowed', request: request.type, message: 'This account may not do that.' });
                return;
            }
            if (request.type === 'machine_token_remove' && machineTokens.remove(String(request.machine ?? ''))) {
                log(`Machine ${request.machine} logged out (by device ${context.device})`);
                bridge.disconnectAgent(String(request.machine));
            }
            reply({ type: 'machine_tokens', list: machineTokens.all() });
            return;
        }
        void handleWakeRequest(request, reply, (host) => bridge.markWoken(host));
    }, new MachinesSeen(dataDir));
    bridge.accountList = () => ({ ids: accounts.ids(), deleted: accounts.deletedIds() });

    type AccountRequest = Extract<RelayRequest, { type: 'accounts' | 'account_create' | 'account_update' | 'account_delete' | 'account_invite' }>;

    /**
     * Accounts: everyone sees and renames their own and sets their own password; admins manage the others. 'main' is
     * the owner's: only it changes itself, and nobody gets an invitation into it (its devices pair from its own).
     */
    function accountRequest(request: AccountRequest, reply: (f: ServerFrame) => void, context: ClientContext): void {
        const own = context.account;
        const admin = accounts.isAdmin(own);
        const list = () => reply({ type: 'accounts', list: admin ? accounts.all() : accounts.all().filter((a) => a.id === own), current: own });
        const refuse = (code: MessageCode = 'not_allowed') => reply({
            type: 'error', code, request: request.type,
            message: code === 'account_name_taken' ? 'An account with this name exists already.' : 'This account may not do that.',
        });
        switch (request.type) {
            case 'accounts':
                list();
                return;
            case 'account_create': {
                if (!admin || typeof request.name !== 'string') return refuse();
                const created = accounts.create(request.name, request.admin === true);
                if (created === 'name_taken') return refuse('account_name_taken');
                if (created === 'invalid') return refuse();
                log(`Account ${created.id} created (by account ${own})`);
                bridge.accountAdded(created.id);
                reply({ type: 'account_created', account: created, pair: devices.createPairing(Date.now(), created.id) });
                return;
            }
            case 'account_update': {
                const id = String(request.id ?? '');
                const self = id === own;
                if (!accounts.get(id) || (!self && !admin) || (id === MAIN && !self)) return refuse();
                // A password only for oneself; admin rights only from another admin
                if (request.password !== undefined && (!self || typeof request.password !== 'string')) return refuse();
                if (request.admin !== undefined && (self || typeof request.admin !== 'boolean')) return refuse();
                if (request.name !== undefined && typeof request.name !== 'string') return refuse();
                const r = accounts.update(id, { name: request.name, password: request.password, admin: request.admin });
                if (r !== 'ok') return refuse(r === 'name_taken' ? 'account_name_taken' : 'not_allowed');
                log(`Account ${id} changed (by account ${own})`);
                list();
                return;
            }
            case 'account_delete': {
                const id = String(request.id ?? '');
                if (!admin || id === own || !accounts.remove(id)) return refuse();
                devices.removeAccount(id);
                log(`Account ${id} deleted (by account ${own})`);
                list();
                bridge.accountDeleted(id);
                return;
            }
            case 'account_invite': {
                const account = accounts.get(String(request.id ?? ''));
                if (!admin || !account || account.id === MAIN || account.id === own) return refuse();
                log(`Invitation to account ${account.id} (by account ${own})`);
                reply({ type: 'account_invite', account, pair: devices.createPairing(Date.now(), account.id) });
                return;
            }
        }
    }

    /**
     * The second factor of 'main', set up and switched off in the app. Both take a code from the authenticator app:
     * setting up proves the app has the secret, switching off that whoever does it holds the second factor too.
     */
    function totpRequest(
        request: Extract<RelayRequest, { type: 'totp_status' | 'totp_begin' | 'totp_confirm' | 'totp_off' }>, reply: (f: ServerFrame) => void, context: ClientContext,
    ): void {
        const status = () => reply({ type: 'totp', active: Boolean(totp.secret), available: context.account === MAIN });
        if (context.account !== MAIN || request.type === 'totp_status') return status();
        const wrong = () => reply({ type: 'error', code: 'totp_wrong_code', request: request.type, message: 'Wrong code.' });
        if (request.type === 'totp_begin') {
            if (totp.secret) return status();
            const secret = newTotpSecret();
            totpPending.set(context.device, { secret, until: Date.now() + 10 * 60_000 });
            const label = typeof request.label === 'string' && request.label.trim() ? request.label.trim().slice(0, 100) : 'OpenFolk';
            reply({ type: 'totp_setup', secret, uri: totpUri(secret, label) });
            return;
        }
        const code = String(request.code ?? '');
        if (request.type === 'totp_confirm') {
            const pending = totpPending.get(context.device);
            if (!pending || pending.until < Date.now() || !totpVerify(pending.secret, code)) return wrong();
            totpPending.delete(context.device);
            totp.save(pending.secret);
            log(`TOTP set up (by device ${context.device})`);
            return status();
        }
        if (!totp.secret || !totpVerifyOnce(totp.secret, code)) return wrong();
        totp.save('');
        log(`TOTP switched off (by device ${context.device})`);
        status();
    }

    /** Devices showing a QR code to be signed in by one that is (clientLogin, "pair_wait"), by request id. */
    const waiting = new Map<string, { ws: WebSocket; ip: string; name: string; since: string }>();
    /** First-device requests passed to a backend ("pair_first"), by request id; one at a time across the relay. */
    const firstAsked = new Set<string>();
    let firstLast = 0;
    const noDevice = () => devices.all(MAIN).length === 0;

    /** A backend's answer to a first-device request: the sealed link goes to the waiting device, as an approval does. */
    bridge.onFirstDevice = (id, box, error) => {
        if (!firstAsked.delete(id)) return;
        const w = waiting.get(id);
        if (!w) return;
        if (error || !box || typeof box.pk !== 'string' || typeof box.iv !== 'string' || typeof box.data !== 'string' || box.pk.length + box.iv.length + box.data.length > 4096) {
            w.ws.send(JSON.stringify({ type: 'pair_first', ok: false, reason: 'off' } satisfies RelayFrame));
            return;
        }
        waiting.delete(id);
        w.ws.send(JSON.stringify({ type: 'pair_wait', box: { pk: box.pk, iv: box.iv, data: box.data } } satisfies RelayFrame));
        w.ws.close(1000, 'Answered');
        log(`First device "${w.name}" from ${w.ip}: sealed pairing link passed on`);
    };

    /**
     * QR sign-in from the approving side: who waits behind an id, and passing on the sealed pairing link. The relay
     * cannot open the box; the pairing token inside comes from a backend of the approving device's account.
     */
    function pairRequest(request: Extract<RelayRequest, { type: 'pair_request' | 'pair_approve' }>, reply: (f: ServerFrame) => void, context: ClientContext): void {
        const id = String(request.id ?? '');
        const w = waiting.get(id);
        if (!w) {
            reply({ type: 'error', code: 'pairing_invalid', request: request.type, message: 'This QR code is no longer valid. Show a new one on the new device.' });
            return;
        }
        if (request.type === 'pair_request') {
            reply({ type: 'pair_request', id, name: w.name, ip: w.ip, since: w.since });
            return;
        }
        const b = request.box as Partial<PairBox> | undefined;
        if (!b || typeof b.pk !== 'string' || typeof b.iv !== 'string' || typeof b.data !== 'string' || b.pk.length + b.iv.length + b.data.length > 4096) {
            reply({ type: 'error', code: 'not_allowed', request: request.type, message: 'Invalid approval.' });
            return;
        }
        waiting.delete(id);
        w.ws.send(JSON.stringify({ type: 'pair_wait', box: { pk: b.pk, iv: b.iv, data: b.data } } satisfies RelayFrame));
        w.ws.close(1000, 'Approved');
        log(`QR sign-in of "${w.name}" from ${w.ip} approved by device ${context.device}`);
        reply({ type: 'pair_approved', id });
    }

    timers.push(setInterval(() => bridge.recordSeen(), 60_000));

    // Push to the apps for backends without APNs/FCM credentials of their own (APNS_* / FCM_* on the relay)
    bridge.pushChannels = nativeChannels();
    bridge.onPush = async (subscriptions, message) => {
        const gone: typeof subscriptions = [];
        await Promise.all(subscriptions.map(async (sub) => {
            const r = await sendNative(sub, message);
            if (!r.ok && r.gone) gone.push(sub);
            else if (!r.ok) log(`Push: ${r.error}`);
        }));
        return gone;
    };

    // Routines with `wake`: wake a machine shortly before the due time if none is awake
    const wakeScheduler = new WakeScheduler(dataDir, {
        online: () => bridge.online(),
        wakeable: wakeableMachines,
        wake: async (machine, routines) => {
            await wake(machine);
            bridge.markWoken(machine, routines);
        },
    }, log);
    bridge.onWakeSchedule = (schedule) => wakeScheduler.set(schedule);
    if (wakeConfigured()) timers.push(setInterval(() => void wakeScheduler.check(), 30_000));

    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const ip = clientIp(req);
        const c = creds();
        if (!c) {
            socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
            socket.destroy();
            return;
        }

        if (url.pathname === '/ws/agent') {
            const auth = req.headers.authorization ?? '';
            // X-Rechner: backends from before the English protocol
            const machine = String(req.headers['x-machine'] ?? req.headers['x-rechner'] ?? 'home').toLowerCase();
            if (!/^[a-z0-9-]{1,32}$/.test(machine)) {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
                return;
            }
            if (!ipAllowed(ip, agentAllowedFrom) || isBlocked(ip) || !agentOk(c, auth.replace(/^Bearer\s+/i, ''), machine)) {
                recordFailure(ip);
                log(`Agent login rejected from ${ip}`);
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            recordSuccess(ip);
            const withAccounts = req.headers['x-accounts'] === '1';
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
                void bridge.connectAgent(ws, ip, machine, withAccounts);
            });
            return;
        }

        if (url.pathname === '/ws/client') {
            if (!originAllowed(req.headers.origin, req.headers.host, req.headers['x-forwarded-host'])) {
                log(`Client from foreign origin ${req.headers.origin} rejected (${ip})`);
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }
            if (isBlocked(ip) || !pendingLogin(ip)) {
                socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
                socket.destroy();
                return;
            }
            // Until the sign-in, a connection may send only a few KB: maxPayload is sized for uploads of signed-in devices
            let preAuthBytes = head.length;
            const guard = (chunk: Buffer) => {
                preAuthBytes += chunk.length;
                if (preAuthBytes > PRE_AUTH_BYTES) socket.destroy();
            };
            socket.on('data', guard);
            let counted = true;
            const signedIn = () => {
                socket.off('data', guard);
                if (counted) pendingDone(ip);
                counted = false;
            };
            socket.once('close', signedIn);
            const ua = String(req.headers['user-agent'] ?? '');
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
                clientLogin(ws, ip, ua, signedIn, c);
            });
            return;
        }

        socket.destroy();
    });

    type AuthReply = Omit<Extract<RelayFrame, { type: 'auth' }>, 'type' | 'ok'>;

    /**
     * First message of the browser: { type: 'auth', device } with the device key, { type: 'auth', pair, name? } with
     * the one-time token of a pairing link, or once per device { type: 'auth', token, name?, totp?, account? } with
     * the password of an account ('main' without `account`). After a pairing or password login the relay issues a
     * device key; the browser stores only that. TOTP_SECRET is the owner's second factor and guards 'main' only.
     */
    function clientLogin(ws: WebSocket, ip: string, ua: string, signedIn: () => void, c: Credentials): void {
        const timer = setTimeout(() => ws.close(4001, 'Login timed out'), 10_000);
        const reject = (code: MessageCode, message: string, extra: AuthReply = {}, countsAsFailure = true) => {
            if (countsAsFailure) recordFailure(ip);
            const frame: RelayFrame = { type: 'auth', ok: false, code, message, ...extra };
            ws.send(JSON.stringify(frame));
            ws.close(4003, 'Not signed in');
        };
        const accountOf = (id: string) => {
            const a = accounts.get(id);
            return a ? { id: a.id, name: a.name, admin: a.admin } : { id, name: id, admin: false };
        };
        const welcome = (created: ReturnType<typeof devices.create>, name: string, how: string) => {
            recordSuccess(ip);
            ws.send(JSON.stringify({ type: 'auth', ok: true, device: { id: created.device.id, token: created.token, name }, account: accountOf(created.account) } satisfies RelayFrame));
            log(`New device ${created.device.id} "${name}" from ${ip} (${how}${created.account === MAIN ? '' : `, account ${created.account}`})`);
            bridge.warn('new_device', { name, ip }, undefined, undefined, created.account);
            signedIn();
            bridge.connectClient(ws, ip, created.device.id, created.account);
        };
        ws.once('message', (raw) => {
            clearTimeout(timer);
            // `geraet`: web apps still cached from before the English protocol
            let f: { type?: string; device?: unknown; geraet?: unknown; pair?: unknown; token?: unknown; name?: unknown; totp?: unknown; account?: unknown } = {};
            try {
                f = JSON.parse(raw.toString()) as typeof f;
            } catch {
                // handled below as a failed attempt
            }
            const deviceKey = f.device ?? f.geraet;
            if (f.type === 'auth' && typeof deviceKey === 'string') {
                const d = devices.verify(deviceKey, ip);
                // A device of a deleted account goes with it, also one a crash left between the two steps
                if (!d || !accounts.get(d.account)) {
                    reject('device_logged_out', 'This device is not (or no longer) signed in.', { loggedOut: true });
                    return;
                }
                recordSuccess(ip);
                ws.send(JSON.stringify({ type: 'auth', ok: true, account: accountOf(d.account) } satisfies RelayFrame));
                signedIn();
                bridge.connectClient(ws, ip, d.id, d.account);
                return;
            }
            const deviceLabel = (typeof f.name === 'string' && f.name.trim() ? f.name.trim() : deviceName(ua)).slice(0, 80);
            // QR code: no sign-in yet; the connection stays open, unsigned, until a signed-in device approves it
            if (f.type === 'pair_wait') {
                if (waiting.size >= MAX_PAIR_WAITING) {
                    reject('too_many_attempts', 'Too many devices are waiting to be signed in. Please try again later.', {}, false);
                    return;
                }
                const id = randomBytes(16).toString('base64url');
                waiting.set(id, { ws, ip, name: deviceLabel, since: new Date().toISOString() });
                const expire = setTimeout(() => ws.close(4005, 'Request expired'), PAIR_WAIT_MS);
                expire.unref();
                ws.once('close', () => {
                    clearTimeout(expire);
                    waiting.delete(id);
                });
                ws.send(JSON.stringify({ type: 'pair_wait', id, expiresAt: new Date(Date.now() + PAIR_WAIT_MS).toISOString(), ...(noDevice() ? { first: true } : {}) } satisfies RelayFrame));
                // The main account's first device: the waiting device asks a backend, which seals the link with the code
                // from its log; the relay only passes key and box on and never sees the code
                let asked = false;
                ws.on('message', (more) => {
                    let m: { type?: unknown; pk?: unknown } = {};
                    try { m = JSON.parse(more.toString()) as typeof m; } catch { return; }
                    if (m.type !== 'pair_first' || typeof m.pk !== 'string' || m.pk.length > 200 || asked) return;
                    const refuse = (reason: 'not_first' | 'no_backend' | 'busy') => ws.send(JSON.stringify({ type: 'pair_first', ok: false, reason } satisfies RelayFrame));
                    if (!noDevice()) return refuse('not_first');
                    if (Date.now() - firstLast < 2000 || isBlocked(ip)) return refuse('busy');
                    firstLast = Date.now();
                    if (!bridge.firstDevice(id, m.pk)) return refuse('no_backend');
                    asked = true;
                    firstAsked.add(id);
                    ws.once('close', () => firstAsked.delete(id));
                    log(`First device "${deviceLabel}" from ${ip} asked a backend`);
                });
                return;
            }
            // Pairing link: the token stands in for password and TOTP, once
            if (f.type === 'auth' && typeof f.pair === 'string') {
                const created = devices.redeemPairing(f.pair, deviceLabel, ip);
                if (!created || !accounts.get(created.account)) {
                    reject('pairing_invalid', 'This pairing link is no longer valid. Create a new one.');
                    return;
                }
                welcome(created, deviceLabel, 'pairing link');
                return;
            }
            // The global limit protects the password only: pairing tokens are long and single-use, and blocking them
            // would let anyone stop new devices from being paired
            if (isGloballyBlocked()) {
                reject('too_many_attempts', 'Too many failed attempts. Please try again later.', {}, false);
                return;
            }
            // An unknown account is a wrong password: the answer must not tell which accounts exist
            const account = typeof f.account === 'string' && f.account.trim() ? accounts.find(f.account)?.id : MAIN;
            const needsCode = account === MAIN && !!totp.secret;
            // With TOTP: do not check at all without a code, so the password alone reveals nothing
            if (needsCode && typeof f.totp !== 'string') {
                reject('totp_required', 'Enter the password and the code from your authenticator app.', { totp: true }, false);
                return;
            }
            const password = f.type === 'auth' && typeof f.token === 'string' ? f.token : '';
            const passwordOk = !!account && !!password && (account === MAIN ? tokenMatches(c.clientHash, password) : accounts.passwordMatches(account, password));
            const totpOk = !needsCode || totpVerifyOnce(totp.secret, String(f.totp ?? ''));
            if (!account || !passwordOk || !totpOk) {
                reject('wrong_password', needsCode ? 'Wrong password or code.' : 'Wrong password.', { totp: needsCode });
                return;
            }
            welcome(devices.create(deviceLabel, ip, account), deviceLabel, 'password');
        });
    }

    // Detect dead connections: ping every interval; without a pong until the next one, the connection is dropped.
    // With noServer, `ws` does not emit 'connection'; the handleUpgrade callbacks above do that, otherwise the pong
    // handler would be missing and every connection would drop after two intervals at the latest.
    const alive = new WeakMap<WebSocket, boolean>();
    wss.on('connection', (ws) => {
        alive.set(ws, true);
        ws.on('pong', () => alive.set(ws, true));
    });
    timers.push(setInterval(() => {
        for (const ws of wss.clients) {
            if (alive.get(ws) === false) {
                ws.terminate();
                continue;
            }
            alive.set(ws, false);
            ws.ping();
        }
    }, o.heartbeatMs ?? 30_000));
    // A relay embedded in a backend must not keep that process alive
    for (const t of timers) t.unref();

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(o.port, o.host, () => {
            server.off('error', reject);
            resolve();
        });
    });
    const port = (server.address() as { port: number }).port;
    log(`Relay listening on ${o.host ?? 'port'}${o.host ? `:${port}` : ` ${port}`}, web app from ${webappDir}`
        + (agentAllowedFrom.length ? `, agents only from ${agentAllowedFrom.join(', ')}` : '')
        + `, ${wakeSummary()}` + (totp.secret ? ', TOTP active' : '') + `, data in ${dataDir}`);
    if (owner.warning) log(`Warning: ${owner.warning}`);
    if (!creds()) {
        log(`Relay is UNCLAIMED. Setup code: ${owner.setupCode}`);
        log('On the machine that runs the backend: npm run claim -- <address of this relay> <setup code>');
    }

    let closing: Promise<void> | null = null;
    return {
        port,
        close() {
            closing ??= new Promise((resolve) => {
                for (const t of timers) clearInterval(t);
                for (const ws of wss.clients) ws.close(1012, 'Relay restarting');
                server.close(() => resolve());
                // Sockets that do not answer the close keep server.close() waiting
                setTimeout(() => {
                    for (const ws of wss.clients) ws.terminate();
                    server.closeAllConnections();
                }, 1000).unref();
            });
            return closing;
        },
    };
}
