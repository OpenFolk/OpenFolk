// Scaffold for the browser tests: the real web app in a mobile Chromium, the test plays the backend.
// A fake WebSocket hands every frame of the app to the test (`onSend`), the test answers with frames (`push`).
// Sign-in, machine list, bots and history are answered by the scaffold itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEBAPP = path.join(ROOT, 'webapp');
const VENDOR = {
    '/vendor/marked.umd.js': path.join(ROOT, 'node_modules', 'marked', 'lib', 'marked.umd.js'),
    '/vendor/purify.min.js': path.join(ROOT, 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
    '/vendor/qrcode.js': path.join(ROOT, 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js'),
    '/vendor/jsQR.js': path.join(ROOT, 'node_modules', 'jsqr', 'dist', 'jsQR.js'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

/**
 * The web app consists of ES modules; tests call its functions and read its state directly (`openEditor(null)`,
 * `activePane().chatId`). This puts the exports of all modules on `window`, in the test context only. Dynamic imports
 * return the same module instances the app uses; `let` bindings are copied, so read those through functions.
 */
async function exposeModules(page) {
    await page.evaluate(async () => {
        const entry = await fetch('/js/main.js').then((r) => r.text());
        const paths = [...entry.matchAll(/^import '\.\/(.+?)';/gm)].map((m) => new URL(m[1], `${location.origin}/js/`).href);
        for (const p of paths) {
            const mod = await import(p);
            for (const [k, v] of Object.entries(mod)) {
                try { window[k] = v; } catch { /* read-only window property */ }
            }
        }
    }).catch(() => undefined);
}

export function bot(id, name = id, extra = {}) {
    return { id, name, role: 'Test', avatar: '', folder: `C:/www/${id}`, model: 'default', approval: 'risky', tone: '', machine: '', ...extra };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {object} o
 *   bots, groups, history ({ chatId: entries }), online, states/activity/activeChats, pinned,
 *   dark, before (script before loading, in the browser), onSend(frame, push, state) for own answers,
 *   ownHistory (history requests are answered by onSend), agentsLater (the test sends the machine list), path,
 *   language ('en' by default; null = do not pin, the app decides), locale (browser locale, default en-US),
 *   device (stored device key, default 'test'; null = none), secure (https, e.g. for crypto.subtle),
 *   auth(frame) (the relay's answer to the sign-in; default { type: 'auth', ok: true }),
 *   botsFor(authFrame) (bots for the connection that signed in so, e.g. another account's in the shared list; default bots)
 * onSend gets a fourth argument `reply(frame)`: the answer to exactly the connection that sent the frame.
 */
export async function start(browser, o = {}) {
    const ctx = await browser.newContext({
        viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light',
        locale: o.locale ?? 'en-US',
    });
    await ctx.route(/^https?:\/\/test\.local\//, (r) => {
        let p = new URL(r.request().url()).pathname;
        if (p === '/') p = '/index.html';
        // The relay's public state (o.health), as the login form asks for it
        if (p === '/health') return r.fulfill({ body: JSON.stringify(o.health ?? { ok: true }), contentType: 'application/json' });
        const file = VENDOR[p] || path.join(WEBAPP, p);
        if (!fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
        return r.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const sent = [];
    const state = {
        bots: o.bots ?? [bot('pdf', 'PDF-Reader')], groups: o.groups ?? [], history: o.history ?? {},
        online: o.online ?? ['desk'], states: o.states ?? {}, activity: o.activity ?? {}, activeChats: o.activeChats ?? {},
    };
    const push = (f) => page.evaluate((f) => window.__ws && window.__ws.push(f), f).catch(() => undefined);
    /** To one connection of the page (the shared list opens one per further account, webapp/js/others.js). */
    const pushTo = (id, f) => page.evaluate(([id, f]) => window.__sockets && window.__sockets[id] && window.__sockets[id].push(f), [id, f]).catch(() => undefined);
    const sendBots = () => push({ type: 'bots', machine: 'desk', bots: state.bots, groups: state.groups, states: state.states, activity: state.activity, activeChats: state.activeChats, approvals: [] });
    await page.exposeFunction('__sent', async (f, id) => {
        sent.push(f);
        const reply = (frame) => (id === undefined ? push(frame) : pushTo(id, frame));
        if (f.type === 'auth') {
            // `auth`: the test plays the relay's answer (refusal, new device key); default: signed in
            const answer = o.auth ? o.auth(f) : { type: 'auth', ok: true };
            await reply(answer);
            if (answer.ok) {
                if (!o.agentsLater) await reply({ type: 'agents', online: state.online });
                const bots = o.botsFor?.(f) ?? state.bots;
                await reply({ type: 'bots', machine: 'desk', bots, groups: bots === state.bots ? state.groups : [], states: state.states, activity: state.activity, activeChats: state.activeChats, approvals: [] });
                await reply({ type: 'pinned', all: o.pinned ?? {} });
            }
        }
        if (f.type === 'history' && !o.ownHistory) {
            const all = state.history[f.chatId] ?? [];
            await reply({ type: 'history', chatId: f.chatId, entries: f.limit ? all.slice(-f.limit) : all, live: o.live?.[f.chatId] ?? [] });
        }
        await o.onSend?.(f, push, state, reply);
    });
    await ctx.addInitScript(([language, device]) => {
        // Only on the first load of the context: a reload keeps what the page stored itself
        if (!sessionStorage.getItem('__harness')) {
            sessionStorage.setItem('__harness', '1');
            if (device) localStorage.setItem('openfolk-device', device);
            if (language) localStorage.setItem('openfolk-language', language);
        }
        class FakeWS {
            constructor(url) {
                this.__id = (window.__sockets = window.__sockets || []).push(this) - 1;
                // The connections of the shared list (others.js) and of the QR sign-in are not the page's main connection
                if (!/others\.js|qr-login\.js/.test(new Error().stack || '')) window.__ws = this;
                window.__wsUrls = (window.__wsUrls || []).concat(url);
                this.readyState = 0;
                setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 10);
            }
            push(f) { if (this.onmessage) this.onmessage({ data: JSON.stringify(f) }); }
            send(raw) { window.__sent(JSON.parse(raw), this.__id); }
            close() { this.readyState = 3; }
        }
        FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
        window.WebSocket = FakeWS;
    }, [o.language === undefined ? 'en' : o.language, o.device === undefined ? 'test' : o.device]);
    if (o.before) await ctx.addInitScript(o.before);
    page.on('load', () => exposeModules(page));
    await page.goto(`${o.secure ? 'https' : 'http'}://test.local/${o.path ?? ''}`);
    await exposeModules(page);
    await page.waitForTimeout(500);
    const cdp = await ctx.newCDPSession(page);

    return {
        page, ctx, cdp, push, sent, state, errors, sendBots,
        wait: (ms) => page.waitForTimeout(ms),
        /** Tap a chat in the list (first row that contains the text). */
        async openChat(text) {
            await page.locator('#chat-list li', { hasText: text }).first().click();
            await page.waitForTimeout(300);
        },
        /** Finger: touch down, move in steps, lift. */
        async swipe(x0, y0, x1, y1, steps = 10, ms = 20) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
            for (let i = 1; i <= steps; i++) {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
                await page.waitForTimeout(ms);
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(400);
        },
        close: () => ctx.close(),
    };
}
