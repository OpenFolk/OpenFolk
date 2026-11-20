// The backend image links `claude` (the CLI for the sign-in) to the native binary the Agent SDK bundles, so both are
// the same version by construction; a separate global install of @anthropic-ai/claude-code would only add ~260 MB.
//   node local/src/images.test.ts
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const repo = path.resolve(import.meta.dirname, '..', '..');
const dockerfile = fs.readFileSync(path.join(repo, 'local', 'Dockerfile'), 'utf8');
check('the CLI is the binary bundled with the Agent SDK', /ln -s "\/app\/\$bin" \/usr\/local\/bin\/claude/.test(dockerfile) && dockerfile.includes('claude-agent-sdk-linux-'));
check('no second global install of the CLI', !/npm install -g @anthropic-ai\/claude-code/.test(dockerfile));

for (const file of ['relay/Dockerfile', 'local/Dockerfile']) {
    const text = fs.readFileSync(path.join(repo, file), 'utf8');
    check(`${file}: installs from the lockfile`, /\bnpm ci\b/.test(text) && !/\bnpm install\b/.test(text));
}

if (failures) process.exit(1);
console.log('all tests passed');
