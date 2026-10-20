// Browser tests of the web app:  npm run test:browser   (single file: node tests/browser/run.mjs pin)
// Every file *.test.mjs exports a function ({ start, check }); it runs in its own context.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { start } from './harness.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Contract between web app and backend: every frame the app sends in the tests must pass the backend's check
// (local/src/frames.ts; Node runs the TypeScript file directly). Frames for the relay itself are not checked there.
const { checkClientFrame } = await import(pathToFileURL(path.join(DIR, '..', '..', 'local', 'src', 'frames.ts')).href);
const RELAY_FRAMES = new Set(['auth', 'wake_status', 'wake', 'devices', 'device_logout', 'accounts', 'account_create', 'account_update', 'account_delete', 'account_invite', 'pair_wait', 'pair_first', 'pair_request', 'pair_approve', 'totp_status', 'totp_begin', 'totp_confirm', 'totp_off', 'machine_tokens', 'machine_token_remove', 'e2e']);
const filter = process.argv[2] ?? '';
const files = fs.readdirSync(DIR).filter((n) => n.endsWith('.test.mjs') && n.includes(filter)).sort();
const TIME_LIMIT_MS = 60_000;

const browser = await chromium.launch();
let failures = 0;
const t0 = Date.now();
for (const file of files) {
    const name = file.replace('.test.mjs', '');
    const open = [];
    const check = (text, ok, actual) => {
        console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}: ${text}${ok || actual === undefined ? '' : ` (actual ${JSON.stringify(actual)})`}`);
        if (!ok) failures++;
    };
    try {
        const { default: test } = await import(pathToFileURL(path.join(DIR, file)).href);
        let timer;
        await Promise.race([
            test({
                check,
                start: async (o) => { const h = await start(browser, o); open.push(h); return h; },
            }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${TIME_LIMIT_MS / 1000} s`)), TIME_LIMIT_MS); }),
        ]);
        clearTimeout(timer);
        for (const h of open) if (h.errors.length) check('no errors in the page', false, h.errors);
        const rejected = open.flatMap((h) => h.sent).filter((f) => !RELAY_FRAMES.has(f.type)).map(checkClientFrame).filter((r) => !r.ok);
        if (rejected.length) check('backend accepts every frame the app sent', false, rejected.map((r) => r.problem));
    } catch (e) {
        const [first, ...log] = e.message.split('\n');
        check('ran through', false, first);
        // Playwright's call log says what an action waited for (visible, stable, covered …); CI has nothing else
        for (const line of log.filter((l) => l.trim()).slice(0, 15)) console.log(`       ${line.trim()}`);
    } finally {
        for (const h of open) await h.close().catch(() => undefined);
    }
}
await browser.close();
console.log(failures ? `${failures} browser test(s) failed` : `all browser tests passed (${files.length} files, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failures ? 1 : 0);
