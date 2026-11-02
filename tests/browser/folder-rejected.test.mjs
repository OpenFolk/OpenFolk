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
    const error = () => p.evaluate(() => { const e = document.getElementById('editor-error'); return { visible: !e.hidden, text: e.textContent, hint: e.querySelector('.error-hint')?.textContent || '' }; });
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
    check('the refusal is shown with the allowed folders from the message', e.visible && e.text.startsWith('Folder is not under C:/Users/sven') && e.text.includes('D:/Work/site'), e);
    check('and how to allow more: ALLOWED_ROOTS, separator, restart', e.hint.includes('ALLOWED_ROOTS') && e.hint.includes('";"') && e.hint.includes('restart'), e.hint);
    check('where: the desktop app\'s .env, a user variable, Docker', e.hint.includes('%APPDATA%\\OpenFolk\\.env') && e.hint.includes('user environment variable') && e.hint.includes('WORK_DIR'), e.hint);

    answer = { ok: false, message: 'Ordner liegt nicht unter C:/Users/sven: D:/Work/site' };
    e = await save();
    check('German refusal: the same note', e.visible && e.text.startsWith('Ordner liegt nicht unter') && e.hint.includes('ALLOWED_ROOTS'), e);

    answer = { ok: false, message: 'There is no folder D:/Work/site.' };
    e = await save();
    check('another error: no note', e.visible && e.text === 'There is no folder D:/Work/site.' && e.hint === '', e);
    await h.close();
}
