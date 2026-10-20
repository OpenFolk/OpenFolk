// Deletes a folder with everything in it, but never what a link inside points to. fs.rmSync({ recursive }) follows
// directory junctions on Windows under Node 24 and deletes the target's contents (Node 22 does not); the desktop
// app and anyone on Node 24 would lose files outside the folder. Links are removed as links here.

import fs from 'node:fs';
import path from 'node:path';

const RETRY = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

function remove(p: string): void {
    let st: fs.Stats;
    try {
        st = fs.lstatSync(p);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
    }
    if (st.isSymbolicLink()) {
        // A junction or directory link is removed with rmdir on Windows, a file link with unlink
        try {
            fs.unlinkSync(p);
        } catch {
            fs.rmdirSync(p);
        }
    } else if (st.isDirectory()) {
        for (const name of fs.readdirSync(p)) remove(path.join(p, name));
        fs.rmdirSync(p);
    } else {
        fs.unlinkSync(p);
    }
}

/**
 * Removes `p` like `rm -r`, links without following them. `retries`: on Windows a process that just ended may hold
 * files briefly; wait 200 ms and try again that often.
 */
export function removeTree(p: string, retries = 0): void {
    for (let attempt = 0; ; attempt++) {
        try {
            remove(p);
            return;
        } catch (e) {
            if (attempt >= retries || !RETRY.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        }
    }
}
