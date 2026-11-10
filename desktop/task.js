// "Run without signing in": the app's backend starts with the system, before anyone signs in, so a machine the relay
// wakes for a routine reports by itself. Windows: a scheduled task (task.ps1). Linux: a systemd user service with
// lingering, so the user's service manager starts at boot without a sign-in. While it is on, the app never starts a
// backend of its own, so two never run against the same data: it shows the window and runs the handovers, and
// quitting it leaves the backend running. macOS has no way without a sign-in that keeps the keychain (docs/running.md).
'use strict';

const { app } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Next to the app, outside the archive: only administrators can change it, and PowerShell can read it. */
const script = () => (app.isPackaged ? path.join(process.resourcesPath, 'task.ps1') : path.join(__dirname, 'task.ps1'));
const taskName = () => `OpenFolk backend ${os.userInfo().username}`;
const powershell = () => path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Single quotes for PowerShell. */
const ps = (text) => `'${String(text).replace(/'/g, "''")}'`;

const UNIT = 'openfolk-backend.service';
const unitFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user', UNIT);

/** A value for a systemd unit line, in double quotes; % is a specifier there. */
const sd = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

/**
 * The user service: the app's Electron as Node with the profile's .env and data folder, as in backend.js; started again
 * 5 s after every exit, also after a requested restart, and never given up. Its output goes to the journal
 * (`journalctl --user -u openfolk-backend`).
 */
function linuxUnit({ exe, root, userData }) {
    const env = { ELECTRON_RUN_AS_NODE: '1', OPENFOLK_ENV_FILE: path.join(userData, '.env'), DATA_DIR: path.join(userData, 'data'), OPEN_BROWSER: '0', RELAY_LISTEN: '' };
    return [
        '# Created by the OpenFolk desktop app ("Run without signing in"); switching that off removes it.',
        '[Unit]',
        'Description=OpenFolk backend of the desktop app, also without signing in',
        'Wants=network-online.target',
        'After=network-online.target',
        'StartLimitIntervalSec=0',
        '',
        '[Service]',
        // A path setting takes the rest of the line as it is, without quotes
        `WorkingDirectory=${root.replace(/%/g, '%%')}`,
        ...Object.entries(env).map(([k, v]) => `Environment=${sd(`${k}=${v}`)}`),
        // The relay comes from the profile's .env, never from the environment of the user's session
        'UnsetEnvironment=RELAY_URL',
        `ExecStart=${sd(exe)} ${sd(path.join(root, 'local', 'src', 'index.ts'))}`,
        'Restart=always',
        'RestartSec=5',
        '',
        '[Install]',
        'WantedBy=default.target',
        '',
    ].join('\n');
}

const run = (file, args) => new Promise((resolve) => {
    execFile(file, args, { timeout: 60_000 }, (error, _stdout, stderr) => resolve(error ? String(stderr || error.message).trim().split('\n')[0] || 'failed' : ''));
});

/**
 * Linux: writes and starts the service and lets the user's service manager run without a sign-in (linger). A linger
 * the system refuses undoes the rest and answers 'linger': the app then names the command for an administrator.
 */
async function setLinuxTask(on, root, userData) {
    const systemctl = (...args) => run('systemctl', ['--user', ...args]);
    if (!on) {
        // Linger stays: other services of the user may need it
        const error = await systemctl('disable', '--now', UNIT);
        fs.rmSync(unitFile(), { force: true });
        await systemctl('daemon-reload');
        return error && fs.existsSync(unitFile()) ? error : '';
    }
    fs.mkdirSync(path.dirname(unitFile()), { recursive: true });
    fs.writeFileSync(unitFile(), linuxUnit({ exe: process.execPath, root, userData }));
    const error = (await systemctl('daemon-reload')) || (await systemctl('enable', '--now', UNIT));
    if (error) return error;
    // With the name: without it logind looks for the caller's session, which a process outside one has not
    if (await run('loginctl', ['enable-linger', os.userInfo().username])) {
        await setLinuxTask(false, root, userData);
        return 'linger';
    }
    return '';
}

/**
 * Creates (`on`) or removes the task or service; on Windows as administrator through UAC. `root`: local/ and the rest;
 * `userData`: the profile. Resolves with '' or the reason it failed (also when UAC was declined); 'linger' on Linux
 * when the system does not let the user's services run without a sign-in.
 */
function setTask(on, root, userData) {
    if (process.platform === 'linux') return setLinuxTask(on, root, userData);
    const result = path.join(userData, 'task-result.json');
    fs.rmSync(result, { force: true });
    const user = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
    // Every value in double quotes for the elevated PowerShell's command line; none of them holds a double quote
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', `"${script()}"`, on ? '-Install' : '-Remove',
        '-Exe', `"${process.execPath}"`, '-Root', `"${root}"`, '-UserData', `"${userData}"`, '-User', `"${user}"`, '-TaskName', `"${taskName()}"`, '-ResultFile', `"${result}"`];
    const command = `Start-Process -FilePath ${ps(powershell())} -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${ps(args.join(' '))}`;
    return new Promise((resolve) => {
        execFile(powershell(), ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 120_000 }, (error, _stdout, stderr) => {
            let answer = null;
            try { answer = JSON.parse(fs.readFileSync(result, 'utf8').replace(/^\uFEFF/, '')); } catch { /* declined or failed before */ }
            fs.rmSync(result, { force: true });
            if (answer?.ok) return resolve('');
            resolve(answer?.message || String(stderr || error?.message || 'failed').trim().split(/\r?\n/)[0]);
        });
    });
}

/** The PID of a backend that runs on this profile's data without being the app's child (the task's); 0 if none. */
function runningBackend(dataDir, ownPid = 0) {
    let id = 0;
    try { id = Number(fs.readFileSync(path.join(dataDir, 'backend.pid'), 'utf8').trim()); } catch { return 0; }
    if (!id || id === ownPid) return 0;
    try {
        process.kill(id, 0);
        return id;
    } catch (e) {
        // A process of the same user in session 0 may refuse to be signalled, but it is there
        return e.code === 'EPERM' ? id : 0;
    }
}

/**
 * Windows always; Linux where systemd runs the system, and not from an AppImage: that mounts its files at another path
 * on every start, so a service could not name them (the .deb installs to /opt/OpenFolk).
 */
function available() {
    if (process.platform === 'win32') return true;
    return process.platform === 'linux' && !process.env.APPIMAGE && fs.existsSync('/run/systemd/system');
}

module.exports = { setTask, runningBackend, available, linuxUnit };
