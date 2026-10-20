// Moves a backend from its embedded relay to a relay of one's own on a server, from the app: the same claim as
// `npm run claim`, then a pairing link at the new relay for the asking device, RELAY_URL in the .env, and the switch
// inside the running process. A restart would not do: under `npm start` nothing would start the backend again.

import { config, setEnvValue } from './config.ts';
import { e2eKeyForLink } from './e2e.ts';
import { t } from './i18n.ts';
import { pairingUrl } from './pairing.ts';
import { RelayClient } from './relay-client.ts';
import { accountIds, DEFAULT_ACCOUNT } from './store.ts';

/** https://relay.example.com, relay.example.com or wss://relay.example.com/ws/agent all mean the same relay. */
export function relayOrigin(raw: string): string {
    const text = raw.trim();
    const u = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol === 'wss:') u.protocol = 'https:';
    if (u.protocol === 'ws:') u.protocol = 'http:';
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(t('relayClaim.address', { address: raw }));
    // The tokens travel in the claim: plain HTTP only to this computer itself
    if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) throw new Error(t('relayClaim.https'));
    return u.origin;
}

let switcher: ((relayUrl: string) => void) | null = null;

/** index.ts: how this process changes its relay (reconnect, close the embedded one). */
export function onRelaySwitch(fn: (relayUrl: string) => void): void {
    switcher = fn;
}

/** The relay's error codes from /claim, as the user reads them. */
function claimError(result: string): string {
    if (result === 'already_claimed') return t('relayClaim.alreadyClaimed');
    if (result === 'wrong_code') return t('relayClaim.wrongCode');
    if (result === 'status 429') return t('relayClaim.tooMany');
    if (result === 'status 404') return t('relayClaim.tooOld');
    return t('relayClaim.failed', { error: result });
}

/**
 * Claims the relay at `address` with the setup code from its log and returns a pairing link there for one device of
 * the main account. The switch follows `delayMs` later, so the answer still reaches the browser over the embedded relay.
 */
export async function claimRelay(address: string, code: string, delayMs = 1500): Promise<{ url: string; relayUrl: string }> {
    if (config.relay.mode !== 'embedded') throw new Error(t('relayClaim.notEmbedded'));
    // Accounts live in the relay: those of the embedded one would be gone at the new one
    if (accountIds().some((a) => a !== DEFAULT_ACCOUNT)) throw new Error(t('relayClaim.accounts'));
    let origin: string;
    try {
        origin = relayOrigin(address);
    } catch (e) {
        throw new Error((e as Error).message.startsWith('Invalid URL') ? t('relayClaim.address', { address }) : (e as Error).message, { cause: e });
    }
    let result: string;
    try {
        result = await RelayClient.claim(code.trim(), origin);
    } catch (e) {
        throw new Error(t('relayClaim.unreachable', { address: origin, error: String((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message) }), { cause: e });
    }
    if (result !== 'ok') throw new Error(claimError(result));
    const { token } = await RelayClient.createPairing(DEFAULT_ACCOUNT, origin);
    const relayUrl = `${origin.replace(/^http/, 'ws')}/ws/agent`;
    setEnvValue('RELAY_URL', relayUrl);
    console.log(`relay: claimed ${origin}; RELAY_URL in the .env, switching over`);
    setTimeout(() => switcher?.(relayUrl), delayMs).unref();
    return { url: pairingUrl(origin, token, e2eKeyForLink()), relayUrl };
}
