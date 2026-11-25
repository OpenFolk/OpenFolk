// Renders the OpenFolk logo (../webapp/icons/icon.svg) into the source images @capacitor/assets expects in assets/
// and into the Play Store graphics in store/graphics/. Run by `npm run assets`, which then lets @capacitor/assets
// write the iOS app icon, the Android launcher icons (legacy and adaptive) and the splash screens.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(MOBILE, 'assets');
const STORE = path.join(MOBILE, 'store', 'graphics');

const ORANGE = '#d97757';
const DARK = '#1f1e1d';
/** The speech bubble of icon.svg without its rounded background; centred on (64, 67) in a 128 box. */
const BUBBLE = (dots = ORANGE) => `
  <path d="M26 44a12 12 0 0 1 12-12h52a12 12 0 0 1 12 12v30a12 12 0 0 1-12 12H58l-18 16v-16h-2a12 12 0 0 1-12-12z" fill="#fff"/>
  <circle cx="48" cy="59" r="6" fill="${dots}"/><circle cx="64" cy="59" r="6" fill="${dots}"/><circle cx="80" cy="59" r="6" fill="${dots}"/>`;
/** Bubble scaled by `scale` around the centre of a 128 box. */
const centred = (scale, dots) => `<g transform="translate(64 64) scale(${scale}) translate(-64 -67)">${BUBBLE(dots)}</g>`;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const square = (size, bg, scale, dots) =>
    svg(size, size, `${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}<g transform="scale(${size / 128})">${centred(scale, dots)}</g>`);

/** PNG without alpha channel where the stores require it (App Store icon, Play icon). */
async function render(file, image, { opaque = false } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let pipeline = sharp(image);
    if (opaque) pipeline = pipeline.flatten({ background: ORANGE });
    await pipeline.png().toFile(file);
    console.log(path.relative(MOBILE, file));
}

// iOS rounds the corners itself, so the icon fills the whole square.
await render(path.join(ASSETS, 'icon-only.png'), square(1024, ORANGE, 1.1), { opaque: true });
// Android adaptive icon: @capacitor/assets insets the layers by 16.7 %, which keeps the bubble inside the 66 dp safe
// zone of the 108 dp square the launcher masks.
await render(path.join(ASSETS, 'icon-foreground.png'), square(1024, null, 1));
await render(path.join(ASSETS, 'icon-background.png'), square(1024, ORANGE, 0));
await render(path.join(ASSETS, 'splash.png'), square(2732, ORANGE, 0.32));
await render(path.join(ASSETS, 'splash-dark.png'), square(2732, DARK, 0.32, DARK));

await render(path.join(STORE, 'play-icon-512.png'), square(512, ORANGE, 1.1), { opaque: true });
await render(
    path.join(STORE, 'feature-graphic-1024x500.png'),
    svg(1024, 500, `<rect width="1024" height="500" fill="${ORANGE}"/>
        <g transform="translate(150 110) scale(2.2)">${centred(1)}</g>
        <text x="470" y="290" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="110" font-weight="600" fill="#fff">OpenFolk</text>`),
    { opaque: true },
);
