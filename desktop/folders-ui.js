// The list of folders bots may work in (ALLOWED_ROOTS), shared by the window "Allowed folders" (folders.html) and the
// setup page. Nothing is saved here: the page reads the list with `get()` and hands it to the main process.
// `texts` come from the main process (English or German).
'use strict';

/**
 * @param {HTMLElement} root where the list is built
 * @param {{ roots: string[], home: string, defaultRoot: string, env: string, texts: Record<string, string> }} info
 *   roots: the folders in the profile's .env; home: the user folder; defaultRoot: the folder bots get when none is
 *   chosen (the app never leaves the list empty); env: the value of a ALLOWED_ROOTS environment variable, which the
 *   backend prefers over the .env
 * @returns {{ get: () => string[], error: (text: string) => void }}
 */
window.mountFolders = function mountFolders(root, { roots, home, defaultRoot, env, texts }) {
    const list = [...roots];
    const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
    const make = (tag, className, text) => {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const plain = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    /** The whole user folder or a drive's root holds far more than a bot needs. */
    const wide = (p) => plain(p) === plain(home) || plain(p) === '' || /^[a-z]:$/.test(plain(p));

    root.textContent = '';
    if (env) root.append(make('p', 'warn', fill(texts.foldersEnvWarn, { value: env })));
    const ul = make('ul', 'folder-list');
    const fallback = make('p', 'folder-default', fill(texts.foldersDefault, { default: defaultRoot }));
    const notes = make('div', 'folder-notes');
    const problem = make('p', 'error');
    const add = make('button', 'secondary folder-add', texts.foldersAdd);
    add.type = 'button';
    root.append(ul, fallback, notes, add, problem);

    function render(note) {
        ul.textContent = '';
        for (const folder of list) {
            const li = make('li');
            const remove = make('button', 'secondary folder-remove', texts.foldersRemove);
            remove.type = 'button';
            remove.addEventListener('click', () => {
                list.splice(list.indexOf(folder), 1);
                problem.textContent = '';
                // The row does not vanish: without a folder the own folder applies, and the list says so
                render(list.length ? '' : fill(texts.foldersLastRemoved, { default: defaultRoot }));
            });
            li.append(make('span', 'folder-path', folder), remove);
            ul.append(li);
        }
        if (!list.length) {
            const li = make('li', 'folder-standard');
            li.append(make('span', 'folder-path', defaultRoot), make('span', 'folder-tag', texts.foldersDefaultTag));
            ul.append(li);
        }
        fallback.hidden = list.length > 0;
        notes.textContent = '';
        if (note) notes.append(make('p', 'note', note));
        for (const folder of list.filter(wide)) notes.append(make('p', 'warn folder-wide', fill(texts.foldersWide, { folder })));
    }

    add.addEventListener('click', async () => {
        problem.textContent = '';
        const folder = await window.openfolkDesktop.pickFolder();
        if (folder && !list.includes(folder)) list.push(folder);
        render();
    });

    render();
    return { get: () => [...list], error: (text) => { problem.textContent = text; } };
};
