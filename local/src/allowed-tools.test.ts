// Tools a bot may call for good (Bot.allowedTools):  node local/src/allowed-tools.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-allowed-tools-'));
process.env.ALLOWED_ROOTS = path.resolve(import.meta.dirname, '..', '..');
const bots = await import('./bots.ts');
const { needsApproval } = await import('./policy.ts');

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
    if (!ok) failures++;
};

const folder = path.resolve(import.meta.dirname, '..', '..');
const input = { id: 'mail', name: 'Mail', role: '', folder, model: 'default', tone: '', avatar: '', approval: 'risky' as const, machine: '' };
const bot = bots.saveBot(input);
check('a new bot has no tools allowed', bot.allowedTools === undefined);

const gmail = 'mcp__claude_ai_Gmail__search_threads';
const drive = 'mcp__claude_ai_Google_Drive__read_file_content';
bots.allowTool('mail', gmail);
bots.allowTool('mail', drive);
bots.allowTool('mail', gmail);
check('allowed on a card: stored once each', JSON.stringify(bots.findBot('mail')!.allowedTools) === JSON.stringify([gmail, drive]), bots.findBot('mail')!.allowedTools);
bots.allowTool('mail', 'mcp__acp__x1');
bots.allowTool('mail', 'ReadMcpResourceTool');
check('ACP calls and resource tools are never stored', bots.findBot('mail')!.allowedTools!.length === 2, bots.findBot('mail')!.allowedTools);
check('stored tool no longer asks for this bot', !needsApproval('risky', gmail, {}, folder, bots.findBot('mail')!.allowedTools).ask);

bots.saveBot({ ...input, name: 'Mail 2' });
check('an editor without the field keeps the list', bots.findBot('mail')!.allowedTools!.length === 2);
bots.saveBot({ ...input, allowedTools: [gmail, 'mcp__github__delete_repo'] });
check('the editor can take tools off, not add new ones', JSON.stringify(bots.findBot('mail')!.allowedTools) === JSON.stringify([gmail]), bots.findBot('mail')!.allowedTools);
bots.saveBot({ ...input, allowedTools: [] });
check('all taken off: the field is gone', bots.findBot('mail')!.allowedTools === undefined);
check('and the tool asks again', needsApproval('risky', gmail, {}, folder, bots.findBot('mail')!.allowedTools).ask);

let threw = false;
try {
    bots.allowTool('nobody', gmail);
} catch {
    threw = true;
}
check('unknown bot: error', threw);

if (failures) process.exit(1);
console.log('all tests passed');
