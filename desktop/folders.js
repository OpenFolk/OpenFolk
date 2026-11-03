// The window "Allowed folders …": the folders bots may work in. Save writes ALLOWED_ROOTS into the profile's .env and the
// main process restarts the backend, but only once no bot is working. Texts come from the main process.
'use strict';
const status = document.getElementById('status');
const save = document.getElementById('save');
let folders = null;
let texts = {};

window.openfolkDesktop.foldersInfo().then((info) => {
    texts = info.texts;
    document.documentElement.lang = info.language;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = texts[el.dataset.i18n] ?? el.textContent;
    document.title = texts.foldersTitle;
    folders = window.mountFolders(document.getElementById('folders'), info);
});

save.addEventListener('click', async () => {
    status.textContent = '';
    save.disabled = true;
    const r = await window.openfolkDesktop.saveFolders(folders.get());
    save.disabled = false;
    if (r.error) folders.error(r.error);
    else status.textContent = r.state === 'waiting' ? texts.foldersWaiting : texts.foldersSaved;
});

document.getElementById('close').addEventListener('click', () => window.close());
