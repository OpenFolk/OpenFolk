// OpenFolk as a desktop app for Windows, Linux and macOS: a tray icon on Windows and Linux, Dock and menu bar on the
// Mac, start at login everywhere. Two ways to run: "on this computer" runs the backend inside the app (backend.js),
// with the relay embedded or, once joined to a server (or a relay claimed from the app), with the relay there;
// "connect to a relay" talks to a relay elsewhere. Either way the window shows the app's own copy of the web app
// (openfolk://app, like the mobile apps), pointed at that relay, so the app can also hold several relays (webapp/js/relays.js).
// Login, device key and display settings stay in the app's profile (%APPDATA%\OpenFolk, ~/.config/OpenFolk,
// ~/Library/Application Support/OpenFolk).
'use strict';

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog, protocol, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Backend, dataDir, freePort, guardQuit, joinServer, profileRoots, remoteUrl, root, setProfileEnv } = require('./backend.js');
const task = require('./task.js');
const { watchHandovers } = require('./handover.js');
const { startUpdates, updateMenuItems } = require('./updater.js');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const SETUP = path.join(__dirname, 'setup.html');
const FOLDERS = path.join(__dirname, 'folders.html');
const MAC = process.platform === 'darwin';
/** Where bots work when no folder is chosen: the backend's own default would be the whole user folder, with documents and downloads. */
const DEFAULT_ROOT = () => path.join(os.homedir(), 'OpenFolk');

/**
 * The web app's own address in the app. A scheme of its own, registered as standard and secure, so the page has an
 * origin (storage, crypto, IndexedDB) and the relays can allow exactly it (relay/src/auth.ts, originAllowed).
 */
const APP = 'openfolk://app/';
protocol.registerSchemesAsPrivileged([{ scheme: 'openfolk', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const WEBAPP = () => path.join(root(), 'webapp');
/** The libraries the web app loads from the relay's /vendor/ (relay/src/relay.ts): here from the bundled node_modules. */
const VENDOR = {
    '/vendor/marked.umd.js': ['marked', 'lib', 'marked.umd.js'],
    '/vendor/purify.min.js': ['dompurify', 'dist', 'purify.min.js'],
    '/vendor/qrcode.js': ['qrcode-generator', 'dist', 'qrcode.js'],
    '/vendor/jsQR.js': ['jsqr', 'dist', 'jsQR.js'],
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

/** The web app's files for openfolk://app/…; nothing outside webapp/ and the vendor files, nothing from a relay. */
function serveWebApp(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = VENDOR[pathname] ? path.join(root(), 'node_modules', ...VENDOR[pathname]) : path.resolve(WEBAPP(), '.' + pathname);
    if (!VENDOR[pathname] && !file.startsWith(WEBAPP() + path.sep)) return new Response('', { status: 403 });
    let body;
    try { body = fs.readFileSync(file); } catch { return new Response('', { status: 404 }); }
    // The relay's security headers (relay.ts), with connect-src open: the page talks to relays elsewhere
    return new Response(body, {
        headers: {
            'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
            'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                + "connect-src https: wss: http: ws:; manifest-src 'self'; worker-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
            'x-content-type-options': 'nosniff',
        },
    });
}

/**
 * The page for a relay: `#relay=` names it, a pairing link's `#pair=…&e2e=…` follows (webapp/js/core.js takes the
 * relay in, e2e.js the sign-in and the key).
 * @param {string} relay http(s) address of the relay
 * @param {string} [hash] the part behind '#' of a pairing link from that relay
 */
const appLink = (relay, hash = '') => `${APP}#relay=${encodeURIComponent(relay.replace(/\/+$/, ''))}${hash ? '&' + hash : ''}`;

/** A pairing link of a relay (`https://relay/#pair=…&e2e=…`) as the app's page for that relay. */
function appLinkFromPairing(link) {
    const u = new URL(link);
    return appLink(u.origin, u.hash.replace(/^#/, ''));
}

/** Texts of the app itself (menus, tray, setup page); the web app from the relay translates itself. */
const TEXTS = {
    en: {
        open: 'Open OpenFolk',
        changeAddress: 'Change setup …',
        foldersMenu: 'Allowed folders …',
        foldersTitle: 'Allowed folders',
        foldersIntro: 'Bots only work in these folders and below them. A bot with a folder outside is refused when it is saved.',
        foldersDefault: 'No folder chosen: bots work in their own folder {default}, not in your whole user folder.',
        foldersDefaultTag: 'default',
        foldersLastRemoved: 'The last folder cannot be removed: without a choice the own folder {default} applies.',
        foldersWide: '{folder} is very wide: bots could work on all documents, downloads and other files in it. Better choose the folders they need.',
        foldersAdd: 'Add folder …',
        foldersRemove: 'Remove',
        foldersSave: 'Save',
        foldersClose: 'Close',
        foldersPickTitle: 'Choose a folder for bots',
        foldersEnvWarn: 'The environment variable ALLOWED_ROOTS is set on this computer ({value}) and takes precedence over this list. Remove the variable (Windows: system settings, environment variables) and restart the app for the list to apply.',
        foldersSaved: 'Saved. The backend restarts now.',
        foldersWaiting: 'Saved. A bot is still working: the backend restarts as soon as no bot is working, until then the old folders apply.',
        foldersNotFolder: '{folder} is not a folder that exists.',
        foldersBadChars: '{folder} cannot be used: a folder name must not contain “;”.',
        foldersSetupSummary: 'Folders the bots may work in (optional)',
        foldersSetupHint: 'Without a choice the bots get their own folder {default}, not your whole user folder. You can change this later in the menu under “Allowed folders …”.',
        pairAgain: 'Sign this window in again',
        setupRelay: 'Display only: connect to an existing relay server',
        setupRelayHint: 'For a computer that only shows your bots, like your phone or browser does: this window is just the interface to a relay server you already have.',
        setupRelayWarn: 'This app then starts no backend on this computer, so bots that run here through the app are offline.',
        setupRelayConfirmText: 'Connect to this relay server? The app starts no backend here, so no bots run on this computer.',
        setupRelayConfirmYes: 'Yes, no bots run on this computer',
        setupRelayConfirmNo: 'Back',
        setupWhere: 'On the computer where your bots should work, usually A or B.',
        setupTermsTitle: 'What do these words mean?',
        setupTermBot: 'Bot',
        setupTermBotText: 'Your AI colleague. A bot always works on one computer.',
        setupTermBackend: 'Backend',
        setupTermBackendText: 'The program on a computer that runs the bots.',
        setupTermRelay: 'Relay server',
        setupTermRelayText: 'The go-between on the internet, e.g. openfolk.example.com, through which your phone, browser and computers find each other.',
        setupLocalTitle: 'Start on this computer',
        setupLocalHint: 'The way if you are new to OpenFolk: backend and relay run on this computer, inside the app, with your Claude Code sign-in. The bots stop when you quit the app. Moving to a relay server of your own works later in the settings (“Move to a relay on a server”). If OpenFolk already runs on this computer, use C instead.',
        setupPhoneHint: 'For your phone, or the browser on another device, OpenFolk needs a relay server of its own:',
        setupPhoneLink: 'how to set it up',
        setupLocal: 'Start on this computer',
        setupJoinTitle: 'Also connect this computer to my relay server',
        setupJoinHint: 'Bots run on this computer, and phone and browser reach them through your relay server. Create the link in the app on a signed-in device: Settings, Machines, “Add machine”, then paste it here.',
        setupJoinLabel: 'Link from “Add machine”',
        setupJoin: 'Connect this computer',
        joinFailed: {
            not_a_link: 'That is not a link. Copy the whole link from “Add machine”.',
            no_invitation: 'The link has no invitation in it. Create a new one: Settings, Machines, “Add machine”.',
            https: 'The relay server needs HTTPS.',
            unreachable: 'The relay server does not answer: {message}',
            expired: 'The invitation is used up or expired (15 minutes). Create a new one in the app.',
            too_old: 'The relay server is too old for invitations: update it first.',
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
        aboutProfile: 'Profile folder',
        notSetUp: 'not set up',
        invalidAddress: 'Please enter a server URL like https://openfolk.example.com.',
        setupTitle: 'Set up OpenFolk',
        setupQuestion: 'How do you use OpenFolk?',
        setupLabel: 'Relay server URL',
        setupConnect: 'Connect',
        setupNoAnswer: 'The relay server does not answer: {error}',
        setupHint: 'OpenFolk {version} · You can change this later in the menu under “Change setup”.',
        checkUpdates: 'Check for updates …',
        autoUpdate: 'Check for updates automatically',
        autoUpdateEnv: 'Check for updates automatically (off: OPENFOLK_NO_UPDATE is set)',
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
        countActive: 'Count this installation anonymously',
    },
    de: {
        open: 'OpenFolk öffnen',
        changeAddress: 'Einrichtung ändern …',
        foldersMenu: 'Freigegebene Ordner …',
        foldersTitle: 'Freigegebene Ordner',
        foldersIntro: 'Bots arbeiten nur in diesen Ordnern und darunter. Ein Bot mit einem Ordner außerhalb wird beim Speichern abgelehnt.',
        foldersDefault: 'Kein Ordner gewählt: Bots arbeiten in ihrem eigenen Ordner {default}, nicht in deinem ganzen Benutzerordner.',
        foldersDefaultTag: 'Standard',
        foldersLastRemoved: 'Der letzte Ordner lässt sich nicht entfernen: Ohne Auswahl gilt der eigene Ordner {default}.',
        foldersWide: '{folder} ist sehr weit gefasst: Bots könnten dort an allen Dokumenten, Downloads und anderen Dateien arbeiten. Besser nur die Ordner wählen, die sie brauchen.',
        foldersAdd: 'Ordner hinzufügen …',
        foldersRemove: 'Entfernen',
        foldersSave: 'Speichern',
        foldersClose: 'Schließen',
        foldersPickTitle: 'Ordner für Bots wählen',
        foldersEnvWarn: 'Auf diesem Rechner ist die Umgebungsvariable ALLOWED_ROOTS gesetzt ({value}) und geht dieser Liste vor. Entferne die Variable (Windows: Systemeinstellungen, Umgebungsvariablen) und starte die App neu, damit die Liste gilt.',
        foldersSaved: 'Gespeichert. Das Backend startet jetzt neu.',
        foldersWaiting: 'Gespeichert. Ein Bot arbeitet noch: Das Backend startet neu, sobald kein Bot mehr arbeitet, bis dahin gelten die alten Ordner.',
        foldersNotFolder: '{folder} ist kein vorhandener Ordner.',
        foldersBadChars: '{folder} geht nicht: Ein Ordnername darf kein „;“ enthalten.',
        foldersSetupSummary: 'Ordner, in denen Bots arbeiten dürfen (optional)',
        foldersSetupHint: 'Ohne Auswahl bekommen die Bots einen eigenen Ordner {default}, nicht deinen ganzen Benutzerordner. Das lässt sich später im Menü unter „Freigegebene Ordner …“ ändern.',
        pairAgain: 'Dieses Fenster neu anmelden',
        setupRelay: 'Nur anzeigen: mit einem bestehenden Relay-Server verbinden',
        setupRelayHint: 'Für einen Rechner, der deine Bots nur anzeigt, wie Handy oder Browser: Dieses Fenster ist nur die Oberfläche zu einem Relay-Server, den du schon hast.',
        setupRelayWarn: 'Die App startet dann kein Backend auf diesem Rechner, Bots, die hier über die App liefen, sind offline.',
        setupRelayConfirmText: 'Mit diesem Relay-Server verbinden? Die App startet hier kein Backend, auf diesem Rechner laufen dann keine Bots.',
        setupRelayConfirmYes: 'Ja, auf diesem Rechner laufen keine Bots',
        setupRelayConfirmNo: 'Zurück',
        setupWhere: 'Auf dem Rechner, auf dem deine Bots arbeiten sollen, meist A oder B.',
        setupTermsTitle: 'Was bedeuten die Begriffe?',
        setupTermBot: 'Bot',
        setupTermBotText: 'Dein KI-Kollege. Ein Bot arbeitet immer auf einem Rechner.',
        setupTermBackend: 'Backend',
        setupTermBackendText: 'Das Programm auf einem Rechner, das die Bots ausführt.',
        setupTermRelay: 'Relay-Server',
        setupTermRelayText: 'Die Vermittlung im Internet, z. B. openfolk.example.com, über die Handy, Browser und Rechner zusammenfinden.',
        setupLocalTitle: 'Auf diesem Rechner starten',
        setupLocalHint: 'Der Weg, wenn du neu bei OpenFolk bist: Backend und Relay laufen auf diesem Rechner in der App, mit deiner Claude-Code-Anmeldung. Die Bots stoppen, wenn du die App beendest. Der Umzug auf einen eigenen Relay-Server geht später in den Einstellungen („Auf ein Relay auf einem Server umziehen“). Läuft OpenFolk auf diesem Rechner schon, nimm stattdessen C.',
        setupPhoneHint: 'Für das Handy oder den Browser auf einem anderen Gerät braucht OpenFolk einen eigenen Relay-Server:',
        setupPhoneLink: 'Anleitung zur Einrichtung',
        setupLocal: 'Auf diesem Rechner starten',
        setupJoinTitle: 'Diesen Rechner zusätzlich an meinen Relay-Server anschließen',
        setupJoinHint: 'Hier laufen Bots, und Handy und Browser erreichen sie über deinen Relay-Server. Den Link erzeugst du in der App auf einem angemeldeten Gerät: Einstellungen, Rechner, „Rechner hinzufügen“, dann fügst du ihn hier ein.',
        setupJoinLabel: 'Link aus „Rechner hinzufügen“',
        setupJoin: 'Rechner anschließen',
        joinFailed: {
            not_a_link: 'Das ist kein Link. Den ganzen Link aus „Rechner hinzufügen“ kopieren.',
            no_invitation: 'Im Link steckt keine Einladung. Eine neue erstellen: Einstellungen, Rechner, „Rechner hinzufügen“.',
            https: 'Der Relay-Server braucht HTTPS.',
            unreachable: 'Der Relay-Server antwortet nicht: {message}',
            expired: 'Die Einladung ist verbraucht oder abgelaufen (15 Minuten). In der App eine neue erstellen.',
            too_old: 'Der Relay-Server ist zu alt für Einladungen: erst aktualisieren.',
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
        aboutProfile: 'Profilordner',
        notSetUp: 'nicht eingerichtet',
        invalidAddress: 'Bitte eine Server-URL wie https://openfolk.example.com eingeben.',
        setupTitle: 'OpenFolk einrichten',
        setupQuestion: 'Wie nutzt du OpenFolk?',
        setupLabel: 'Relay-Server-URL',
        setupConnect: 'Verbinden',
        setupNoAnswer: 'Der Relay-Server antwortet nicht: {error}',
        setupHint: 'OpenFolk {version} · Das lässt sich später im Menü unter „Einrichtung ändern“ anpassen.',
        checkUpdates: 'Nach Updates suchen …',
        autoUpdate: 'Automatisch nach Updates suchen',
        autoUpdateEnv: 'Automatisch nach Updates suchen (aus: OPENFOLK_NO_UPDATE ist gesetzt)',
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
        countActive: 'Installation anonym mitzählen',
    },
};

/** German for a German operating system, English otherwise (available after app ready). */
const language = () => (app.getLocale().toLowerCase().startsWith('de') ? 'de' : 'en');
const t = (key) => TEXTS[language()][key] ?? TEXTS.en[key];

/** { autoUpdate (false = no automatic checks; absent = on), mode: 'local' | 'relay', url, localPort, paired (the address this window is signed in at), window: { x, y, width, height } } */
let config = {};
/** The backend of "on this computer"; null in relay mode. */
let backend = null;
let win = null;
/** The setup page is open on top of a working setup ("Change setup"): closing the window without a choice brings the app back. */
let choosing = false;
/** The window's user agent as Electron made it, without our mark. */
let baseAgent = '';
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
    choosing = false;
    // The web app tells "on this computer" (it has the menu "Allowed folders …") from a display-only window by this mark
    win.webContents.setUserAgent(config.mode === 'local' ? `${baseAgent} OpenFolkLocal` : baseAgent);
    if (config.mode === 'local') void startLocal();
    else if (config.mode === 'relay' && config.url) win.loadURL(appLink(config.url));
    else win.loadFile(SETUP);
}

/** Starts the backend (once) and shows the web app for its relay; the first time with a pairing link. */
async function startLocal() {
    win.loadFile(SETUP, { query: { starting: '1' } });
    if (!config.localPort) {
        config.localPort = await freePort();
        saveConfig();
    }
    if (!backend) {
        if (!profileRoots().length) {
            // A profile that ran before the folder list let its bots work in the whole user folder (the backend's default
            // without ALLOWED_ROOTS): written down as it was, so no bot is refused after the update; the folders window
            // warns that it is wide. A new profile, or a setup page that sent nothing, gets the own folder.
            if (usedBefore()) setProfileEnv('ALLOWED_ROOTS', os.homedir());
            else writeRoots([]);
        }
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
        win.loadURL(appLink(backend.url));
        return;
    }
    await pairAgain();
}

/** Loads the web app with a fresh pairing link, which signs this window in and hands it the end-to-end key. */
async function pairAgain() {
    if (!backend) return;
    try {
        win.loadURL(appLinkFromPairing(await backend.pairingUrl()));
        config.paired = backend.url;
        saveConfig();
    } catch (e) {
        win.loadFile(SETUP, { query: { error: e.message, log: backend.log } });
    }
}

/** The window signed itself in at a relay with a pairing link in its address: remembered, so the next start needs no new one. */
function notePairing(url) {
    if (config.mode !== 'local' || !url.startsWith(APP)) return;
    const params = new URLSearchParams(url.split('#')[1] || '');
    const relay = params.get('relay');
    if (!params.get('pair') || !relay || !/^https?:\/\//.test(relay)) return;
    const paired = relay.replace(/\/?$/, '/');
    if (config.paired === paired) return;
    config.paired = paired;
    saveConfig();
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

    baseAgent = win.webContents.userAgent;
    win.once('ready-to-show', () => win.show());
    win.on('resize', rememberBounds);
    win.on('move', rememberBounds);
    // Closing only hides the window (like messengers do); the app quits via the tray menu, Ctrl+Q or Cmd+Q
    win.on('close', (e) => {
        if (quitting) return;
        e.preventDefault();
        win.hide();
        if (choosing) loadWebApp();
    });
    win.on('closed', () => { win = null; });

    // Links to other sites (files, docs) open in the default browser, not in the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('file://') || url.startsWith(APP)) return;
        e.preventDefault();
        shell.openExternal(url);
    });
    // The web app follows its backend to a relay claimed from the app: it puts that relay's pairing link into its
    // address and loads again (webapp/js/relays.js), which is no will-navigate; both events carry the address with '#'
    win.webContents.on('did-navigate', (e, url) => notePairing(url));
    win.webContents.on('did-navigate-in-page', (e, url) => notePairing(url));
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

/** The small window for the folders bots may work in; the main window stays where it is. */
let foldersWin = null;
function openFolders() {
    if (foldersWin) {
        foldersWin.show();
        foldersWin.focus();
        return;
    }
    foldersWin = new BrowserWindow({
        width: 620, height: 560, minWidth: 420, minHeight: 420, parent: win || undefined,
        title: t('foldersTitle'), icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#111b21', autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    foldersWin.removeMenu();
    foldersWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    foldersWin.loadFile(FOLDERS);
    foldersWin.on('closed', () => { foldersWin = null; });
}

/** Only the backend of "on this computer" has folders to choose; with a server in the browser's place they belong to its machines. */
const foldersItem = () => (config.mode === 'local' ? [{ label: t('foldersMenu'), click: openFolders }] : []);

/**
 * The folders for ALLOWED_ROOTS: existing folders, no ";" (it separates them), no duplicates.
 * @returns {{ roots: string[] } | { error: string }}
 */
function checkRoots(list) {
    const roots = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const folder = String(raw || '').trim();
        if (!folder) continue;
        if (folder.includes(';')) return { error: t('foldersBadChars').replace('{folder}', folder) };
        let isDir = false;
        try { isDir = path.isAbsolute(folder) && fs.statSync(folder).isDirectory(); } catch { /* not there */ }
        if (!isDir) return { error: t('foldersNotFolder').replace('{folder}', folder) };
        if (!roots.includes(folder)) roots.push(folder);
    }
    return { roots };
}

/**
 * The folders for ALLOWED_ROOTS, never none: bots without a choice work in their own folder (created here), where the
 * backend's own default would be the whole user folder.
 */
/** The profile's backend has run before: its data folder holds something. */
function usedBefore() {
    try { return fs.readdirSync(dataDir()).length > 0; } catch { return false; }
}

function writeRoots(roots) {
    const list = roots.length ? roots : [DEFAULT_ROOT()];
    if (!roots.length) fs.mkdirSync(list[0], { recursive: true });
    setProfileEnv('ALLOWED_ROOTS', list.join(';'));
}

function changeAddress() {
    show();
    choosing = Boolean(config.mode);
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
    ...foldersItem(),
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

const about = () => dialog.showMessageBox(win, { title: 'OpenFolk', message: `OpenFolk ${app.getVersion()}`, detail: `Server: ${config.mode === 'local' ? t('thisComputer') : config.url || t('notSetUp')}\n${t('aboutProfile')}: ${app.getPath('userData')}\nElectron ${process.versions.electron}` });

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
                ...foldersItem(),
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
                ...foldersItem(),
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
        protocol.handle('openfolk', serveWebApp);
        // Allow microphone (voice messages) and notifications without a browser prompt
        session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
            callback(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
        });
        // Before the menus: they show its entries in the user's language
        startUpdates({
            t,
            quit,
            window: () => win,
            auto: () => config.autoUpdate !== false,
            setAuto: (on) => {
                config.autoUpdate = on;
                saveConfig();
            },
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
    ipcMain.handle('choose-local', (e, folders) => {
        if (!fromSetup(e)) return { error: 'not allowed' };
        // The folders chosen on the setup page go into the profile's .env before the backend starts
        if (Array.isArray(folders)) {
            const checked = checkRoots(folders);
            if (checked.error) return { error: checked.error };
            writeRoots(checked.roots);
            // "Change setup" with the backend running already: it reads the folders by a restart
            if (backend) void backend.restartWhenIdle();
        }
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
    ipcMain.handle('folders-info', (e) => (!fromSetup(e) ? {} : { roots: profileRoots(), home: os.homedir(), defaultRoot: DEFAULT_ROOT(), env: process.env.ALLOWED_ROOTS || '', language: language(), texts: TEXTS[language()] }));
    ipcMain.handle('folders-pick', async (e) => {
        if (!fromSetup(e)) return '';
        const owner = BrowserWindow.fromWebContents(e.sender) || undefined;
        const r = await dialog.showOpenDialog(owner, { title: t('foldersPickTitle'), properties: ['openDirectory'] });
        return r.canceled ? '' : r.filePaths[0] || '';
    });
    // Saves into the profile's .env; the running backend picks it up by a restart, which waits for the bots
    ipcMain.handle('folders-save', async (e, list) => {
        if (!fromSetup(e)) return { error: 'not allowed' };
        const checked = checkRoots(list);
        if (checked.error) return { error: checked.error };
        writeRoots(checked.roots);
        return { state: config.mode === 'local' && backend ? await backend.restartWhenIdle() : 'saved' };
    });
    ipcMain.handle('info', (e) => (!fromSetup(e) ? {} : { mode: config.mode || '', url: config.url || '', roots: profileRoots(), home: os.homedir(), defaultRoot: DEFAULT_ROOT(), envRoots: process.env.ALLOWED_ROOTS || '', version: app.getVersion(), platform: process.platform, language: language(), texts: TEXTS[language()] }));

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
