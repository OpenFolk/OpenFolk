// Draws the set of profile pictures the bot editor offers under "AI avatar" (webapp/avatars/): flat vector portraits
// made from parts (skin, hair, eyes, clothes, glasses, beard, headphones), rendered to PNG with the Playwright that the
// browser tests use. Deterministic: running it again gives the same files.   node scripts/avatar-set.mjs [--sheet out.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'webapp', 'avatars');
const SIZE = 512;

// ---------------------------------------------------------------- Palette
const SKIN = [
    ['#f7dcc8', '#e4b99c'], ['#f2cba6', '#d9a67e'], ['#e3ad85', '#c48d63'], ['#c88d5c', '#a67244'], ['#9d6b44', '#7d5333'], ['#6e4a30', '#563826'],
];
const HAIR = { black: '#2a2522', dark: '#4a3226', brown: '#6b4a2f', chestnut: '#8d5b3a', blond: '#d8b063', light: '#e7cf96', red: '#b4532a', grey: '#9d9d9d', silver: '#d6d6d6' };
const BROW = { black: '#1e1a18', dark: '#3b281e', brown: '#52381f', chestnut: '#6b4328', blond: '#a8803a', light: '#b89a5c', red: '#8a3d1e', grey: '#777', silver: '#9a9a9a' };
const BG = { peach: '#ffe2d2', blue: '#d9e9ff', green: '#dff2d9', lilac: '#efe0f7', yellow: '#fff0c4', teal: '#d6f0f0', pink: '#fde0e6', sand: '#ece6da', periwinkle: '#dfe3f9', lime: '#e7f0d4' };
const CLOTH = { navy: '#2f4a7a', teal: '#2d7a78', maroon: '#8a3a4a', olive: '#6f7a3a', charcoal: '#3a3a40', mustard: '#c99a2e', white: '#f3f3f3', denim: '#4a6ea0', forest: '#2f6a4a', coral: '#d96a5a', plum: '#6a3a7a', grey: '#c9cdd3' };
const EYES = { brown: '#3b2a20', black: '#262626', blue: '#4a7fa8', green: '#5b8a4a', hazel: '#7a5a3a' };

/** Darkens (negative) or lightens a hex color by a fraction. */
function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- Parts (viewBox 256×256, the head's centre at 128,112)
const HEAD = { cx: 128, cy: 112, rx: 50, ry: 58 };

function body(a) {
    const c = CLOTH[a.cloth];
    const dark = shade(c, -0.18);
    const parts = [`<path d="M 22 256 C 22 204, 68 182, 128 182 C 188 182, 234 204, 234 256 Z" fill="${c}"/>`];
    switch (a.collar) {
        case 'tee':
            parts.push(`<path d="M 104 182 Q 128 204 152 182 Q 128 196 104 182 Z" fill="${dark}"/>`);
            break;
        case 'vneck':
            parts.push(`<path d="M 108 182 L 128 212 L 148 182 Z" fill="${SKIN[a.skin][1]}"/>`, `<path d="M 108 182 L 128 212 L 148 182" fill="none" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>`);
            break;
        case 'hoodie':
            parts.push(`<path d="M 98 184 C 88 200, 84 224, 86 256" fill="none" stroke="${dark}" stroke-width="9" stroke-linecap="round"/>`,
                `<path d="M 158 184 C 168 200, 172 224, 170 256" fill="none" stroke="${dark}" stroke-width="9" stroke-linecap="round"/>`,
                `<path d="M 116 200 L 114 236 M 140 200 L 142 236" stroke="#f2f2f2" stroke-width="3" stroke-linecap="round"/>`,
                `<circle cx="114" cy="238" r="3" fill="#f2f2f2"/><circle cx="142" cy="238" r="3" fill="#f2f2f2"/>`);
            break;
        case 'blazer':
            parts.push(`<path d="M 106 182 L 128 232 L 150 182 Z" fill="#f6f6f6"/>`,
                `<path d="M 108 182 L 128 238 L 98 256 L 92 200 Z" fill="${dark}"/>`, `<path d="M 148 182 L 128 238 L 158 256 L 164 200 Z" fill="${dark}"/>`);
            break;
        case 'shirt': {
            const light = a.cloth === 'white' ? '#ffffff' : shade(c, 0.35);
            const edge = a.cloth === 'white' ? '#cfcfcf' : dark;
            parts.push(`<path d="M 128 202 L 128 256" stroke="${edge}" stroke-width="2"/>`,
                `<circle cx="128" cy="222" r="2.2" fill="${edge}"/><circle cx="128" cy="242" r="2.2" fill="${edge}"/>`,
                `<path d="M 108 180 L 128 200 L 118 214 L 102 196 Z" fill="${light}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/>`,
                `<path d="M 148 180 L 128 200 L 138 214 L 154 196 Z" fill="${light}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/>`);
            break;
        }
    }
    return parts.join('');
}

/** The hair behind the head (long styles), drawn before the head; `noBack`: the fringe of the style only. */
function hairBack(a) {
    const c = HAIR[a.hair];
    if (a.noBack) return '';
    switch (a.style) {
        case 'bob': return `<rect x="70" y="64" width="116" height="106" rx="44" fill="${c}"/>`;
        case 'wavy': return `<rect x="70" y="64" width="116" height="104" rx="44" fill="${c}"/>`
            + [84, 100, 116, 132, 148, 164, 172].map((x, i) => `<circle cx="${x}" cy="${160 + (i % 2) * 6}" r="11" fill="${c}"/>`).join('');
        case 'long': return `<path d="M 72 104 C 70 52, 186 52, 184 104 L 192 206 C 192 222, 64 222, 64 206 Z" fill="${c}"/>`;
        case 'ponytail': return `<rect x="76" y="64" width="104" height="80" rx="40" fill="${c}"/><ellipse cx="186" cy="150" rx="15" ry="42" transform="rotate(-12 186 150)" fill="${c}"/><rect x="174" y="110" width="20" height="7" rx="3.5" fill="${shade(c, 0.3)}" transform="rotate(-12 184 113)"/>`;
        case 'afro': return `<circle cx="128" cy="100" r="76" fill="${c}"/>`;
        default: return '';
    }
}

/** The hair over the forehead and the top of the head. */
function hairFront(a) {
    const c = HAIR[a.hair];
    const cap = `<path d="M 76 104 C 74 60, 100 42, 128 42 C 156 42, 182 60, 180 104 C 176 90, 160 78, 128 78 C 96 78, 80 90, 76 104 Z" fill="${c}"/>`;
    switch (a.style) {
        case 'bald': return `<ellipse cx="116" cy="64" rx="16" ry="9" fill="#fff" opacity=".18"/>`;
        case 'crop': return `<path d="M 78 100 C 76 62, 100 46, 128 46 C 156 46, 180 62, 178 100 C 174 88, 158 82, 128 82 C 98 82, 82 88, 78 100 Z" fill="${c}"/>`;
        case 'side': return `<path d="M 76 108 C 72 58, 104 40, 134 42 C 162 44, 186 64, 180 100 C 178 86, 164 74, 138 80 C 112 86, 94 96, 86 116 C 82 112, 78 110, 76 108 Z" fill="${c}"/>`;
        case 'quiff': return cap + `<path d="M 108 50 C 118 28, 152 24, 166 46 C 152 40, 128 42, 108 50 Z" fill="${c}"/>`;
        case 'curly': return cap + [[84, 82], [96, 62], [112, 50], [128, 46], [144, 50], [160, 62], [172, 82], [80, 102], [176, 102], [102, 80], [128, 78], [154, 80]]
            .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="${c}"/>`).join('');
        case 'wavy': return cap + [[92, 96], [110, 84], [128, 82], [146, 84], [164, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${c}"/>`).join('');
        case 'bun': return cap + `<circle cx="128" cy="44" r="17" fill="${c}"/><circle cx="123" cy="39" r="5" fill="#fff" opacity=".15"/>`;
        default: return cap;
    }
}

function face(a) {
    const [skin, dark] = SKIN[a.skin];
    const lip = a.skin >= 4 ? '#8f4040' : '#c4605e';
    const eye = (x) => `<ellipse cx="${x}" cy="105" rx="8" ry="6" fill="#fff"/><circle cx="${x}" cy="105.5" r="4.6" fill="${EYES[a.eyes]}"/><circle cx="${x}" cy="105.5" r="2.2" fill="#1d1d1d"/><circle cx="${x - 1.6}" cy="103.6" r="1.4" fill="#fff"/>`;
    const brow = BROW[a.hair];
    return [
        `<circle cx="79" cy="114" r="9" fill="${skin}"/><circle cx="177" cy="114" r="9" fill="${skin}"/>`,
        `<circle cx="79" cy="114" r="4" fill="${dark}" opacity=".35"/><circle cx="177" cy="114" r="4" fill="${dark}" opacity=".35"/>`,
        `<ellipse cx="${HEAD.cx}" cy="${HEAD.cy}" rx="${HEAD.rx}" ry="${HEAD.ry}" fill="${skin}"/>`,
        `<circle cx="100" cy="128" r="8" fill="#ff7f7f" opacity=".2"/><circle cx="156" cy="128" r="8" fill="#ff7f7f" opacity=".2"/>`,
        a.freckles ? [[96, 122], [104, 130], [112, 124], [144, 124], [152, 130], [160, 122], [108, 134], [148, 134]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${dark}" opacity=".7"/>`).join('') : '',
        `<path d="M 98 92 Q 108 85 118 91" fill="none" stroke="${brow}" stroke-width="${a.brows || 3.4}" stroke-linecap="round"/>`,
        `<path d="M 138 91 Q 148 85 158 92" fill="none" stroke="${brow}" stroke-width="${a.brows || 3.4}" stroke-linecap="round"/>`,
        eye(108), eye(148),
        `<path d="M 128 110 C 126 118, 122 122, 124 125 Q 128 128 132 125" fill="none" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/>`,
        a.grin ? `<path d="M 113 137 Q 128 152 143 137 Z" fill="#fff" stroke="${lip}" stroke-width="2.6" stroke-linejoin="round"/>`
            : `<path d="M 114 138 Q 128 150 142 138" fill="none" stroke="${lip}" stroke-width="3" stroke-linecap="round"/>`,
    ].join('');
}

function beard(a) {
    const c = HAIR[a.hair];
    switch (a.beard) {
        case 'full': return `<path d="M 84 118 C 82 150, 98 178, 128 178 C 158 178, 174 150, 172 118 C 172 140, 160 154, 128 154 C 96 154, 84 140, 84 118 Z" fill="${c}"/>`
            + `<path d="M 112 130 C 118 124, 126 126, 128 130 C 130 126, 138 124, 144 130 C 138 134, 118 134, 112 130 Z" fill="${c}"/>`;
        case 'stubble': return `<path d="M 84 118 C 82 150, 98 176, 128 176 C 158 176, 174 150, 172 118 C 172 140, 160 154, 128 154 C 96 154, 84 140, 84 118 Z" fill="${c}" opacity=".22"/>`;
        case 'mustache': return `<path d="M 112 130 C 118 124, 126 126, 128 130 C 130 126, 138 124, 144 130 C 138 134, 118 134, 112 130 Z" fill="${c}"/>`;
        default: return '';
    }
}

function extras(a) {
    const parts = [];
    if (a.glasses === 'round') {
        parts.push(`<circle cx="108" cy="105" r="13" fill="#fff" fill-opacity=".12" stroke="#3a3a3a" stroke-width="2.6"/><circle cx="148" cy="105" r="13" fill="#fff" fill-opacity=".12" stroke="#3a3a3a" stroke-width="2.6"/>`,
            `<path d="M 121 104 Q 128 99 135 104 M 95 103 L 82 100 M 161 103 L 174 100" fill="none" stroke="#3a3a3a" stroke-width="2.6" stroke-linecap="round"/>`);
    }
    if (a.glasses === 'rect') {
        parts.push(`<rect x="94" y="95" width="28" height="20" rx="5" fill="#fff" fill-opacity=".12" stroke="#3a3a3a" stroke-width="2.6"/><rect x="134" y="95" width="28" height="20" rx="5" fill="#fff" fill-opacity=".12" stroke="#3a3a3a" stroke-width="2.6"/>`,
            `<path d="M 122 103 L 134 103 M 94 103 L 82 100 M 162 103 L 174 100" fill="none" stroke="#3a3a3a" stroke-width="2.6" stroke-linecap="round"/>`);
    }
    if (a.headphones) {
        parts.push(`<path d="M 66 112 C 64 42, 192 42, 190 112" fill="none" stroke="#2e2e33" stroke-width="7" stroke-linecap="round"/>`,
            `<rect x="56" y="98" width="20" height="32" rx="7" fill="#2e2e33"/><rect x="180" y="98" width="20" height="32" rx="7" fill="#2e2e33"/>`);
    }
    if (a.earrings) parts.push(`<circle cx="79" cy="126" r="3.6" fill="#e3b54a"/><circle cx="177" cy="126" r="3.6" fill="#e3b54a"/>`);
    return parts.join('');
}

export function avatarSvg(a, size = SIZE) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">`
        + `<rect width="256" height="256" fill="${BG[a.bg]}"/>`
        + body(a) + hairBack(a)
        + `<rect x="112" y="140" width="32" height="52" rx="10" fill="${SKIN[a.skin][1]}"/>`
        + face(a) + beard(a) + hairFront(a) + extras(a)
        + '</svg>';
}

// ---------------------------------------------------------------- The set: twelve women, twelve men
const WOMEN = [
    { skin: 0, hair: 'blond', style: 'long', eyes: 'blue', cloth: 'navy', collar: 'tee', bg: 'peach', earrings: true },
    { skin: 2, hair: 'dark', style: 'curly', eyes: 'brown', cloth: 'charcoal', collar: 'blazer', bg: 'blue', grin: true },
    { skin: 1, hair: 'red', style: 'bob', eyes: 'green', cloth: 'teal', collar: 'hoodie', bg: 'green', glasses: 'round' },
    { skin: 4, hair: 'black', style: 'afro', eyes: 'brown', cloth: 'coral', collar: 'tee', bg: 'yellow', earrings: true, grin: true },
    { skin: 0, hair: 'brown', style: 'bun', eyes: 'hazel', cloth: 'white', collar: 'shirt', bg: 'lilac', glasses: 'rect' },
    { skin: 3, hair: 'black', style: 'ponytail', eyes: 'black', cloth: 'plum', collar: 'hoodie', bg: 'teal', headphones: true },
    { skin: 1, hair: 'silver', style: 'bob', eyes: 'blue', cloth: 'navy', collar: 'blazer', bg: 'sand', earrings: true },
    { skin: 5, hair: 'black', style: 'crop', eyes: 'brown', cloth: 'mustard', collar: 'tee', bg: 'pink', earrings: true, grin: true },
    { skin: 2, hair: 'chestnut', style: 'wavy', eyes: 'hazel', cloth: 'forest', collar: 'vneck', bg: 'periwinkle' },
    { skin: 0, hair: 'black', style: 'bob', eyes: 'brown', cloth: 'denim', collar: 'shirt', bg: 'lime', glasses: 'round', freckles: true },
    { skin: 3, hair: 'red', style: 'curly', eyes: 'green', cloth: 'olive', collar: 'tee', bg: 'peach', grin: true },
    { skin: 1, hair: 'light', style: 'long', eyes: 'blue', cloth: 'grey', collar: 'hoodie', bg: 'blue', headphones: true },
];
const MEN = [
    { skin: 1, hair: 'brown', style: 'short', eyes: 'brown', cloth: 'navy', collar: 'tee', bg: 'green', beard: 'stubble', brows: 4 },
    { skin: 4, hair: 'black', style: 'crop', eyes: 'brown', cloth: 'charcoal', collar: 'blazer', bg: 'lilac', beard: 'full', brows: 4 },
    { skin: 0, hair: 'blond', style: 'side', eyes: 'blue', cloth: 'white', collar: 'shirt', bg: 'peach', glasses: 'rect', brows: 4 },
    { skin: 2, hair: 'black', style: 'curly', eyes: 'black', cloth: 'teal', collar: 'hoodie', bg: 'yellow', grin: true, brows: 4 },
    { skin: 0, hair: 'grey', style: 'bald', eyes: 'hazel', cloth: 'maroon', collar: 'vneck', bg: 'teal', beard: 'full', brows: 4 },
    { skin: 3, hair: 'dark', style: 'quiff', eyes: 'brown', cloth: 'coral', collar: 'tee', bg: 'pink', headphones: true, brows: 4 },
    { skin: 1, hair: 'grey', style: 'short', eyes: 'blue', cloth: 'navy', collar: 'blazer', bg: 'sand', glasses: 'round', brows: 4 },
    { skin: 5, hair: 'black', style: 'crop', eyes: 'brown', cloth: 'denim', collar: 'shirt', bg: 'periwinkle', beard: 'full', grin: true, brows: 4 },
    { skin: 2, hair: 'chestnut', style: 'side', eyes: 'green', cloth: 'plum', collar: 'hoodie', bg: 'lime', beard: 'stubble', brows: 4 },
    { skin: 0, hair: 'red', style: 'curly', eyes: 'blue', cloth: 'forest', collar: 'tee', bg: 'blue', freckles: true, grin: true, brows: 4 },
    { skin: 4, hair: 'black', style: 'short', eyes: 'black', cloth: 'mustard', collar: 'vneck', bg: 'peach', glasses: 'rect', beard: 'mustache', brows: 4 },
    { skin: 1, hair: 'brown', style: 'wavy', eyes: 'hazel', cloth: 'white', collar: 'shirt', bg: 'green', beard: 'full', brows: 4 },
];
// Wavy hair comes with a back layer down to the chin; the men's "wavy" keeps the fringe only
const SET = [
    ...WOMEN.map((a, i) => ({ ...a, file: `f${String(i + 1).padStart(2, '0')}.png`, voice: 'female' })),
    ...MEN.map((a, i) => ({ ...a, file: `m${String(i + 1).padStart(2, '0')}.png`, voice: 'male', noBack: a.style === 'wavy' })),
];

// ---------------------------------------------------------------- Rendering
const sheet = process.argv.indexOf('--sheet') > 0 ? process.argv[process.argv.indexOf('--sheet') + 1] : '';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
for (const a of SET) {
    await page.setContent(`<body style="margin:0">${avatarSvg(a)}</body>`);
    fs.writeFileSync(path.join(OUT, a.file), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE } }));
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(SET.map(({ file, voice }) => ({ file, voice })), null, 2) + '\n');
if (sheet) {
    await page.setViewportSize({ width: 6 * 160, height: 4 * 160 });
    await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(6,160px)">${SET.map((a) => avatarSvg(a, 160)).join('')}</body>`);
    fs.writeFileSync(sheet, await page.screenshot({ type: 'png', fullPage: true }));
}
await browser.close();
const bytes = SET.reduce((n, a) => n + fs.statSync(path.join(OUT, a.file)).size, 0);
console.log(`${SET.length} avatars in ${OUT} (${Math.round(bytes / 1024)} KB)${sheet ? `, sheet ${sheet}` : ''}`);
