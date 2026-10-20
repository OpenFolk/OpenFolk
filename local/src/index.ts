// Entry point of the local backend: bot sessions + connection to the relay (RELAY_URL), or a relay of its own on
// 127.0.0.1 when RELAY_URL is not set.
//
//   npm start   (= npm run local)

import fs from 'node:fs';
import path from 'node:path';
import { isNewDataDir, migrateDataDir } from './migrate.ts';
// In the desktop app Electron runs this process as Node (ELECTRON_RUN_AS_NODE). Everything the bots start would
// inherit that and could not open an Electron program (VS Code, the desktop apps) any more; auth.ts sets it again
// only where Electron itself has to run as Node.
if (process.versions.electron) delete process.env.ELECTRON_RUN_AS_NODE;
// The data must be in the current format before any other module reads it
const newDataDir = isNewDataDir();
const migrated = migrateDataDir();

const { BotManager } = await import('./agent.ts');
const { RelayClient } = await import('./relay-client.ts');
const { Accounts } = await import('./accounts.ts');
const { stopDeviceLogins } = await import('./engine-login.ts');
const { transcriber } = await import('./voice.ts');
const { config, movedToSettings } = await import('./config.ts');
const { setupE2eKey } = await import('./e2e.ts');
const { accountIds, DEFAULT_ACCOUNT, inAccount, secureDataDir } = await import('./store.ts');
const { watchRestart } = await import('./restart.ts');
const { migrateNotes } = await import('./knowledge.ts');
const { machineSummary } = await import('./machine-config.ts');
const { applyGitPush, startWithoutEngines } = await import('./machine-settings.ts');
const { relayPush } = await import('./push.ts');
const { appUrl, newPairingLink, openInBrowser, pairingTerminal } = await import('./pairing.ts');
const { t } = await import('./i18n.ts');

if (migrated) console.log(`migrate: data folder converted to the current format (${migrated.files.length} files, ${migrated.entries} history entries, ${migrated.facts} facts)`);
for (const account of accountIds()) {
    const notes = inAccount(account, migrateNotes);
    if (notes) console.log(`knowledge: notes of ${notes} bots of account ${account} taken over into the knowledge folder`);
}

secureDataDir();
// A new installation runs no provider until the user picks theirs (first steps, settings); existing ones keep them all
if (newDataDir) startWithoutEngines();
// The git token of the machine settings, before the first session starts
applyGitPush();
// local/tools/install-task.ps1 stops exactly this process, not any node.exe it cannot see the command line of
const pidFile = path.join(config.dataDir, 'backend.pid');
fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
process.on('exit', () => {
    try {
        if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.rmSync(pidFile);
    } catch {
        // already gone
    }
});
const e2e = setupE2eKey();
const e2eText = { env: 'on', file: 'on (key in data/e2e-key)', off: 'OFF (E2E_KEY=off)',
    generated: 'on with a new key in data/e2e-key (further machines need the same values: npm run env writes them into the .env)' }[e2e];
/** First start of this backend: nothing to pair with yet, so the start output offers the link (and opens it). */
const firstStart = e2e === 'generated';

// Without RELAY_URL the relay runs in this process, on 127.0.0.1 only: the whole setup is `npm start`
let embedded: { close(): Promise<void> } | null = null;
if (config.relay.mode === 'embedded') {
    const { agentToken, clientToken } = await import('./tokens.ts');
    const { dataPath } = await import('./store.ts');
    let startRelay: typeof import('../../relay/src/relay.ts').startRelay;
    try {
        ({ startRelay } = await import('../../relay/src/relay.ts'));
    } catch (e) {
        // The backend image has no relay/: there RELAY_URL is required
        console.error(`RELAY_URL is not set and this installation has no relay (${(e as Error).message}). Set RELAY_URL in the .env.`);
        process.exit(1);
    }
    try {
        embedded = await startRelay({
            port: config.relay.port, host: process.env.RELAY_LISTEN?.trim() || '127.0.0.1',
            clientToken: clientToken(), agentToken: agentToken(), dataDir: dataPath('relay'), totpSecret: process.env.TOTP_SECRET ?? '',
            log: (text) => console.log(`${new Date().toLocaleTimeString('en-GB')} relay: ${text}`),
        });
    } catch (e) {
        const inUse = (e as NodeJS.ErrnoException).code === 'EADDRINUSE';
        console.error(inUse ? `Port ${config.relay.port} is taken: another relay or backend runs here. Set RELAY_PORT, or RELAY_URL to use that relay.`
            : `The embedded relay did not start: ${(e as Error).message}`);
        process.exit(1);
    }
    console.log(t('setup.embedded', { url: `http://127.0.0.1:${config.relay.port}` }));
}

const relay = new RelayClient();
// Claimed from the app (relay-switch.ts): connect there, the embedded relay is done
const { onRelaySwitch } = await import('./relay-switch.ts');
onRelaySwitch((relayUrl) => {
    process.env.RELAY_URL = relayUrl;
    config.relay = { mode: 'remote', url: relayUrl, port: 0 };
    relay.reconnect();
    void embedded?.close();
    embedded = null;
    console.log(`relay: now ${relayUrl}`);
});
// The main account's first device from the sign-in page, with the code in this log (containers only, first-device.ts)
const { answerFirstDevice, firstDeviceCode } = await import('./first-device.ts');
const { e2eKeyForLink } = await import('./e2e.ts');
relay.onFirstDevice = (id, pk) => answerFirstDevice(id, pk, async () => {
    const { token } = await RelayClient.createPairing(DEFAULT_ACCOUNT);
    const key = e2eKeyForLink();
    return `pair=${token}${key ? `&e2e=${key}` : ''}`;
});
let announced = false;
relay.onConnected = () => {
    if (announced) return;
    announced = true;
    void announcePairing();
};

/**
 * The pairing link carries the end-to-end key, so it goes to an interactive terminal only, never into local.log or a
 * container log; there the start output says how to get one.
 */
async function announcePairing(): Promise<void> {
    if (firstDeviceCode) console.log(t('setup.firstDeviceCode', { code: firstDeviceCode, url: appUrl() }));
    const show = process.stdout.isTTY && (embedded !== null || firstStart);
    if (!show) {
        if (firstStart) console.log(t('setup.pairLater'));
        return;
    }
    try {
        const link = await newPairingLink(DEFAULT_ACCOUNT);
        console.log(`\n${t('setup.pairHere')}\n\n${link.url}\n\n${await pairingTerminal(link.url)}`);
        if (firstStart && process.env.OPEN_BROWSER !== '0') openInBrowser(link.url);
    } catch (e) {
        console.log(t('setup.pairFailed', { error: (e as Error).message }));
    }
}
// One BotManager per account, each created and started in its account (accounts.ts)
const accounts = new Accounts((account) => new BotManager(
    (frame, cid) => relay.send(frame, cid, account), (data, to) => relay.peer(data, to, account), (schedule) => relay.wakeSchedule(schedule, account)));
relay.setRouter(accounts);
// App push through the relay for channels this machine has no credentials for
relayPush.channels = () => relay.relayPushChannels;
relayPush.send = (subscriptions, message) => relay.pushViaRelay(subscriptions, message);

console.log(`openfolk local on ${config.machine}: data in ${config.dataDir}, allowed folders ${config.allowedRoots.join(', ')}, `
    + `end-to-end encryption ${e2eText}, ${machineSummary(config.power)}`);
const moved = movedToSettings();
if (moved.length) console.log(t('setup.movedToSettings', { names: moved.join(', ') }));
accounts.start();
relay.start();
transcriber.preload();

function exit(): void {
    console.log('Stopping …');
    relay.stop();
    accounts.close();
    stopDeviceLogins();
    transcriber.stop();
    void embedded?.close();
    setTimeout(() => process.exit(0), 500);
}
watchRestart(() => accounts.busy(), (reason) => {
    console.log(`restart: ${reason}`);
    exit();
});
process.on('SIGINT', exit);
process.on('SIGTERM', exit);
// When a session is closed, the SDK drops open internal requests of the CLI without catching the error
// ("Query closed before response received"); that must not end the whole backend.
process.on('unhandledRejection', (e) => console.log(`unhandled: ${e instanceof Error ? e.message : String(e)}`));
