// Tests for the machine settings of the backend (shutdown, autologon):  node local/src/machine-config.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { machineName } from './config.ts';
import { parseMachineConfig } from './machine-config.ts';
import { cleanMachineSettings } from './machine-settings.ts';
import { MACHINE_SETTINGS_DEFAULT } from '../../shared/protocol.ts';
import { activeUsers, builtinCommand, canRestart, fillCommand, idleMinutes, shutdown } from './shutdown.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

const withScripts = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-machine-'));
const scripts = { SHUTDOWN_SCRIPT: path.join(withScripts, 'shutdown.php'), AUTOLOGON_SCRIPT: path.join(withScripts, 'autologon.ps1') };
fs.writeFileSync(scripts.SHUTDOWN_SCRIPT, '');
fs.writeFileSync(scripts.AUTOLOGON_SCRIPT, '');

let c = parseMachineConfig({}, 'win32');
check('nothing set: builtin, no autologon', c.shutdown.method === 'builtin' && c.autologon.method === 'none' && !c.problems.length, c);
check('defaults: 60 s, after wake ifIdle in 300 s, wait 60 min, free after 15 min', c.shutdown.delaySeconds === 60 && c.afterWake.mode === 'ifIdle'
    && c.afterWake.delaySeconds === 300 && c.afterWake.waitMinutes === 60 && c.shutdown.idleMinutes === 15 && c.shutdown.php === 'php', c);
c = parseMachineConfig(scripts, 'win32');
check('scripts set: script', c.shutdown.method === 'script' && c.autologon.method === 'script' && c.shutdown.script === path.resolve(scripts.SHUTDOWN_SCRIPT), c);
check('autologon script is Windows-only', parseMachineConfig(scripts, 'linux').autologon.method === 'none');
check('SHUTDOWN_SCRIPT beats SHUTDOWN_COMMAND', parseMachineConfig({ ...scripts, SHUTDOWN_COMMAND: 'poweroff' }, 'win32').shutdown.method === 'script');
check('SHUTDOWN_COMMAND without a script: command', parseMachineConfig({ SHUTDOWN_COMMAND: 'poweroff' }, 'win32').shutdown.method === 'command');
const off = { ...MACHINE_SETTINGS_DEFAULT, shutdown: false };
c = parseMachineConfig({ ...scripts, AUTOLOGON_METHOD: 'none' }, 'win32', off);
check('switched off in the settings: none, but what the .env allows is known', c.shutdown.method === 'none' && c.shutdown.available === 'script'
    && c.autologon.method === 'none', c);
c = parseMachineConfig({ AUTOLOGON_METHOD: 'script' }, 'win32');
check('autologon script without a path: none, with reason', c.autologon.method === 'none' && c.problems.some((p) => p.includes('AUTOLOGON_SCRIPT')), c.problems);
check('container without script or command: no shutdown', parseMachineConfig({ OPENFOLK_CONTAINER: '1' }, 'linux').shutdown.method === 'none');
c = parseMachineConfig({ SHUTDOWN_METHOD: 'none', SHUTDOWN_DELAY_SECONDS: '5', SHUTDOWN_AFTER_WAKE: 'never' }, 'linux');
check('the old variables count no more', c.shutdown.method === 'builtin' && c.shutdown.delaySeconds === 60 && c.afterWake.mode === 'ifIdle', c);
const own = cleanMachineSettings({ afterWake: 'always', shutdownDelaySeconds: 0, afterWakeWaitMinutes: 10, idleMinutes: 5 });
c = parseMachineConfig({ PHP_BIN: 'C:/php/php.exe' }, 'win32', own);
check('values from the settings', c.afterWake.mode === 'always' && c.shutdown.delaySeconds === 0 && c.afterWake.waitMinutes === 10
    && c.shutdown.idleMinutes === 5 && c.shutdown.php === 'C:/php/php.exe', c);
const wrong = cleanMachineSettings({ afterWake: 'maybe', shutdownDelaySeconds: 99999, idleMinutes: -1, shutdown: 'yes', voiceModel: 'huge' });
check('invalid settings: defaults', JSON.stringify(wrong) === JSON.stringify(MACHINE_SETTINGS_DEFAULT), wrong);

check('quser idle column', idleMinutes('none') === 0 && idleMinutes('.') === 0 && idleMinutes('7') === 7 && idleMinutes('1:05') === 65 && idleMinutes('2+01:00') === 2940);
const quser = [
    ' BENUTZERNAME          SITZUNGSNAME       ID  STATUS  LEERLAUF   ANMELDEZEIT',
    '>alex                  console             1  Aktiv        3     13.10.2026 08:00',
    ' gast                                      2  Getr.     none    13.10.2026 07:00',
    ' admin                 rdp-tcp#1           3  Active     1:10   10/13/2026 7:00 AM',
].join('\r\n');
check('quser: active and recently used only', activeUsers(quser, 15).join() === 'alex', activeUsers(quser, 15));
check('quser: higher threshold counts the long idle one too', activeUsers(quser, 120).join() === 'alex,admin', activeUsers(quser, 120));
check('quser: nobody signed in', activeUsers('', 15).length === 0);

const win = builtinCommand('win32', false, 90, Date.parse('2026-10-13T10:00:00Z'));
check('Windows: shutdown /s /t 90', win.args.slice(0, 3).join(' ') === '/s /t 90' && win.at === '2026-10-13T10:01:30.000Z', win);
check('Windows: cancel /a', builtinCommand('win32', true, 0).args.join() === '/a');
const linux = builtinCommand('linux', false, 90, Date.parse('2026-10-13T10:00:00Z'));
check('Linux: whole minutes, rounded up', linux.file === 'shutdown' && linux.args.join(' ') === '-h +2' && linux.at === '2026-10-13T10:02:00.000Z', linux);
check('Linux: 0 s = now', builtinCommand('linux', false, 0).args.join(' ') === '-h now');
check('Linux: cancel -c, macOS: killall', builtinCommand('linux', true, 0).args.join() === '-c' && builtinCommand('darwin', true, 0).file === 'killall');
const winRestart = builtinCommand('win32', false, 90, Date.parse('2026-10-13T10:00:00Z'), true);
check('Windows restart: shutdown /r /t 90', winRestart.args.slice(0, 3).join(' ') === '/r /t 90' && winRestart.at === '2026-10-13T10:01:30.000Z', winRestart);
check('Linux restart: -r in whole minutes', builtinCommand('linux', false, 90, Date.now(), true).args.join(' ') === '-r +2');
check('command placeholders', fillCommand('shutdown -h +{minutes} # {seconds}', 61) === 'shutdown -h +2 # 61');

const none = parseMachineConfig({}, 'win32', off).shutdown;
check('none: shutdown refused', await shutdown(false, 60, false, none).then(() => false, () => true));
const node = JSON.stringify(process.execPath);
const cmd = parseMachineConfig({ SHUTDOWN_COMMAND: `${node} -e "process.exit(0)"`, MACHINE_IDLE_COMMAND: `${node} -e "process.exit(1)"` }).shutdown;
check('command: idle check says busy -> not shut down', await shutdown(false, 60, true, cmd).then(() => false, (e: Error) => e.message.includes('?')));
const r = await shutdown(false, 60, false, cmd);
check('command: runs, planned time in 60 s', Math.abs(Date.parse(r.at ?? '') - Date.now() - 60_000) < 5000, r);
check('command: cancel without SHUTDOWN_CANCEL_COMMAND refused', await shutdown(true, 0, false, cmd).then(() => false, () => true));
const failing = parseMachineConfig({ SHUTDOWN_COMMAND: `${node} -e "process.exit(3)"` }).shutdown;
check('command: exit code reported', await shutdown(false, 60, false, failing).then(() => false, (e: Error) => e.message.includes('3')));


check('restart offered with builtin and script, not with none', canRestart(parseMachineConfig({}).shutdown)
    && canRestart(parseMachineConfig(scripts, 'win32').shutdown) && !canRestart(none));
check('command: restart only with SHUTDOWN_RESTART_COMMAND', !canRestart(cmd));
check('command: restart without SHUTDOWN_RESTART_COMMAND refused, nothing shut down', await shutdown(false, 60, false, failing, true).then(() => false, (e: Error) => e.message.includes('SHUTDOWN_RESTART_COMMAND')));
const restartOnly = parseMachineConfig({ SHUTDOWN_COMMAND: `${node} -e "process.exit(3)"`, SHUTDOWN_RESTART_COMMAND: `${node} -e "process.exit({seconds} === 30 ? 0 : 4)"` }).shutdown;
check('command: restart runs SHUTDOWN_RESTART_COMMAND with placeholders', canRestart(restartOnly)
    && await shutdown(false, 30, false, restartOnly, true).then((x) => Math.abs(Date.parse(x.at ?? '') - Date.now() - 30_000) < 5000, () => false));

// Machine name: what the relay accepts (1 to 32 of a-z, 0-9, '-')
const runner = machineName('sat12-dp150-51a9f79f-36ef-4c6f-9b9e-506e8a9e9f00-d254c4687e0a.local');
check('machine name: a long host name is cut to what the relay accepts', /^[a-z0-9-]{1,32}$/.test(runner) && runner.startsWith('sat12-dp150-'), runner);
check('machine name: no dash at the end after the cut', machineName(`${'a'.repeat(31)}.local`) === 'a'.repeat(31));
check('machine name: lower case, other characters as dashes', machineName('Marcos MacBook.local') === 'marcos-macbook-local');
check('machine name: nothing usable is "home"', machineName('---') === 'home');

fs.rmSync(withScripts, { recursive: true, force: true });
if (failed) {
    console.log(`\n${failed} test(s) failed`);
    process.exit(1);
}
console.log('\nall machine setting tests passed');
