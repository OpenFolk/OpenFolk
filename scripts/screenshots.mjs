// Draws the pictures of the README into docs/screenshots/: the real web app with demo bots and data, served and
// answered by the scaffold of the browser tests (tests/browser/harness.mjs), so no backend, relay or key is involved.
//   node scripts/screenshots.mjs          the PNGs and demo.gif (needs ffmpeg on the PATH for the GIF)
//   node scripts/screenshots.mjs --png    the PNGs only
// Demo names and folders only: nothing of a real project may end up in a picture.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { start } from '../tests/browser/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const avatar = (file) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'webapp', 'avatars', file)).toString('base64')}`;

// A fixed morning, so the times in the pictures do not depend on when they were drawn
const DAY = '2026-11-09';
const at = (time) => new Date(`${DAY}T${time}:00`).toISOString();

const BOTS = [
    { id: 'lena', name: 'Lena', area: 'Frontend', role: 'Shop web app', avatar: avatar('f03.png'), folder: '/work/demo-shop/web', model: 'default', approval: 'risky', tone: '', machine: 'desk' },
    { id: 'tom', name: 'Tom', area: 'Backend', role: 'API and database', avatar: avatar('m02.png'), folder: '/work/demo-shop/api', model: 'default', approval: 'risky', tone: '', machine: 'desk' },
    { id: 'mia', name: 'Mia', area: 'Docs', role: 'Handbook and release notes', avatar: avatar('f05.png'), folder: '/work/demo-shop/docs', model: 'default', approval: 'write', tone: '', machine: 'cloud' },
    { id: 'ben', name: 'Ben', area: 'Ops', role: 'Server and deploys', avatar: avatar('m05.png'), folder: '/work/infra', model: 'default', approval: 'risky', tone: '', machine: 'cloud' },
];
const GROUPS = [{ id: 'release', name: 'Release 1.2', avatar: '', members: ['lena', 'tom', 'mia'], createdAt: at('07:00'), updatedAt: at('07:00') }];

const HISTORY = {
    lena: [
        { id: 'u1', role: 'user', from: 'me', text: 'The product cards break on small phones. Can you make them responsive?', ts: at('09:12'), readAt: at('09:12') },
        {
            id: 'a1', role: 'assistant', botId: 'lena', ts: at('09:14'),
            tools: [{ id: 't1', name: 'Grep', summary: 'product-card', ok: true, deferred: true }, { id: 't2', name: 'Read', summary: 'src/components/ProductCard.css', ok: true, deferred: true },
                { id: 't3', name: 'Edit', summary: 'src/components/ProductCard.css', ok: true, deferred: true }, { id: 't4', name: 'Bash', summary: 'npm test', ok: true, deferred: true }],
            text: 'Done. The cards now use a grid that drops to one column below 480 px, and the image keeps its ratio:\n\n```css\n.product-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));\n}\n```\n\nAll 48 tests pass. Shall I push it?',
        },
        { id: 'u2', role: 'user', from: 'me', text: 'Yes, push it.', ts: at('09:15'), readAt: at('09:15') },
    ],
    tom: [{ id: 'u1', role: 'user', from: 'me', text: 'Add an index for orders by customer and date.', ts: at('08:40'), readAt: at('08:40') }],
    mia: [{ id: 'a1', role: 'assistant', botId: 'mia', text: 'The release notes for 1.2 are in docs/releases/1.2.md.', ts: at('08:05') }],
    ben: [{ id: 'a1', role: 'assistant', botId: 'ben', text: 'Backups of last night are complete, 3.2 GB.', ts: at('06:30') }],
};
const STATES = { tom: 'thinking' };
const ACTIVITY = { tom: 'Running the migration tests' };
const APPROVAL = {
    id: 'ap1', chatId: 'lena', botId: 'lena', kind: 'tool', tool: 'Bash', summary: 'git push origin main', machine: 'desk', ts: at('09:15'),
    detail: 'git push origin main\n\nPushes 1 commit to git.example.com/demo/shop: "Responsive product cards"',
};
const GIT = {
    lena: [{ name: 'demo-shop', path: '', branch: 'main', ahead: 1, behind: 0, files: [{ status: ' M', path: 'web/src/components/ProductCard.css' }], more: 0, since: at('09:14') }],
    tom: [{ name: 'demo-shop', path: '', branch: 'orders-index', ahead: 0, behind: 0, files: [{ status: 'A ', path: 'api/migrations/0042_orders_index.sql' }, { status: ' M', path: 'api/src/orders.ts' }], more: 0, since: at('08:52') }],
};

const options = (o = {}) => ({
    bots: BOTS, groups: GROUPS, history: HISTORY, states: STATES, activity: ACTIVITY, activeChats: { tom: 'tom' },
    online: ['desk', 'cloud'], now: new Date(`${DAY}T09:16:00`), onSend: answer, ...o,
});

/** The approval card and the open changes, as a backend sends them after the sign-in. */
/** What the bot's page asks for: its open changes. */
async function answer(f, push) {
    if (f.type === 'git_changes') await push({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: GIT[f.botId] ?? [] });
}

async function afterSignIn(h) {
    await h.push({ type: 'approval', machine: 'desk', approval: APPROVAL });
    await h.push({ type: 'git_status', machine: 'desk', status: GIT });
    await h.wait(200);
}

async function pictures(browser) {
    fs.mkdirSync(OUT, { recursive: true });
    const shot = async (h, name) => {
        await h.wait(300);
        await h.page.screenshot({ path: path.join(OUT, `${name}.png`) });
        console.log(`docs/screenshots/${name}.png`);
    };

    // Phone: the list, a chat with an approval card, the open changes
    let h = await start(browser, options());
    await afterSignIn(h);
    await shot(h, 'phone-list');
    await h.openChat('Lena');
    await h.page.evaluate(() => { const m = document.querySelector('[data-el=messages]'); if (m) m.scrollTop = m.scrollHeight; });
    await shot(h, 'phone-chat');
    await h.page.click('.back').catch(() => undefined);
    await h.wait(200);
    await h.page.click('#tab-repos');
    await shot(h, 'phone-changes');
    await h.close();

    // Desktop: list, chat and the bot's page side by side, light and dark
    for (const dark of [false, true]) {
        h = await start(browser, options({ dark, context: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } }));
        await afterSignIn(h);
        await h.openChat('Lena');
        await h.page.evaluate(() => { openInfo('lena'); });
        await shot(h, dark ? 'desktop-dark' : 'desktop');
        await h.close();
    }
}

/** About 12 s: a task to a bot, its work live, an approval, the answer. Recorded as video, turned into a GIF. */
async function demo(browser) {
    const video = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-demo-'));
    const size = { width: 390, height: 780 };
    let turn = null;
    const h = await start(browser, options({
        history: { ...HISTORY, lena: HISTORY.lena.slice(0, 2) },
        context: { viewport: size, deviceScaleFactor: 1, recordVideo: { dir: video, size } },
        onSend: async (f, push) => {
            await answer(f, push);
            if (f.type === 'send' && f.chatId === 'lena') turn = f.text;
            if (f.type === 'approval_reply' && f.allow) {
                await push({ type: 'approval_done', machine: 'desk', id: APPROVAL.id, chatId: 'lena', result: 'allowed' });
                await push({ type: 'tool', machine: 'desk', chatId: 'lena', botId: 'lena', tool: { id: 'p1', name: 'Bash', summary: 'git push origin main', ok: true } });
                await new Promise((r) => setTimeout(r, 900));
                await push({ type: 'done', machine: 'desk', chatId: 'lena', botId: 'lena', durationMs: 4200,
                    entry: { id: 'a2', role: 'assistant', botId: 'lena', ts: at('09:17'), text: 'Pushed to main. The preview build is on its way.', tools: [{ id: 'p1', name: 'Bash', summary: 'git push origin main', ok: true }] } });
                await push({ type: 'state', machine: 'desk', botId: 'lena', state: 'idle', chatId: 'lena' });
            }
        },
    }));
    const p = h.page;
    const pause = (ms) => h.wait(ms);
    await pause(600);
    await h.openChat('Lena');
    await pause(900);
    await p.click('[data-el=text]');
    await p.keyboard.type('Yes, push it.', { delay: 70 });
    await pause(400);
    await p.click('[data-el=btn-send]');
    await pause(300);
    if (turn) {
        await h.push({ type: 'user', machine: 'desk', chatId: 'lena', entry: { id: 'u2', role: 'user', from: 'me', text: turn, ts: at('09:16'), readAt: at('09:16') } });
        await h.push({ type: 'state', machine: 'desk', botId: 'lena', state: 'thinking', activity: 'git status', chatId: 'lena' });
        await pause(700);
        await h.push({ type: 'tool', machine: 'desk', chatId: 'lena', botId: 'lena', tool: { id: 's1', name: 'Bash', summary: 'git status', ok: true } });
        await pause(600);
        await h.push({ type: 'delta', machine: 'desk', chatId: 'lena', botId: 'lena', text: 'One commit is ready. Pushing needs your approval.' });
        await pause(500);
        await h.push({ type: 'state', machine: 'desk', botId: 'lena', state: 'waiting', chatId: 'lena' });
        await h.push({ type: 'approval', machine: 'desk', approval: { ...APPROVAL, ts: at('09:16') } });
        await pause(1800);
        await p.locator('.approval button', { hasText: /^Allow/ }).first().click();
        await pause(2600);
    }
    const file = await p.video().path();
    await h.close();
    const gif = path.join(OUT, 'demo.gif');
    const filter = 'fps=12,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', filter, '-loop', '0', gif]);
    fs.rmSync(video, { recursive: true, force: true });
    console.log(`docs/screenshots/demo.gif (${Math.round(fs.statSync(gif).size / 1024)} KB)${turn ? '' : ' – WARNING: the message was not sent, the GIF shows no turn'}`);
}

const browser = await chromium.launch();
try {
    await pictures(browser);
    if (!process.argv.includes('--png')) await demo(browser);
} finally {
    await browser.close();
}
