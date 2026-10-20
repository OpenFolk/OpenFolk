// Screenshots of the web app at desktop and phone width with Playwright's Chromium (a dev dependency).
//   node scripts/screenshot.mjs [target folder] [chat-id] [auto|light|dark] [address]
// The address defaults to http://localhost:8787. The first run signs in with USER_PASSWORD (environment, relay/.env or .env)
// and keeps the device key in <target folder>/state.json, so later runs do not add a device each time. A relay with
// A relay with a second factor asks for a code; sign in once in that browser profile by hand, or take screenshots of a local relay.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

const values = {};
dotenv.config({ path: [new URL('../relay/.env', import.meta.url), new URL('../.env', import.meta.url)], processEnv: values, quiet: true });
const [target = path.join(os.tmpdir(), 'openfolk-shots'), chat = '', theme = 'auto', base = 'http://localhost:8787'] = process.argv.slice(2);
if (!['auto', 'light', 'dark'].includes(theme)) {
    console.error('Theme must be auto, light or dark.');
    process.exit(2);
}
fs.mkdirSync(target, { recursive: true });
const stateFile = path.join(target, 'state.json');
const url = `${base.replace(/\/+$/, '')}/${chat ? `?chat=${encodeURIComponent(chat)}` : ''}`;

const browser = await chromium.launch();
try {
    const shoot = async (name, options) => {
        const ctx = await browser.newContext({ ...options, storageState: fs.existsSync(stateFile) ? stateFile : undefined });
        await ctx.addInitScript((t) => {
            if (t === 'auto') localStorage.removeItem('openfolk-theme');
            else localStorage.setItem('openfolk-theme', t);
        }, theme);
        const page = await ctx.newPage();
        await page.goto(url);
        await page.waitForTimeout(1500);
        if (await page.isVisible('#login')) {
            const token = process.env.USER_PASSWORD || values.USER_PASSWORD || process.env.CLIENT_TOKEN || values.CLIENT_TOKEN;
            if (!token) throw new Error('not signed in and no USER_PASSWORD in relay/.env or .env');
            await page.fill('#login-token', token);
            await page.press('#login-token', 'Enter');
            await page.waitForTimeout(2500);
            if (await page.isVisible('#login')) throw new Error(`sign-in failed: ${(await page.textContent('#login-error'))?.trim() || 'no answer'}`);
            await ctx.storageState({ path: stateFile });
        }
        await page.waitForTimeout(1500);
        const file = path.join(target, `${name}.png`);
        await page.screenshot({ path: file });
        await ctx.close();
        console.log(`${name}.png ${fs.statSync(file).size} bytes`);
    };
    await shoot('desktop', { viewport: { width: 1400, height: 900 } });
    await shoot('mobile', { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
} catch (e) {
    console.error(`Screenshot failed: ${e.message}`);
    process.exitCode = 1;
} finally {
    await browser.close();
}
