// Session transfer when a bot changes machines: the backend the bot ran on so far sends the transcripts of its
// Claude sessions (main chat and conversations) via the relay to the new machine, in chunks so the chat does not
// stall. The new machine stores them under the bot's folder there (~/.claude/projects/<folder>/<id>.jsonl, the
// folder may differ from the one here) and sets the session id; the next message continues the session there via
// resume, with full context.
// Codex threads do not exist as a transcript and stay where they are.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './store.ts';
import { transcriptPath } from './vscode.ts';
import type { PeerData } from '../../shared/protocol.ts';

/** Raw bytes per chunk (base64 adds about a third). */
export const CHUNK_BYTES = 1024 * 1024;
/** Half-finished transfers that make no progress for this long are dropped. */
const RECEIVE_TIMEOUT_MS = 10 * 60_000;

export type TransferPart = Extract<PeerData, { kind: 'session_transfer' }>;

/** Splits a transcript into peer messages; empty if the file does not exist. `from`: folder here, `to`: there. */
export function transferParts(botId: string, from: string, to: string, key: string, sessionId: string): TransferPart[] {
    const file = transcriptPath(from, sessionId);
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file);
    const parts = Math.max(1, Math.ceil(content.length / CHUNK_BYTES));
    const r: TransferPart[] = [];
    for (let i = 0; i < parts; i++) {
        r.push({
            kind: 'session_transfer', botId, folder: to, key, sessionId, part: i, parts,
            data: content.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64'),
        });
    }
    return r;
}

interface Pending { parts: (string | undefined)[]; since: number }

/** Puts incoming chunks together; with the last missing chunk it returns the path of the stored file. */
export class TransferReceiver {
    private pending = new Map<string, Pending>();

    chunk(t: TransferPart): string | null {
        const now = Date.now();
        for (const [k, o] of this.pending) if (now - o.since > RECEIVE_TIMEOUT_MS) this.pending.delete(k);
        if (!Number.isInteger(t.part) || !Number.isInteger(t.parts) || t.parts < 1 || t.part < 0 || t.part >= t.parts) {
            throw new Error('invalid chunk');
        }
        const k = `${t.key}:${t.sessionId}`;
        let o = this.pending.get(k);
        if (!o || o.parts.length !== t.parts) {
            // without holes: some() skips the empty slots of new Array(n)
            o = { parts: Array.from({ length: t.parts }, () => undefined), since: now };
            this.pending.set(k, o);
        }
        o.parts[t.part] = t.data;
        if (o.parts.some((d) => d === undefined)) return null;
        this.pending.delete(k);
        const file = transcriptPath(t.folder, t.sessionId);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.transfer`;
        fs.writeFileSync(tmp, Buffer.concat(o.parts.map((d) => Buffer.from(d!, 'base64'))), { mode: 0o600 });
        fs.renameSync(tmp, file);
        return file;
    }
}

// ------------------------------------------------------------------ pending transfers

export interface PendingTransfer {
    machine: string;
    /** The bot's folder on this machine, where its transcripts are; empty = its current folder. */
    folder: string;
}

/** Bot id → target: transfers waiting until the bot is done or the target is awake. */
export function pendingTransfers(): Record<string, PendingTransfer> {
    const all = readJson<Record<string, string | PendingTransfer>>('transfers.json', {});
    // Before 0.2 only the machine was stored; the folder did not change with it
    return Object.fromEntries(Object.entries(all).map(([id, p]) => [id, typeof p === 'string' ? { machine: p, folder: '' } : p]));
}

export function scheduleTransfer(botId: string, target: PendingTransfer | null): void {
    const all = pendingTransfers();
    if (target) all[botId] = target;
    else delete all[botId];
    writeJson('transfers.json', all);
}
