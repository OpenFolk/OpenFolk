// The bot editor marks what saving needs: a star on the name only. Folder and repository may stay empty, a note says
// that the bot then gets a folder of its own.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader')] });
    const p = h.page;
    await h.openChat('PDF');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    await p.click('#info-edit-top');
    await h.wait(200);
    const stars = await p.evaluate(() => Object.fromEntries(['editor-name', 'editor-folder', 'editor-repo', 'editor-machine'].map((id) => {
        const span = document.getElementById(id).closest('label').querySelector(':scope > span[data-i18n]');
        return [id, getComputedStyle(span, '::after').content];
    })));
    check('a star on the name only', stars['editor-name'] === '" *"' && stars['editor-folder'] === 'none' && stars['editor-repo'] === 'none' && stars['editor-machine'] === 'none', stars);
    check('folder and repository are not aria-required', (await p.getAttribute('#editor-folder', 'aria-required')) === null && (await p.getAttribute('#editor-repo', 'aria-required')) === null);
    check('a note says both may stay empty', await p.isVisible('[data-i18n="editor.requiredNote"]') && (await p.textContent('[data-i18n="editor.requiredNote"]')).includes('a folder of its own'));
    await h.close();
}
