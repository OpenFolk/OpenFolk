// When each machine's backend was last connected, in a file that survives deploys. The app uses it to spot a
// machine that is running according to the wake service but whose backend does not come back (e.g. a hanging
// shutdown). Connected machines are recorded again every minute: a backend that does not return after the relay
// restarts is thus reported as gone at most one minute too late.

import fs from 'node:fs';
import path from 'node:path';

export const MACHINES_SEEN_FILE = 'machines-seen.json';

export class MachinesSeen {
    private file: string;
    private times: Record<string, string>;

    constructor(dir: string) {
        fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, MACHINES_SEEN_FILE);
        try {
            this.times = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>;
            if (!this.times || typeof this.times !== 'object' || Array.isArray(this.times)) this.times = {};
        } catch {
            this.times = {};
        }
    }

    /** These machines are connected now (or were until just now). */
    record(machines: string[], now = new Date()): void {
        if (!machines.length) return;
        for (const m of machines) this.times[m] = now.toISOString();
        const tmp = this.file + '.tmp';
        try {
            fs.writeFileSync(tmp, JSON.stringify(this.times, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (e) {
            console.log(`${MACHINES_SEEN_FILE} not saved: ${(e as Error).message}`);
        }
    }

    /** Machines that are not connected, with the time their backend was last connected. */
    gone(online: string[]): Record<string, string> {
        return Object.fromEntries(Object.entries(this.times).filter(([m]) => !online.includes(m)));
    }
}
