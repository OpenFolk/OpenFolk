// Installs or updates an ACP agent that the ACP registry distributes as a program archive
// (currently Google Antigravity), into %LOCALAPPDATA%\<id>\<version> or ~/.local/share/<id>/<version>.
//
//   node local/tools/acp-install.mjs antigravity-acp          # newest version from the registry
//   node local/tools/acp-install.mjs antigravity-acp --check  # only show what would be installed
//
// The backend then takes the newest installed version (local/src/acp.ts); a restart is enough.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const [id, ...rest] = process.argv.slice(2);
if (!id) {
    console.error('Usage: node local/tools/acp-install.mjs <agent-id> [--check]');
    process.exit(1);
}

const platform = `${{ win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform]}-${{ x64: 'x86_64', arm64: 'aarch64' }[process.arch]}`;
const registry = await (await fetch(REGISTRY)).json();
const agent = (registry.agents ?? registry).find((a) => a.id === id);
if (!agent) throw new Error(`${id} is not in the ACP registry`);
const target = agent.distribution?.binary?.[platform];
if (!target) throw new Error(`${agent.name} ${agent.version} is not available as a program for ${platform}`);

const root = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), id)
    : path.join(os.homedir(), '.local', 'share', id);
const folder = path.join(root, agent.version);
const program = path.join(folder, target.cmd);
console.log(`${agent.name} ${agent.version} for ${platform}: ${target.archive}`);
if (fs.existsSync(program)) {
    console.log(`already installed: ${program}`);
    process.exit(0);
}
// --pruefen is the German option name of older versions
if (rest.includes('--check') || rest.includes('--pruefen')) process.exit(0);

// Archive into its own empty folder; only after complete unpacking to the target place
const work = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-`));
try {
    const archive = path.join(work, path.basename(new URL(target.archive).pathname));
    const response = await fetch(target.archive);
    if (!response.ok) throw new Error(`Download: HTTP ${response.status}`);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    console.log(`downloaded: ${(fs.statSync(archive).size / 1e6).toFixed(1)} MB`);
    const unpacked = path.join(work, 'content');
    fs.mkdirSync(unpacked);
    // Windows' bsdtar also handles zip; fixed from System32, a GNU tar from Git Bash would take "C:" for a host name
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xf', archive, '-C', unpacked], { stdio: 'inherit' });
    if (!fs.existsSync(path.join(unpacked, target.cmd))) throw new Error(`${target.cmd} is missing in the archive`);
    fs.mkdirSync(root, { recursive: true });
    fs.renameSync(unpacked, folder);
    if (process.platform !== 'win32') fs.chmodSync(program, 0o755);
    console.log(`installed: ${program}`);
} finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
