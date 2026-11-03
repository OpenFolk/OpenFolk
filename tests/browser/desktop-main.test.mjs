// The desktop app's main process (desktop/main.js) with a stand-in for Electron:
// the folders for the bots are never empty and the window is marked for the web app. No browser is needed here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Starts main.js against a profile folder; returns what the stand-in recorded. */
function startApp(profile, config) {
    const state = { handlers: {}, whenReady: null, win: null, tray: null, menu: null, restarts: 0 };
    if (config) fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config));
    class Win {
        constructor() {
            this.loads = [];
            this.events = {};
            this.hidden = false;
            this.agent = '';
            this.webContents = { userAgent: 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44', setUserAgent: (a) => { this.agent = a; }, setWindowOpenHandler: () => undefined, on: () => undefined };
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
            whenReady: () => new Promise((resolve) => { state.whenReady = resolve; }),
            getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: () => undefined,
        },
        BrowserWindow: Object.assign(Win, { fromWebContents: () => null }),
        Tray,
        Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (t) => { state.menu = t; } },
        shell: { openExternal: () => undefined },
        ipcMain: { handle: (name, fn) => { state.handlers[name] = fn; } },
        nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
        dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true }) },
        session: { defaultSession: { setPermissionRequestHandler: () => undefined } },
    };
    const require = createRequire(import.meta.url);
    const load = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return electron;
        if (request === './handover.js') return { watchHandovers: () => undefined };
        if (request === './updater.js') return { startUpdates: () => undefined, updateMenuItems: () => [] };
        if (request === './backend.js') {
            const real = load.call(this, request, ...rest);
            class Backend {
                constructor(port) { this.port = port; this.url = `http://127.0.0.1:${port}/`; this.child = {}; }
                start() {}
                ready() { return Promise.resolve(true); }
                restartWhenIdle() { state.restarts++; return Promise.resolve('restarted'); }
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
const fromSetup = { senderFrame: { url: 'file:///setup.html' } };

export default async function ({ check }) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-main-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-home-'));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = process.env.USERPROFILE = home;
    try {
        // Running "on this computer"
        let app = startApp(profile, { mode: 'local', localPort: 4711, paired: 'http://127.0.0.1:4711/' });
        app.whenReady();
        await settle();
        const last = () => app.win.loads[app.win.loads.length - 1];
        check('main: the app shows the web app of the backend', last().url === 'http://127.0.0.1:4711/', app.win.loads);
        check('main: "on this computer" marks the user agent for the web app', app.win.agent === 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44 OpenFolkLocal', app.win.agent);
        check('main: no folder in the .env yet: the own folder is created and written, never the whole user folder', fs.readFileSync(path.join(profile, '.env'), 'utf8') === `ALLOWED_ROOTS=${path.join(home, 'OpenFolk')}\n` && fs.statSync(path.join(home, 'OpenFolk')).isDirectory(), fs.existsSync(path.join(profile, '.env')) && fs.readFileSync(path.join(profile, '.env'), 'utf8'));

        // Choosing "on this computer" again, with the list emptied: the own folder, and the running backend restarts
        const r = await app.handlers['choose-local'](fromSetup, []);
        check('main: "start on this computer" with no folder writes the own folder and restarts the running backend', !r.error && fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${path.join(home, 'OpenFolk')}`) && app.restarts === 1, { r, restarts: app.restarts });
        const other = path.join(home, 'Work');
        fs.mkdirSync(other);
        const saveFolders = await app.handlers['folders-save'](fromSetup, [other]);
        check('main: the window "Allowed folders" saves its list', !saveFolders.error && fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${other}`), saveFolders);
        await app.handlers['folders-save'](fromSetup, []);
        check('main: saving an empty list falls back to the own folder', fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${path.join(home, 'OpenFolk')}`));
        const info = await app.handlers['folders-info'](fromSetup);
        check('main: the folder pages learn the own folder', info.defaultRoot === path.join(home, 'OpenFolk'), info.defaultRoot);

        // Connected to a relay: a display-only window
        app = startApp(profile, { mode: 'relay', url: 'https://relay.example.test/' });
        app.whenReady();
        await settle();
        check('main: a display-only window carries no mark', app.win.agent === 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44', app.win.agent);
    } finally {
        for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
}
