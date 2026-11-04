// The desktop app's switch "Check for updates automatically" (desktop/updater.js) with stand-ins for Electron and
// electron-updater and fake timers: off means no timer and no check, switching works at once, a check from the menu
// works either way, and OPENFOLK_NO_UPDATE wins. No browser is needed here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function ({ check }) {
    // The runner starts its own time limit after this function first waits; the fake timers must not catch it
    await new Promise((resolve) => setImmediate(resolve));
    const require = createRequire(import.meta.url);
    const checks = [];
    const dialogs = [];
    const updater = {
        on: () => undefined,
        autoDownload: false,
        setFeedURL: () => undefined,
        checkForUpdates: async () => { checks.push(Date.now()); return { isUpdateAvailable: false }; },
    };
    // update-count.json of the active-version count goes to a folder of its own
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-updates-'));
    const load = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return { app: { isPackaged: true, getVersion: () => '0.1.2', getPath: () => userData, on: () => undefined, quit: () => undefined }, dialog: { showMessageBox: async (...a) => { dialogs.push(a[a.length - 1]); return { response: 0 }; } } };
        if (request === 'electron-updater') return { autoUpdater: updater };
        return load.call(this, request, ...rest);
    };
    // Timers: recorded, never run by themselves
    const real = { setTimeout: global.setTimeout, setInterval: global.setInterval, clearTimeout: global.clearTimeout, clearInterval: global.clearInterval };
    const live = new Set();
    const made = [];
    const fake = (kind) => (fn, ms) => { const timer = { fn, ms, kind, unref: () => timer }; live.add(timer); made.push(timer); return timer; };
    global.setTimeout = fake('timeout');
    global.setInterval = fake('interval');
    global.clearTimeout = global.clearInterval = (timer) => { live.delete(timer); };
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const noUpdate = process.env.OPENFOLK_NO_UPDATE;
    const portable = process.env.PORTABLE_EXECUTABLE_DIR;
    delete process.env.OPENFOLK_NO_UPDATE;
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    try {
        const file = path.join(ROOT, 'desktop', 'updater.js');
        delete require.cache[file];
        const updates = require(file);
        let auto = true;
        let changes = 0;
        const T = { checkUpdates: 'Check', autoUpdate: 'Automatic', autoUpdateEnv: 'Automatic (OPENFOLK_NO_UPDATE)', updateNone: 'Latest {version}' };
        updates.startUpdates({ t: (k) => T[k] ?? k, quit: () => undefined, window: () => null, auto: () => auto, setAuto: (on) => { auto = on; }, onChange: () => { changes++; } });
        const item = () => updates.updateMenuItems().find((i) => i.type === 'checkbox');
        const pending = () => [...live].map((t) => `${t.kind}:${t.ms}`).sort().join();

        check('updates: switched on (the default): a first check after half a minute and one every six hours', pending() === 'interval:21600000,timeout:30000', pending());
        check('updates: the menu entry is a checked checkbox right after "Check for updates", before the count switch', item().checked && item().enabled && item().label === 'Automatic' && updates.updateMenuItems()[0].label === 'Check' && updates.updateMenuItems()[2].label === 'countActive', updates.updateMenuItems());
        [...live].find((t) => t.kind === 'timeout').fn();
        check('updates: the timer checks', checks.length === 1);

        item().click({ checked: false });
        check('updates: switched off: stored, both timers stopped at once, menus rebuilt', auto === false && live.size === 0 && changes === 1, { auto, pending: pending(), changes });
        check('updates: the entry shows unchecked', item().checked === false && item().enabled);
        const before = checks.length;
        // the entry starts the check without returning it; setImmediate is not faked
        updates.updateMenuItems().find((i) => i.label === 'Check').click();
        await new Promise((resolve) => setImmediate(resolve));
        check('updates: off, a check from the menu still works and says what it found', checks.length === before + 1 && dialogs.length === 1 && dialogs[0].detail === 'Latest 0.1.2', dialogs);

        item().click({ checked: true });
        check('updates: switched on again: timers run again without a restart, the first check follows in a moment', auto === true && pending() === 'interval:21600000,timeout:3000', pending());

        // OPENFOLK_NO_UPDATE wins over the setting
        process.env.OPENFOLK_NO_UPDATE = '1';
        live.clear();
        delete require.cache[file];
        const forced = require(file);
        forced.startUpdates({ t: (k) => T[k] ?? k, quit: () => undefined, window: () => null, auto: () => true, setAuto: () => undefined, onChange: () => undefined });
        const entry = forced.updateMenuItems().find((i) => i.type === 'checkbox');
        check('updates: OPENFOLK_NO_UPDATE: no timer although the setting is on', live.size === 0, pending());
        check('updates: OPENFOLK_NO_UPDATE: the entry is unchecked and disabled, and says why', entry.checked === false && entry.enabled === false && entry.label.includes('OPENFOLK_NO_UPDATE'), entry);
    } finally {
        Object.assign(global, real);
        Module._load = load;
        Object.defineProperty(process, 'platform', platform);
        if (noUpdate === undefined) delete process.env.OPENFOLK_NO_UPDATE; else process.env.OPENFOLK_NO_UPDATE = noUpdate;
        if (portable !== undefined) process.env.PORTABLE_EXECUTABLE_DIR = portable;
        fs.rmSync(userData, { recursive: true, force: true });
    }
    check('updates: the texts exist in English and German', ['autoUpdate', 'autoUpdateEnv'].every((k) => (fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').match(new RegExp(`^\\s{8}${k}: `, 'gm')) || []).length === 2));
}
