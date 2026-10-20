// Claims a relay that was started without tokens (it waits and prints a setup code to its log): sends this backend's
// AGENT_TOKEN and USER_PASSWORD with the code, then points the .env at the relay (RELAY_URL).
//
//   npm run claim -- <address of the relay> <setup code>
//   npm run claim -- https://relay.example.com ABCDE-FGHJK
import { envFile, ensureToken, parse, set } from './env.mjs';

const [address = '', code = ''] = process.argv.slice(2);
if (!address || !code) {
    console.error('Usage: npm run claim -- <address of the relay> <setup code>');
    console.error('The setup code is in the relay\'s log (docker logs, Coolify\'s log view).');
    process.exit(2);
}

/** https://relay.example.com, relay.example.com or wss://relay.example.com/ws/agent all mean the same relay. */
function origin(raw) {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol === 'wss:') u.protocol = 'https:';
    if (u.protocol === 'ws:') u.protocol = 'http:';
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${raw} is not a web address`);
    return u.origin;
}

let base;
try {
    base = origin(address);
} catch (e) {
    console.error(e.message);
    process.exit(2);
}
if (base.startsWith('http:') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(base)) {
    console.error('The relay needs HTTPS (the tokens travel in this request). Put it behind a reverse proxy with a certificate.');
    process.exit(2);
}

const reasons = {
    already_claimed: 'This relay already has an owner. If it is yours, set RELAY_URL and the AGENT_TOKEN it was claimed with in the .env.'
        + ' To start over, delete owner.json in the relay\'s data volume and restart it.',
    wrong_code: 'Wrong setup code. Take it from the relay\'s current log: it changes when the relay restarts, unless RELAY_SETUP_CODE is set.',
    invalid: 'The relay refused the tokens (at least 16 characters, no spaces). Check AGENT_TOKEN and USER_PASSWORD in the .env.',
};

/** Sends the claim and reports the outcome; returns the exit code. */
async function claim() {
    const body = { code, agentToken: ensureToken('AGENT_TOKEN'), clientToken: ensureToken('USER_PASSWORD') };
    let r;
    try {
        r = await fetch(`${base}/claim`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
        });
    } catch (e) {
        console.error(`The relay at ${base} does not answer (${e.cause?.code ?? e.message}).`);
        return 1;
    }
    const answer = await r.json().catch(() => ({}));
    if (r.status !== 200) {
        console.error(reasons[answer.error] ?? (r.status === 429 ? 'Too many attempts from this address; wait an hour.'
            : r.status === 404 ? 'This relay is too old for claiming: update it, or set USER_PASSWORD and AGENT_TOKEN on the relay.'
                : `The relay answered ${r.status}.`));
        return 1;
    }
    const relayUrl = `${base.replace(/^http/, 'ws')}/ws/agent`;
    const before = parse(envFile).RELAY_URL;
    set({ RELAY_URL: relayUrl }, envFile, true);
    console.log(`The relay at ${base} belongs to this backend now.`);
    console.log(before && before !== relayUrl ? `RELAY_URL in the .env changed from ${before} to ${relayUrl}.` : `RELAY_URL=${relayUrl} is in the .env.`);
    console.log('Restart the backend: npm run restart (or npm start if it is not running). The web app\'s password stays'
        + ' the one of this backend: node local/tools/e2e.mjs password.');
    return 0;
}

// exitCode instead of process.exit(): exiting while fetch still closes its connection aborts Node 24 on Windows in
// libuv (assertion in src\win\async.c) and replaces the exit code. The process ends by itself once the socket is closed.
process.exitCode = await claim();
