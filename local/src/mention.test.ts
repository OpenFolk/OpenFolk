// Tests for @ mentions:  node local/src/mention.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Bot } from '../../shared/protocol.ts';

// Own data folder: the prompt language and the known bots would otherwise come from the machine's local/data.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-mention-'));
const { delegationContext, mentioned, quoteContext } = await import('./agent.ts');

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
    const ok = actual === expected;
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok ? '' : ` (is ${String(actual)}, expected ${String(expected)})`}`);
    if (!ok) failures++;
};

const bots = [
    { id: 'cloud', name: 'Cloud', role: 'Infrastructure' },
    { id: 'mail', name: 'Mail-Agent', role: '' },
] as Bot[];
const ids = (b: Bot[]) => b.map((x) => x.id).join(',');

check('by id', ids(mentioned('can @cloud help?', bots)), 'cloud');
check('by name, case-insensitive', ids(mentioned('@Mail-Agent please', bots)), 'mail');
check('several, order of the list', ids(mentioned('@mail and @cloud', bots)), 'cloud,mail');
check('@all hits everyone', ids(mentioned('@all please', bots)), 'cloud,mail');
check('an e-mail address is no mention of a known bot', ids(mentioned('mail@example.com', bots)), '');
check('unknown bot', ids(mentioned('@nobody', bots)), '');
check('no note without a mention', delegationContext([]), '');
check('note names id, name and role', delegationContext(bots.slice(0, 1)).includes('@cloud (Cloud, Infrastructure)'), true);
check('note names the tool', delegationContext(bots).includes('message_bot'), true);

// Reply to an earlier message (quote)
check('no note without a quote', quoteContext(undefined), '');
check('quote of an own message', quoteContext({ id: 'x', from: 'me', text: 'Please  check\nthe build' }), '[Reply to this earlier message of the user: "Please check the build"]\n\n');
check('quote of an unknown bot names the id', quoteContext({ id: 'x', from: 'doesnotexist', text: 'Done.' }).includes('from doesnotexist: "Done."'), true);

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
