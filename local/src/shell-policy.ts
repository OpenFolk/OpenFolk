// How the approval level "risky" reads a shell command (Bash or PowerShell): split into the commands it runs, each
// judged by what it does. One pattern over the whole line missed `echo x > C:\elsewhere\file`, `curl … | sh` and
// `cat .env`, and anything hidden behind `&&` or `|`. This stays a best effort on purpose: whoever wants every command
// confirmed uses the level "write"; a list of allowed commands would ask on nearly every step of a bot.

import os from 'node:os';
import path from 'node:path';
import { isUnder } from './bots.ts';

/** Why a command asks; the keys are i18n keys `policy.<risk>`. */
export type ShellRisk = 'outsideFolder' | 'sensitiveFile' | 'remoteCode' | 'install' | 'elevation';

/** Sensitive file names ('zugangsdaten' is German for credentials); templates of .env files stay free. */
const SENSITIVE = /(^|[\\/])\.env(\.[\w-]+)?$|\.(pem|key|pfx|p12|ppk)$|(^|[\\/])id_(rsa|ed25519|ecdsa)$|zugangsdaten|credentials|(^|[\\/])secrets\./i;
const TEMPLATE = /\.env\.(sample|example|tpl|template|dist)$/i;

/** Commands that read a file's content (or copy it somewhere). */
const READERS = new Set([
    'cat', 'type', 'more', 'less', 'head', 'tail', 'bat', 'nl', 'xxd', 'od', 'strings', 'base64', 'certutil', 'gc',
    'get-content', 'select-string', 'sls', 'findstr', 'grep', 'rg', 'awk', 'sed', 'cut', 'sort', 'cp', 'copy', 'copy-item',
    'cpi', 'scp', 'curl', 'source', '.', 'import-csv', 'get-filehash',
]);
const COPIERS = new Set(['cp', 'mv', 'copy', 'move', 'xcopy', 'install', 'ln', 'rename-item', 'ren']);
const PS_COPIERS = new Set(['copy-item', 'move-item', 'cpi', 'mi', 'cpp']);
const WRITERS = new Set(['set-content', 'add-content', 'out-file', 'new-item', 'tee', 'tee-object', 'sc', 'ac', 'ni', 'touch', 'mkdir', 'md']);
const INTERPRETERS = 'sh|bash|zsh|dash|ksh|python3?|py|node|deno|bun|perl|ruby|php|pwsh|powershell|cmd';
const DOWNLOADERS = 'curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod';

/** Splits a line of words at blanks outside quotes and drops the quotes. */
export function words(text: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quote: string | null = null;
    let any = false;
    for (const c of text) {
        if (quote) {
            if (c === quote) quote = null;
            else cur += c;
        } else if (c === '"' || c === "'") {
            quote = c;
            any = true;
        } else if (/\s/.test(c)) {
            if (cur || any) out.push(cur);
            cur = '';
            any = false;
        } else {
            cur += c;
        }
    }
    if (cur || any) out.push(cur);
    return out;
}

/**
 * The commands a line runs: split at `;`, `&&`, `||`, `|`, `&` and line breaks outside quotes; the contents of `$( )`,
 * `<( )` and backticks become commands of their own (also inside double quotes, where the shell runs them too).
 */
export function shellParts(command: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let quote: string | null = null;
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (quote) {
            if (c === quote) quote = null;
            cur += c;
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            cur += c;
            continue;
        }
        // 2>&1, &>file and >&2 are redirects, not separators
        const redirect = c === '&' && (command[i - 1] === '>' || command[i + 1] === '>');
        if (!redirect && (c === ';' || c === '\n' || c === '|' || c === '&')) {
            if (cur.trim()) parts.push(cur.trim());
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    for (const m of command.matchAll(/\$\(([^()]*)\)|<\(([^()]*)\)|`([^`\n]*)`/g)) {
        const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
        if (inner) parts.push(...shellParts(inner));
    }
    return parts;
}

/** Name of a command without path and .exe, lower case (`C:\bin\Curl.exe` → `curl`). */
function commandName(word: string | undefined): string {
    return path.basename(word ?? '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/** A path as the shell would see it: home and temp variables expanded; null if it holds another variable. */
function expand(target: string): string | null {
    let p = target
        .replace(/^~(?=$|[\\/])/, os.homedir())
        .replace(/^(\$HOME|\$env:USERPROFILE|%USERPROFILE%)(?=$|[\\/])/i, os.homedir())
        .replace(/^(\$TMPDIR|\$env:TEMP|\$env:TMP|%TEMP%|%TMP%)(?=$|[\\/])/i, os.tmpdir());
    if (/[$%]/.test(p)) return null;
    // Git Bash writes C:\ as /c/
    if (process.platform === 'win32') p = p.replace(/^\/([a-z])(?=\/|$)/i, '$1:');
    return p;
}

/** True if a write to `target` (relative to `cwd`) leaves the bot folder; the temp folder is allowed. */
function outside(target: string, cwd: string, folder: string): boolean {
    const p = expand(target);
    if (p === null || !p.trim()) return false;
    if (/^(nul|\$null|\/dev\/(null|stdout|stderr|tty))$/i.test(p) || /^&\d$/.test(p)) return false;
    const abs = path.resolve(cwd, p);
    if (isUnder(abs, folder) || isUnder(abs, os.tmpdir())) return false;
    return !(process.platform !== 'win32' && isUnder(abs, '/tmp'));
}

/** Value of a PowerShell parameter (`-Destination x`, `-Path:x`), case-insensitive, by any of its names. */
function param(args: string[], names: string[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
        const [flag, inline] = args[i].split(/:(.*)/s);
        if (names.some((n) => flag.toLowerCase() === `-${n}`)) return inline || args[i + 1];
    }
    return undefined;
}

const positional = (args: string[]) => args.filter((a) => !a.startsWith('-'));

/** Files a command writes to: redirects, copy and move targets, writing cmdlets. */
function writeTargets(part: string, name: string, args: string[]): string[] {
    const targets: string[] = [];
    for (const m of part.matchAll(/(?:^|[^\d&>])(?:\d|&)?>>?\s*("[^"]*"|'[^']*'|[^\s;|&<>]+)/g)) targets.push(m[1].replace(/^["']|["']$/g, ''));
    const pos = positional(args);
    if (COPIERS.has(name) && pos.length >= 2) targets.push(pos[pos.length - 1]);
    if (name === 'robocopy' && pos.length >= 2) targets.push(pos[1]);
    if (PS_COPIERS.has(name)) {
        const dest = param(args, ['destination', 'dest']) ?? (pos.length >= 2 ? pos[pos.length - 1] : undefined);
        if (dest) targets.push(dest);
    }
    if (WRITERS.has(name)) {
        const named = param(args, ['path', 'filepath', 'literalpath']);
        if (named) targets.push(named);
        else if (['tee', 'touch', 'mkdir', 'md'].includes(name)) targets.push(...pos);
        else if (pos[0]) targets.push(pos[0]);
    }
    return targets;
}

/** Package installs: they run code of the package (install scripts) and change the project or the machine. */
function installs(name: string, args: string[]): boolean {
    const pos = positional(args);
    const verb = (pos[0] ?? '').toLowerCase();
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
        if (args.some((a) => a === '-g' || a === '--global')) return ['i', 'install', 'add'].includes(verb);
        if (['add'].includes(verb)) return true;
        return ['i', 'install'].includes(verb) && pos.length > 1;
    }
    if (['npx', 'pnpx', 'bunx'].includes(name)) {
        return args.some((a) => ['-y', '--yes', '-p', '--package'].includes(a) || a.startsWith('--package=')) || /^[^@\s]+@|^@[^/]+\/[^@]+@/.test(pos[0] ?? '');
    }
    if (['pip', 'pip3', 'pipx', 'gem', 'cargo', 'go', 'winget', 'choco', 'scoop', 'brew', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'snap', 'conda'].includes(name)) {
        return verb === 'install' || (name === 'pacman' && args.some((a) => a.startsWith('-S')));
    }
    if (['python', 'python3', 'py'].includes(name)) return /(^|\s)-m\s+pip\s+install\b/i.test(args.join(' '));
    if (name === 'uv') return /^(pip|tool)$/.test(verb) && (pos[1] ?? '').toLowerCase() === 'install' || verb === 'add';
    return false;
}

/** The first reason for a question in "risky", or null when the command may run without one. */
export function shellRisk(command: string, folder: string): ShellRisk | null {
    const line = command.toLowerCase();
    if (new RegExp(`\\b(${DOWNLOADERS})\\b[^|\\n]*\\|\\s*(sudo\\s+)?(${INTERPRETERS})\\b`, 'i').test(command)
        || new RegExp(`\\b(${INTERPRETERS}|source)\\s+<\\(\\s*(${DOWNLOADERS})\\b`, 'i').test(command)
        || /(^|[\s;|&(])(iex|invoke-expression)\b/i.test(line)) return 'remoteCode';

    let cwd = folder;
    for (const part of shellParts(command)) {
        let args = words(part);
        // PowerShell's call operator and a leading environment assignment (FOO=1 cmd) do not name the command
        while (args.length && (args[0] === '&' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]))) args = args.slice(1);
        let name = commandName(args[0]);
        if (['sudo', 'doas', 'runas', 'gsudo'].includes(name) || (name === 'start-process' && /-verb\s+runas\b/i.test(part))) return 'elevation';
        args = args.slice(1);
        if (['cd', 'set-location', 'sl', 'pushd', 'chdir'].includes(name)) {
            const to = expand(positional(args)[0] ?? param(args, ['path', 'literalpath']) ?? '');
            if (to) cwd = path.resolve(cwd, to);
            continue;
        }
        if (name === 'env' || name === 'command' || name === 'exec') {
            name = commandName(args[0]);
            args = args.slice(1);
        }
        if (installs(name, args)) return 'install';
        const sensitive = (a: string) => SENSITIVE.test(a) && !TEMPLATE.test(a);
        if ((READERS.has(name) && args.some(sensitive)) || [...part.matchAll(/<\s*("[^"]*"|'[^']*'|[^\s;|&<>]+)/g)].some((m) => sensitive(m[1].replace(/^["']|["']$/g, '')))) {
            return 'sensitiveFile';
        }
        if (writeTargets(part, name, args).some((target) => outside(target, cwd, folder))) return 'outsideFolder';
    }
    return null;
}
