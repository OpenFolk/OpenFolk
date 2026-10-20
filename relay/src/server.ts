// The relay on its own (container, `npm run relay`): reads its settings from the environment and relay/.env
// (relay/.env.sample) and runs startRelay() (relay.ts) until SIGTERM.

import path from 'node:path';
import { parseTrustProxy } from './auth.ts';
import { repoRoot, startRelay } from './relay.ts';

// relay/.env; the root .env is the backend's and only a fallback for setups from before the split.
// Variables already set (container) win, as with any .env.
for (const file of [path.join(repoRoot, 'relay', '.env'), path.join(repoRoot, '.env')]) {
    try {
        process.loadEnvFile(file);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
}

const env = process.env;
let relay: Awaited<ReturnType<typeof startRelay>>;
try {
    relay = await startRelay({
        port: Number(env.RELAY_PORT ?? 8787),
        // CLIENT_TOKEN: the password's former name, still read
        clientToken: env.USER_PASSWORD || env.CLIENT_TOKEN || '',
        agentToken: env.AGENT_TOKEN ?? '',
        setupCode: env.RELAY_SETUP_CODE ?? '',
        dataDir: env.RELAY_DATA ?? path.join(repoRoot, 'relay', 'data'),
        // Only taken over once into totp.json; the second factor is set up in the app (devices.ts TotpStore)
        totpSecret: env.TOTP_SECRET ?? '',
        trustProxy: parseTrustProxy(env.TRUST_PROXY),
        agentAllowedFrom: (env.AGENT_ALLOWED_FROM ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        heartbeatMs: Number(env.HEARTBEAT_MS ?? 30_000),
    });
} catch (e) {
    console.error((e as Error).message);
    process.exit(1);
}

// Deploy (the container platform, e.g. Coolify, replaces the container with SIGTERM): close connections cleanly
// with 1012 "Service Restart" instead of dropping them (1006); backends and app reconnect to the new container
// right away.
let shuttingDown = false;
function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: relay shutting down`);
    void relay.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
