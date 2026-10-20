// Tests for the suggestions in the bot editor (without Claude):  node local/src/suggestions.test.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Allowed root for this test: the folder containing this repo (set before the config is loaded)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.ALLOWED_ROOTS = path.dirname(projectRoot);
const { descriptionFrom, resultFrom, photoPrompt, folderContext, prompt, checkSvg } = await import('./suggestions.ts');

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
check('prompt: avatar asks for SVG', prompt({ what: 'avatar', folder: '', name: 'Pixel', role: '', tone: '', model: 'default' }, '').includes('viewBox'));
check('prompt: first name and field of work as separate fields', /no hyphen/i.test(p) && /"Rudolf" with "Research"/.test(p) && !/Deploy Dave|SEO Sally/.test(p));
check('prompt: known field of work included', prompt({ what: 'role', folder: '', name: 'Rudolf', area: 'Research', role: '', tone: '', model: 'default' }, '', 'role', 'en').includes('Field of work: Research'));
const pf = prompt({ what: 'avatar', folder: '', name: 'Deploy Dave', role: 'Server', tone: '', model: 'default', previous: ['x'] }, '', 'photo');
check('prompt: photo describes a person instead of SVG', pf.includes('image model') && pf.includes('attractive') && pf.includes('different person') && !pf.includes('viewBox'));
check('description: too short is an error', throws(() => descriptionFrom({ description: 'short' })));
check('description: gets truncated', descriptionFrom({ description: 'x'.repeat(2000) }).length === 1500);
const fp = photoPrompt('A woman with red hair in a blazer.');
check('photo prompt: person first, photo requirements after', fp.startsWith('A woman') && fp.includes('Photorealistic') && fp.includes('No text'));
check('result avatar: photo as data URL passes', JSON.stringify(resultFrom('avatar', { image: 'data:image/jpeg;base64,/9j/4AAQ' })) === JSON.stringify({ what: 'avatar', image: 'data:image/jpeg;base64,/9j/4AAQ' }));
check('result avatar: foreign image URL falls back to SVG and fails', throws(() => resultFrom('avatar', { image: 'https://x/y.jpg' })));

const pairs = (...l: [string, string][]) => ({ suggestions: l.map(([name, area]) => ({ name, area })) });
check('result name: cleaned, without duplicates, at most three, field of work beside each name',
    JSON.stringify(resultFrom('name', pairs(['„Dan“', 'Deploy'], ['Dan', 'Other'], [' Ada ', ' Accounting '], ['Bo', ''], ['Cy', 'Cloud'])))
        === JSON.stringify({ what: 'name', names: ['Dan', 'Ada', 'Bo'], areas: ['Deploy', 'Accounting', ''] }));
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

if (failures) process.exit(1);
console.log('all tests passed');
