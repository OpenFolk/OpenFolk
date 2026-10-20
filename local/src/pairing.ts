// Pairing links: `<web app>/#pair=<token>&e2e=<key>`. The token (from the relay, valid 15 minutes, once) signs a
// device in without the password; the key behind '#' never reaches a server. Built by the backend, because only the
// backend has the key. Used by the devices dialog (agent.ts), the start output (index.ts) and local/tools/e2e.mjs.

import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { e2eKeyForLink } from './e2e.ts';
import { RelayClient } from './relay-client.ts';

/** Address of the web app in links: APP_URL (e.g. a Tailscale or proxy address), otherwise the relay's own. */
export function appUrl(): string {
    return (process.env.APP_URL?.trim() || RelayClient.origin()).replace(/\/+$/, '');
}

/** The link for a token and a key; the key in base64url without padding, as the web app reads it. */
export function pairingUrl(base: string, token: string, key: string): string {
    const k = key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${base}/#${token ? `pair=${token}` : ''}${token && k ? '&' : ''}${k ? `e2e=${k}` : ''}`;
}

export interface PairingLink {
    url: string;
    expiresAt: string;
    /** Whether the link carries the end-to-end key. */
    e2e: boolean;
}

/** A fresh link for a device of the account from the relay; throws when the relay cannot be reached. */
export async function newPairingLink(account: string): Promise<PairingLink> {
    const { token, expiresAt } = await RelayClient.createPairing(account);
    const key = e2eKeyForLink();
    return { url: pairingUrl(appUrl(), token, key), expiresAt, e2e: !!key };
}

/**
 * The invitation for one more machine: `<relay>/#join=<token>&e2e=<key>` and the command to run there. The relay's own
 * address, not APP_URL: the new machine talks to the relay itself (local/tools/join.mjs).
 */
export async function newMachineInvite(): Promise<{ url: string; command: string; expiresAt: string; e2e: boolean }> {
    const { token, expiresAt } = await RelayClient.createMachineInvite();
    const key = e2eKeyForLink().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${RelayClient.origin()}/#join=${token}${key ? `&e2e=${key}` : ''}`;
    return { url, command: `npm run join -- "${url}"`, expiresAt, e2e: !!key };
}

/**
 * Opens a link in the default browser. On Windows not through `cmd /c start`: cmd splits the command line at the
 * '&' between pair= and e2e=.
 */
export function openInBrowser(url: string): void {
    const [cmd, args] = process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`]]
        : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
}

export const pairingSvg =(url: string): Promise<string> => QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
export const pairingTerminal = (url: string): Promise<string> => QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
