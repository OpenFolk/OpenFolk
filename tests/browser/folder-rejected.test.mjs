// Saving a bot with a folder outside the machine's ALLOWED_ROOTS: the backend's refusal (a plain message without a
// code, English or German) gets a note on how to allow more folders. Other errors do not.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    let answer = { ok: false, message: 'Folder is not under C:/Users/sven: D:/Work/site' };
    const h = await start({
        online: ['desk'],
        bots: [bot('web', 'Web Wanda')],
        async onSend(f, push) {
            if (f.type === 'folder_check' && f.folder === 'D:/Work/site') await push({ type: 'folder_checked', asked: f.folder, ...answer });
        },
    });
    const p = h.page;
    const error = () => p.evaluate(() => { const e = document.getElementById('editor-error'); return { visible: !e.hidden, text: e.textContent, head: e.firstChild.textContent, roots: e.querySelector('.error-roots')?.textContent || '', hint: e.querySelector('.error-hint')?.textContent || '' }; });
    const save = async () => {
        await p.fill('#editor-folder', 'D:/Work/site');
        await h.wait(100);
        await p.evaluate(() => document.getElementById('editor-form').requestSubmit());
        await h.wait(300);
        return error();
    };

    await p.evaluate(() => openEditor(null));
    await p.fill('#editor-name', 'Site');
    let e = await save();
    check('the refusal names the refused folder first, the allowed ones as a list below', e.visible && e.head === 'This folder is not allowed: D:/Work/site' && e.roots === 'Allowed folders:\nC:/Users/sven', e);
    check('and how to allow more: ALLOWED_ROOTS, separator, restart', e.hint.includes('ALLOWED_ROOTS') && e.hint.includes('";"') && e.hint.includes('restart'), e.hint);
    check('where: the desktop app\'s .env, a user variable, Docker', e.hint.includes('%APPDATA%\\OpenFolk\\.env') && e.hint.includes('user environment variable') && e.hint.includes('WORK_DIR'), e.hint);

    answer = { ok: false, message: 'Ordner liegt nicht unter C:/Users/sven: D:/Work/site' };
    e = await save();
    check('German refusal of a backend in German: split the same, worded by the language of the app', e.visible && e.head === 'This folder is not allowed: D:/Work/site' && e.roots === 'Allowed folders:\nC:/Users/sven' && e.hint.includes('ALLOWED_ROOTS'), e);

    await p.evaluate(() => { localStorage.setItem('openfolk-language', 'de'); });
    await p.reload();
    await h.wait(500);
    await p.evaluate(() => openEditor(null));
    await p.fill('#editor-name', 'Site');
    e = await save();
    check('app in German: heading and list in German', e.head === 'Dieser Ordner ist nicht freigegeben: D:/Work/site' && e.roots === 'Freigegebene Ordner:\nC:/Users/sven', e);
    await p.evaluate(() => { localStorage.setItem('openfolk-language', 'en'); });
    await p.reload();
    await h.wait(500);
    await p.evaluate(() => openEditor(null));
    await p.fill('#editor-name', 'Site');

    answer = { ok: false, message: 'Folder is not under C:/Users/sven, D:/Projects, E:/x: y: D:/Work/site' };
    e = await save();
    check('several allowed folders: one per line, the refused one after the last ": "', e.head === 'This folder is not allowed: D:/Work/site' && e.roots === 'Allowed folders:\nC:/Users/sven\nD:/Projects\nE:/x: y', e);

    // The message as the backend builds it from ALLOWED_ROOTS=C:\Users\sven\OpenFolk;C:\OneDrive\OneDrive - TUBIX …;D:\Work\my-site
    answer = { ok: false, message: String.raw`Folder is not under C:\Users\sven\OpenFolk, C:\OneDrive\OneDrive - TUBIX Computer Systeme\Projekte, D:\Work\my-site: D:/Work/site` };
    e = await save();
    check('Windows folders with spaces and hyphens: every folder gets its own line, whole', e.head === 'This folder is not allowed: D:/Work/site'
        && e.roots === String.raw`Allowed folders:
C:\Users\sven\OpenFolk
C:\OneDrive\OneDrive - TUBIX Computer Systeme\Projekte
D:\Work\my-site`, e);

    answer = { ok: false, message: 'Folder is not under somewhere' };
    e = await save();
    check('a message that cannot be split stays as it is, the note remains', e.text.startsWith('Folder is not under somewhere') && e.roots === '' && e.hint.includes('ALLOWED_ROOTS'), e);

    answer = { ok: false, message: 'There is no folder D:/Work/site.' };
    e = await save();
    check('another error: no note', e.visible && e.text === 'There is no folder D:/Work/site.' && e.hint === '', e);
    await h.close();
}
