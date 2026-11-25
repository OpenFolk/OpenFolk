/* OpenFolk web app: images and videos of attachments shown in the app, fetched from the machine that holds them. */
import { t } from './i18n.js';
import { el, md, node } from './core.js';
import { codeBlocks } from './code-blocks.js';
import { send } from './e2e.js';

/** Object URLs of files fetched for display, by path; kept for the page's life so a re-render does not fetch again. */
const cache = new Map();
/** The files themselves by path, to read a text without fetching its object URL (Safari refuses that: "Load failed"). */
const blobs = new Map();
/** Fetches under way: path → waiting callers. */
const waiting = new Map();
const TIMEOUT_MS = 90_000;

/** An image without a preview (a bot's send_file) up to this size is fetched for the bubble itself. */
export const INLINE_IMAGE_MAX = 8 * 1024 * 1024;

export const isVideo = (a) => /^video\/(mp4|webm|quicktime)$/.test(a.type || '') || /\.(mp4|webm|mov|m4v)$/i.test(a.name || '');

/**
 * The file of an attachment as an object URL, from the machine it lives on (file_get); one request per path.
 * @param {{ path: string, machine?: string, type?: string }} a
 * @returns {Promise<string>}
 */
export function fileUrl(a) {
    const known = cache.get(a.path);
    if (known) return Promise.resolve(known);
    return new Promise((resolve, reject) => {
        const list = waiting.get(a.path);
        const entry = { resolve, reject, timer: setTimeout(() => fail(a.path, new Error(t('media.timeout'))), TIMEOUT_MS) };
        if (list) { list.push(entry); return; }
        waiting.set(a.path, [entry]);
        send({ type: 'file_get', path: a.path }, a.machine);
    });
}

function fail(path, e) {
    const list = waiting.get(path) || [];
    waiting.delete(path);
    for (const w of list) { clearTimeout(w.timer); w.reject(e); }
}

/** connection.js: a "file" frame; true when it was fetched for display here. */
export function mediaArrived(f) {
    const list = waiting.get(f.path);
    if (!list) return false;
    waiting.delete(f.path);
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: f.mime });
    const url = URL.createObjectURL(blob);
    cache.set(f.path, url);
    blobs.set(f.path, blob);
    for (const w of list) { clearTimeout(w.timer); w.resolve(url); }
    return true;
}

/** A Markdown file (plans, notes, READMEs): read in the app instead of downloaded. */
export const isMarkdown = (a) => /^text\/(markdown|x-markdown)$/.test(a.type || '') || /\.(md|markdown)$/i.test(a.name || '');

/** Shows a Markdown attachment formatted, like a bot's answer; "Save" still hands over the file. */
export async function showMarkdown(a) {
    await fileUrl(a);
    const text = await blobs.get(a.path).text();
    el.docTitle.textContent = a.name;
    el.docContent.innerHTML = md(text);
    codeBlocks(el.docContent);
    el.docSave.onclick = () => send({ type: 'file_get', path: a.path }, a.machine);
    el.docView.hidden = false;
    el.docContent.parentElement.scrollTop = 0;
}

/** The URL if the file is here already (no request). */
export const cachedUrl = (path) => cache.get(path) || '';

/** Loads `img` from the machine once it scrolls into view, so a long history does not fetch every picture at once. */
export function loadWhenVisible(img, a) {
    const load = () => fileUrl(a).then((url) => { img.src = url; }, () => img.closest('.attachment')?.classList.add('failed'));
    if (cachedUrl(a.path)) { img.src = cachedUrl(a.path); return; }
    if (!('IntersectionObserver' in window)) { void load(); return; }
    const io = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void load();
    }, { rootMargin: '200px' });
    io.observe(img);
}

/** The large player over the page; a tap beside the video or Escape closes it and stops it. */
export function showVideo(url, name) {
    let o = document.getElementById('video-view');
    if (!o) {
        o = node('div', 'overlay image-view video-view');
        o.id = 'video-view';
        const video = /** @type {HTMLVideoElement} */ (document.createElement('video'));
        video.controls = true;
        video.playsInline = true;
        o.appendChild(video);
        o.addEventListener('click', (ev) => { if (ev.target === o) closeVideo(); });
        document.body.appendChild(o);
    }
    const video = /** @type {HTMLVideoElement} */ (o.querySelector('video'));
    video.src = url;
    video.title = name || '';
    o.hidden = false;
    void video.play().catch(() => undefined);
}

/** Closes the player; returns whether it was open. */
export function closeVideo() {
    const o = document.getElementById('video-view');
    if (!o || o.hidden) return false;
    const video = /** @type {HTMLVideoElement} */ (o.querySelector('video'));
    video.pause();
    o.hidden = true;
    return true;
}
