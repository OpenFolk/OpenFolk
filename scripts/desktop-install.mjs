// Builds the Windows desktop app from this checkout and installs it over the installed one, to try the current
// state before a release. The NSIS installer asks for admin rights once, keeps the app's profile and data, and
// starts the app when it is done. The build keeps the version of desktop/package.json, so the next published
// release still updates the app as usual.
//   npm run desktop:install            build, then start the installer
//   npm run desktop:install -- --no-build   install the installer already in desktop/dist
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') {
    console.error('desktop:install builds the Windows installer and runs only on Windows (desktop/README.md for the others).');
    process.exit(1);
}

const desktop = path.resolve(import.meta.dirname, '..', 'desktop');
const { version } = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const installer = path.join(desktop, 'dist', `OpenFolk-Setup-${version}.exe`);
const build = !process.argv.includes('--no-build');

if (build) {
    if (!fs.existsSync(path.join(desktop, 'node_modules'))) execSync('npm install --no-audit --no-fund', { cwd: desktop, stdio: 'inherit' });
    const started = Date.now();
    execSync('npm run build', { cwd: desktop, stdio: 'inherit' });
    if (!fs.existsSync(installer) || fs.statSync(installer).mtimeMs < started) {
        console.error(`The build did not write ${installer}.`);
        process.exit(1);
    }
} else if (!fs.existsSync(installer)) {
    console.error(`${installer} does not exist; run without --no-build.`);
    process.exit(1);
}

console.log(`\nInstalling ${path.basename(installer)} (quit OpenFolk from the tray first so a working bot can finish) ...`);
// The installer asks for admin rights, which a plain CreateProcess refuses (EACCES); the shell shows the UAC prompt
spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${installer.replaceAll("'", "''")}'`], { detached: true, stdio: 'ignore' }).unref();
