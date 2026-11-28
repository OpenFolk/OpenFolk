// The relay's version: read from the nearest package.json above the module, in a checkout and in the image's layout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RELAY_VERSION, versionFrom } from './version.ts';

let failed = false;
function check(name: string, ok: boolean, detail?: unknown): void {
    console.log(`${ok ? 'ok' : 'FAILED'}  ${name}`);
    if (!ok) { failed = true; if (detail !== undefined) console.log('   ', detail); }
}

const own = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
check('the relay reads its own version from relay/package.json', RELAY_VERSION === own && /^\d+\.\d+\.\d+/.test(own), RELAY_VERSION);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'of-relay-version-'));
try {
    // the image: package.json in relay/, the code in relay/dist/relay/src
    const deep = path.join(tmp, 'relay', 'dist', 'relay', 'src');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'relay', 'package.json'), JSON.stringify({ version: '1.2.3' }));
    check('from the container layout the version is found a few folders up', versionFrom(deep) === '1.2.3', versionFrom(deep));
    fs.writeFileSync(path.join(tmp, 'relay', 'package.json'), JSON.stringify({ name: 'x' }));
    check('a package.json without a version gives none', versionFrom(deep) === '');
    fs.writeFileSync(path.join(tmp, 'relay', 'package.json'), '{ not json');
    check('an unreadable package.json gives none, it does not throw', versionFrom(deep) === '');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
