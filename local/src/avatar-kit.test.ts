// Tests for the kit the drawn profile pictures are made from:  node local/src/avatar-kit.test.ts
// Every combination of parts draws a clean SVG that passes the app's check; a choice from a garbled answer falls back
// to the defaults; the same choice always gives the same picture.
const { AVATAR_OPTIONS, BEARDS, COLLARS, GLASSES, HAIR_STYLES, composeAvatar, sanitizeChoice } = await import('./avatar-kit.ts');
const { checkSvg } = await import('./suggestions.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const base = sanitizeChoice({});
const clean = (svg: string) => svg.startsWith('<svg') && svg.endsWith('</svg>') && !/NaN|undefined|null/.test(svg) && checkSvg(svg) === svg;

let drawn = 0;
let bad: string[] = [];
for (const style of HAIR_STYLES) for (const collar of COLLARS) {
    const svg = composeAvatar({ ...base, style, collar });
    drawn++;
    if (!clean(svg)) bad.push(`${style}/${collar}`);
}
check(`every hair style with every collar draws a clean SVG (${drawn})`, bad.length === 0, bad);
bad = [];
for (const beard of BEARDS) for (const glasses of GLASSES) for (const headphones of [false, true]) for (const earrings of [false, true]) {
    if (!clean(composeAvatar({ ...base, beard, glasses, headphones, earrings }))) bad.push(`${beard}/${glasses}/${headphones}/${earrings}`);
}
check('beards, glasses, headphones and earrings in every combination', bad.length === 0, bad);
bad = [];
for (const skin of AVATAR_OPTIONS.skin) for (const hair of AVATAR_OPTIONS.hair) if (!clean(composeAvatar({ ...base, skin, hair }))) bad.push(`${skin}/${hair}`);
for (const cloth of AVATAR_OPTIONS.cloth) for (const bg of AVATAR_OPTIONS.bg) if (!clean(composeAvatar({ ...base, cloth, bg }))) bad.push(`${cloth}/${bg}`);
check('every skin tone with every hair color, every cloth with every background', bad.length === 0, bad);

const sizes = composeAvatar(base).length;
check('a picture is small (a few KB, not a drawing of the model)', sizes > 1000 && sizes < 12_000, sizes);
check('deterministic: the same choice gives the same picture', composeAvatar({ ...base, style: 'bob' }) === composeAvatar({ ...base, style: 'bob' }));
check('different choices give different pictures', composeAvatar({ ...base, style: 'bob' }) !== composeAvatar({ ...base, style: 'bun' }) && composeAvatar({ ...base, bg: 'sage' }) !== composeAvatar({ ...base, bg: 'rose' }));
check('the picture holds no text and no references', !/<text|href=|url\(/.test(composeAvatar({ ...base, style: 'ponytail', collar: 'blazer', glasses: 'rect', headphones: true })));
check('the wavy style without its back layer (the set) differs', composeAvatar({ ...base, style: 'wavy' }) !== composeAvatar({ ...base, style: 'wavy' }, 256, true));
check('the size goes into width and height', composeAvatar(base, 512).includes('width="512" height="512"'));

// sanitizeChoice
const got = sanitizeChoice({ skin: 'deep', hair: 'white', style: 'afro', collar: 'turtleneck', cloth: 'plum', bg: 'rose', beard: 'full', glasses: 'round', headphones: true, earrings: true });
check('sanitize: a valid choice passes through', JSON.stringify(got) === JSON.stringify({ skin: 'deep', hair: 'white', style: 'afro', collar: 'turtleneck', cloth: 'plum', bg: 'rose', beard: 'full', glasses: 'round', headphones: true, earrings: true }), got);
const garbage = sanitizeChoice({ skin: 'green', hair: 7, style: 'mohawk', collar: null, headphones: 'yes', earrings: 1, extra: 'x' });
check('sanitize: unknown values fall back to the defaults, switches only on true', JSON.stringify(garbage) === JSON.stringify(base) && garbage.headphones === false && garbage.earrings === false, garbage);
check('sanitize: no object at all gives the defaults', JSON.stringify(sanitizeChoice(null)) === JSON.stringify(base) && JSON.stringify(sanitizeChoice('x')) === JSON.stringify(base));

console.log(failures ? `\n${failures} failure(s)` : '\nall tests passed');
process.exit(failures ? 1 : 0);
