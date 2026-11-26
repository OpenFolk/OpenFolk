// The kit the drawn profile pictures are made from: flat vector portraits put together from parts (skin, hair, clothes,
// glasses, beard, headphones) in a calm, reduced style, as on the team page of a firm. The model only chooses the parts
// (suggestions.ts); nothing is drawn freehand, so every picture comes out clean. The same kit draws the set the bot
// editor offers under "AI avatar" (scripts/avatar-set.mjs). viewBox 256×256, the head's centre at 128,112.

export const SKIN_TONES = ['light', 'fair', 'medium', 'tan', 'brown', 'deep'] as const;
export const HAIR_COLORS = ['black', 'dark', 'brown', 'chestnut', 'blond', 'red', 'grey', 'white'] as const;
export const HAIR_STYLES = ['short', 'crop', 'side', 'quiff', 'curly', 'wavy', 'bob', 'long', 'ponytail', 'bun', 'afro', 'bald'] as const;
export const COLLARS = ['tee', 'vneck', 'shirt', 'blazer', 'hoodie', 'turtleneck'] as const;
export const CLOTH_COLORS = ['navy', 'charcoal', 'slate', 'forest', 'burgundy', 'camel', 'offwhite', 'plum'] as const;
export const BACKGROUNDS = ['sand', 'sage', 'mist', 'stone', 'rose', 'slate', 'clay', 'lavender'] as const;
export const BEARDS = ['none', 'stubble', 'full', 'mustache'] as const;
export const GLASSES = ['none', 'round', 'rect'] as const;

export type SkinTone = (typeof SKIN_TONES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Collar = (typeof COLLARS)[number];
export type ClothColor = (typeof CLOTH_COLORS)[number];
export type Background = (typeof BACKGROUNDS)[number];
export type Beard = (typeof BEARDS)[number];
export type Glasses = (typeof GLASSES)[number];

/** What the model chooses; the drawing follows from it alone. */
export interface AvatarChoice {
    skin: SkinTone;
    hair: HairColor;
    style: HairStyle;
    collar: Collar;
    cloth: ClothColor;
    bg: Background;
    beard: Beard;
    glasses: Glasses;
    headphones: boolean;
    earrings: boolean;
}

/** The choices by field, for the schema and the prompt of the suggestion. */
export const AVATAR_OPTIONS = {
    skin: SKIN_TONES, hair: HAIR_COLORS, style: HAIR_STYLES, collar: COLLARS, cloth: CLOTH_COLORS, bg: BACKGROUNDS, beard: BEARDS, glasses: GLASSES,
} as const;

const DEFAULT: AvatarChoice = { skin: 'fair', hair: 'brown', style: 'short', collar: 'tee', cloth: 'navy', bg: 'sand', beard: 'none', glasses: 'none', headphones: false, earrings: false };

/** A choice from whatever the model answered: every field one of its options, anything else the default. */
export function sanitizeChoice(input: unknown): AvatarChoice {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback);
    return {
        skin: pick(SKIN_TONES, o.skin, DEFAULT.skin), hair: pick(HAIR_COLORS, o.hair, DEFAULT.hair), style: pick(HAIR_STYLES, o.style, DEFAULT.style),
        collar: pick(COLLARS, o.collar, DEFAULT.collar), cloth: pick(CLOTH_COLORS, o.cloth, DEFAULT.cloth), bg: pick(BACKGROUNDS, o.bg, DEFAULT.bg),
        beard: pick(BEARDS, o.beard, DEFAULT.beard), glasses: pick(GLASSES, o.glasses, DEFAULT.glasses),
        headphones: o.headphones === true, earrings: o.earrings === true,
    };
}

// ---------------------------------------------------------------- Palette: muted, as a team page uses it
const SKIN: Record<SkinTone, [string, string]> = {
    light: ['#f3dccb', '#dcb99f'], fair: ['#ecc9a8', '#d2a581'], medium: ['#dba982', '#bd8a62'], tan: ['#c08a5c', '#9f6f45'], brown: ['#966545', '#785033'], deep: ['#664430', '#4e3323'],
};
const HAIR: Record<HairColor, string> = { black: '#262220', dark: '#45302a', brown: '#654733', chestnut: '#845436', blond: '#c7a86b', red: '#9e4f2e', grey: '#9a9a98', white: '#dcd8d2' };
const CLOTH: Record<ClothColor, string> = { navy: '#263a55', charcoal: '#3b3f45', slate: '#4e6472', forest: '#3d5a4a', burgundy: '#6a303b', camel: '#a98a63', offwhite: '#e8e3da', plum: '#5a3d5c' };
const BG: Record<Background, string> = { sand: '#e7dccb', sage: '#cfd8cc', mist: '#d5dde3', stone: '#dad6cf', rose: '#e4d2cf', slate: '#c6cfd8', clay: '#dcc7b6', lavender: '#d9d4e0' };
const INK = '#2a2522';

/** Darkens (negative) or lightens a hex color by a fraction. */
function shade(hex: string, f: number): string {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- Parts
const HEAD = { cx: 128, cy: 112, rx: 50, ry: 58 };

function body(a: AvatarChoice): string {
    const c = CLOTH[a.cloth];
    const dark = shade(c, -0.18);
    const light = a.cloth === 'offwhite' ? '#f7f5f0' : shade(c, 0.35);
    const edge = a.cloth === 'offwhite' ? '#cfcac2' : dark;
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
                `<path d="M 116 200 L 114 236 M 140 200 L 142 236" stroke="${light}" stroke-width="3" stroke-linecap="round"/>`);
            break;
        case 'blazer':
            parts.push(`<path d="M 106 182 L 128 232 L 150 182 Z" fill="#f4f2ee"/>`,
                `<path d="M 108 182 L 128 238 L 98 256 L 92 200 Z" fill="${dark}"/>`, `<path d="M 148 182 L 128 238 L 158 256 L 164 200 Z" fill="${dark}"/>`);
            break;
        case 'shirt':
            parts.push(`<path d="M 128 202 L 128 256" stroke="${edge}" stroke-width="2"/>`,
                `<circle cx="128" cy="222" r="2.2" fill="${edge}"/><circle cx="128" cy="242" r="2.2" fill="${edge}"/>`,
                `<path d="M 108 180 L 128 200 L 118 214 L 102 196 Z" fill="${light}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/>`,
                `<path d="M 148 180 L 128 200 L 138 214 L 154 196 Z" fill="${light}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/>`);
            break;
        case 'turtleneck':
            parts.push(`<path d="M 106 158 C 106 150, 150 150, 150 158 L 150 188 C 150 198, 106 198, 106 188 Z" fill="${c}"/>`,
                `<path d="M 106 166 C 106 160, 150 160, 150 166" fill="none" stroke="${dark}" stroke-width="2.5"/>`);
            break;
    }
    return parts.join('');
}

/** The hair behind the head (long styles), drawn before the head; `noBack`: the fringe of the style only. */
function hairBack(a: AvatarChoice, noBack: boolean): string {
    const c = HAIR[a.hair];
    if (noBack) return '';
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
function hairFront(a: AvatarChoice): string {
    const c = HAIR[a.hair];
    const cap = `<path d="M 76 104 C 74 60, 100 42, 128 42 C 156 42, 182 60, 180 104 C 176 90, 160 78, 128 78 C 96 78, 80 90, 76 104 Z" fill="${c}"/>`;
    switch (a.style) {
        case 'bald': return '';
        case 'crop': return `<path d="M 78 100 C 76 62, 100 46, 128 46 C 156 46, 180 62, 178 100 C 174 88, 158 82, 128 82 C 98 82, 82 88, 78 100 Z" fill="${c}"/>`;
        case 'side': return `<path d="M 76 108 C 72 58, 104 40, 134 42 C 162 44, 186 64, 180 100 C 178 86, 164 74, 138 80 C 112 86, 94 96, 86 116 C 82 112, 78 110, 76 108 Z" fill="${c}"/>`;
        case 'quiff': return cap + `<path d="M 108 50 C 118 28, 152 24, 166 46 C 152 40, 128 42, 108 50 Z" fill="${c}"/>`;
        case 'curly': return cap + [[84, 82], [96, 62], [112, 50], [128, 46], [144, 50], [160, 62], [172, 82], [80, 102], [176, 102], [102, 80], [128, 78], [154, 80]]
            .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="${c}"/>`).join('');
        case 'wavy': return cap + [[92, 96], [110, 84], [128, 82], [146, 84], [164, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${c}"/>`).join('');
        case 'bun': return cap + `<circle cx="128" cy="44" r="17" fill="${c}"/>`;
        default: return cap;
    }
}

/** The face, reduced: ears, the head, thin brows, dark almond eyes, a hint of a nose and a calm smile; no cheeks, no shine. */
function face(a: AvatarChoice): string {
    const [skin, dark] = SKIN[a.skin];
    const lip = a.skin === 'brown' || a.skin === 'deep' ? '#7f4a46' : '#b6716a';
    const brow = shade(HAIR[a.hair], a.hair === 'white' || a.hair === 'grey' ? -0.3 : -0.2);
    const eye = (x: number) => `<ellipse cx="${x}" cy="106" rx="3.6" ry="4.4" fill="${INK}"/>`;
    return [
        `<circle cx="79" cy="114" r="9" fill="${skin}"/><circle cx="177" cy="114" r="9" fill="${skin}"/>`,
        `<circle cx="79" cy="114" r="4" fill="${dark}" opacity=".3"/><circle cx="177" cy="114" r="4" fill="${dark}" opacity=".3"/>`,
        `<ellipse cx="${HEAD.cx}" cy="${HEAD.cy}" rx="${HEAD.rx}" ry="${HEAD.ry}" fill="${skin}"/>`,
        `<path d="M 97 93 Q 108 88 119 92" fill="none" stroke="${brow}" stroke-width="2.4" stroke-linecap="round"/>`,
        `<path d="M 137 92 Q 148 88 159 93" fill="none" stroke="${brow}" stroke-width="2.4" stroke-linecap="round"/>`,
        eye(108), eye(148),
        `<path d="M 128 112 C 127 118, 124 122, 125 124 Q 128 126 131 124" fill="none" stroke="${dark}" stroke-width="2" stroke-linecap="round"/>`,
        `<path d="M 117 137 Q 128 144 139 137" fill="none" stroke="${lip}" stroke-width="2.4" stroke-linecap="round"/>`,
    ].join('');
}

function beard(a: AvatarChoice): string {
    const c = HAIR[a.hair];
    switch (a.beard) {
        case 'full': return `<path d="M 84 118 C 82 150, 98 178, 128 178 C 158 178, 174 150, 172 118 C 172 140, 160 154, 128 154 C 96 154, 84 140, 84 118 Z" fill="${c}"/>`
            + `<path d="M 112 130 C 118 124, 126 126, 128 130 C 130 126, 138 124, 144 130 C 138 134, 118 134, 112 130 Z" fill="${c}"/>`;
        case 'stubble': return `<path d="M 84 118 C 82 150, 98 176, 128 176 C 158 176, 174 150, 172 118 C 172 140, 160 154, 128 154 C 96 154, 84 140, 84 118 Z" fill="${c}" opacity=".22"/>`;
        case 'mustache': return `<path d="M 112 130 C 118 124, 126 126, 128 130 C 130 126, 138 124, 144 130 C 138 134, 118 134, 112 130 Z" fill="${c}"/>`;
        default: return '';
    }
}

function extras(a: AvatarChoice): string {
    const parts: string[] = [];
    const frame = '#3a3835';
    if (a.glasses === 'round') {
        parts.push(`<circle cx="108" cy="105" r="13" fill="#fff" fill-opacity=".1" stroke="${frame}" stroke-width="2.4"/><circle cx="148" cy="105" r="13" fill="#fff" fill-opacity=".1" stroke="${frame}" stroke-width="2.4"/>`,
            `<path d="M 121 104 Q 128 99 135 104 M 95 103 L 82 100 M 161 103 L 174 100" fill="none" stroke="${frame}" stroke-width="2.4" stroke-linecap="round"/>`);
    }
    if (a.glasses === 'rect') {
        parts.push(`<rect x="94" y="95" width="28" height="20" rx="5" fill="#fff" fill-opacity=".1" stroke="${frame}" stroke-width="2.4"/><rect x="134" y="95" width="28" height="20" rx="5" fill="#fff" fill-opacity=".1" stroke="${frame}" stroke-width="2.4"/>`,
            `<path d="M 122 103 L 134 103 M 94 103 L 82 100 M 162 103 L 174 100" fill="none" stroke="${frame}" stroke-width="2.4" stroke-linecap="round"/>`);
    }
    if (a.headphones) {
        parts.push(`<path d="M 66 112 C 64 42, 192 42, 190 112" fill="none" stroke="#2e2e33" stroke-width="7" stroke-linecap="round"/>`,
            `<rect x="56" y="98" width="20" height="32" rx="7" fill="#2e2e33"/><rect x="180" y="98" width="20" height="32" rx="7" fill="#2e2e33"/>`);
    }
    if (a.earrings) parts.push(`<circle cx="79" cy="126" r="3.2" fill="#c9a24a"/><circle cx="177" cy="126" r="3.2" fill="#c9a24a"/>`);
    return parts.join('');
}

/**
 * The picture as SVG markup (square, viewBox 256). `noBack`: wavy hair without the layer behind the head (short wavy
 * hair), used by the set.
 */
export function composeAvatar(choice: AvatarChoice, size = 256, noBack = false): string {
    const a = choice;
    const neck = a.collar === 'turtleneck' ? '' : `<rect x="112" y="140" width="32" height="52" rx="10" fill="${SKIN[a.skin][1]}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">`
        + `<rect width="256" height="256" fill="${BG[a.bg]}"/>`
        + hairBack(a, noBack) + neck + body(a)
        + face(a) + beard(a) + hairFront(a) + extras(a)
        + '</svg>';
}
