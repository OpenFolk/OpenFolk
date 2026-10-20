// The backend image pins the Claude Code CLI (for the sign-in) to the version the Agent SDK bundles; when an update
// raises the SDK, this test fails until the ARG in local/Dockerfile follows.  node local/src/images.test.ts
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const repo = path.resolve(import.meta.dirname, '..', '..');
const dockerfile = fs.readFileSync(path.join(repo, 'local', 'Dockerfile'), 'utf8');
const pinned = /^ARG CLAUDE_CODE_VERSION=(\S+)$/m.exec(dockerfile)?.[1];
// The package exports no ./package.json; find it above its entry file
let sdkDir = path.dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'));
while (!fs.existsSync(path.join(sdkDir, 'package.json')) && path.dirname(sdkDir) !== sdkDir) sdkDir = path.dirname(sdkDir);
const sdk = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8')) as { claudeCodeVersion?: string };
check('Dockerfile pins the Claude Code CLI', !!pinned && /^\d+\.\d+\.\d+$/.test(pinned), pinned);
check('pinned version is the one the Agent SDK bundles', pinned === sdk.claudeCodeVersion, { pinned, sdk: sdk.claudeCodeVersion });
check('the CLI is installed with that version', dockerfile.includes('@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}'));

for (const file of ['relay/Dockerfile', 'local/Dockerfile']) {
    const text = fs.readFileSync(path.join(repo, file), 'utf8');
    check(`${file}: installs from the lockfile`, /\bnpm ci\b/.test(text) && !/\bnpm install\b(?! -g @anthropic-ai\/claude-code)/.test(text));
}

if (failures) process.exit(1);
console.log('all tests passed');
