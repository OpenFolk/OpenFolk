// Puts what "on this computer" runs into desktop/build/openfolk, which electron-builder ships as resources/openfolk:
// backend, relay, shared protocol and web app as sources (Electron's Node runs the TypeScript itself) and their
// production dependencies. Codex and Copilot stay out (about 600 MB); the app offers Claude Code. npm installs the
// optional dependencies (the Claude Code binary) of the system it runs on, so each app is bundled on its own system.
//   node scripts/desktop-bundle.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const out = path.join(repo, 'desktop', 'build', 'openfolk');
const skip = (name) => name.endsWith('.test.ts') || name === 'testdata' || name === 'data' || name === 'dist' || name === '__pycache__' || name === '.venv';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (rel) => fs.cpSync(path.join(repo, rel), path.join(out, rel), { recursive: true, filter: (src) => !skip(path.basename(src)) });

// The workspace manifests and the lockfile, so npm installs exactly the versions the repository pins
for (const f of ['package.json', 'package-lock.json', 'local/package.json', 'relay/package.json']) copy(f);
execSync('npm ci -w local -w relay --omit=dev --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
// npm links the workspaces into node_modules; nothing imports them by name, and a link has no place in an installer.
// Removed as links: fs.rmSync would follow them on Windows under Node 24.
for (const name of fs.readdirSync(path.join(out, 'node_modules'))) {
    const p = path.join(out, 'node_modules', name);
    if (!fs.lstatSync(p).isSymbolicLink()) continue;
    try {
        fs.unlinkSync(p);
    } catch {
        fs.rmdirSync(p);
    }
}
// Optional engines with CLIs of their own; the Claude Code binary (also an optional dependency) stays
for (const scope of ['@openai', '@github']) {
    const dir = path.join(out, 'node_modules', scope);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) if (/^(codex|copilot)/.test(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}
// On Linux and macOS their commands in .bin are symbolic links, now pointing nowhere
const bin = path.join(out, 'node_modules', '.bin');
for (const name of fs.existsSync(bin) ? fs.readdirSync(bin) : []) if (/^(codex|copilot)/.test(name)) fs.rmSync(path.join(bin, name), { force: true });
// npm installs the musl build of the Claude Code binary next to the glibc one; a desktop Linux has glibc
if (process.platform === 'linux' && process.report.getReport().header.glibcVersionRuntime) {
    for (const name of fs.readdirSync(path.join(out, 'node_modules', '@anthropic-ai'))) if (name.endsWith('-musl')) fs.rmSync(path.join(out, 'node_modules', '@anthropic-ai', name), { recursive: true, force: true });
}

for (const rel of ['local/src', 'local/tools', 'local/tsconfig.json', 'shared', 'relay/src', 'webapp', 'LICENSE']) copy(rel);
// The Windows task that runs a checkout's backend at system start; the app starts its backend itself
fs.rmSync(path.join(out, 'local', 'tools', 'install-task.ps1'), { force: true });

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.lstatSync(path.join(dir, e.name)).size), 0);
console.log(`${path.relative(repo, out)}: ${(size(out) / 1024 / 1024).toFixed(0)} MB`);
