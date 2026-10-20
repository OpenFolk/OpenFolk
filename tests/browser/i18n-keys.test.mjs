// Dictionaries of the web app (no browser needed): the same keys in English and German with the same placeholders,
// and every key used in the scripts (t, tn, key constants) and in index.html (data-i18n*) exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'webapp');

export default async function ({ check }) {
    const dicts = {};
    for (const language of ['en', 'de']) {
        // The dictionaries are ES modules that import registerDictionary; run them with a stand-in instead
        const source = fs.readFileSync(path.join(WEBAPP, 'i18n', `${language}.js`), 'utf8').replace(/^import .*$/m, '');
        new Function('registerDictionary', source)((l, d) => { dicts[l] = d; });
    }
    const en = Object.keys(dicts.en);
    const de = Object.keys(dicts.de);
    check('same keys in en.js and de.js', en.length === de.length && en.every((k) => k in dicts.de), { onlyEn: en.filter((k) => !(k in dicts.de)), onlyDe: de.filter((k) => !(k in dicts.en)) });
    const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const mismatch = en.filter((k) => k in dicts.de && placeholders(dicts.en[k]) !== placeholders(dicts.de[k]));
    check('same placeholders in both languages', mismatch.length === 0, mismatch);

    const js = fs.readdirSync(path.join(WEBAPP, 'js')).map((f) => fs.readFileSync(path.join(WEBAPP, 'js', f), 'utf8')).join('\n');
    const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');
    const has = (k) => k in dicts.en;
    const plural = (k) => has(`${k}.one`) && has(`${k}.other`);
    const namespaces = new Set(en.map((k) => k.split('.')[0]));
    const t = [...js.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
    const tn = [...js.matchAll(/\btn\('([^']+)'/g)].map((m) => m[1]);
    const attrs = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
    const literals = [...js.matchAll(/'([a-z][a-zA-Z]*\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]).filter((k) => namespaces.has(k.split('.')[0]));
    const missing = [...t.filter((k) => !has(k)), ...tn.filter((k) => !plural(k)), ...attrs.filter((k) => !has(k)), ...literals.filter((k) => !has(k) && !plural(k))];
    check(`every used key exists (${new Set([...t, ...tn, ...attrs, ...literals]).size} keys used, ${en.length} in the dictionaries)`, missing.length === 0, missing);
}
