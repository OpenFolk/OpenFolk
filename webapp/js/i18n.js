/* OpenFolk web app: translations. Loaded first; the dictionaries (i18n/en.js, i18n/de.js) register themselves
   right after it, everything else calls t() at run time. */

const LANGUAGES = ['en', 'de'];
const LOCALES = { en: 'en-US', de: 'de-DE' };
/** Language chosen by hand on this device ('' = automatic). */
export const LANGUAGE_KEY = 'openfolk-language';
/** Last language the backends reported (shared setting); remembered so the page starts in it without flicker. */
export const BACKEND_LANGUAGE_KEY = 'openfolk-language-backend';

export const i18n = { dictionaries: {}, language: 'en' };

export function registerDictionary(language, dictionary) {
    i18n.dictionaries[language] = dictionary;
}

export function readSetting(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

export function writeSetting(key, value) {
    try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
    } catch { /* private mode */ }
}

export const isLanguage = (l) => LANGUAGES.includes(l);

/** Language of the browser: German for 'de…', English otherwise. */
function browserLanguage() {
    const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    return /^de\b/i.test(list[0] || '') ? 'de' : 'en';
}

/** Order: chosen on this device, then the shared setting of the backends, then the browser. */
export function resolveLanguage() {
    const own = readSetting(LANGUAGE_KEY);
    if (isLanguage(own)) return own;
    const backend = readSetting(BACKEND_LANGUAGE_KEY);
    if (isLanguage(backend)) return backend;
    return browserLanguage();
}

/** Locale for dates and numbers ('en-US' / 'de-DE'). */
export function locale() {
    return LOCALES[i18n.language] || 'en-US';
}

/** Text for a key in the current language (English as fallback, the key itself as last resort); `{name}` placeholders. */
export function t(key, params) {
    const own = i18n.dictionaries[i18n.language] || {};
    const english = i18n.dictionaries.en || {};
    let text = key in own ? own[key] : key in english ? english[key] : key;
    if (params) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
    return text;
}

/** Plural: `<key>.one` for exactly 1, otherwise `<key>.other`; `{n}` is the count. */
export function tn(key, n, params) {
    return t(`${key}.${n === 1 ? 'one' : 'other'}`, Object.assign({ n }, params));
}

/** Static texts in the HTML: data-i18n (text), data-i18n-html (markup from the dictionary), data-i18n-title,
 *  data-i18n-placeholder, data-i18n-aria-label. A cloned pane is translated before it is attached.
 *  @param {ParentNode} [root] */
export function applyI18n(root = document) {
    for (const n of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n]'))) n.textContent = t(n.dataset.i18n);
    for (const n of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n-html]'))) n.innerHTML = t(n.dataset.i18nHtml);
    for (const n of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n-title]'))) n.title = t(n.dataset.i18nTitle);
    for (const n of /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-i18n-placeholder]'))) n.placeholder = t(n.dataset.i18nPlaceholder);
    for (const n of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n-aria-label]'))) n.setAttribute('aria-label', t(n.dataset.i18nAriaLabel));
    document.documentElement.lang = i18n.language;
}

/** Switches the language for this page; true if it changed. */
export function setLanguage(language) {
    const next = isLanguage(language) ? language : 'en';
    if (next === i18n.language) return false;
    i18n.language = next;
    document.documentElement.lang = next;
    return true;
}

i18n.language = resolveLanguage();
document.documentElement.lang = i18n.language;
