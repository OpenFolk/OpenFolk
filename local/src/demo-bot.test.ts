// The demo bot of the stores' reviewers (DEMO_BOT):  node local/src/demo-bot.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-demo-bot-'));
const work = path.join(dir, 'work');
fs.mkdirSync(work);
process.env.DATA_DIR = path.join(dir, 'data');
process.env.ALLOWED_ROOTS = work;

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const { inAccount } = await import('./store.ts');
const { loadBots } = await import('./bots.ts');
const { setPeople } = await import('./people.ts');
const { seedDemoBot } = await import('./demo-bot.ts');

const template = path.join(dir, 'demo-bot.json');
fs.writeFileSync(template, JSON.stringify({ name: 'Guide', role: 'Answers questions about OpenFolk', tone: 'Short and friendly.', folder: work, model: 'haiku' }));
const quiet = () => undefined;
setPeople([
    { id: 'main', name: 'Main', admin: true, reach: 'all' },
    { id: 'apple-review', name: 'Apple Review', admin: false, reach: 'admins', demo: true },
    { id: 'kunde', name: 'Kunde', admin: false, reach: 'admins' },
]);

const bot = inAccount('apple-review', () => seedDemoBot('apple-review', template, quiet));
check('a demo account without bots gets the demo bot', bot?.name === 'Guide' && bot.model === 'haiku' && bot.folder === work.replace(/\\/g, '/'), bot);
check('… as a support bot by default', bot?.approval === 'read');
check('… stored in that account', inAccount('apple-review', () => loadBots().map((b) => b.name).join()) === 'Guide');
check('a second time adds none', inAccount('apple-review', () => seedDemoBot('apple-review', template, quiet)) === null && inAccount('apple-review', () => loadBots().length) === 1);
check('an account that is no demo gets none', inAccount('kunde', () => seedDemoBot('kunde', template, quiet)) === null && inAccount('kunde', () => loadBots().length) === 0);
check('without DEMO_BOT nothing happens', inAccount('kunde', () => seedDemoBot('kunde', '', quiet)) === null);

setPeople([{ id: 'google-review', name: 'Google Review', admin: false, reach: 'admins', demo: true }]);
const logged: string[] = [];
fs.writeFileSync(path.join(dir, 'broken.json'), '{ "name": "Guide" }');
check('a template without folder creates nothing and says why', inAccount('google-review', () => seedDemoBot('google-review', path.join(dir, 'broken.json'), (t) => logged.push(t))) === null
    && logged.some((t) => t.includes('folder')));
fs.writeFileSync(path.join(dir, 'outside.json'), JSON.stringify({ name: 'Guide', folder: dir }));
check('a folder outside the allowed roots is refused', inAccount('google-review', () => seedDemoBot('google-review', path.join(dir, 'outside.json'), quiet)) === null);

if (failures) process.exit(1);
console.log('all tests passed');
