// "Run without signing in" (Windows): a scheduled task starts the app's backend at system start, before anyone signs
// in, so a machine the relay wakes for a routine reports by itself (task.ps1). While the task is on, the app never starts
// a backend of its own, so two never run against the same data: it shows the window and runs the handovers, and
// quitting it leaves the backend running.
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

/**
 * Creates (`on`) or removes the task, as administrator through UAC. `root`: local/ and the rest; `userData`: the
 * profile. Resolves with '' or the reason it failed (also when UAC was declined).
 */
function setTask(on, root, userData) {
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

module.exports = { setTask, runningBackend, available: () => process.platform === 'win32' };
