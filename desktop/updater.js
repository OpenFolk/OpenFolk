// Updates of the desktop app from the GitHub releases (electron-updater, the latest*.yml files CI attaches): a check
// shortly after start and every six hours, the download in the background, the install on the next quit. "Restart
// now" installs at once, but only after guardQuit (backend.js) has let the backend end, so no working bot is cut off.
'use strict';

const { app, dialog } = require('electron');
const { execFileSync } = require('node:child_process');

const FIRST_CHECK = 30_000;
const EVERY = 6 * 60 * 60_000;

/** electron-updater's autoUpdater, or null where this build does not update itself. */
let updater = null;
/** Version downloaded and waiting for the install; '' while there is none. */
let ready = '';
let restartAfterQuit = false;
let opts = { t: (k) => k, onChange: () => undefined, quit: () => app.quit(), window: () => null };

/**
 * Squirrel.Mac installs only an app signed with a Developer ID; an unsigned or ad-hoc signed build would download
 * every update and then fail, so it does not check at all.
 */
function developerIdSigned() {
    try {
        const out = execFileSync('codesign', ['-dv', '--verbose=2', process.execPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return /Authority=Developer ID Application/.test(out);
    } catch (e) {
        // codesign writes its report to stderr
        return /Authority=Developer ID Application/.test(String(e.stderr || ''));
    }
}

/** Not in development, not in tests (OPENFOLK_NO_UPDATE), not the portable Windows EXE, not an unsigned Mac app. */
function supported() {
    if (!app.isPackaged || process.env.OPENFOLK_NO_UPDATE || process.env.PORTABLE_EXECUTABLE_DIR) return false;
    if (process.platform === 'darwin') return developerIdSigned();
    if (process.platform === 'linux') return Boolean(process.env.APPIMAGE) || require('node:fs').existsSync('/opt/OpenFolk');
    return true;
}

const text = (key, version) => opts.t(key).replace('{version}', version || '');

async function askRestart() {
    const { response } = await dialog.showMessageBox(opts.window() || undefined, {
        type: 'info', title: 'OpenFolk', message: text('updateReadyTitle'), detail: text('updateReadyText', ready),
        buttons: [text('updateRestart'), text('updateLater')], defaultId: 0, cancelId: 1,
    });
    if (response === 0) restart();
}

/** Quits like the user would (the backend ends first, bots finish), then installs and starts the new version. */
function restart() {
    if (!ready) return;
    restartAfterQuit = true;
    opts.quit();
}

/** @param {{ t: (key: string) => string, onChange: () => void, quit: () => void, window: () => Electron.BrowserWindow | null }} o */
function startUpdates(o) {
    opts = { ...opts, ...o };
    if (!supported()) return;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    // An automatic check stays quiet when it fails (offline, GitHub's rate limit); a check from the menu reports it
    updater.on('error', () => undefined);
    updater.on('update-downloaded', (info) => {
        ready = info.version;
        opts.onChange();
        void askRestart();
    });
    const check = () => updater.checkForUpdates().catch(() => undefined);
    setTimeout(check, FIRST_CHECK).unref();
    setInterval(check, EVERY).unref();
    // will-quit comes after guardQuit let the quit through, i.e. after the backend has ended
    app.on('will-quit', () => {
        if (restartAfterQuit && ready) updater.quitAndInstall(true, true);
    });
}

/** "Check for updates" in the menus: says what it found, unlike the automatic checks. */
async function checkNow() {
    const box = (detail, type = 'info') => dialog.showMessageBox(opts.window() || undefined, { type, title: 'OpenFolk', message: text('checkUpdatesTitle'), detail });
    if (!updater) return box(text('updateNotHere', app.getVersion()));
    if (ready) return askRestart();
    try {
        const result = await updater.checkForUpdates();
        if (!result?.isUpdateAvailable) return box(text('updateNone', app.getVersion()));
        return box(text('updateDownloading', result.updateInfo.version));
    } catch (e) {
        return box(text('updateFailed').replace('{error}', e instanceof Error ? e.message : String(e)), 'warning');
    }
}

/** Menu entries: "Restart to update" once a version waits, always "Check for updates". */
function updateMenuItems() {
    return [
        ...(ready ? [{ label: text('updateReadyMenu', ready), click: restart }] : []),
        { label: text('checkUpdates'), click: () => void checkNow() },
    ];
}

module.exports = { startUpdates, updateMenuItems };
