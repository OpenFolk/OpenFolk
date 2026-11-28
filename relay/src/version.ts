// The version of OpenFolk this relay is (relay/package.json, raised with every release), told to the backends in relay_hello.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The version in the nearest package.json at or above `dir`; '' if there is none or it has no version. Walks up because the
 * relay runs from relay/src (npm start) and from relay/dist/relay/src (the container image), a fixed path fits only one.
 */
export function versionFrom(dir: string): string {
    for (let d = dir; ; d = path.dirname(d)) {
        try {
            const v = (JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')) as { version?: unknown }).version;
            return typeof v === 'string' ? v : '';
        } catch {
            // no package.json here (or unreadable): look one folder up
        }
        if (path.dirname(d) === d) return '';
    }
}

export const RELAY_VERSION: string = versionFrom(path.dirname(fileURLToPath(import.meta.url)));
