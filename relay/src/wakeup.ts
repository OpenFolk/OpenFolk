// Waking the machines. How is a setting of the relay (WAKE_METHOD, see .env.sample):
//
//   service  an external wake service (WAKEUP_URL, WAKEUP_API_TOKEN), e.g. a small web app that sends Wake-on-LAN
//            through the router and knows whether a machine is running. The relay only knows its address and a
//            service token. API: GET <url>/api.php -> { hosts: { <name>: MachineStatus }, at }, POST { host } -> wakes it.
//   wol      Wake-on-LAN magic packet straight from the relay (relay in the same network, or a forwarded port);
//            machines and their MAC addresses in WAKE_MACHINES.
//   command  any command (WAKE_COMMAND) with the placeholders {machine} and {mac}, e.g. ssh to the router or a call
//            to a home automation system; machines in WAKE_MACHINES.
//   none     no waking.
//
// Without WAKE_METHOD the method follows from the other values (WAKEUP_URL -> service, WAKE_COMMAND -> command,
// MAC addresses in WAKE_MACHINES -> wol).

import { exec } from 'node:child_process';
import dgram from 'node:dgram';
import type { MachineStatus, RelayRequest, ServerFrame } from '../../shared/protocol.ts';

export type WakeMethod = 'service' | 'wol' | 'command' | 'none';

export interface WakeConfig {
    method: WakeMethod;
    /** Why waking is off although something is set (wrong value), for the start log. */
    problem?: string;
    serviceUrl: string;
    serviceToken: string;
    /** Machines for wol/command, name -> MAC address ('' = without MAC, only for command). */
    machines: Record<string, string>;
    wolAddress: string;
    wolPort: number;
    command: string;
}

const MACHINE = /^[a-z0-9-]{1,32}$/;
const METHODS: readonly WakeMethod[] = ['service', 'wol', 'command', 'none'];

/** MAC address in the form aa:bb:cc:dd:ee:ff, or null (also accepts - and no separators). */
export function normalizeMac(raw: string): string | null {
    const hex = raw.trim().toLowerCase().replace(/[:\-.]/g, '');
    return /^[0-9a-f]{12}$/.test(hex) ? hex.match(/../g)!.join(':') : null;
}

/** `WAKE_MACHINES`: "desktop=AA:BB:CC:DD:EE:FF, laptop" (comma or semicolon separated). */
export function parseMachines(raw: string): { machines: Record<string, string>; invalid: string[] } {
    const machines: Record<string, string> = {};
    const invalid: string[] = [];
    for (const part of raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        const [name, mac = ''] = part.split('=').map((s) => s.trim());
        const machine = name.toLowerCase();
        const normalized = mac ? normalizeMac(mac) : '';
        if (!MACHINE.test(machine) || normalized === null) invalid.push(part);
        else machines[machine] = normalized;
    }
    return { machines, invalid };
}

export function parseWakeConfig(env: NodeJS.ProcessEnv): WakeConfig {
    const { machines, invalid } = parseMachines(env.WAKE_MACHINES ?? '');
    const c: WakeConfig = {
        method: 'none',
        serviceUrl: (env.WAKEUP_URL ?? '').trim().replace(/\/+$/, ''),
        serviceToken: (env.WAKEUP_API_TOKEN ?? '').trim(),
        machines,
        wolAddress: (env.WOL_ADDRESS ?? '').trim() || '255.255.255.255',
        wolPort: Number(env.WOL_PORT) || 9,
        command: (env.WAKE_COMMAND ?? '').trim(),
    };
    const problems: string[] = invalid.length ? [`WAKE_MACHINES: invalid entries ${invalid.join(', ')}`] : [];
    const wanted = (env.WAKE_METHOD ?? '').trim().toLowerCase();
    let method: WakeMethod;
    if (wanted) {
        if (!(METHODS as readonly string[]).includes(wanted)) {
            return { ...c, problem: [`WAKE_METHOD: unknown value "${wanted}" (${METHODS.join(', ')})`, ...problems].join('; ') };
        }
        method = wanted as WakeMethod;
    } else if (c.serviceUrl) method = 'service';
    else if (c.command) method = 'command';
    else if (Object.values(machines).some(Boolean)) method = 'wol';
    else method = 'none';

    if (method === 'service' && (!c.serviceUrl || c.serviceToken.length < 32)) problems.push('service: WAKEUP_URL and WAKEUP_API_TOKEN (at least 32 characters) are needed');
    if (method === 'wol' && !Object.values(machines).some(Boolean)) problems.push('wol: WAKE_MACHINES needs at least one machine with a MAC address');
    if (method === 'command' && !c.command) problems.push('command: WAKE_COMMAND is missing');
    if (method === 'command' && !Object.keys(machines).length) problems.push('command: WAKE_MACHINES needs at least one machine');
    if (method !== 'none' && problems.some((p) => p.startsWith(method))) return { ...c, problem: problems.join('; ') };
    return { ...c, method, problem: problems.length ? problems.join('; ') : undefined };
}

/** Read on first use: the relay loads its .env only after the imports. */
let cached: WakeConfig | null = null;
export function wakeConfig(): WakeConfig {
    cached ??= parseWakeConfig(process.env);
    return cached;
}

/** Sets the configuration instead of reading the environment (startRelay with `wake`). */
export function setWakeConfig(c: WakeConfig): void {
    cached = c;
    lastStatus = null;
}

export function wakeConfigured(): boolean {
    return wakeConfig().method !== 'none';
}

/** One line for the start log. */
export function wakeSummary(): string {
    const c = wakeConfig();
    if (c.method === 'none') return c.problem ? `waking off (${c.problem})` : 'waking not set up';
    const machines = Object.keys(c.machines);
    return `waking via ${c.method}${c.method !== 'service' ? ` for ${machines.join(', ')}` : ''}${c.problem ? ` (${c.problem})` : ''}`;
}

const NOT_CONFIGURED = 'Waking is not set up on the relay (WAKE_METHOD, see .env.sample).';
const UNKNOWN_MACHINE = 'Unknown machine.';

/** Cache status queries briefly: many browsers ask every few seconds. */
let lastStatus: { time: number; frame: ServerFrame } | null = null;
const STATUS_CACHE_MS = 8_000;

async function callService(method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    const c = wakeConfig();
    const res = await fetch(`${c.serviceUrl}/api.php`, {
        method,
        headers: { authorization: `Bearer ${c.serviceToken}`, 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
    });
    let data: Record<string, unknown> = {};
    try {
        data = (await res.json()) as Record<string, unknown>;
    } catch {
        // no JSON answer
    }
    return { status: res.status, data };
}

/** Magic packet: 6 x 0xff, then the MAC address 16 times. */
export function magicPacket(mac: string): Buffer {
    const bytes = Buffer.from(mac.replace(/:/g, ''), 'hex');
    return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

function sendMagicPacket(mac: string, address: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', (e) => { socket.close(); reject(e); });
        socket.bind(() => {
            socket.setBroadcast(true);
            const packet = magicPacket(mac);
            socket.send(packet, port, address, (e) => {
                socket.close();
                if (e) reject(e);
                else resolve();
            });
        });
    });
}

/** WAKE_COMMAND with the placeholders filled in; the values are checked (name pattern, MAC), so no shell escaping. */
export function wakeCommand(template: string, machine: string, mac: string): string {
    return template.replace(/\{machine\}/g, machine).replace(/\{mac\}/g, mac);
}

function runCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: 30_000, windowsHide: true }, (error, _stdout, stderr) => {
            if (error) reject(new Error(String(stderr).trim() || error.message));
            else resolve();
        });
    });
}

/** Wakes a machine; throws with the error text. */
export async function wake(host: string): Promise<void> {
    const c = wakeConfig();
    if (c.method === 'none') throw new Error(NOT_CONFIGURED);
    if (!MACHINE.test(host)) throw new Error(UNKNOWN_MACHINE);
    if (c.method === 'service') {
        // the wake service checks host names against its own list
        const { status, data } = await callService('POST', { host });
        if (status !== 200 || data.error !== undefined) throw new Error(String(data.error ?? `Wake service answered with ${status}`));
    } else {
        if (!(host in c.machines)) throw new Error(UNKNOWN_MACHINE);
        const mac = c.machines[host];
        if (c.method === 'wol') {
            if (!mac) throw new Error(`No MAC address for ${host} in WAKE_MACHINES.`);
            await sendMagicPacket(mac, c.wolAddress, c.wolPort);
        } else {
            await runCommand(wakeCommand(c.command, host, mac));
        }
    }
    lastStatus = null;
}

/** Machines that can be woken (alphabetical); empty if the wake service cannot be reached. */
export async function wakeableMachines(): Promise<string[]> {
    const c = wakeConfig();
    if (c.method === 'none') return [];
    if (c.method !== 'service') return Object.keys(c.machines).filter((m) => c.method === 'command' || c.machines[m]).sort();
    const { status, data } = await callService('GET');
    return status === 200 ? Object.keys((data.hosts ?? {}) as Record<string, unknown>).sort() : [];
}

/** Status of the machines: from the wake service, otherwise only the known names (running or not is unknown). */
async function machineStatus(): Promise<ServerFrame> {
    const c = wakeConfig();
    if (c.method !== 'service') {
        const hosts = Object.fromEntries((await wakeableMachines()).map((m) => [m, {} as MachineStatus]));
        return { type: 'machine_status', configured: true, hosts, at: new Date().toISOString() };
    }
    const { status, data } = await callService('GET');
    return status === 200
        ? { type: 'machine_status', configured: true, hosts: (data.hosts ?? {}) as Record<string, MachineStatus>, at: String(data.at ?? new Date().toISOString()) }
        : { type: 'machine_status', configured: true, hosts: {}, at: new Date().toISOString(), error: String(data.error ?? `Wake service answered with ${status}`) };
}

/** Answers `wake_status` and `wake`. `woken` is called after a successful wake. */
export async function handleWakeRequest(r: Extract<RelayRequest, { type: 'wake_status' | 'wake' }>, reply: (f: ServerFrame) => void, woken: (host: string) => void): Promise<void> {
    if (!wakeConfigured()) {
        if (r.type === 'wake_status') reply({ type: 'machine_status', configured: false, hosts: {}, at: new Date().toISOString() });
        else reply({ type: 'wake_result', host: r.host, ok: false, code: 'wake_not_configured', message: NOT_CONFIGURED });
        return;
    }
    const via = wakeConfig().method === 'service' ? 'Wake service' : 'Waking';
    try {
        if (r.type === 'wake_status') {
            if (lastStatus && Date.now() - lastStatus.time < STATUS_CACHE_MS) {
                reply(lastStatus.frame);
                return;
            }
            const frame = await machineStatus();
            if (!('error' in frame && frame.error)) lastStatus = { time: Date.now(), frame };
            reply(frame);
            return;
        }
        if (!MACHINE.test(r.host)) {
            reply({ type: 'wake_result', host: r.host, ok: false, code: 'unknown_machine', message: UNKNOWN_MACHINE });
            return;
        }
        try {
            await wake(r.host);
        } catch (e) {
            const message = (e as Error).message;
            reply({ type: 'wake_result', host: r.host, ok: false, code: message === UNKNOWN_MACHINE ? 'unknown_machine' : 'wake_failed', message });
            return;
        }
        woken(r.host);
        reply({ type: 'wake_result', host: r.host, ok: true });
    } catch (e) {
        const text = `${via} not reachable: ${(e as Error).message}`;
        if (r.type === 'wake_status') reply({ type: 'machine_status', configured: true, hosts: {}, at: new Date().toISOString(), error: text });
        else reply({ type: 'wake_result', host: r.host, ok: false, code: 'wake_failed', message: text });
    }
}
