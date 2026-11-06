// The desktop app's allowed folders (ALLOWED_ROOTS): what the main process writes into the profile's .env and how it
// restarts the backend (backend.js, with a stand-in for Electron), the window "Allowed folders" (folders.html) and the
// list on the setup page. The pages run without Electron here; a stand-in for the bridge of preload.js records calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = (name) => pathToFileURL(path.join(ROOT, 'desktop', name)).href;

/** backend.js asks Electron for the profile folder: here a folder of its own, removed again at the end. */
function loadBackend(profile) {
    const load = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return { app: { getPath: () => profile, isPackaged: false, getVersion: () => '0.0.0', on: () => undefined } };
        return load.call(this, request, ...rest);
    };
    try {
        return createRequire(import.meta.url)(path.join(ROOT, 'desktop', 'backend.js'));
    } finally {
        Module._load = load;
    }
}

export default async function ({ check }) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-roots-'));
    try {
        const backend = loadBackend(profile);
        const envFile = path.join(profile, '.env');
        const read = () => fs.readFileSync(envFile, 'utf8');

        backend.setProfileEnv('ALLOWED_ROOTS', 'C:/Work;D:/Projects');
        check('folders: no .env yet, the line is created', read() === 'ALLOWED_ROOTS=C:/Work;D:/Projects\n', read());
        check('folders: read back as a list', backend.profileRoots().join('|') === 'C:/Work|D:/Projects', backend.profileRoots());

        fs.writeFileSync(envFile, '# my settings\r\nRELAY_URL=https://relay.example.test\r\nALLOWED_ROOTS=C:/Old\r\nMACHINE_NAME=desk\r\n');
        backend.setProfileEnv('ALLOWED_ROOTS', 'C:/New');
        check('folders: an existing line is replaced, the other lines stay', read() === '# my settings\r\nRELAY_URL=https://relay.example.test\r\nALLOWED_ROOTS=C:/New\r\nMACHINE_NAME=desk\r\n', read());
        backend.setProfileEnv('ALLOWED_ROOTS', '');
        check('folders: an empty list removes the line (the default of the backend applies), nothing else', read() === '# my settings\r\nRELAY_URL=https://relay.example.test\r\nMACHINE_NAME=desk\r\n' && backend.profileRoots().length === 0, read());

        backend.setProfileEnv('ALLOWED_ROOTS', 'C:/Team #1;D:/x');
        check('folders: a folder with " #" is quoted so the .env does not cut it short', read().includes("ALLOWED_ROOTS='C:/Team #1;D:/x'") && backend.profileRoots().join('|') === 'C:/Team #1|D:/x', read());

        // What the backend reads (dotenv, local/src/config.ts) must be exactly what was written
        const dotenv = createRequire(import.meta.url)('dotenv');
        const tricky = [
            String.raw`C:\Team #1\new`, String.raw`C:\Team#1\tab`, String.raw`C:\Team #1\new;D:\OneDrive - TUBIX Computer Systeme\Projekte`,
            String.raw`C:\My Docs\a b`, String.raw`C:\temp\r\n\t`, String.raw`C:\it's #1`, 'C:/a "b" #c', String.raw`C:\a=b;E:\c`, ' C:/leading space',
        ];
        for (const value of tricky) {
            fs.writeFileSync(envFile, 'RELAY_URL=https://relay.example.test\nMACHINE_NAME=desk\n');
            backend.setProfileEnv('ALLOWED_ROOTS', value);
            const parsed = dotenv.parse(fs.readFileSync(envFile));
            check(`folders: dotenv reads ${JSON.stringify(value)} back unchanged, the other lines stay`, parsed.ALLOWED_ROOTS === value && parsed.MACHINE_NAME === 'desk' && parsed.RELAY_URL === 'https://relay.example.test', parsed);
            check(`folders: the app reads ${JSON.stringify(value)} back too`, backend.profileRoots().join(';') === value.trim(), backend.profileRoots());
            backend.setProfileEnv('ALLOWED_ROOTS', 'C:/Plain');
            check('folders: replacing the quoted line leaves a plain one', read().includes('ALLOWED_ROOTS=C:/Plain\n') && !read().includes("'"));
        }
        check('folders: a value with both \' and ` is refused, nothing written', (() => { try { backend.setProfileEnv('ALLOWED_ROOTS', "C:/a' #`b"); return false; } catch { return read().includes('C:/Plain'); } })());

        // The restart: the request the backend answers once no bot is working; the app starts it again by itself
        const data = path.join(profile, 'data');
        fs.mkdirSync(data, { recursive: true });
        const request = path.join(data, 'restart.request');
        let b = new backend.Backend(0);
        b.child = {};
        b.exited = new Promise((resolve) => setTimeout(resolve, 30));
        check('folders: the backend ends within the wait: "restarted", with a request, and not as "stopping"', (await b.restartWhenIdle(2000)) === 'restarted' && fs.existsSync(request) && !b.stopping);
        fs.rmSync(request, { force: true });
        b = new backend.Backend(0);
        b.child = {};
        b.exited = new Promise(() => undefined);
        check('folders: a bot still works: "waiting", the request stays', (await b.restartWhenIdle(60)) === 'waiting' && fs.existsSync(request));
        fs.rmSync(request, { force: true });
        b = new backend.Backend(0);
        b.useTask = true;
        check('folders: the scheduled task runs the backend: the request only, answer "waiting"', (await b.restartWhenIdle()) === 'waiting' && fs.existsSync(request));
        b = new backend.Backend(0);
        let started = 0;
        b.start = () => { started++; };
        check('folders: no backend running: started right away', (await b.restartWhenIdle()) === 'restarted' && started === 1);

        // The texts of the pages
        const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').split('\n');
        const en = main.findIndex((l) => l === '    en: {');
        const de = main.findIndex((l) => l === '    de: {');
        const keys = (from, to) => new Set(main.slice(from, to).flatMap((l) => { const m = /^\s{8}(\w+): /.exec(l); return m ? [m[1]] : []; }));
        const [inEn, inDe] = [keys(en, de), keys(de, main.length)];
        const used = ['folders.html', 'setup.html'].flatMap((n) => [...fs.readFileSync(path.join(ROOT, 'desktop', n), 'utf8').matchAll(/data-i18n="(folders\w+)"/g)].map((m) => m[1]));
        const own = ['foldersMenu', 'foldersDefault', 'foldersDefaultTag', 'foldersLastRemoved', 'foldersWide', 'foldersAdd', 'foldersRemove', 'foldersEnvWarn', 'foldersSaved', 'foldersWaiting', 'foldersNotFolder', 'foldersBadChars', 'foldersPickTitle'];
        const missing = [...used, ...own].filter((k) => !inEn.has(k) || !inDe.has(k));
        check('folders: every text exists in English and in German', used.length >= 6 && missing.length === 0, missing);
        const files = fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8');
        check('folders: the new files are part of the package', ['folders.html', 'folders.js', 'folders-ui.js', 'folders-ui.css'].every((n) => files.includes(`"${n}"`)));

        const browser = await chromium.launch();
        try {
            const texts = {
                foldersTitle: 'Allowed folders', foldersIntro: 'Intro', foldersDefault: 'No folder chosen: the own folder {default}, not your whole user folder.', foldersDefaultTag: 'default',
                foldersLastRemoved: 'The last folder stays: {default} applies.', foldersWide: '{folder} is very wide.', foldersAdd: 'Add folder …', foldersRemove: 'Remove',
                foldersSave: 'Save', foldersClose: 'Close', foldersSaved: 'Saved.', foldersWaiting: 'Saved, waiting for the bot.', foldersEnvWarn: 'ALLOWED_ROOTS is set ({value}) and wins.',
                foldersSetupSummary: 'Folders (optional)', foldersSetupHint: 'Hint {default}', setupHint: 'OpenFolk {version}',
            };
            const open = async (file, info, answers = {}) => {
                const context = await browser.newContext({ bypassCSP: true });
                await context.addInitScript(`
                    window.__calls = [];
                    window.__answers = ${JSON.stringify(answers)};
                    window.openfolkDesktop = {
                        info: async () => ({ mode: '', language: 'en', version: '0.0.0', ...${JSON.stringify(info)}, texts: ${JSON.stringify(texts)} }),
                        foldersInfo: async () => ({ language: 'en', ...${JSON.stringify(info)}, texts: ${JSON.stringify(texts)} }),
                        pickFolder: async () => { window.__calls.push(['pick']); return window.__answers.pick || ''; },
                        saveFolders: async (list) => { window.__calls.push(['save', list]); return window.__answers.save || { state: 'restarted' }; },
                        chooseLocal: async (list) => { window.__calls.push(['local', list]); return window.__answers.local || {}; },
                        saveAddress: async () => ({}), joinServer: async () => ({}),
                        qrJoinStart: async () => ({}), qrJoinStop: async () => ({}), onQrJoin: () => {},
                    };`);
                const p = await context.newPage();
                const errors = [];
                p.on('pageerror', (e) => errors.push(e.message));
                await p.goto(page(file));
                await p.waitForSelector(file === 'folders.html' ? '#folders .folder-add' : '#setup-folders .folder-add', { state: 'attached' });
                return { p, context, errors, calls: () => p.evaluate(() => window.__calls) };
            };
            const rows = (p) => p.$$eval('.folder-path', (n) => n.map((x) => x.textContent));

            // The window
            let s = await open('folders.html', { roots: ['C:/Work'], home: 'C:/Users/sven', defaultRoot: 'C:/Users/sven/OpenFolk', env: '' }, { pick: 'D:/Projects' });
            let p = s.p;
            check('folders window: the folders of the .env are listed, no note about the default', (await rows(p)).join() === 'C:/Work' && !(await p.isVisible('.folder-default')) && !(await p.isVisible('.warn')), await rows(p));
            await p.click('.folder-add');
            check('folders window: "Add folder" asks the native dialog and lists the answer', (await rows(p)).join() === 'C:/Work,D:/Projects', await rows(p));
            await p.click('.folder-add');
            check('folders window: the same folder is not listed twice', (await rows(p)).length === 2);
            await p.click('.folder-list li:first-child .folder-remove');
            check('folders window: "Remove" takes it out', (await rows(p)).join() === 'D:/Projects');
            await p.click('#save');
            await p.waitForFunction(() => document.getElementById('status').textContent !== '');
            check('folders window: "Save" hands over the list, says the backend restarts', JSON.stringify((await s.calls()).filter((c) => c[0] === 'save')) === '[["save",["D:/Projects"]]]' && (await p.textContent('#status')) === 'Saved.', await s.calls());
            await p.click('.folder-list li .folder-remove');
            check('folders window: the last folder is not just deleted: the own folder takes its row, with a note', (await rows(p)).join() === 'C:/Users/sven/OpenFolk' && (await p.isVisible('.folder-standard')) && (await p.textContent('.folder-notes .note')).includes('C:/Users/sven/OpenFolk') && (await p.textContent('.folder-default')).includes('not your whole user folder'), await rows(p));
            await p.click('#save');
            await p.waitForFunction(() => window.__calls.filter((c) => c[0] === 'save').length === 2);
            check('folders window: that row has no "Remove", saving hands over an empty list (the app writes the own folder)', (await p.$$('.folder-standard .folder-remove')).length === 0 && JSON.stringify((await s.calls()).filter((c) => c[0] === 'save')[1]) === '["save",[]]', await s.calls());
            check('folders window: no script errors', s.errors.length === 0, s.errors);
            await s.context.close();

            // The user folder or a drive root is allowed, with a clear warning
            s = await open('folders.html', { roots: ['C:\\Users\\sven\\'], home: 'C:/Users/sven', defaultRoot: 'C:/Users/sven/OpenFolk', env: '' }, { pick: 'D:\\' });
            p = s.p;
            check('folders window: the whole user folder (other spelling, trailing slash) is listed with a warning', (await p.$$('.folder-wide')).length === 1 && (await p.textContent('.folder-wide')).includes('C:\\Users\\sven\\'), await rows(p));
            await p.click('.folder-add');
            check('folders window: a drive root is warned about as well, the other folders are not', (await p.$$('.folder-wide')).length === 2, await rows(p));
            await p.click('.folder-list li:first-child .folder-remove');
            await p.click('.folder-list li:first-child .folder-remove');
            await p.evaluate(() => { window.__answers.pick = 'C:/Users/sven/Work'; });
            await p.click('.folder-add');
            check('folders window: a folder below the user folder is fine, no warning', (await p.$$('.folder-wide')).length === 0 && (await rows(p)).join() === 'C:/Users/sven/Work', await rows(p));
            await s.context.close();

            s = await open('folders.html', { roots: [], home: 'C:/Users/sven', defaultRoot: 'C:/Users/sven/OpenFolk', env: 'C:/Everything' }, { save: { state: 'waiting' } });
            p = s.p;
            check('folders window: a ALLOWED_ROOTS environment variable is pointed out, with its value', (await p.isVisible('.warn')) && (await p.textContent('.warn')).includes('C:/Everything'));
            await p.click('#save');
            await p.waitForFunction(() => document.getElementById('status').textContent !== '');
            check('folders window: a bot still works: the note says the restart waits', (await p.textContent('#status')) === 'Saved, waiting for the bot.');
            await s.context.close();

            s = await open('folders.html', { roots: [], home: 'C:/Users/sven', defaultRoot: 'C:/Users/sven/OpenFolk', env: '' }, { save: { error: 'C:/x is not a folder that exists.' } });
            await s.p.click('#save');
            await s.p.waitForFunction(() => document.querySelector('#folders .error').textContent !== '');
            check('folders window: a refused list shows the reason and no success', (await s.p.textContent('#folders .error')) === 'C:/x is not a folder that exists.' && (await s.p.textContent('#status')) === '');
            await s.context.close();

            // The setup page
            s = await open('setup.html', { roots: [], home: 'C:/Users/sven', defaultRoot: 'C:/Users/sven/OpenFolk', envRoots: '' }, { pick: 'E:/Code' });
            p = s.p;
            check('setup page: the way "on this computer" offers the folders, folded, with the default named', (await p.isVisible('details.folders-setup summary')) && !(await p.isVisible('#setup-folders')) && (await p.$eval('.folder-default', (n) => n.textContent)).includes('C:/Users/sven/OpenFolk') && (await p.textContent('[data-i18n="foldersSetupHint"]')).includes('C:/Users/sven/OpenFolk'));
            await p.click('details.folders-setup summary');
            await p.click('#setup-folders .folder-add');
            await p.click('#local');
            await p.waitForFunction(() => window.__calls.some((c) => c[0] === 'local'));
            check('setup page: starting on this computer hands over the chosen folders', JSON.stringify((await s.calls()).find((c) => c[0] === 'local')) === '["local",["E:/Code"]]', await s.calls());
            check('setup page: no script errors', s.errors.length === 0, s.errors);
            await s.context.close();
        } finally {
            await browser.close();
        }
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
}
