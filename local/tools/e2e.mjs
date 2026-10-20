// Manage the keys for end-to-end encryption and web push (the second factor is set up in the app). Never prints keys to the console, except with
// "link" and "password" (then deliberately for the user in their own terminal).
//
//   npm run pair                                 = link: pairing link and QR code for one more device
//   npm run env [-- --print]                     write E2E_KEY, AGENT_TOKEN and PUSH_VAPID_* into the .env if missing:
//                                                the values the backend generated on its first start; copy that .env
//                                                to every further machine
//   node local/tools/e2e.mjs password            show the web app's password (USER_PASSWORD, generated or from the .env)
//   node local/tools/e2e.mjs new                 write E2E_KEY into the .env if there is none: the key the backend
//                                                generated on its first start (local/data/e2e-key), otherwise a new
//                                                one; copy that line into the .env of every further machine
//   node local/tools/e2e.mjs vapid               take PUSH_VAPID_* from local/data/vapid.json into the .env
//                                                (for further machines that need the same key pair)
//   node local/tools/e2e.mjs page [address]      create the pairing page (QR code for the E2E link) as an HTML file in the temp folder, open it in the
//                                                browser and delete it again after 15 minutes
//   node local/tools/e2e.mjs link [address]      show the pairing link and QR code in the terminal
//
// [address] is the web app's public address (default: APP_URL from the .env, otherwise the relay's address; without
// RELAY_URL the relay embedded in the backend).
// The link contains a one-time sign-in token (from the relay, valid 15 minutes) and the key behind '#'. The browser
// never sends that part to the server; the app reads it once, stores the key as a non-exportable key and removes
// everything from the address bar. The same link comes from the devices dialog of a signed-in device.
// All machines need the same E2E_KEY in their .env.
// TOTP_SECRET belongs to the relay; it is read from relay/.env, for older setups also from the .env.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { dataDir, envFile, generated, parse, relayEnvFile, relayOrigin, set, values } from './env.mjs';
/** The German command names of older versions still work. */
const ALIASES = { neu: 'new', seite: 'page' };
const [rawCommand = '', baseArg] = process.argv.slice(2);
const command = ALIASES[rawCommand] ?? rawCommand;

function base() {
    return (baseArg || values().APP_URL || relayOrigin()).replace(/\/+$/, '');
}

/**
 * A one-time sign-in token from the relay (POST /pair with AGENT_TOKEN), so the link also signs the device in
 * without the password; '' when the relay is unreachable or too old (then the link only carries the key).
 */
async function pairingToken() {
    const w = values();
    if (!w.AGENT_TOKEN) return '';
    try {
        const r = await fetch(`${relayOrigin(w)}/pair`, { method: 'POST', headers: { authorization: `Bearer ${w.AGENT_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`relay answered ${r.status}`);
        const j = await r.json();
        return typeof j.token === 'string' ? j.token : '';
    } catch (e) {
        console.error(`No sign-in token from the relay (${e.message}); is the backend running? The link carries the key only, the device will ask for the password.`);
        return '';
    }
}

/** `#pair=<token>&e2e=<key>`: the token signs the device in once, the key enables end-to-end encryption. */
const pairingLink = (key, token = '') => `${base()}/#${token ? `pair=${token}&` : ''}e2e=${key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

if (command === 'new') {
    const own = parse(envFile).E2E_KEY;
    const generatedKey = generated(values(), 'e2e-key');
    if (own && own.trim().toLowerCase() !== 'off') {
        console.log('E2E_KEY is already set, nothing changed.');
    } else if (generatedKey) {
        set({ E2E_KEY: generatedKey });
        console.log('E2E_KEY written into the .env: the key this backend generated (local/data/e2e-key). Copy the line into the .env of every further machine.');
    } else {
        set({ E2E_KEY: crypto.randomBytes(32).toString('base64url') });
        console.log('E2E_KEY written into the .env. Restart the backend, then pair the browsers (page or link).');
    }
} else if (command === 'totp-new') {
    console.log('The second factor is set up in the app now: Settings, Devices and security, "Set up second factor".');
} else if (command === 'vapid') {
    const w = values();
    if (w.PUSH_VAPID_PUBLIC_KEY && w.PUSH_VAPID_PRIVATE_KEY) {
        console.log('PUSH_VAPID_* are already set, nothing changed.');
    } else {
        const file = path.join(dataDir(w), 'vapid.json');
        if (!fs.existsSync(file)) {
            console.error('local/data/vapid.json is missing – the backend creates it on its first start.');
            process.exit(1);
        }
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        set({ PUSH_VAPID_PUBLIC_KEY: v.publicKey, PUSH_VAPID_PRIVATE_KEY: v.privateKey });
        console.log('PUSH_VAPID_* taken from vapid.json into the .env (same key pair as before).');
    }
} else if (command === 'env') {
    // Everything a further machine needs to join, into the .env that gets copied there
    const own = parse(envFile);
    const w = values();
    const add = {};
    if (!own.E2E_KEY && w.E2E_KEY) add.E2E_KEY = w.E2E_KEY;
    if (!own.AGENT_TOKEN && w.AGENT_TOKEN) add.AGENT_TOKEN = w.AGENT_TOKEN;
    const vapidFile = path.join(dataDir(w), 'vapid.json');
    if (!own.PUSH_VAPID_PUBLIC_KEY && fs.existsSync(vapidFile)) {
        const v = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
        add.PUSH_VAPID_PUBLIC_KEY = v.publicKey;
        add.PUSH_VAPID_PRIVATE_KEY = v.privateKey;
    }
    if (!w.E2E_KEY || !w.AGENT_TOKEN) {
        console.error('Start the backend once first (npm start); it generates the keys on its first start.');
        process.exit(1);
    }
    // --print: the lines on the terminal instead of into the .env (a container, whose /app the user cannot write)
    if (baseArg === '--print') {
        const vapid = fs.existsSync(vapidFile) ? JSON.parse(fs.readFileSync(vapidFile, 'utf8')) : {};
        const lines = { E2E_KEY: w.E2E_KEY, AGENT_TOKEN: w.AGENT_TOKEN, PUSH_VAPID_PUBLIC_KEY: w.PUSH_VAPID_PUBLIC_KEY || vapid.publicKey, PUSH_VAPID_PRIVATE_KEY: w.PUSH_VAPID_PRIVATE_KEY || vapid.privateKey };
        console.log('Lines for the .env of a further machine (keep them secret):\n');
        for (const [k, v] of Object.entries(lines)) if (v) console.log(`${k}=${v}`);
        process.exit(0);
    }
    if (Object.keys(add).length) set(add);
    console.log(Object.keys(add).length ? `Written into the .env: ${Object.keys(add).join(', ')}.` : 'The .env already holds everything, nothing changed.');
    console.log('Copy the .env to the next machine. All machines need a relay they reach together: an embedded relay serves only this'
        + ' computer, so set RELAY_URL on every machine to your own relay (docs/running.md).');
} else if (command === 'password') {
    const w = values();
    if (!w.USER_PASSWORD) {
        console.error('No password yet: start the backend once (npm start).');
        process.exit(1);
    }
    console.log('Password of the web app (needed only without a pairing link; keep it secret):\n');
    console.log(w.USER_PASSWORD + '\n');
    const own = (v) => v.USER_PASSWORD || v.CLIENT_TOKEN;
    if (w.RELAY_URL && !own(parse(envFile)) && !own(parse(relayEnvFile))) {
        console.log('This is the password this backend generated. It is the relay\'s password if this backend claimed the relay'
            + ' (npm run claim); a relay started with USER_PASSWORD uses that value instead.');
    }
} else if (command === 'page') {
    const w = values();
    if (!w.E2E_KEY) {
        console.error('E2E_KEY is not set – first "new".');
        process.exit(1);
    }
    const parts = [];
    if (w.E2E_KEY) {
        const link = pairingLink(w.E2E_KEY, await pairingToken());
        parts.push(`<section><h2>1. Pair devices (sign-in and end-to-end encryption)</h2>
<p>Scan with the phone or click on this PC. Once per device; the link signs the device in for 15 minutes without the password, afterwards the app removes the key from the address bar.</p>
${await QRCode.toString(link, { type: 'svg', margin: 1, width: 260 })}
<p><a href="${link}" target="_blank" rel="noreferrer">Open on this PC</a></p></section>`);
    }
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Pair OpenFolk</title>
<style>body{font:16px system-ui,sans-serif;max-width:720px;margin:30px auto;padding:0 16px;color:#111}section{border:1px solid #ddd;border-radius:12px;padding:16px 20px;margin:16px 0}svg{display:block;margin:12px 0}code{background:#f3f3f3;padding:2px 6px;border-radius:4px}.note{color:#a33}</style>
<h1>Pair OpenFolk</h1>
<p class="note">Secret! This page contains your keys. Do not share it. The file is deleted after 15 minutes.</p>
${parts.join('\n')}
</html>`;
    const file = path.join(os.tmpdir(), `openfolk-pairing-${crypto.randomBytes(4).toString('hex')}.html`);
    fs.writeFileSync(file, html, { mode: 0o600 });
    // Open in the default browser; then delete the file after 15 minutes in a process of its own
    const opener = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', file]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [file]];
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
    spawn(process.execPath, ['-e', "setTimeout(() => { try { require('fs').rmSync(process.argv[1], { force: true }); } catch {} }, 15 * 60 * 1000)", file],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    console.log('Pairing page opened in the browser (deleted after 15 minutes).');
} else if (command === 'link') {
    const key = values().E2E_KEY;
    if (!key) {
        console.error('No E2E_KEY in the .env – first "node local/tools/e2e.mjs new".');
        process.exit(1);
    }
    const link = pairingLink(key, await pairingToken());
    console.log('Pairing link (keep it secret, open it only on your own devices; the sign-in part works once, for 15 minutes):\n');
    console.log(link + '\n');
    console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
} else {
    console.error('Usage: node local/tools/e2e.mjs link [address] | env | password | new | vapid | page [address]');
    process.exit(2);
}
