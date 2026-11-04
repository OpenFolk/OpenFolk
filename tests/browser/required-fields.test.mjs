// The bot editor marks what saving needs: a star on the name, the folder and the repository (one of the two is enough,
// a note says so), and the folder and repository inputs carry aria-required.
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
    check('a star on name, folder and repository, none on the machine', stars['editor-name'] === '" *"' && stars['editor-folder'] === '" *"' && stars['editor-repo'] === '" *"' && stars['editor-machine'] === 'none', stars);
    check('folder and repository are aria-required', (await p.getAttribute('#editor-folder', 'aria-required')) === 'true' && (await p.getAttribute('#editor-repo', 'aria-required')) === 'true');
    check('a note says one of folder and repository is enough', await p.isVisible('[data-i18n="editor.requiredNote"]') && (await p.textContent('[data-i18n="editor.requiredNote"]')).includes('a folder or a repository is enough'));
    await h.close();
}
