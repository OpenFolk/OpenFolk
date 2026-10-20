// After `npm run join` (local/tools/join.mjs): the new machine has the relay, its own agent token and the end-to-end
// key, but not the web push key pair the other machines share. It asks them once it is connected ("keys_request");
// one answers with the pair ("keys"), only through encrypted sync, and the marker join-pending.json goes away.

import fs from 'node:fs';
import { dataPath } from './store.ts';

const MARKER = 'join-pending.json';

/** This machine joined by invitation and still waits for the shared keys. */
export function joinPending(): boolean {
    return fs.existsSync(dataPath(MARKER));
}

export function joinDone(): void {
    fs.rmSync(dataPath(MARKER), { force: true });
}
