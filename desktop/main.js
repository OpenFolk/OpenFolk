// OpenFolk as a desktop app for Windows, Linux and macOS: a tray icon on Windows and Linux, Dock and menu bar on the
// Mac, start at login everywhere. Two ways to run: "on this computer" runs the backend inside the app (backend.js),
// with the relay embedded or, once joined to a server (or a relay claimed from the app), with the relay there;
// "connect to a relay" talks to a relay elsewhere. Either way the window shows the app's own copy of the web app
// (openfolk://app, like the mobile apps), pointed at that relay, so the app can also hold several relays (webapp/js/relays.js).
// Login, device key and display settings stay in the app's profile (%APPDATA%\OpenFolk, ~/.config/OpenFolk,
// ~/Library/Application Support/OpenFolk).
'use strict';

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog, protocol, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { Backend, dataDir, freePort, guardQuit, joinServer, profileRoots, remoteUrl, root, setProfileEnv } = require('./backend.js');
const task = require('./task.js');
const { watchHandovers } = require('./handover.js');
const { startQrJoin, stopQrJoin } = require('./qr-join.js');
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

/** Origins of relays before 0.2.0 found by relayRefusesApp(): their pages may load in the window. */
const oldRelays = new Set();
/** Origins that took the app's page: asked no more in this run. */
const newRelays = new Set();

/**
 * Relays before 0.2.0 refuse the app's own page as a foreign origin (relay/src/auth.ts, originAllowed) and close the
 * web socket with 403. Asked once per relay with a handshake from that origin; false when the relay does not answer,
 * so the app's page loads and reports the trouble itself.
 */
function relayRefusesApp(relay) {
    let url;
    try { url = new URL('/ws/client', relay); } catch { return Promise.resolve(false); }
    if (oldRelays.has(url.origin)) return Promise.resolve(true);
    if (newRelays.has(url.origin)) return Promise.resolve(false);
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
        const done = (old) => {
            if (old) oldRelays.add(url.origin);
            resolve(old);
        };
        const fresh = () => {
            newRelays.add(url.origin);
            done(false);
        };
        const req = client.request(url, {
            headers: {
                Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), Origin: 'openfolk://app',
            },
            timeout: 10_000,
        });
        req.on('upgrade', (res, socket) => { socket.destroy(); fresh(); });
        req.on('response', (res) => { res.resume(); if (res.statusCode === 403) done(true); else fresh(); });
        req.on('timeout', () => { req.destroy(); done(false); });
        req.on('error', () => done(false));
        req.end();
    });
}

/**
 * The page for a relay: the app's own, or, for a relay before 0.2.0 that refuses it, the web app that relay serves,
 * as up to 0.1.2 (its storage still holds the sign-in from then). `link`: the relay's address or one of its pairing links.
 */
async function relayPage(link) {
    const u = new URL(link);
    if (await relayRefusesApp(u.origin)) {
        console.log(`relay ${u.origin} is older than 0.2.0: showing its own web app until it is updated`);
        return `${u.origin}/${u.hash}`;
    }
    return appLinkFromPairing(link);
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
        setupQrOr: 'Or with your phone, by QR code: enter the address of your relay server, show the code and scan it with OpenFolk on your phone.',
        setupQrShow: 'Show QR code',
        setupQrHint: 'Scan it with OpenFolk on your phone (Settings, Devices, “Scan QR code”) or with the phone’s camera, then confirm there. The code is renewed when it expires.',
        setupQrCancel: 'Cancel',
        setupQrJoining: 'Approved, connecting this computer …',
        setupQrFailed: {
            unreachable: 'The relay server does not answer ({message}). Check the address.',
            closed: 'The connection to the relay server dropped ({message}). Show a new code.',
            refused: 'The relay server refused the request: {message}',
            open: 'The answer from your phone could not be opened ({message}). Show a new code.',
            old_app: 'Your phone signed in a device instead of connecting a computer: its OpenFolk is too old for this. Update it, or use the link from “Add machine”.',
            join: '{message}',
        },
        joinFailed: {
            not_a_link: 'That is not a link. Copy the whole link from “Add machine”.',
            no_invitation: 'The link has no invitation in it. Create a new one: Settings, Machines, “Add machine”.',
            https: 'The relay server needs HTTPS.',
            unreachable: 'The relay server does not answer: {message}',
            expired: 'The invitation is used up or expired (15 minutes). Create a new one in the app.',
            setup_expired: 'The setup link is used up, revoked or expired (7 days). Ask the person who sent it for a new one.',
            too_old: 'The relay server is too old for invitations: update it first.',
            too_many: 'Too many attempts from this address; wait an hour.',
        },
        setupLinkTitle: 'Set up OpenFolk',
        setupLinkConfirm: 'Set this OpenFolk up with the link from {relay}?',
        setupLinkDetail: 'This computer then works for your account there: your bots run here, with your own Claude sign-in, and the person who sent you the link sets them up. Nobody else’s bots or chats come to this computer.',
        setupLinkYes: 'Set up',
        setupLinkNo: 'Cancel',
        setupLinkBots: 'This OpenFolk already has bots of its own. A setup link is for an OpenFolk that is new; keep using it as it is, or ask for access as a further device instead.',
        setupLinkJoined: 'This OpenFolk is connected to {relay} already. Disconnect it first (menu File), then open the link again.',
        setupLinkFailed: 'The setup did not work: {error}',
        disconnect: 'Disconnect from {relay} …',
        disconnectConfirm: 'Disconnect this computer from {relay}?',
        disconnectDetail: 'Its bots stop running here and the app starts on this computer again, without them. What they did stays in this app’s profile.',
        disconnectYes: 'Disconnect',
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
        runWithoutSignInFailedLinux: 'The service openfolk-backend could not be changed: {error}',
        runWithoutSignInLinger: 'This system does not let your services run without a sign-in. An administrator can allow it once with "sudo loginctl enable-linger {user}"; then switch it on again.',
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
        updateReadyTextAdmin: 'OpenFolk {version} has been downloaded. Restart now, or it is installed the next time you quit. A working bot finishes first. Windows asks for administrator rights for the install; declined, the update waits for the next time.',
        updateRestart: 'Restart now',
        updateLater: 'Later',
        updateNone: 'OpenFolk {version} is the latest version.',
        updateDownloading: 'OpenFolk {version} is being downloaded. The app asks to restart once it is ready.',
        updateFailed: 'The update servers could not be reached. Try again later, or download the new version from openfolk.app.\n\nopenfolk.app: {feed}\nGitHub: {github}',
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
        setupQrOr: 'Oder mit dem Handy per QR-Code: Adresse deines Relay-Servers eingeben, Code anzeigen und mit OpenFolk auf dem Handy scannen.',
        setupQrShow: 'QR-Code anzeigen',
        setupQrHint: 'Mit OpenFolk auf dem Handy scannen (Einstellungen, Geräte, „QR-Code scannen“) oder mit der Kamera des Handys, dann dort bestätigen. Läuft der Code ab, kommt ein neuer.',
        setupQrCancel: 'Abbrechen',
        setupQrJoining: 'Freigegeben, der Rechner wird angeschlossen …',
        setupQrFailed: {
            unreachable: 'Der Relay-Server antwortet nicht ({message}). Adresse prüfen.',
            closed: 'Die Verbindung zum Relay-Server ist abgebrochen ({message}). Neuen Code anzeigen.',
            refused: 'Der Relay-Server hat die Anfrage abgelehnt: {message}',
            open: 'Die Antwort vom Handy ließ sich nicht öffnen ({message}). Neuen Code anzeigen.',
            old_app: 'Dein Handy hat ein Gerät angemeldet statt einen Rechner anzuschließen: Sein OpenFolk ist dafür zu alt. Aktualisieren oder den Link aus „Rechner hinzufügen“ nehmen.',
            join: '{message}',
        },
        joinFailed: {
            not_a_link: 'Das ist kein Link. Den ganzen Link aus „Rechner hinzufügen“ kopieren.',
            no_invitation: 'Im Link steckt keine Einladung. Eine neue erstellen: Einstellungen, Rechner, „Rechner hinzufügen“.',
            https: 'Der Relay-Server braucht HTTPS.',
            unreachable: 'Der Relay-Server antwortet nicht: {message}',
            expired: 'Die Einladung ist verbraucht oder abgelaufen (15 Minuten). In der App eine neue erstellen.',
            setup_expired: 'Der Einrichtungslink ist verbraucht, widerrufen oder abgelaufen (7 Tage). Bitte die Person, die ihn geschickt hat, um einen neuen.',
            too_old: 'Der Relay-Server ist zu alt für Einladungen: erst aktualisieren.',
            too_many: 'Zu viele Versuche von dieser Adresse; eine Stunde warten.',
        },
        setupLinkTitle: 'OpenFolk einrichten',
        setupLinkConfirm: 'Dieses OpenFolk mit dem Link von {relay} einrichten?',
        setupLinkDetail: 'Dieser Computer arbeitet dann für dein Konto dort: Deine Bots laufen hier, mit deiner eigenen Claude-Anmeldung, und wer dir den Link geschickt hat, richtet sie ein. Bots und Chats anderer kommen nicht auf diesen Computer.',
        setupLinkYes: 'Einrichten',
        setupLinkNo: 'Abbrechen',
        setupLinkBots: 'Dieses OpenFolk hat schon eigene Bots. Ein Einrichtungslink ist für ein neues OpenFolk; nutze es weiter wie bisher oder lass dich stattdessen als weiteres Gerät einladen.',
        setupLinkJoined: 'Dieses OpenFolk ist schon mit {relay} verbunden. Trenne es zuerst (Menü Datei) und öffne den Link dann noch einmal.',
        setupLinkFailed: 'Die Einrichtung hat nicht geklappt: {error}',
        disconnect: 'Von {relay} trennen …',
        disconnectConfirm: 'Diesen Computer von {relay} trennen?',
        disconnectDetail: 'Seine Bots laufen dann nicht mehr hier, und die App startet wieder auf diesem Computer, ohne sie. Was sie getan haben, bleibt im Profil dieser App.',
        disconnectYes: 'Trennen',
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
        runWithoutSignInFailedLinux: 'Der Dienst openfolk-backend ließ sich nicht ändern: {error}',
        runWithoutSignInLinger: 'Dieses System lässt deine Dienste nicht ohne Anmeldung laufen. Ein Administrator erlaubt es einmal mit „sudo loginctl enable-linger {user}“; danach noch einmal einschalten.',
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
        updateReadyTextAdmin: 'OpenFolk {version} ist geladen. Jetzt neu starten, oder es wird beim nächsten Beenden installiert. Ein arbeitender Bot macht vorher fertig. Für die Installation fragt Windows nach Administratorrechten; abgelehnt, wartet das Update bis zum nächsten Mal.',
        updateRestart: 'Jetzt neu starten',
        updateLater: 'Später',
        updateNone: 'OpenFolk {version} ist die aktuelle Version.',
        updateDownloading: 'OpenFolk {version} wird geladen. Die App fragt nach dem Neustart, sobald es fertig ist.',
        updateFailed: 'Die Update-Server sind nicht erreichbar. Versuche es später noch einmal oder lade die neue Version auf openfolk.app.\n\nopenfolk.app: {feed}\nGitHub: {github}',
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
    stopQrJoin();
    // The web app tells "on this computer" (it has the menu "Allowed folders …") from a display-only window by this mark
    win.webContents.setUserAgent(config.mode === 'local' ? `${baseAgent} OpenFolkLocal` : baseAgent);
    if (config.mode === 'local') void startLocal();
    else if (config.mode === 'relay' && config.url) void relayPage(config.url).then((page) => win.loadURL(page), () => win.loadURL(appLink(config.url)));
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
        try { await win.loadURL(await relayPage(backend.url)); } catch { /* the page reports it */ }
        // The page may have lost its sign-in, though: up to 0.1.2 it ran at the relay's address, since 0.2.0 at
        // openfolk://app with a storage of its own. Without a device key it would show the sign-in page; a fresh
        // pairing link signs it in again, as on the first start.
        if (!(await pageSignedIn(backend.url))) await pairAgain();
        return;
    }
    await pairAgain();
}

/**
 * Whether the web app in the window holds a device key (or a password still to be exchanged) for this relay; see
 * relayEntry and DEVICE_KEY in webapp/js/core.js. True when that cannot be told, so nothing pairs by mistake.
 */
async function pageSignedIn(relay) {
    let origin;
    try { origin = new URL(relay).origin; } catch { return true; }
    try {
        // The web app of an old relay keeps its keys without a relay's scope (webapp/js/core.js, relayScope)
        if (!win.webContents.getURL().startsWith(APP)) {
            return Boolean(await win.webContents.executeJavaScript("Boolean(localStorage.getItem('openfolk-device') || localStorage.getItem('openfolk-token'))"));
        }
        return Boolean(await win.webContents.executeJavaScript(`(() => {
            try {
                const list = JSON.parse(localStorage.getItem('openfolk-relays') || '[]');
                const entry = Array.isArray(list) ? list.find((r) => r && r.url === ${JSON.stringify(origin)}) : null;
                if (!entry) return false;
                return Boolean(localStorage.getItem('openfolk-device' + entry.scope) || localStorage.getItem('openfolk-token' + entry.scope));
            } catch { return true; }
        })()`));
    } catch {
        return true;
    }
}

/** Loads the web app with a fresh pairing link, which signs this window in and hands it the end-to-end key. */
async function pairAgain() {
    if (!backend) return;
    try {
        const link = await relayPage(await backend.pairingUrl());
        // Already on that page, the link would only change what follows '#', and the web app reads the pairing link
        // when it starts: through a blank page it loads anew
        if (!win.webContents.getURL().startsWith('file:')) await win.loadURL('about:blank').catch(() => undefined);
        win.loadURL(link);
        config.paired = backend.url;
        saveConfig();
    } catch (e) {
        win.loadFile(SETUP, { query: { error: e.message, log: backend.log } });
    }
}

/**
 * Joins this computer to a relay with the invitation from "Add machine" (pasted or received by QR code) and starts the
 * backend against it; the window then signs itself in with a pairing link from that backend (startLocal).
 */
async function joinWith(link) {
    stopQrJoin();
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
}

/**
 * The setup link inside `openfolk://setup?link=…` (the button on the relay's page for a setup link) or a setup link
 * itself (`https://relay/#setup=…`); '' for anything else.
 */
function setupLinkOf(arg) {
    try {
        const u = new URL(String(arg || ''));
        if (u.protocol === 'openfolk:' && u.hostname === 'setup') return setupLinkOf(u.searchParams.get('link') || '');
        if ((u.protocol === 'https:' || u.protocol === 'http:') && new URLSearchParams(u.hash.slice(1)).get('setup')) return u.href;
    } catch { /* not an address */ }
    return '';
}

/** The profile has bots of its own from "on this computer": a setup link must not put them aside unasked. */
function hasOwnBots() {
    try {
        const list = JSON.parse(fs.readFileSync(path.join(dataDir(), 'accounts', 'main', 'bots.json'), 'utf8'));
        return Array.isArray(list) && list.length > 0;
    } catch { return false; }
}

/** Why this OpenFolk cannot take a setup link; '' when it can. A setup link is for an OpenFolk that is new. */
function setupBlocked(link) {
    const relay = remoteUrl();
    if (relay) return t('setupLinkJoined').replace('{relay}', new URL(relay).host);
    if (hasOwnBots()) return t('setupLinkBots');
    return link ? '' : t('invalidAddress');
}

let setupRunning = false;
/** A setup link from the browser: asked once, then joined like an invitation (the relay binds the machine). */
async function openSetupLink(link) {
    if (!link || setupRunning || !win) return;
    show();
    const title = t('setupLinkTitle');
    const blocked = setupBlocked(link);
    if (blocked) {
        await dialog.showMessageBox(win, { type: 'info', title, message: blocked });
        return;
    }
    const { response } = await dialog.showMessageBox(win, {
        type: 'question', title, message: t('setupLinkConfirm').replace('{relay}', new URL(link).host), detail: t('setupLinkDetail'),
        buttons: [t('setupLinkYes'), t('setupLinkNo')], defaultId: 0, cancelId: 1,
    });
    if (response !== 0) return;
    setupRunning = true;
    try {
        const r = await joinWith(link);
        if (r.error) await dialog.showMessageBox(win, { type: 'error', title, message: t('setupLinkFailed').replace('{error}', r.error) });
    } finally {
        setupRunning = false;
    }
}

/**
 * The way back from a relay this computer joined (by invitation or setup link): the backend lets go of it and the app
 * runs "on this computer" again. The profile keeps what the bots did; the relay's owner removes the machine there.
 */
async function disconnectRelay() {
    const relay = remoteUrl();
    if (!relay) return;
    const host = new URL(relay).host;
    const { response } = await dialog.showMessageBox(win, {
        type: 'question', title: 'OpenFolk', message: t('disconnectConfirm').replace('{relay}', host), detail: t('disconnectDetail'),
        buttons: [t('disconnectYes'), t('setupLinkNo')], defaultId: 1, cancelId: 1,
    });
    if (response !== 0) return;
    if (backend) {
        await backend.stop();
        backend = null;
    }
    // The embedded relay takes its own token and key from the data folder again
    for (const key of ['RELAY_URL', 'AGENT_TOKEN', 'E2E_KEY', 'MACHINE_NAME']) setProfileEnv(key, '');
    config.mode = 'local';
    config.paired = '';
    saveConfig();
    createMenu();
    if (tray) tray.setContextMenu(trayMenu());
    loadWebApp();
}

const disconnectItem = () => (config.mode === 'local' && remoteUrl()
    ? [{ label: t('disconnect').replace('{relay}', new URL(remoteUrl()).host), click: () => void disconnectRelay() }] : []);

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
    watchZoom(win);

    // Links to other sites (files, docs) open in the default browser, not in the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('file://') || url.startsWith(APP)) return;
        // The page of a relay before 0.2.0 reloads itself, e.g. after the sign-in
        try { if (oldRelays.has(new URL(url).origin)) return; } catch { /* no address */ }
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

// Chromium keeps a zoom level per origin and only until quit; the app keeps one level for every page it shows
// (openfolk://app, a relay's page, the setup page) and across starts. Steps of 0.5 like the browser's own (about 10 %).
const ZOOM_MIN = -3;
const ZOOM_MAX = 4.5;
function setZoom(level) {
    config.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
    saveConfig();
    for (const w of [win, foldersWin]) if (w) w.webContents.setZoomLevel(config.zoom);
}
const zoomBy = (step) => setZoom((config.zoom || 0) + step);

/** Ctrl and + / - / 0 in every keyboard layout and on the number pad, Ctrl and the mouse wheel; Cmd on the Mac. */
function watchZoom(w) {
    w.webContents.on('did-finish-load', () => w.webContents.setZoomLevel(config.zoom || 0));
    w.webContents.on('zoom-changed', (e, direction) => zoomBy(direction === 'in' ? 0.5 : -0.5));
    w.webContents.on('before-input-event', (e, input) => {
        if (input.type !== 'keyDown' || input.alt || !(MAC ? input.meta : input.control)) return;
        const key = input.code === 'NumpadAdd' ? '+' : input.code === 'NumpadSubtract' ? '-' : input.code === 'Numpad0' ? '0' : input.key;
        if (key === '+' || key === '=') zoomBy(0.5);
        else if (key === '-') zoomBy(-0.5);
        else if (key === '0') setZoom(0);
        else return;
        e.preventDefault();
    });
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
    watchZoom(foldersWin);
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

/** "Run without signing in": Windows or Linux (task.js), the backend in the app, and a relay on a server that can wake this computer. */
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
        const message = error === 'linger' ? t('runWithoutSignInLinger').replace('{user}', os.userInfo().username)
            : t(process.platform === 'linux' ? 'runWithoutSignInFailedLinux' : 'runWithoutSignInFailed').replace('{error}', error);
        dialog.showMessageBox(win, { type: 'warning', title: 'OpenFolk', message });
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
    ...disconnectItem(),
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
        // The keys themselves go through watchZoom (the roles' Ctrl+Plus misses the + key of a German keyboard)
        { label: t('resetZoom'), accelerator: 'CmdOrCtrl+0', registerAccelerator: false, click: () => setZoom(0) },
        { label: t('zoomIn'), accelerator: 'CmdOrCtrl+Plus', registerAccelerator: false, click: () => zoomBy(0.5) },
        { label: t('zoomOut'), accelerator: 'CmdOrCtrl+-', registerAccelerator: false, click: () => zoomBy(-0.5) },
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
                ...disconnectItem(),
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
                ...disconnectItem(),
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

// openfolk:// links from the browser (the button on a relay's page for a setup link) start this app. Inside the app
// the same scheme serves the web app (serveWebApp); only links from outside come through the system. A test run keeps
// the system's registration (the installed app's) as it is.
if (!process.env.OPENFOLK_USER_DATA) {
    if (process.defaultApp) {
        if (process.argv[1]) app.setAsDefaultProtocolClient('openfolk', process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient('openfolk');
    }
}

/** A setup link that came before the window was there (macOS hands it over before ready, the others in argv). */
let pendingSetupLink = process.argv.map(setupLinkOf).find(Boolean) || '';

// A second start only brings the existing window to the front; Windows and Linux hand a link over this way
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (e, argv) => {
        show();
        const link = argv.map(setupLinkOf).find(Boolean);
        if (link) void openSetupLink(link);
    });
    // macOS hands links over as an event, also the one the app was started with
    app.on('open-url', (e, url) => {
        e.preventDefault();
        const link = setupLinkOf(url);
        if (!link) return;
        if (win) void openSetupLink(link);
        else pendingSetupLink = link;
    });

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
        if (pendingSetupLink) void openSetupLink(pendingSetupLink);
        pendingSetupLink = '';
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
        // A setup link pasted here: the same checks as one from the browser
        const blocked = setupLinkOf(link) ? setupBlocked(setupLinkOf(link)) : '';
        if (blocked) return { error: blocked };
        return joinWith(link);
    });
    // The same invitation by QR code: a signed-in device scans it and sends the link back sealed (qr-join.js)
    ipcMain.handle('qr-join-start', async (e, input) => {
        if (!fromSetup(e)) return { error: 'not allowed' };
        const url = normalizeAddress(input);
        if (!url) return { error: t('invalidAddress') };
        const sender = e.sender;
        try {
            await startQrJoin({
                relay: url, root: root(),
                emit: (state) => { if (!sender.isDestroyed()) sender.send('qr-join', state); },
                onLink: async (link) => (await joinWith(link)).error || '',
            });
        } catch (err) {
            return { error: err.message };
        }
        return {};
    });
    ipcMain.handle('qr-join-stop', (e) => {
        if (fromSetup(e)) stopQrJoin();
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
