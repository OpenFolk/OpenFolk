#!/usr/bin/env node
// OpenFolk wake agent: a small always-on device in the network of your machines (a Raspberry Pi, a NAS) connects to
// your relay and sends the Wake-on-LAN packet there when the relay asks, so a relay on a server can wake a computer at
// home without a port forwarded on the router. It can do nothing else: it only ever gets "wake <MAC>" for the machines
// in the relay's WAKE_MACHINES, and nothing of the chats. Node 22 or newer, no npm install. README.md next to it.
//
//   RELAY_URL=https://bots.example.com WAKE_AGENT_TOKEN=… node wake-agent.mjs
//
// Optional: WOL_ADDRESS (default 255.255.255.255, or the broadcast address of the network such as 192.168.1.255),
// WOL_PORT (default 9), AGENT_NAME (shown in the relay's log; default the host name).
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';

const env = process.env;
const relay = (env.RELAY_URL ?? '').trim().replace(/\/+$/, '');
const token = (env.WAKE_AGENT_TOKEN ?? '').trim();
const address = (env.WOL_ADDRESS ?? '').trim() || '255.255.255.255';
const port = Number(env.WOL_PORT) || 9;
const name = (env.AGENT_NAME ?? '').trim() || os.hostname();

const log = (text) => console.log(`${new Date().toISOString()} ${text}`);

/** The relay's address as a WebSocket URL of /ws/wake: https → wss, http → ws. */
export function wakeUrl(raw) {
    const u = new URL(raw);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) throw new Error(`RELAY_URL must be http(s):// or ws(s)://, not ${u.protocol}`);
    u.protocol = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:';
    u.pathname = '/ws/wake';
    u.search = '';
    u.hash = '';
    return u.href;
}

/** Magic packet: 6 x 0xff, then the MAC address 16 times; null for anything that is no MAC address. */
export function magicPacket(mac) {
    const hex = String(mac).toLowerCase().replace(/[:\-.]/g, '');
    if (!/^[0-9a-f]{12}$/.test(hex)) return null;
    const bytes = Buffer.from(hex, 'hex');
    return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/** Sends the packet as a broadcast; resolves with '' or the error. */
export function sendPacket(packet, to = address, toPort = port) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', (e) => { socket.close(); resolve(e.message); });
        socket.bind(() => {
            socket.setBroadcast(true);
            socket.send(packet, toPort, to, (e) => {
                socket.close();
                resolve(e ? e.message : '');
            });
        });
    });
}

/** One connection: sign in, then answer wake orders until it closes. Resolves with whether it was signed in. */
function connect(url) {
    return new Promise((resolve) => {
        let signedIn = false;
        const ws = new WebSocket(url);
        ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token, name })));
        ws.addEventListener('message', async (event) => {
            let m;
            try { m = JSON.parse(String(event.data)); } catch { return; }
            if (m.type === 'welcome') {
                signedIn = true;
                log(`connected to ${url} as "${name}"; packets go to ${address}:${port}`);
                return;
            }
            if (m.type !== 'wake' || typeof m.id !== 'string') return;
            const packet = magicPacket(m.mac);
            const error = packet ? await sendPacket(packet) : `not a MAC address: ${m.mac}`;
            log(error ? `wake ${m.machine} failed: ${error}` : `woke ${m.machine} (${m.mac})`);
            ws.send(JSON.stringify({ type: 'woken', id: m.id, ok: !error, ...(error ? { error } : {}) }));
        });
        ws.addEventListener('close', (event) => {
            if (event.code === 4003) log('the relay refused the token (WAKE_AGENT_TOKEN must be the one in the relay\'s settings)');
            else if (signedIn) log(`disconnected (${event.code})`);
            resolve(signedIn);
        });
        ws.addEventListener('error', () => undefined);
    });
}

/** Stays connected: again after 5 s, longer while the relay cannot be reached or refuses, at most every 5 minutes. */
async function main() {
    if (!relay || token.length < 32) {
        console.error('Set RELAY_URL (the address of your relay) and WAKE_AGENT_TOKEN (the same as on the relay, at least 32 characters).');
        process.exit(2);
    }
    const url = wakeUrl(relay);
    let wait = 5;
    for (;;) {
        const signedIn = await connect(url);
        wait = signedIn ? 5 : Math.min(wait * 2, 300);
        await new Promise((r) => setTimeout(r, wait * 1000));
    }
}

// Started itself, not imported by its test
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await main();
