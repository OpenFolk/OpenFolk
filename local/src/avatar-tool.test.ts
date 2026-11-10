// Tests for set_avatar, a bot setting its own profile picture:  node local/src/avatar-tool.test.ts
// The tool reads an image of the bot's folder by its bytes, refuses SVG, other files and large ones, and the bot
// manager stores it for this bot only, with a line in the chat it works in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Not in the temp folder: on Windows that lies under AppData, whose files are never handed out (files.ts)
const folder = fs.mkdtempSync(path.join(import.meta.dirname, '..', '.avatar-tool-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-avatar-tool-data-'));
process.env.ALLOWED_ROOTS = folder;
const bots = await import('./bots.ts');
const { readHistory } = await import('./history.ts');
const { BotManager } = await import('./agent.ts');
const { botTools, imageType } = await import('./bot-tools.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
check('type: PNG', imageType(PNG) === 'image/png');
check('type: JPEG', imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) === 'image/jpeg');
check('type: WebP', imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')) === 'image/webp');
check('type: GIF', imageType(Buffer.from('GIF89a', 'latin1')) === 'image/gif');
check('type: SVG is none', imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')) === null);
check('type: a text file named .png is none', imageType(Buffer.from('not an image')) === null);

const base = { role: '', folder, model: 'default', tone: '', avatar: '', approval: 'never' as const, machine: '' };
const me = bots.saveBot({ ...base, id: 'ada', name: 'Ada' });
bots.saveBot({ ...base, id: 'other', name: 'Other', avatar: 'data:image/png;base64,b3RoZXI=' });
const m = new BotManager(() => undefined) as unknown as { toolHost: unknown };
const s = { bot: me, currentTurn: { chatId: 'ada~c1' } };
const setAvatar = botTools(s as never, m.toolHost as never).find((x) => x.name === 'set_avatar')!;
const call = async (p: string) => {
    const r = await setAvatar.handler({ path: p } as never, undefined);
    return { text: (r.content[0] as { text: string }).text, error: r.isError === true };
};

fs.writeFileSync(path.join(folder, 'me.png'), PNG);
const ok = await call('me.png');
check('a PNG of the folder: set', !ok.error && bots.findBot('ada')?.avatar === `data:image/png;base64,${PNG.toString('base64')}`, ok);
check('only its own picture', bots.findBot('other')?.avatar === 'data:image/png;base64,b3RoZXI=');
check('the chat it works in says so', readHistory('ada~c1').some((e) => e.role === 'event' && e.text.includes('Ada set a new profile picture')));

fs.writeFileSync(path.join(folder, 'face.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
check('SVG refused', (await call('face.svg')).error);
fs.writeFileSync(path.join(folder, 'big.png'), Buffer.concat([PNG, Buffer.alloc(400_000)]));
const big = await call('big.png');
check('too large refused, with what to do', big.error && big.text.includes('512'), big);
check('a file outside the bot folders refused', (await call(path.join(os.tmpdir(), 'nowhere.png'))).error);
check('the picture stays after refusals', bots.findBot('ada')?.avatar === `data:image/png;base64,${PNG.toString('base64')}`);

for (const d of [folder, process.env.DATA_DIR!]) fs.rmSync(d, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
