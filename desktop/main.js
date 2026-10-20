// OpenFolk as a desktop app for Windows, Linux and macOS: a tray icon on Windows and Linux, Dock and menu bar on the
// Mac, start at login everywhere. Two ways to run: "on this computer" runs the backend inside the app (backend.js),
// with the relay embedded or, once joined to a server (or a relay claimed from the app), with the relay there, and shows
// the web app from that relay; "connect to a relay" loads the web app from a relay elsewhere, like the browser. Login, device key and display settings stay in the app's profile (%APPDATA%\OpenFolk,
// ~/.config/OpenFolk, ~/Library/Application Support/OpenFolk).
'use strict';

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Backend, freePort, guardQuit, joinServer, remoteUrl, root } = require('./backend.js');
const task = require('./task.js');
const { watchHandovers } = require('./handover.js');
const { startUpdates, updateMenuItems } = require('./updater.js');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const SETUP = path.join(__dirname, 'setup.html');
const MAC = process.platform === 'darwin';

/** Texts of the app itself (menus, tray, setup page); the web app from the relay translates itself. */
const TEXTS = {
    en: {
        open: 'Open OpenFolk',
        changeAddress: 'Change setup …',
        pairAgain: 'Sign this window in again',
        setupRelay: 'I already have an OpenFolk server',
        setupRelayHint: 'Your bots keep running on your machines. This window shows the same bots and chats as your phone and browser.',
        setupLocalTitle: 'New to OpenFolk, without a server',
        setupLocalHint: 'The app runs a backend of its own: the bots run here with your Claude Code sign-in and stop when you quit the app. If OpenFolk already runs on this computer, connect to its server instead.',
        setupPhoneHint: 'For your phone, or the browser on another device, OpenFolk needs a server of its own:',
        setupPhoneLink: 'how to set it up',
        setupLocal: 'Start on this computer',
        setupJoinTitle: 'Connect this computer to my server',
        setupJoinHint: 'Bots run on this computer too, and phone and browser reach them through your server. In the app on a device that is signed in: Settings, Machines, “Add machine”, then paste the link here.',
        setupJoinLabel: 'Link from “Add machine”',
        setupJoin: 'Connect this computer',
        joinFailed: {
            not_a_link: 'That is not a link. Copy the whole link from “Add machine”.',
            no_invitation: 'The link has no invitation in it. Create a new one: Settings, Machines, “Add machine”.',
            https: 'The server needs HTTPS.',
            unreachable: 'The server does not answer: {message}',
            expired: 'The invitation is used up or expired (15 minutes). Create a new one in the app.',
            too_old: 'The server is too old for invitations: update it first.',
            too_many: 'Too many attempts from this address; wait an hour.',
        },
        setupStarting: 'OpenFolk is starting …',
        setupFailed: 'The backend does not start ({error}). Its log: {log}',
        quitWaitTitle: 'A bot is still working',
        quitWaitText: 'OpenFolk quits as soon as the bots are done.',
        quitWait: 'Wait',
        quitNow: 'Quit now',
        thisComputer: 'this computer',
        startWithWindows: 'Start with Windows',
        startAtLogin: 'Start at login',
        runWithoutSignIn: 'Run without signing in (for waking)',
        runWithoutSignInFailed: 'The scheduled task could not be changed: {error}',
        runWithoutSignInOn: 'The bots of this computer now run from system start, also without signing in. The relay can wake this computer for routines; set that up on the relay (WAKE_METHOD).',
        quit: 'Quit',
        quitApp: 'Quit OpenFolk',
        hide: 'Hide OpenFolk',
        hideOthers: 'Hide others',
        unhide: 'Show all',
        file: 'File',
        edit: 'Edit',
        undo: 'Undo',
        redo: 'Redo',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select all',
        view: 'View',
        viewMac: 'View',
        reload: 'Reload',
        forceReload: 'Reload without cache',
        resetZoom: 'Actual size',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out',
        fullscreen: 'Full screen',
        devTools: 'Developer tools',
        window: 'Window',
        minimize: 'Minimize',
        zoom: 'Zoom',
        help: 'Help',
        about: 'About OpenFolk',
        notSetUp: 'not set up',
        invalidAddress: 'Please enter a server URL like https://openfolk.example.com.',
        setupTitle: 'Set up OpenFolk',
        setupQuestion: 'How do you use OpenFolk?',
        setupLabel: 'Server URL',
        setupConnect: 'Connect',
        setupNoAnswer: 'The server does not answer: {error}',
        setupHint: 'OpenFolk {version} · You can change this later in the menu under “Change setup”.',
        checkUpdates: 'Check for updates …',
        checkUpdatesTitle: 'Updates',
        updateReadyMenu: 'Restart to update to {version}',
        updateReadyTitle: 'Update ready',
        updateReadyText: 'OpenFolk {version} has been downloaded. Restart now, or it is installed the next time you quit. A working bot finishes first.',
        updateRestart: 'Restart now',
        updateLater: 'Later',
        updateNone: 'OpenFolk {version} is the latest version.',
        updateDownloading: 'OpenFolk {version} is being downloaded. The app asks to restart once it is ready.',
        updateFailed: 'Could not check for updates: {error}',
        updateNotHere: 'This build of OpenFolk {version} does not update itself. New versions are on openfolk.app.',
    },
    de: {
        open: 'OpenFolk öffnen',
        changeAddress: 'Einrichtung ändern …',
        pairAgain: 'Dieses Fenster neu anmelden',
        setupRelay: 'Ich habe schon einen OpenFolk-Server',
        setupRelayHint: 'Deine Bots laufen weiter auf deinen Rechnern. Dieses Fenster zeigt dieselben Bots und Chats wie Handy und Browser.',
        setupLocalTitle: 'Neu bei OpenFolk, ohne Server',
        setupLocalHint: 'Die App startet ein eigenes Backend: Die Bots laufen hier mit deiner Claude-Code-Anmeldung und stoppen, wenn du die App beendest. Läuft OpenFolk auf diesem Rechner schon, verbinde dich stattdessen mit seinem Server.',
        setupPhoneHint: 'Für das Handy oder den Browser auf einem anderen Gerät braucht OpenFolk einen eigenen Server:',
        setupPhoneLink: 'Anleitung zur Einrichtung',
        setupLocal: 'Auf diesem Rechner starten',
        setupJoinTitle: 'Diesen Rechner an meinen Server anschließen',
        setupJoinHint: 'Bots laufen auch auf diesem Rechner, Handy und Browser erreichen sie über deinen Server. In der App auf einem angemeldeten Gerät: Einstellungen, Rechner, „Rechner hinzufügen“, dann den Link hier einfügen.',
        setupJoinLabel: 'Link aus „Rechner hinzufügen“',
        setupJoin: 'Rechner anschließen',
        joinFailed: {
            not_a_link: 'Das ist kein Link. Den ganzen Link aus „Rechner hinzufügen“ kopieren.',
            no_invitation: 'Im Link steckt keine Einladung. Eine neue erstellen: Einstellungen, Rechner, „Rechner hinzufügen“.',
            https: 'Der Server braucht HTTPS.',
            unreachable: 'Der Server antwortet nicht: {message}',
            expired: 'Die Einladung ist verbraucht oder abgelaufen (15 Minuten). In der App eine neue erstellen.',
            too_old: 'Der Server ist zu alt für Einladungen: erst aktualisieren.',
            too_many: 'Zu viele Versuche von dieser Adresse; eine Stunde warten.',
        },
        setupStarting: 'OpenFolk startet …',
        setupFailed: 'Das Backend startet nicht ({error}). Sein Log: {log}',
        quitWaitTitle: 'Ein Bot arbeitet noch',
        quitWaitText: 'OpenFolk beendet sich, sobald die Bots fertig sind.',
        quitWait: 'Warten',
        quitNow: 'Jetzt beenden',
        thisComputer: 'dieser Rechner',
        startWithWindows: 'Mit Windows starten',
        startAtLogin: 'Beim Anmelden starten',
        runWithoutSignIn: 'Auch ohne Anmeldung laufen (zum Wecken)',
        runWithoutSignInFailed: 'Die geplante Aufgabe ließ sich nicht ändern: {error}',
        runWithoutSignInOn: 'Die Bots dieses Rechners laufen jetzt ab dem Systemstart, auch ohne Anmeldung. Das Relay kann den Rechner für Routinen wecken; das wird am Relay eingerichtet (WAKE_METHOD).',
        quit: 'Beenden',
        quitApp: 'OpenFolk beenden',
        hide: 'OpenFolk ausblenden',
        hideOthers: 'Andere ausblenden',
        unhide: 'Alle einblenden',
        file: 'Datei',
        edit: 'Bearbeiten',
        undo: 'Widerrufen',
        redo: 'Wiederholen',
        cut: 'Ausschneiden',
        copy: 'Kopieren',
        paste: 'Einsetzen',
        selectAll: 'Alles auswählen',
        view: 'Ansicht',
        viewMac: 'Darstellung',
        reload: 'Neu laden',
        forceReload: 'Neu laden ohne Cache',
        resetZoom: 'Normale Größe',
        zoomIn: 'Vergrößern',
        zoomOut: 'Verkleinern',
        fullscreen: 'Vollbild',
        devTools: 'Entwicklerwerkzeuge',
        window: 'Fenster',
        minimize: 'Im Dock ablegen',
        zoom: 'Zoomen',
        help: 'Hilfe',
        about: 'Über OpenFolk',
        notSetUp: 'nicht eingerichtet',
        invalidAddress: 'Bitte eine Server-URL wie https://openfolk.example.com eingeben.',
        setupTitle: 'OpenFolk einrichten',
        setupQuestion: 'Wie nutzt du OpenFolk?',
        setupLabel: 'Server-URL',
        setupConnect: 'Verbinden',
        setupNoAnswer: 'Der Server antwortet nicht: {error}',
        setupHint: 'OpenFolk {version} · Das lässt sich später im Menü unter „Einrichtung ändern“ anpassen.',
        checkUpdates: 'Nach Updates suchen …',
        checkUpdatesTitle: 'Updates',
        updateReadyMenu: 'Neu starten für Version {version}',
        updateReadyTitle: 'Update bereit',
        updateReadyText: 'OpenFolk {version} ist geladen. Jetzt neu starten, oder es wird beim nächsten Beenden installiert. Ein arbeitender Bot macht vorher fertig.',
        updateRestart: 'Jetzt neu starten',
        updateLater: 'Später',
        updateNone: 'OpenFolk {version} ist die aktuelle Version.',
        updateDownloading: 'OpenFolk {version} wird geladen. Die App fragt nach dem Neustart, sobald es fertig ist.',
        updateFailed: 'Die Suche nach Updates ist fehlgeschlagen: {error}',
        updateNotHere: 'Dieser Build von OpenFolk {version} aktualisiert sich nicht selbst. Neue Versionen gibt es auf openfolk.app.',
    },
};

/** German for a German operating system, English otherwise (available after app ready). */
const language = () => (app.getLocale().toLowerCase().startsWith('de') ? 'de' : 'en');
const t = (key) => TEXTS[language()][key] ?? TEXTS.en[key];

/** { mode: 'local' | 'relay', url, localPort, paired (the address this window is signed in at), window: { x, y, width, height } } */
let config = {};
/** The backend of "on this computer"; null in relay mode. */
let backend = null;
let win = null;
let tray = null;
let quitting = false;

// Electron's login items exist only on Windows and macOS; Linux desktops start what lies in ~/.config/autostart
const AUTOSTART = () => path.join(app.getPath('appData'), 'autostart', 'openfolk.desktop');

function startsAtLogin() {
    if (process.platform !== 'linux') return app.getLoginItemSettings().openAtLogin;
    return fs.existsSync(AUTOSTART());
}

function setStartAtLogin(on) {
    if (process.platform !== 'linux') return app.setLoginItemSettings({ openAtLogin: on });
    if (!on) return fs.rmSync(AUTOSTART(), { force: true });
    fs.mkdirSync(path.dirname(AUTOSTART()), { recursive: true });
    // An AppImage runs from a mount that changes with every start; APPIMAGE names the file itself
    const exe = process.env.APPIMAGE || process.execPath;
    fs.writeFileSync(AUTOSTART(), `[Desktop Entry]\nType=Application\nName=OpenFolk\nExec="${exe}"\nX-GNOME-Autostart-enabled=true\n`);
}

function loadConfig() {
    try { config = JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { config = {}; }
    // configs written by older versions stored the window bounds under `fenster`
    if (!config.window && config.fenster) config.window = config.fenster;
    delete config.fenster;
    // Configs from before the local mode only had an address
    if (!config.mode && config.url) config.mode = 'relay';
    // `paired` was a yes before the relay could be one on a server: then it meant the embedded one
    if (config.paired === true) config.paired = config.localPort ? `http://127.0.0.1:${config.localPort}/` : '';
    if (process.env.OPENFOLK_URL) Object.assign(config, { mode: 'relay', url: process.env.OPENFOLK_URL });
}

/** Origin the web app comes from: the embedded relay or the relay's address. */
const appUrl = () => (config.mode === 'local' && backend ? backend.url : config.url || '');

function saveConfig() {
    fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
    fs.writeFileSync(CONFIG(), JSON.stringify(config, null, 2));
}

/** Only http(s); input without a scheme gets https, the result ends with "/". */
function normalizeAddress(input) {
    let text = String(input || '').trim();
    if (!text) return null;
    if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
    try {
        const u = new URL(text);
        if (!['http:', 'https:'].includes(u.protocol)) return null;
        return u.origin + u.pathname.replace(/\/?$/, '/');
    } catch { return null; }
}

function loadWebApp() {
    if (config.mode === 'local') void startLocal();
    else if (config.mode === 'relay' && config.url) win.loadURL(config.url);
    else win.loadFile(SETUP);
}

/** Starts the backend (once) and shows the web app from its relay; the first time with a pairing link. */
async function startLocal() {
    win.loadFile(SETUP, { query: { starting: '1' } });
    if (!config.localPort) {
        config.localPort = await freePort();
        saveConfig();
    }
    if (!backend) {
        backend = new Backend(config.localPort);
        backend.useTask = Boolean(config.task);
        backend.start();
    }
    if (!(await backend.ready())) {
        win.loadFile(SETUP, { query: { error: backend.failure || 'no answer', log: backend.log } });
        return;
    }
    // Signed in at this relay already; a relay claimed from the app or joined by invitation needs a new sign-in
    if (config.paired === backend.url) {
        win.loadURL(backend.url);
        return;
    }
    await pairAgain();
}

/** Loads the web app with a fresh pairing link, which signs this window in and hands it the end-to-end key. */
async function pairAgain() {
    if (!backend) return;
    try {
        win.loadURL(await backend.pairingUrl());
        config.paired = backend.url;
        saveConfig();
    } catch (e) {
        win.loadFile(SETUP, { query: { error: e.message, log: backend.log } });
    }
}

function createWindow() {
    const bounds = config.window || {};
    win = new BrowserWindow({
        width: bounds.width || 1100,
        height: bounds.height || 800,
        x: bounds.x,
        y: bounds.y,
        minWidth: 360,
        minHeight: 500,
        title: 'OpenFolk',
        icon: path.join(__dirname, 'build', 'icon.png'),
        backgroundColor: '#111b21',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true,
        },
    });

    win.once('ready-to-show', () => win.show());
    win.on('resize', rememberBounds);
    win.on('move', rememberBounds);
    // Closing only hides the window (like messengers do); the app quits via the tray menu, Ctrl+Q or Cmd+Q
    win.on('close', (e) => {
        if (quitting) return;
        e.preventDefault();
        win.hide();
    });
    win.on('closed', () => { win = null; });

    // Links to other sites (files, docs) open in the default browser, not in the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('file://')) return;
        if (appUrl() && url.startsWith(appUrl())) {
            // The web app follows its backend to a relay claimed from the app, with a pairing link of that relay
            if (config.mode === 'local' && url.includes('#pair=') && config.paired !== appUrl()) {
                config.paired = appUrl();
                saveConfig();
            }
            return;
        }
        e.preventDefault();
        shell.openExternal(url);
    });
    win.webContents.on('did-fail-load', (e, code, text, url) => {
        if (code === -3 || !url || url.startsWith('file://')) return; // -3 = aborted (own navigation)
        win.loadFile(SETUP, { query: { error: `${text} (${code})`, url: config.url || '', ...(backend ? { log: backend.log } : {}) } });
    });

    loadWebApp();
}

let boundsTimer = null;
function rememberBounds() {
    if (!win || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
        config.window = win.getBounds();
        saveConfig();
    }, 500);
}

function show() {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function changeAddress() {
    show();
    win.loadFile(SETUP, { query: { url: config.url || '', choose: '1' } });
}

function quit() {
    quitting = true;
    app.quit();
}

/** "Run without signing in": Windows, the backend in the app, and a relay on a server that can wake this computer. */
const taskOffered = () => task.available() && config.mode === 'local' && Boolean(remoteUrl());

const taskItem = () => (taskOffered() ? [{ label: t('runWithoutSignIn'), type: 'checkbox', checked: Boolean(config.task), click: (m) => void switchTask(m.checked) }] : []);

/**
 * Hands the backend to the scheduled task or takes it back. Our own backend ends first, so the two never run against
 * the same data; if the task cannot be changed, the backend runs as before.
 */
async function switchTask(on) {
    const refresh = () => {
        createMenu();
        if (tray) tray.setContextMenu(trayMenu());
    };
    if (on && backend?.child) await backend.stop();
    const error = await task.setTask(on, root(), app.getPath('userData'));
    if (!error) {
        config.task = on;
        saveConfig();
    }
    if (backend) {
        backend.stopping = false;
        backend.useTask = Boolean(config.task);
        if (!backend.useTask && !backend.child) backend.start();
    }
    refresh();
    if (error) {
        dialog.showMessageBox(win, { type: 'warning', title: 'OpenFolk', message: t('runWithoutSignInFailed').replace('{error}', error) });
        return;
    }
    if (on) dialog.showMessageBox(win, { type: 'info', title: 'OpenFolk', message: t('runWithoutSignInOn') });
    // The window waits for the backend that runs now (the task's, or ours again)
    if (win && config.mode === 'local') void startLocal();
}

const trayMenu = () => Menu.buildFromTemplate([
    { label: t('open'), click: show },
    { label: t('changeAddress'), click: changeAddress },
    ...(config.mode === 'local' ? [{ label: t('pairAgain'), click: () => { show(); void pairAgain(); } }] : []),
    { type: 'separator' },
    { label: t(process.platform === 'win32' ? 'startWithWindows' : 'startAtLogin'), type: 'checkbox', checked: startsAtLogin(), click: (m) => setStartAtLogin(m.checked) },
    ...taskItem(),
    ...updateMenuItems(),
    { type: 'separator' },
    { label: t('quit'), click: quit },
]);

function createTray() {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('OpenFolk');
    tray.setContextMenu(trayMenu());
    tray.on('click', show);
    tray.on('right-click', () => tray.setContextMenu(trayMenu()));
}

const about = () => dialog.showMessageBox(win, { title: 'OpenFolk', message: `OpenFolk ${app.getVersion()}`, detail: `Server: ${config.mode === 'local' ? t('thisComputer') : config.url || t('notSetUp')}\nElectron ${process.versions.electron}` });

const viewMenu = (label) => ({
    label,
    submenu: [
        { role: 'reload', label: t('reload') },
        { role: 'forceReload', label: t('forceReload') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('resetZoom') },
        { role: 'zoomIn', label: t('zoomIn') },
        { role: 'zoomOut', label: t('zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('fullscreen') },
        { role: 'toggleDevTools', label: t('devTools') },
    ],
});

/** The Mac's menu bar: app menu with start at login, Edit (copy and paste need it there), View, Window. */
function createMacMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: app.name,
            submenu: [
                { label: t('about'), click: about },
                ...updateMenuItems(),
                { type: 'separator' },
                { label: t('changeAddress'), click: changeAddress },
                { type: 'separator' },
                { label: t('startAtLogin'), type: 'checkbox', checked: startsAtLogin(), click: (m) => setStartAtLogin(m.checked) },
                { type: 'separator' },
                { role: 'hide', label: t('hide') },
                { role: 'hideOthers', label: t('hideOthers') },
                { role: 'unhide', label: t('unhide') },
                { type: 'separator' },
                { role: 'quit', label: t('quitApp') },
            ],
        },
        {
            label: t('edit'),
            submenu: [
                { role: 'undo', label: t('undo') },
                { role: 'redo', label: t('redo') },
                { type: 'separator' },
                { role: 'cut', label: t('cut') },
                { role: 'copy', label: t('copy') },
                { role: 'paste', label: t('paste') },
                { role: 'selectAll', label: t('selectAll') },
            ],
        },
        viewMenu(t('viewMac')),
        {
            label: t('window'),
            role: 'window',
            submenu: [
                { role: 'minimize', label: t('minimize') },
                { role: 'zoom', label: t('zoom') },
                { type: 'separator' },
                { label: 'OpenFolk', click: show },
                { label: t('pairAgain'), click: () => { show(); void pairAgain(); }, enabled: config.mode === 'local' },
            ],
        },
    ]));
}

function createMenu() {
    if (MAC) return createMacMenu();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: t('file'),
            submenu: [
                { label: t('changeAddress'), click: changeAddress },
                ...(taskOffered() ? [{ type: 'separator' }, ...taskItem()] : []),
                { type: 'separator' },
                { label: t('quit'), accelerator: 'Ctrl+Q', click: quit },
            ],
        },
        viewMenu(t('view')),
        {
            label: t('help'),
            submenu: [
                ...updateMenuItems(),
                { type: 'separator' },
                { label: t('about'), click: about },
            ],
        },
    ]));
}

// Tests (scripts/desktop-smoke.mjs) run with a profile of their own, never the user's
if (process.env.OPENFOLK_USER_DATA) app.setPath('userData', process.env.OPENFOLK_USER_DATA);

// A second start only brings the existing window to the front
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', show);

    app.whenReady().then(() => {
        loadConfig();
        // Allow microphone (voice messages) and notifications without a browser prompt
        session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
            callback(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
        });
        // Before the menus: they show its entries in the user's language
        startUpdates({
            t,
            quit,
            window: () => win,
            onChange: () => {
                createMenu();
                if (tray) tray.setContextMenu(trayMenu());
            },
        });
        createMenu();
        if (!MAC) createTray();
        createWindow();
        // In every mode: a backend of this machine without a desktop hands its IDE and terminal windows to the app
        watchHandovers();
    });

    // Only the setup page (file://) may change the address, not the web app loaded from the relay
    const fromSetup = (e) => String(e.senderFrame?.url || '').startsWith('file://');
    ipcMain.handle('save-address', (e, input) => {
        if (!fromSetup(e)) return { error: 'not allowed' };
        const url = normalizeAddress(input);
        if (!url) return { error: t('invalidAddress') };
        config.url = url;
        config.mode = 'relay';
        saveConfig();
        createMenu();
        // The bots of "on this computer" stop with the switch; their data stays in the profile
        if (backend) void backend.stop().then(() => { backend = null; });
        loadWebApp();
        return { url };
    });
    ipcMain.handle('choose-local', (e) => {
        if (!fromSetup(e)) return { error: 'not allowed' };
        config.mode = 'local';
        saveConfig();
        createMenu();
        loadWebApp();
        return {};
    });
    ipcMain.handle('join-server', async (e, link) => {
        if (!fromSetup(e)) return { error: 'not allowed' };
        const r = await joinServer(link);
        if (!r.ok) {
            const text = TEXTS[language()].joinFailed[r.error] ?? TEXTS.en.joinFailed[r.error];
            return { error: text ? text.replace('{message}', r.message || '') : r.message || r.error };
        }
        // A backend of "on this computer" still runs against the embedded relay: start it anew with the new .env
        if (backend) {
            await backend.stop();
            backend = null;
        }
        config.mode = 'local';
        config.paired = '';
        saveConfig();
        createMenu();
        loadWebApp();
        return { machine: r.machine };
    });
    ipcMain.handle('info', (e) => (!fromSetup(e) ? {} : { mode: config.mode || '', url: config.url || '', version: app.getVersion(), platform: process.platform, language: language(), texts: TEXTS[language()] }));

    // A click on the Dock icon brings the hidden window back (macOS only)
    app.on('activate', show);
    app.on('before-quit', () => { quitting = true; });
    guardQuit(() => backend, async () => {
        const { response } = await dialog.showMessageBox({
            type: 'info', title: 'OpenFolk', message: t('quitWaitTitle'), detail: t('quitWaitText'), buttons: [t('quitWait'), t('quitNow')], defaultId: 0, cancelId: 0,
        });
        return response === 1;
    });
    app.on('window-all-closed', () => { /* keeps running in the tray or the Dock */ });
}
