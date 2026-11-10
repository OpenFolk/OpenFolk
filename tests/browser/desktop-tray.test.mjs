// The desktop app's main process (desktop/main.js) with a stand-in for Electron: which page the window shows after
// "Change setup" was closed (a click on the tray icon used to bring the setup page back). No browser is needed here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Starts main.js against a profile folder; returns what the stand-in recorded. */
function startApp(profile, config) {
    const state = { whenReady: null, win: null, tray: null, menu: null };
    if (config) fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config));
    class Win {
        constructor() {
            this.loads = [];
            this.events = {};
            this.hidden = false;
            this.webContents = { userAgent: 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44', setUserAgent: () => undefined, setWindowOpenHandler: () => undefined, on: () => undefined };
            state.win = this;
        }
        once() {}
        on(name, fn) { this.events[name] = fn; }
        loadFile(file, o) { this.loads.push({ file: path.basename(file), query: o?.query || {} }); }
        loadURL(url) { this.loads.push({ url }); }
        show() { this.hidden = false; }
        hide() { this.hidden = true; }
        focus() {}
        isMinimized() { return false; }
        isMaximized() { return false; }
        isFullScreen() { return false; }
        getBounds() { return {}; }
    }
    class Tray {
        constructor() { state.tray = this; this.events = {}; }
        setToolTip() {}
        setContextMenu() {}
        on(name, fn) { this.events[name] = fn; }
    }
    const electron = {
        app: {
            name: 'OpenFolk', isPackaged: false, getPath: () => profile, getLocale: () => 'en', getVersion: () => '0.0.0',
            setPath: () => undefined, requestSingleInstanceLock: () => true, on: () => undefined, quit: () => undefined,
            setAsDefaultProtocolClient: () => true,
            whenReady: () => new Promise((resolve) => { state.whenReady = resolve; }),
            getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: () => undefined,
        },
        BrowserWindow: Object.assign(Win, { fromWebContents: () => null }),
        Tray,
        Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (t) => { state.menu = t; } },
        shell: { openExternal: () => undefined },
        ipcMain: { handle: () => undefined },
        nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
        dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true }) },
        session: { defaultSession: { setPermissionRequestHandler: () => undefined } },
        protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
    };
    const require = createRequire(import.meta.url);
    const load = Module._load;
    // main.js asks a relay whether it takes the app's page (relayRefusesApp): here no relay answers, as when it is offline
    const offline = { request: () => { const req = new (require('node:events').EventEmitter)(); req.end = () => setImmediate(() => req.emit('error', new Error('offline'))); req.destroy = () => undefined; return req; } };
    Module._load = function (request, ...rest) {
        if (request === 'electron') return electron;
        if ((request === 'node:http' || request === 'node:https') && rest[0]?.filename?.endsWith(path.join('desktop', 'main.js'))) return offline;
        if (request === './handover.js') return { watchHandovers: () => undefined };
        if (request === './updater.js') return { startUpdates: () => undefined, updateMenuItems: () => [] };
        if (request === './backend.js') {
            const real = load.call(this, request, ...rest);
            class Backend {
                constructor(port) { this.port = port; this.url = `http://127.0.0.1:${port}/`; this.child = {}; }
                start() {}
                ready() { return Promise.resolve(true); }
                stop() { return Promise.resolve(); }
            }
            return { ...real, Backend, freePort: async () => 4711 };
        }
        return load.call(this, request, ...rest);
    };
    for (const name of ['main.js', 'backend.js', 'task.js']) delete require.cache[path.join(ROOT, 'desktop', name)];
    try {
        require(path.join(ROOT, 'desktop', 'main.js'));
    } finally {
        Module._load = load;
    }
    return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
// The app brings the web app along (openfolk://app) and names the relay it is pointed at
const appAt = (relay) => `openfolk://app/#relay=${encodeURIComponent(relay)}`;
const menuItem = (state, label) => state.menu[0].submenu.find((i) => i.label === label);

export default async function ({ check }) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-tray-'));
    try {
        // Running "on this computer": "Change setup" opened and closed without a choice, the tray icon brings the app back
        let app = startApp(profile, { mode: 'local', localPort: 4711, paired: 'http://127.0.0.1:4711/' });
        app.whenReady();
        await settle();
        const last = () => app.win.loads[app.win.loads.length - 1];
        check('tray: the app shows the web app of the backend', last().url === appAt('http://127.0.0.1:4711'), app.win.loads);
        menuItem(app, 'Change setup …').click();
        check('tray: "Change setup" shows the setup page', last().file === 'setup.html' && last().query.choose === '1', last());
        app.win.events.close({ preventDefault: () => undefined });
        await settle();
        check('tray: closing it without a choice hides the window and brings the web app back', app.win.hidden && last().url === appAt('http://127.0.0.1:4711'), app.win.loads);
        app.tray.events.click();
        check('tray: a click on the tray icon shows the web app, not the setup page', !app.win.hidden && last().url === appAt('http://127.0.0.1:4711'), last());

        // First start: no choice made yet, so closing the setup page leaves it there
        fs.rmSync(path.join(profile, 'config.json'));
        app = startApp(profile);
        app.whenReady();
        await settle();
        menuItem(app, 'Change setup …').click();
        app.win.events.close({ preventDefault: () => undefined });
        await settle();
        check('tray: without any choice made the setup page stays', app.win.loads.every((l) => l.file === 'setup.html'), app.win.loads);

        // Connected to a relay: closing "Change setup" brings that relay back
        app = startApp(profile, { mode: 'relay', url: 'https://relay.example.test/' });
        app.whenReady();
        await settle();
        menuItem(app, 'Change setup …').click();
        app.win.events.close({ preventDefault: () => undefined });
        await settle();
        check('tray: in relay mode the relay comes back', app.win.loads[app.win.loads.length - 1].url === appAt('https://relay.example.test'), app.win.loads);
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
}
