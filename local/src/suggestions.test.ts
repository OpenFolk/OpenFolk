// Tests for the suggestions in the bot editor (without Claude):  node local/src/suggestions.test.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Allowed root for this test: the folder containing this repo (set before the config is loaded)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.ALLOWED_ROOTS = path.dirname(projectRoot);
const { avatarDataUrl, descriptionFrom, resultFrom, photoPrompt, folderContext, prompt, checkSvg, suggestionEngine, jsonIn, photoModel } = await import('./suggestions.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const c = folderContext(projectRoot);
check('context: folder and README', c.includes('README.md') && c.includes('OpenFolk'));
check('context: node_modules not listed', !/Entries:.*node_modules/.test(c));
check('context: README truncated', c.length < 6000);
check('context: folder outside the roots empty', folderContext(process.platform === 'win32' ? 'C:/Windows' : '/etc') === '');
check('context: missing folder empty', folderContext(path.join(projectRoot, 'does-not-exist')) === '');

const p = prompt({ what: 'name', folder: '', name: '', role: 'Deployments', tone: '', model: 'default', previous: ['Deploy-Dan'] }, '', 'name', 'en');
check('prompt: role and previous names included', p.includes('Role: Deployments') && p.includes('Deploy-Dan') && p.includes('three'));
check('prompt: names in the chosen language', p.includes('common\nEnglish first name') && prompt({ what: 'name', folder: '', name: '', role: '', tone: '', model: 'default' }, '', 'name', 'de').includes('German first name'));
const ap = prompt({ what: 'avatar', folder: '', name: 'Pixel', role: '', tone: '', model: 'default' }, '');
check('prompt: avatar asks for the parts of the kit, not for SVG', ap.includes('kit') && ap.includes('ponytail') && ap.includes('headphones') && !ap.includes('viewBox'));
check('prompt: first name and field of work as separate fields', /no hyphen/i.test(p) && /"Rudolf" with "Research"/.test(p) && !/Deploy Dave|SEO Sally/.test(p));
check('prompt: known field of work included', prompt({ what: 'role', folder: '', name: 'Rudolf', area: 'Research', role: '', tone: '', model: 'default' }, '', 'role', 'en').includes('Field of work: Research'));
const pf = prompt({ what: 'avatar', folder: '', name: 'Deploy Dave', role: 'Server', tone: '', model: 'default', previous: ['x'] }, '', 'photo');
check('prompt: photo describes a person instead of SVG', pf.includes('image model') && pf.includes('attractive') && pf.includes('different person') && !pf.includes('viewBox'));
const wish = { what: 'avatar' as const, folder: '', name: 'Ada', role: '', tone: '', model: 'default', wish: 'curly red hair, hoodie' };
check('prompt: a wish for the picture reaches photo and SVG, not the name', prompt(wish, '', 'photo').includes('Wishes for the picture: curly red hair') && prompt(wish, '').includes('curly red hair')
    && !prompt({ ...wish, what: 'name' }, '').includes('curly'));
check('description: too short is an error', throws(() => descriptionFrom({ description: 'short' })));
check('description: gets truncated', descriptionFrom({ description: 'x'.repeat(2000) }).length === 1500);
const fp = photoPrompt('A woman with red hair in a blazer.');
check('photo prompt: person first, photo requirements after', fp.startsWith('A woman') && fp.includes('Photorealistic') && fp.includes('No text'));
check('result avatar: photo as data URL passes', JSON.stringify(resultFrom('avatar', { image: 'data:image/jpeg;base64,/9j/4AAQ' })) === JSON.stringify({ what: 'avatar', image: 'data:image/jpeg;base64,/9j/4AAQ' }));
check('result avatar: foreign image URL is refused', throws(() => resultFrom('avatar', { image: 'https://x/y.jpg' })));
const parts = (resultFrom('avatar', { skin: 'deep', hair: 'black', style: 'afro', collar: 'blazer', cloth: 'navy', bg: 'sage', beard: 'none', glasses: 'round', headphones: false, earrings: true }) as { what: string; svg?: string });
check('result avatar: the parts the model chose come back drawn by the kit', parts.what === 'avatar' && typeof parts.svg === 'string' && parts.svg.startsWith('<svg') && checkSvg(parts.svg) === parts.svg && parts.svg.includes('r="76"'));
check('result avatar: garbage parts still give a picture (the defaults)', (resultFrom('avatar', { style: 'mohawk', nonsense: 1 }) as { svg?: string }).svg?.startsWith('<svg') === true);

const pairs = (...l: [string, string, string?][]) => ({ suggestions: l.map(([name, area, voice]) => ({ name, area, voice })) });
check('result name: cleaned, without duplicates, at most three, field of work beside each name',
    JSON.stringify(resultFrom('name', pairs(['„Dan“', 'Deploy', 'male'], ['Dan', 'Other'], [' Ada ', ' Accounting ', 'female'], ['Bo', ''], ['Cy', 'Cloud'])))
        === JSON.stringify({ what: 'name', names: ['Dan', 'Ada', 'Bo'], areas: ['Deploy', 'Accounting', ''], voices: ['male', 'female', 'female'] }));
check('result name: empty is an error', throws(() => resultFrom('name', pairs())));
check('result role: period at the end removed', JSON.stringify(resultFrom('role', { role: 'Servers and deploys.' })) === JSON.stringify({ what: 'role', role: 'Servers and deploys' }));
check('result role: missing is an error', throws(() => resultFrom('role', {})));

const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect width="256" height="256" fill="#123"/><circle cx="128" cy="128" r="60" fill="url(#g)"/><use href="#a"/></svg>';
check('SVG: valid passes', checkSvg(good) === good);
check('SVG: code fence removed', checkSvg('```svg\n' + good + '\n```') === good);
check('SVG: script rejected', throws(() => checkSvg(good.replace('</svg>', '<script>1</script></svg>'))));
check('SVG: event attribute rejected', throws(() => checkSvg(good.replace('<rect', '<rect onload="x()"'))));
check('SVG: external address rejected', throws(() => checkSvg(good.replace('href="#a"', 'href="https://x/y.png"'))));
check('SVG: external url() rejected', throws(() => checkSvg(good.replace('url(#g)', 'url(https://x/y)'))));
check('SVG: no SVG rejected', throws(() => checkSvg('<div>hi</div>')));
check('SVG: too large rejected', throws(() => checkSvg(good.replace('<rect', '<rect data-x="' + 'a'.repeat(210000) + '"'))));

check('avatar data URL: the photo as it is', avatarDataUrl({ what: 'avatar', image: 'data:image/jpeg;base64,/9j/4AAQ' }) === 'data:image/jpeg;base64,/9j/4AAQ');
check('avatar data URL: the SVG encoded', avatarDataUrl({ what: 'avatar', svg: '```svg\n' + good + '\n```' }) === `data:image/svg+xml;base64,${Buffer.from(good).toString('base64')}`);
check('avatar data URL: a bad SVG or another result is an error', throws(() => avatarDataUrl({ what: 'avatar', svg: '<div/>' })) && throws(() => avatarDataUrl({ what: 'role', role: 'x' })));

// The engine that answers: Claude while it is on, otherwise the bot's own, otherwise the first one on
const onOnly = (...l: string[]) => (e: string) => l.includes(e);
check('engine: Claude while it is on, also for a bot on another engine', suggestionEngine('default', onOnly('claude', 'opencode')) === 'claude' && suggestionEngine('codex', onOnly('claude', 'codex')) === 'claude');
check('engine: Claude off: the bot\'s own engine', suggestionEngine('opencode:opencode/big-pickle', onOnly('codex', 'opencode')) === 'opencode');
check('engine: Claude off, the bot on Claude: the first one on', suggestionEngine('default', onOnly('opencode')) === 'opencode' && suggestionEngine(undefined, onOnly('copilot', 'opencode')) === 'copilot');
check('engine: none on stays Claude', suggestionEngine('default', onOnly()) === 'claude');
check('JSON in an answer with a fence or words around it', JSON.stringify(jsonIn('Sure:\n```json\n{"role":"Servers"}\n```')) === '{"role":"Servers"}'
    && jsonIn('no json') === undefined && jsonIn('{broken') === undefined);

// The photo's model: the chosen one with its key, else the other provider's with its key, a drawing only without any
const keys = (...p: string[]) => (x: string) => p.includes(x);
check('photo: the chosen model (Gemini by default) with its key', photoModel(keys('gemini', 'openai'), 'gemini-3.1-flash-image') === 'gemini-3.1-flash-image');
check('photo: only an OpenAI key, Gemini chosen: the OpenAI model instead of a drawing', photoModel(keys('openai'), 'gemini-3.1-flash-image') === 'gpt-image-1');
check('photo: no key: a drawing', photoModel(keys(), 'gemini-3.1-flash-image') === null);
check('photo: only a Gemini key, OpenAI chosen: the Gemini model', photoModel(keys('gemini'), 'gpt-image-1') === 'gemini-3.1-flash-image');

if (failures) process.exit(1);
console.log('all tests passed');
