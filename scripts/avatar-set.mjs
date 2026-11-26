// Draws the set of profile pictures the bot editor offers under "AI avatar" (webapp/avatars/) with the kit the backend
// draws suggested pictures with (local/src/avatar-kit.ts), rendered to PNG with the Playwright that the browser tests
// use. Deterministic: running it again gives the same files.   node scripts/avatar-set.mjs [--sheet out.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { composeAvatar, sanitizeChoice } from '../local/src/avatar-kit.ts';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'webapp', 'avatars');
const SIZE = 512;

// ---------------------------------------------------------------- The set: twelve women, twelve men
// Business look (blazer, shirt, turtleneck), no beards, mostly light skin; the hair and the colors vary
const WOMEN = [
    { skin: 'light', hair: 'blond', style: 'long', cloth: 'navy', collar: 'blazer', bg: 'sand', earrings: true },
    { skin: 'fair', hair: 'dark', style: 'curly', cloth: 'charcoal', collar: 'shirt', bg: 'mist' },
    { skin: 'light', hair: 'red', style: 'bob', cloth: 'slate', collar: 'turtleneck', bg: 'sage', glasses: 'round' },
    { skin: 'medium', hair: 'black', style: 'bun', cloth: 'camel', collar: 'blazer', bg: 'clay', earrings: true },
    { skin: 'light', hair: 'brown', style: 'bun', cloth: 'offwhite', collar: 'shirt', bg: 'lavender', glasses: 'rect' },
    { skin: 'fair', hair: 'black', style: 'ponytail', cloth: 'plum', collar: 'turtleneck', bg: 'slate' },
    { skin: 'fair', hair: 'white', style: 'bob', cloth: 'navy', collar: 'blazer', bg: 'stone', earrings: true },
    { skin: 'light', hair: 'chestnut', style: 'long', cloth: 'burgundy', collar: 'turtleneck', bg: 'rose', earrings: true },
    { skin: 'medium', hair: 'chestnut', style: 'wavy', cloth: 'forest', collar: 'blazer', bg: 'mist' },
    { skin: 'light', hair: 'black', style: 'bob', cloth: 'slate', collar: 'shirt', bg: 'sage', glasses: 'round' },
    { skin: 'tan', hair: 'dark', style: 'curly', cloth: 'charcoal', collar: 'blazer', bg: 'sand', earrings: true },
    { skin: 'fair', hair: 'blond', style: 'long', cloth: 'charcoal', collar: 'turtleneck', bg: 'lavender' },
];
const MEN = [
    { skin: 'fair', hair: 'brown', style: 'short', cloth: 'navy', collar: 'blazer', bg: 'sage' },
    { skin: 'medium', hair: 'black', style: 'crop', cloth: 'charcoal', collar: 'shirt', bg: 'lavender' },
    { skin: 'light', hair: 'blond', style: 'side', cloth: 'offwhite', collar: 'shirt', bg: 'sand', glasses: 'rect' },
    { skin: 'fair', hair: 'dark', style: 'curly', cloth: 'slate', collar: 'turtleneck', bg: 'clay' },
    { skin: 'light', hair: 'grey', style: 'bald', cloth: 'burgundy', collar: 'blazer', bg: 'slate', glasses: 'round' },
    { skin: 'tan', hair: 'dark', style: 'quiff', cloth: 'camel', collar: 'shirt', bg: 'rose' },
    { skin: 'fair', hair: 'grey', style: 'short', cloth: 'navy', collar: 'blazer', bg: 'stone', glasses: 'round' },
    { skin: 'medium', hair: 'black', style: 'crop', cloth: 'slate', collar: 'shirt', bg: 'mist' },
    { skin: 'light', hair: 'chestnut', style: 'side', cloth: 'plum', collar: 'turtleneck', bg: 'sage' },
    { skin: 'light', hair: 'red', style: 'short', cloth: 'forest', collar: 'blazer', bg: 'mist' },
    { skin: 'fair', hair: 'black', style: 'short', cloth: 'charcoal', collar: 'turtleneck', bg: 'sand', glasses: 'rect' },
    // wavy hair comes with a layer down to the chin; the men's keeps the fringe only
    { skin: 'fair', hair: 'brown', style: 'wavy', cloth: 'offwhite', collar: 'shirt', bg: 'sage', noBack: true },
];
const SET = [
    ...WOMEN.map((a, i) => ({ ...a, file: `f${String(i + 1).padStart(2, '0')}.png`, voice: 'female' })),
    ...MEN.map((a, i) => ({ ...a, file: `m${String(i + 1).padStart(2, '0')}.png`, voice: 'male' })),
];
const svgOf = (a, size) => composeAvatar(sanitizeChoice(a), size, Boolean(a.noBack));

// ---------------------------------------------------------------- Rendering
const sheet = process.argv.indexOf('--sheet') > 0 ? process.argv[process.argv.indexOf('--sheet') + 1] : '';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
for (const a of SET) {
    await page.setContent(`<body style="margin:0">${svgOf(a, SIZE)}</body>`);
    fs.writeFileSync(path.join(OUT, a.file), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE } }));
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(SET.map(({ file, voice }) => ({ file, voice })), null, 2) + '\n');
if (sheet) {
    await page.setViewportSize({ width: 6 * 160, height: 4 * 160 });
    await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(6,160px)">${SET.map((a) => svgOf(a, 160)).join('')}</body>`);
    fs.writeFileSync(sheet, await page.screenshot({ type: 'png', fullPage: true }));
}
await browser.close();
const bytes = SET.reduce((n, a) => n + fs.statSync(path.join(OUT, a.file)).size, 0);
console.log(`${SET.length} avatars in ${OUT} (${Math.round(bytes / 1024)} KB)${sheet ? `, sheet ${sheet}` : ''}`);
