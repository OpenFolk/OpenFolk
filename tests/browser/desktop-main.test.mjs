// The desktop app's main process (desktop/main.js) with a stand-in for Electron:
// the folders for the bots are never empty and the window is marked for the web app. No browser is needed here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Starts main.js against a profile folder; returns what the stand-in recorded. */
function startApp(profile, config) {
    const state = { handlers: {}, whenReady: null, win: null, tray: null, menu: null, restarts: 0, joined: [], ai: [], aiAnswers: {}, signIns: [], appEvents: {}, webEvents: {}, protocols: [], dialogs: [], answer: 0, scripts: [] };
    if (config) fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config));
    class Win {
        constructor(o = {}) {
            // The hidden window the app signs in with (signInAway): recorded apart, it is not the app's window
            if (o.show === false && !o.width) {
                this.loads = [];
                this.destroyed = false;
                this.webContents = { setUserAgent: () => undefined, setWindowOpenHandler: () => undefined };
                state.signIns.push(this);
                return;
            }
            this.loads = [];
            this.events = {};
            this.hidden = false;
            this.agent = '';
            this.webContents = { userAgent: 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44', setUserAgent: (a) => { this.agent = a; }, setWindowOpenHandler: () => undefined, on: (name, fn) => { state.webEvents[name] = fn; }, executeJavaScript: (code) => { state.scripts.push(code); return Promise.resolve(/localStorage/.test(code) || undefined); }, getURL: () => 'file:///setup.html' };
            state.win = this;
        }
        once() {}
        on(name, fn) { this.events[name] = fn; }
        loadFile(file, o) { this.loads.push({ file: path.basename(file), query: o?.query || {} }); }
        loadURL(url) { this.loads.push({ url }); }
        show() { this.hidden = false; }
        hide() { this.hidden = true; }
        focus() {}
        isMinimized() { return false; }
        isMaximized() { return false; }
        isFullScreen() { return false; }
        getBounds() { return {}; }
        isDestroyed() { return this.destroyed === true; }
        destroy() { this.destroyed = true; }
    }
    class Tray {
        constructor() { state.tray = this; this.events = {}; }
        setToolTip() {}
        setContextMenu() {}
        on(name, fn) { this.events[name] = fn; }
    }
    const electron = {
        app: {
            name: 'OpenFolk', isPackaged: false, getPath: () => profile, getLocale: () => 'en', getVersion: () => '0.0.0',
            setPath: () => undefined, requestSingleInstanceLock: () => true, on: (name, fn) => { state.appEvents[name] = fn; }, quit: () => undefined,
            setAsDefaultProtocolClient: (scheme) => { state.protocols.push(scheme); return true; },
            whenReady: () => new Promise((resolve) => { state.whenReady = resolve; }),
            getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: () => undefined,
        },
        BrowserWindow: Object.assign(Win, { fromWebContents: () => null }),
        Tray,
        Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (t) => { state.menu = t; } },
        shell: { openExternal: () => undefined },
        ipcMain: { handle: (name, fn) => { state.handlers[name] = fn; } },
        nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
        dialog: { showMessageBox: async (w, o) => { state.dialogs.push(o); return { response: state.answer }; }, showOpenDialog: async () => ({ canceled: true }) },
        session: { defaultSession: { setPermissionRequestHandler: () => undefined } },
        protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
    };
    const require = createRequire(import.meta.url);
    const load = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return electron;
        if (request === './handover.js') return { watchHandovers: () => undefined };
        if (request === './updater.js') return { startUpdates: () => undefined, updateMenuItems: () => [] };
        if (request === './backend.js') {
            const real = load.call(this, request, ...rest);
            class Backend {
                constructor(port) { this.port = port; this.url = `http://127.0.0.1:${port}/`; this.child = {}; }
                start() {}
                ready() { return Promise.resolve(true); }
                settled() { return Promise.resolve(true); }
                pairingUrl() { return Promise.resolve(`${this.url}#pair=fresh&e2e=${'k'.repeat(43)}`); }
                restartWhenIdle() { state.restarts++; return Promise.resolve('restarted'); }
                stop() { return Promise.resolve(); }
            }
            // Joining redeems the invitation at the relay: recorded here instead
            // Step 3 runs local/tools/ai-setup.mjs: recorded here, with the answers the test sets
            const aiSetup = (command, o = {}) => {
                state.ai.push(o.input ? [command, o.input] : command);
                const r = state.aiAnswers[command] ?? { ok: true };
                for (const line of r.lines ?? []) o.onLine?.(line);
                return { child: {}, stop: () => state.ai.push('kill'), done: Promise.resolve(r.last ?? r) };
            };
            return { ...real, Backend, aiSetup, freePort: async () => 4711, joinServer: async (link) => { state.joined.push(link); return { ok: true, machine: 'desk' }; } };
        }
        return load.call(this, request, ...rest);
    };
    for (const name of ['main.js', 'backend.js', 'task.js']) delete require.cache[path.join(ROOT, 'desktop', name)];
    try {
        require(path.join(ROOT, 'desktop', 'main.js'));
    } finally {
        Module._load = load;
    }
    return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const fromSetup = { senderFrame: { url: 'file:///setup.html' } };

export default async function ({ check }) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-main-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-home-'));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = process.env.USERPROFILE = home;
    try {
        // Running "on this computer"
        let app = startApp(profile, { mode: 'local', localPort: 4711, paired: 'http://127.0.0.1:4711/' });
        app.whenReady();
        await settle();
        const last = () => app.win.loads[app.win.loads.length - 1];
        check('main: the app shows the web app of the backend', last().url === `openfolk://app/#relay=${encodeURIComponent('http://127.0.0.1:4711')}`, app.win.loads);
        check('main: "on this computer" marks the user agent for the web app', app.win.agent === 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44 OpenFolkLocal', app.win.agent);
        check('main: no folder in the .env yet: the own folder is created and written, never the whole user folder', fs.readFileSync(path.join(profile, '.env'), 'utf8') === `ALLOWED_ROOTS=${path.join(home, 'OpenFolk')}\n` && fs.statSync(path.join(home, 'OpenFolk')).isDirectory(), fs.existsSync(path.join(profile, '.env')) && fs.readFileSync(path.join(profile, '.env'), 'utf8'));

        // Choosing "on this computer" again, with the list emptied: the own folder, and the running backend restarts
        const r = await app.handlers['choose-local'](fromSetup, []);
        check('main: "start on this computer" with no folder writes the own folder and restarts the running backend', !r.error && fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${path.join(home, 'OpenFolk')}`) && app.restarts === 1, { r, restarts: app.restarts });
        const other = path.join(home, 'Work');
        fs.mkdirSync(other);
        const saveFolders = await app.handlers['folders-save'](fromSetup, [other]);
        check('main: the window "Allowed folders" saves its list', !saveFolders.error && fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${other}`), saveFolders);
        await app.handlers['folders-save'](fromSetup, []);
        check('main: saving an empty list falls back to the own folder', fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${path.join(home, 'OpenFolk')}`));
        const info = await app.handlers['folders-info'](fromSetup);
        check('main: the folder pages learn the own folder', info.defaultRoot === path.join(home, 'OpenFolk'), info.defaultRoot);

        // Setup links: the app takes openfolk:// links, and a setup link only into an OpenFolk that is new
        check('main: the app registers for openfolk:// links', app.protocols.includes('openfolk'), app.protocols);
        const setupLink = 'https://relay.example.test/#setup=abc&e2e=key';
        const viaBrowser = ['openfolk.exe', `openfolk://setup?link=${encodeURIComponent(setupLink)}`];
        const bots = path.join(profile, 'data', 'accounts', 'main', 'bots.json');
        fs.mkdirSync(path.dirname(bots), { recursive: true });
        fs.writeFileSync(bots, JSON.stringify([{ id: 'own' }]));
        app.appEvents['second-instance']({}, viaBrowser);
        await settle();
        check('main: a setup link into an OpenFolk with bots of its own is refused with the reason', /bots of its own/.test(app.dialogs.at(-1)?.message ?? ''), app.dialogs.at(-1));
        const pasted = await app.handlers['join-server'](fromSetup, setupLink);
        check('main: so is one pasted on the setup page', /bots of its own/.test(pasted.error ?? ''), pasted);
        fs.writeFileSync(bots, '[]');
        app.answer = 1;
        const shown = app.dialogs.length;
        app.appEvents['second-instance']({}, viaBrowser);
        await settle();
        const ask = app.dialogs[shown];
        check('main: a new OpenFolk asks first, naming the relay', ask?.type === 'question' && ask.message.includes('relay.example.test') && app.dialogs.length === shown + 1, ask);
        check('main: cancelled, nothing joined', !fs.readFileSync(path.join(profile, '.env'), 'utf8').includes('RELAY_URL'));
        // Pasted into the web app ("Add", the sign-in's address field): the page hands it over as a navigation
        let stopped = false;
        const asked = app.dialogs.length;
        app.webEvents['will-navigate']({ preventDefault: () => { stopped = true; } }, viaBrowser[1]);
        await settle();
        check('main: a setup link from the web app is asked the same way, the page stays', stopped && app.dialogs[asked]?.type === 'question' && app.dialogs[asked].message.includes('relay.example.test'), app.dialogs[asked]);
        app.answer = 0;

        // Joined a relay (by invitation or setup link): the way back
        fs.appendFileSync(path.join(profile, '.env'), ['RELAY_URL=wss://relay.example.test/ws/agent', 'AGENT_TOKEN=abc', 'E2E_KEY=def', 'MACHINE_NAME=desk-2', ''].join('\n'));
        app.appEvents['second-instance']({}, viaBrowser);
        await settle();
        check('main: a setup link into an OpenFolk joined elsewhere says to disconnect first', /connected to relay\.example\.test/.test(app.dialogs.at(-1)?.message ?? ''), app.dialogs.at(-1));
        app = startApp(profile, { mode: 'local', localPort: 4711, paired: 'http://127.0.0.1:4711/' });
        app.whenReady();
        await settle();
        const fileMenu = app.menu?.[0]?.submenu ?? [];
        const disconnect = fileMenu.find((i) => /Disconnect from relay\.example\.test/.test(i.label ?? ''));
        check('main: the menu offers to disconnect from the relay', !!disconnect, fileMenu.map((i) => i.label));
        await disconnect?.click();
        await settle();
        const after = fs.readFileSync(path.join(profile, '.env'), 'utf8');
        check('main: disconnected, the lines of the relay leave the .env, the folders stay', !/RELAY_URL|AGENT_TOKEN|E2E_KEY|MACHINE_NAME/.test(after) && after.includes('ALLOWED_ROOTS='), after);
        check('main: … and the app runs on this computer again', !app.menu?.[0]?.submenu?.some((i) => /Disconnect/.test(i.label ?? '')));

        /**
         * Waits until `test` holds, at most 12 seconds: a relay's answer comes asynchronously, after a real DNS lookup of
         * *.example.test, which a CI runner may take seconds for (main.js gives up on the relay after 10).
         */
        const until = async (test) => { for (let i = 0; i < 240 && !test(); i++) await settle(); };

        // Connected to a relay: a display-only window
        app = startApp(profile, { mode: 'relay', url: 'https://relay.example.test/' });
        app.whenReady();
        // The start page comes after the relay's answer; a page shown later ends a hidden sign-in begun before it, so
        // the steps below wait for it (on the CI runner it came only after the invitation, which then went nowhere)
        await until(() => app.win?.loads.length);
        check('main: a display-only window carries no mark', app.win.agent === 'Mozilla/5.0 OpenFolk/0.1.2 Electron/44', app.win.agent);

        // The setup page's one field with an invitation into an account: the app signs in at that relay out of sight,
        // the setup page stays (no web app in between)
        const beforeInvite = app.win.loads.length;
        const invited = await app.handlers['join-server'](fromSetup, 'https://other.example.test/#pair=tok&e2e=key');
        await until(() => app.signIns.at(-1)?.loads?.length);
        const hidden = app.signIns.at(-1);
        const page = hidden?.loads.at(-1)?.url ?? '';
        check('main: an invitation pasted on the setup page signs in at that relay out of sight, no join', invited.signingIn === true && page.startsWith('openfolk://app/#relay=') && page.includes(encodeURIComponent('https://other.example.test')) && page.includes('pair=tok'), { invited, page });
        check('main: … the window stays on the setup page meanwhile', app.win.loads.length === beforeInvite, app.win.loads.slice(beforeInvite));
        check('main: … and the app stays on that relay', JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8')).url === 'https://other.example.test/');
        const fromHidden = { senderFrame: { url: `openfolk://app/#relay=${encodeURIComponent('https://other.example.test')}` }, sender: hidden.webContents };
        await app.handlers['machine-wanted'](fromHidden, 'https://other.example.test');
        await app.handlers['machine-none'](fromHidden);
        await settle();
        check('main: signed in, nothing to set up here: the hidden window goes, the window shows the web app, signed in (no pairing link again)', hidden.destroyed
            && app.win.loads.at(-1)?.url === `openfolk://app/#relay=${encodeURIComponent('https://other.example.test')}`, app.win.loads.at(-1));

        // Refused before it got in (a used link): back to step 1 of the setup with the reason, not the web app's sign-in
        await app.handlers['join-server'](fromSetup, 'https://other.example.test/#pair=used&e2e=key');
        await until(() => app.signIns.at(-1) !== hidden && app.signIns.at(-1)?.loads?.length);
        const refusedIn = app.signIns.at(-1);
        await app.handlers['sign-in-needed']({ ...fromHidden, sender: refusedIn.webContents }, 'This pairing link is no longer valid.', 'pairing_invalid');
        await settle();
        const back = app.win.loads.at(-1);
        check('main: the hidden sign-in refused: the setup page again, step 1 with the way used and the reason', refusedIn.destroyed && back?.file === 'setup.html'
            && back.query.method === 'invite' && back.query.refused === 'This pairing link is no longer valid.' && !String(back?.url ?? '').includes('pair=used'), back);
        check('main: a request of the window itself does not end anything', !(await app.handlers['sign-in-needed'](fromSetup)));

        // The address with a password: the same out of sight; the hidden web app takes the password once
        const withPassword = await app.handlers['save-address'](fromSetup, 'other.example.test', 'secret');
        await until(() => app.signIns.at(-1) !== refusedIn && app.signIns.at(-1)?.loads?.length);
        const pwIn = app.signIns.at(-1);
        const pwFrom = { ...fromHidden, sender: pwIn.webContents };
        check('main: the address with a password signs in out of sight too', withPassword.signingIn === true && pwIn !== refusedIn && !pwIn.destroyed, withPassword);
        check('main: … the hidden web app gets the password', (await app.handlers['take-password'](pwFrom, 'https://other.example.test')) === 'secret');
        // Asked for a TOTP code: the user is needed, the window gets the password once more
        await app.handlers['sign-in-needed'](pwFrom, 'Enter the code.', 'totp_required');
        await settle();
        check('main: … a code needed: the window takes over and gets the password again', pwIn.destroyed && (await app.handlers['take-password'](fromHidden, 'https://other.example.test')) === 'secret');
        const noPassword = await app.handlers['save-address'](fromSetup, 'other.example.test', '');
        check('main: without a password the web app asks for it in the window', !noPassword.signingIn, noPassword);
        await settle();

        // After that sign-in the web app asks for this computer: the second step of the setup
        const KEY = 'k'.repeat(43);
        const appPage = { senderFrame: { url: `openfolk://app/#relay=${encodeURIComponent('https://other.example.test')}` } };
        const config = () => JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'));
        await app.handlers['join-server'](fromSetup, `https://other.example.test/#pair=tok2&e2e=${KEY}`);
        const wanted = await app.handlers['machine-wanted'](appPage, 'https://other.example.test');
        check('main: signed in as a window, this computer is still to be set up, the key of the invitation known', wanted.wanted === true && wanted.key === true, wanted);
        check('main: … not for another relay, nor for a page that is not the app', (await app.handlers['machine-wanted'](appPage, 'https://evil.example.test')).wanted === false
            && (await app.handlers['machine-wanted']({ senderFrame: { url: 'https://other.example.test/' } }, 'https://other.example.test')).wanted === false);
        await app.handlers['machine-offer'](appPage, { relay: 'https://evil.example.test', kind: 'setup', token: 'x'.repeat(32) });
        await app.handlers['machine-offer'](appPage, { relay: 'https://other.example.test', kind: 'pair', token: 'x'.repeat(32) });
        check('main: an offer for another relay or of another kind is ignored', app.win.loads.at(-1)?.file !== 'setup.html');
        await app.handlers['machine-offer'](appPage, { relay: 'https://other.example.test', kind: 'setup', token: 'x'.repeat(32) });
        check('main: the invitation of the relay for this computer opens the second step, the hidden sign-in ends', app.signIns.every((w) => w.destroyed) && app.win.loads.at(-1)?.file === 'setup.html' && app.win.loads.at(-1).query.step === 'machine' && (await app.handlers.info(fromSetup)).step === 'machine', app.win.loads.at(-1));
        check('main: … and is not asked for twice', (await app.handlers['machine-wanted'](appPage, 'https://other.example.test')).wanted === false);
        check('main: step 2 has no "Not now"', !app.handlers['machine-skip']);
        await app.handlers['join-server'](fromSetup, `https://other.example.test/#pair=tok3&e2e=${KEY}`);
        check('main: a new sign-in offers the computer again', (await app.handlers['machine-wanted'](appPage, 'https://other.example.test')).wanted === true);
        await app.handlers['machine-offer'](appPage, { relay: 'https://other.example.test', kind: 'setup', token: 'y'.repeat(32) });
        const work = path.join(home, 'Work');
        const beforeSetup = app.win.loads.length;
        const set = await app.handlers['machine-setup'](fromSetup, [work]);
        await settle();
        check('main: "Set up this computer": the folders written, the invitation redeemed with the key', !set.error && fs.readFileSync(path.join(profile, '.env'), 'utf8').includes(`ALLOWED_ROOTS=${work}`)
            && app.joined.at(-1) === `https://other.example.test/#setup=${'y'.repeat(32)}&e2e=${KEY}`, { set, joined: app.joined });
        check('main: … and the backend runs here from now on', config().mode === 'local' && app.win.agent.endsWith('OpenFolkLocal') && (await app.handlers.info(fromSetup)).step === '', config());
        // Pages of the relay asked for earlier (relayPage) may still arrive late here: only what came after an action counts
        const loadedSince = (n, test) => app.win.loads.slice(n).some(test);
        const appPageLoad = (l) => String(l.url || '').startsWith('openfolk://app/');
        check('main: … and the setup page stays for step 3 below it, no page in between', !loadedSince(beforeSetup, (l) => l.file === 'setup.html' || l.url === 'about:blank'), app.win.loads.slice(beforeSetup));
        check('main: step 3 asks the backend here for its engines', (await app.handlers['ai-status'](fromSetup)).ok === true && app.ai.at(-1) === 'status');
        app.aiAnswers.key = { ok: false, error: 'invalid' };
        const restartsAtKey = app.restarts;
        const refused = await app.handlers['ai-key'](fromSetup, ' sk-ant-bad ');
        await settle();
        check('main: step 3: a refused key is said, nothing restarts', refused.error === 'Anthropic does not know this key.' && JSON.stringify(app.ai.at(-1)) === '["key","sk-ant-bad"]' && app.restarts === restartsAtKey && !app.ai.includes('kill'), { refused, ai: app.ai });
        check('main: step 3: an empty key is not sent', (await app.handlers['ai-key'](fromSetup, '  ')).error === 'Paste the key first.' && JSON.stringify(app.ai.at(-1)) === '["key","sk-ant-bad"]');
        const sent = [];
        const restartsBefore = app.restarts;
        app.aiAnswers.claude = { lines: [{ state: 'browser' }, { state: 'done' }], last: { state: 'done' } };
        const beforeClaude = app.win.loads.length;
        await app.handlers['ai-login']({ ...fromSetup, sender: { isDestroyed: () => false, send: (...a) => sent.push(a) } }, 'claude');
        await settle();
        check('main: step 3: the Claude sign-in tells the page, then the backend restarts and the web app comes', sent.some((a) => a[0] === 'ai-state' && a[1].state === 'browser')
            && app.ai.includes('on claude') && app.restarts === restartsBefore + 1 && loadedSince(beforeClaude, appPageLoad)
            && !loadedSince(beforeClaude, (l) => l.file === 'setup.html'), { sent, ai: app.ai, restarts: app.restarts, loads: app.win.loads.slice(beforeClaude) });
        check('main: step 3 is done: its requests are refused now', (await app.handlers['ai-key'](fromSetup, 'sk-ant-x')).error === 'not allowed');
        // "Change setup …", "Without setup" again: step 3 once more, and "Not now"
        await app.handlers['choose-local'](fromSetup, []);
        await settle();
        const beforeSkip = app.win.loads.length;
        const restartsAtSkip = app.restarts;
        const codexSent = [];
        const codexPage = { ...fromSetup, sender: { isDestroyed: () => false, send: (...x) => codexSent.push(x) } };
        app.aiAnswers['device codex'] = { lines: [{ state: 'code', url: 'https://auth.example.test/device', code: 'ABCD-1234' }], last: { state: 'failed', message: 'expired' } };
        await app.handlers['ai-login'](codexPage, 'codex');
        await app.handlers['ai-login'](codexPage, 'cursor');
        await settle();
        check('main: step 3: Codex signs in with a device code; failed, nothing switched on and nothing restarts', app.ai.includes('device codex') && !app.ai.includes('on codex') && !app.ai.some((c) => String(c).includes('cursor'))
            && codexSent.some((x) => x[1].state === 'code' && x[1].code === 'ABCD-1234') && codexSent.some((x) => x[1].state === 'failed' && x[1].message === 'expired') && app.restarts === restartsAtSkip, { ai: app.ai, codexSent });
        await app.handlers['ai-skip'](fromSetup);
        await settle();
        check('main: step 3: "Not now" shows the web app without a restart', app.restarts === restartsAtSkip && loadedSince(beforeSkip, appPageLoad), app.win.loads.slice(beforeSkip));
        await app.handlers['choose-local'](fromSetup, []);
        await settle();
        await app.handlers['ai-cancel'](fromSetup);
        check('main: step 1 changed at step 3: it ends there, its requests are refused', (await app.handlers['ai-key'](fromSetup, 'sk-ant-x')).error === 'not allowed' && (await app.handlers['ai-status'](fromSetup)).ok === false);
        check('main: step 3 is only for the setup page', (await app.handlers['ai-key']({ senderFrame: { url: 'https://evil.example.test/' } }, 'sk-ant-x')).error === 'not allowed');

        // A machine's invitation pasted in the first step: the second step asks for the folders before it joins
        app = startApp(profile, {});
        app.whenReady();
        await settle();
        const before2 = app.joined.length;
        const pastedJoin = await app.handlers['join-server'](fromSetup, 'npm run join -- "https://relay.example.test/#join=abc&e2e=key"');
        check('main: the invitation of a machine waits for the second step, step 1 shown with its method', !pastedJoin.error && app.joined.length === before2 && app.win.loads.at(-1)?.query?.step === 'machine'
            && app.win.loads.at(-1)?.query?.method === 'invite', app.win.loads.at(-1));
        await app.handlers['machine-drop'](fromSetup);
        check('main: step 1 changed then: the invitation is dropped', Boolean((await app.handlers['machine-setup'](fromSetup, [])).error) && app.joined.length === before2, app.joined);
        await app.handlers['join-server'](fromSetup, 'npm run join -- "https://relay.example.test/#join=abc&e2e=key"');
        await app.handlers['machine-setup'](fromSetup, []);
        check('main: … which joins with it', app.joined.at(-1) === 'https://relay.example.test/#join=abc&e2e=key', app.joined);
        app = startApp(profile, { mode: 'relay', url: 'https://other.example.test/' });
        app.whenReady();
        await settle();

        // The web app's keyboard shortcuts as a menu: shown with their keys, the keys themselves left to the page
        const go = app.menu?.find((m) => m.label === 'Go')?.submenu ?? [];
        const keys = go.filter((i) => i.accelerator);
        check('main: the menu "Go" lists the shortcuts of the web app', keys.find((i) => i.label.startsWith('Command palette'))?.accelerator === 'CmdOrCtrl+K' && keys.length >= 10, go.map((i) => `${i.label} ${i.accelerator ?? ''}`));
        check('main: … without registering them, so a key does not run twice', keys.every((i) => i.registerAccelerator === false), keys.map((i) => i.registerAccelerator));
        check('main: … and none takes the zoom keys', !keys.some((i) => /\+(Plus|-|=|0)$/.test(i.accelerator)), keys.map((i) => i.accelerator));
        go.find((i) => i.accelerator === 'CmdOrCtrl+B').click();
        check('main: a menu entry hands its command to the page', /CustomEvent\('openfolk:command', \{ detail: "sidebar" \}\)/.test(app.scripts.at(-1) ?? ''), app.scripts.at(-1));

        // A profile from before the folder list: its bots worked in the whole user folder, and still do after the update
        const before = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-main-before-'));
        try {
            fs.mkdirSync(path.join(before, 'data'));
            fs.writeFileSync(path.join(before, 'data', 'bots.json'), '[]');
            fs.writeFileSync(path.join(before, '.env'), 'E2E_KEY=x\n');
            app = startApp(before, { mode: 'local', localPort: 4712, paired: 'http://127.0.0.1:4712/' });
            app.whenReady();
            await settle();
            const env = fs.readFileSync(path.join(before, '.env'), 'utf8');
            check('main: a profile used before keeps the whole user folder, written down, its other lines kept', env.includes(`ALLOWED_ROOTS=${home}`) && env.includes('E2E_KEY=x'), env);
        } finally {
            fs.rmSync(before, { recursive: true, force: true });
        }
    } finally {
        for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
}
