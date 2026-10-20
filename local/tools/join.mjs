// Joins this machine to an existing OpenFolk with the invitation from the app (Settings, Machines, "Add machine"):
// redeems the one-time token at the relay for an agent token of this machine's own, and writes RELAY_URL, AGENT_TOKEN
// and the end-to-end key from the link into the .env. The web push keys come from the other machines on the first
// start (encrypted), see local/src/join.ts. Prints names, never values.
//
//   npm run join -- "<link from the app>"
//
// OPENFOLK_JSON=1: one line of JSON instead of text, {"ok":true,"machine":…} or {"ok":false,"error":<code>,"message":…};
// the desktop app runs it that way and says the outcome in its own language.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, envFile, parse, set, values } from './env.mjs';

const json = process.env.OPENFOLK_JSON === '1';

/** Reports a failure; returns the exit code. */
function fail(error, message, code = 1) {
    if (json) console.log(JSON.stringify({ ok: false, error, message }));
    else console.error(message);
    return code;
}

/** Redeems the invitation and writes the .env; returns the exit code. */
async function join(raw) {
    if (!raw) return fail('usage', 'Usage: npm run join -- "<link from the app>"   (Settings, Machines, "Add machine")', 2);
    let link;
    try {
        link = new URL(raw.trim());
    } catch {
        return fail('not_a_link', 'That is not a link. Copy the whole command from the app.', 2);
    }
    const params = new URLSearchParams(link.hash.slice(1));
    const token = params.get('join') ?? '';
    const key = params.get('e2e') ?? '';
    if (!token) return fail('no_invitation', 'The link has no invitation in it. Create a new one in the app: Settings, Machines, "Add machine".', 2);
    const base = link.origin;
    if (base.startsWith('http:') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(base)) {
        return fail('https', 'The relay needs HTTPS (the token travels in this request).', 2);
    }

    // The name the backend will use (config.ts): MACHINE_NAME, otherwise the computer name
    const v = values();
    const machine = (v.MACHINE_NAME || v.RECHNER || process.env.COMPUTERNAME || os.hostname()).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);

    let r;
    try {
        r = await fetch(`${base}/join`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, machine }), signal: AbortSignal.timeout(15_000),
        });
    } catch (e) {
        return fail('unreachable', `The relay at ${base} does not answer (${e.cause?.code ?? e.message}).`);
    }
    const answer = await r.json().catch(() => ({}));
    if (r.status !== 200 || typeof answer.agentToken !== 'string') {
        if (r.status === 403) return fail('expired', 'The invitation is used up or expired (15 minutes). Create a new one in the app.');
        if (r.status === 404) return fail('too_old', 'This relay is too old for invitations: update it first.');
        if (r.status === 429) return fail('too_many', 'Too many attempts from this address; wait an hour.');
        return fail('status', `The relay answered ${r.status}.`);
    }

    const before = parse(envFile);
    const pairs = { RELAY_URL: `${base.replace(/^http/, 'ws')}/ws/agent`, AGENT_TOKEN: answer.agentToken };
    if (key) pairs.E2E_KEY = key;
    set(pairs, envFile, true);
    const changed = Object.keys(pairs).filter((k) => before[k] && before[k] !== pairs[k]);
    // The backend asks the other machines for the shared web push keys once it is connected
    const dir = dataDir(v);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'join-pending.json'), JSON.stringify({ since: new Date().toISOString() }));

    if (json) {
        console.log(JSON.stringify({ ok: true, machine, e2e: !!key }));
        return 0;
    }
    console.log(`This machine (${machine}) joined the relay at ${base}.`);
    console.log(`Written into the .env: ${Object.keys(pairs).join(', ')}${changed.length ? ` (replaced: ${changed.join(', ')})` : ''}.`);
    if (!key) console.log('The link carried no end-to-end key: this OpenFolk runs without encryption, or the link was cut off.');
    console.log('Start the backend now: npm start (or npm run restart if it is running). It shows up in the app as', machine.toUpperCase());
    return 0;
}

// exitCode instead of process.exit(), as in claim.mjs: exiting while fetch still closes its connection aborts Node 24
// on Windows in libuv and replaces the exit code.
process.exitCode = await join(process.argv[2] ?? '');
