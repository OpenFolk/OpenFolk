// Copies the web app into www/, the folder Capacitor packs into the apps, together with the two libraries the relay
// otherwise serves under /vendor/. Run by `npm run sync`; afterwards `cap sync` copies www/ into android/ and ios/.
// Needs `npm install` in the repository root once (marked and DOMPurify come with the relay's dependencies).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOBILE, '..');
const SOURCE = path.join(ROOT, 'webapp');
const TARGET = path.join(MOBILE, 'www');
/** Pages for manual tests in the browser; not part of the app. */
const SKIP = (name) => name === 'tsconfig.json' || name === 'types';

const require = createRequire(path.join(ROOT, 'relay', 'package.json'));
let vendor;
try {
    vendor = {
        'marked.umd.js': path.join(path.dirname(require.resolve('marked')), 'marked.umd.js'),
        'purify.min.js': path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js'),
        'qrcode.js': path.join(path.dirname(require.resolve('qrcode-generator')), 'qrcode.js'),
    };
} catch {
    console.error('marked, DOMPurify or qrcode-generator not found: run "npm install" in the repository root first.');
    process.exit(1);
}

fs.rmSync(TARGET, { recursive: true, force: true });
fs.cpSync(SOURCE, TARGET, { recursive: true, filter: (src) => !SKIP(path.basename(src)) });
fs.mkdirSync(path.join(TARGET, 'vendor'), { recursive: true });
for (const [name, file] of Object.entries(vendor)) fs.copyFileSync(file, path.join(TARGET, 'vendor', name));

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`web app copied to ${path.relative(ROOT, TARGET)} (${count(TARGET)} files)`);
