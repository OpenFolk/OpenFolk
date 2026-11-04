// The version in every app: next to the name at the top of the sidebar and in "About" in the settings; a click shows
// the notes of that version from the CHANGELOG with the older ones folded below. webapp/js/release.js is generated
// (scripts/release-notes.mjs) and must match package.json and CHANGELOG.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bot } from './harness.mjs';
import { parseChangelog, unwrap } from '../../scripts/release-notes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export default async function ({ start, check }) {
    let upToDate = true;
    try { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release-notes.mjs'), '--check'], { stdio: 'pipe' }); } catch { upToDate = false; }
    check('release.js matches package.json and CHANGELOG.md (npm run release-notes)', upToDate);

    const parsed = parseChangelog('# Changelog\n\n## [Unreleased]\n\n### Added\n- soon\n\n## [1.1.0] - 2026-12-01\n\n### Fixed\n- a\n  b\n\n## [1.0.0] - 2026-11-01\n\n- first\n\n[Unreleased]: https://x/compare\n[1.1.0]: https://x/1.1.0\n');
    check('changelog: released versions only, newest first, without the link lines', JSON.stringify(parsed) === JSON.stringify([
        { version: '1.1.0', date: '2026-12-01', notes: '### Fixed\n- a b' },
        { version: '1.0.0', date: '2026-11-01', notes: '- first' },
    ]), parsed);
    // The web app renders line breaks: wrapped lines are joined, headings, code blocks and new items stay as they are
    const fence = '```';
    for (const [text, want] of [
        ['### X\nText under it\n- a\n  b\n\n- c', '### X\nText under it\n- a b\n\n- c'],
        [`${fence}sh\nnpm a\nnpm b\n${fence}\nafter`, `${fence}sh\nnpm a\nnpm b\n${fence}\nafter`],
        ['para one\ngoes on\n\n1. x\n   y', 'para one goes on\n\n1. x y'],
    ]) check(`changelog: unwrapped ${JSON.stringify(text)}`, unwrap(text) === want, unwrap(text));

    const web = await start({ bots: [bot('pdf', 'PDF-Reader')], online: ['desk'] });
    const p = web.page;
    await p.click('[data-tab=settings]');
    await web.wait(200);
    const first = await p.evaluate(() => {
        const dt = document.querySelector('#about-list dt');
        return [dt?.textContent, dt?.nextElementSibling?.textContent];
    });
    check('about: OpenFolk and its version come first', first[0] === 'OpenFolk' && first[1] === `${VERSION} · What's new?`, first);
    await p.click('#about-list .about-version');
    await web.wait(200);
    check('a click opens the release notes', await p.isVisible('#settings-dialog') && (await p.textContent('#settings-dialog-title')) === `New in OpenFolk ${VERSION}`);
    const shown = await p.evaluate(() => ({
        headings: [...document.querySelectorAll('#settings-dialog .release-notes-current h3')].map((h) => h.textContent),
        items: document.querySelectorAll('#settings-dialog .release-notes-current li').length,
        older: [...document.querySelectorAll('#settings-dialog .release-notes-older summary')].map((s) => s.textContent),
        openOlder: document.querySelectorAll('#settings-dialog .release-notes-older[open]').length,
        link: document.querySelector('#settings-dialog .release-notes-all')?.getAttribute('href'),
        scripts: document.querySelectorAll('#settings-dialog script').length,
    }));
    check('the notes of this version: its sections and entries', shown.headings.includes('Added') && shown.items > 3, shown);
    check('the older versions folded below it', shown.older.length >= 3 && shown.openOlder === 0 && shown.older.some((s) => s.startsWith('0.1.0 ')), shown);
    check('a link to all versions on GitHub', shown.link === 'https://github.com/OpenFolk/OpenFolk/releases', shown);
    await p.click('#settings-dialog [data-close]');
    await web.wait(100);
    check('closing it leaves the settings open, the notes back in their place', !(await p.isVisible('#settings-dialog')) && (await p.isVisible('#settings-about')) && (await p.locator('#settings-about #release-notes').count()) === 1);
    // The version next to the name at the top of the sidebar opens the same notes, also with the settings closed
    await p.click('[data-tab=bots]');
    await web.wait(200);
    check('sidebar: the version next to the name', await p.isVisible('#brand-version') && (await p.textContent('#brand-version')) === VERSION
        && (await p.textContent('.brand strong')).replace(/\s+/g, ' ').trim() === `OpenFolk ${VERSION}` && (await p.getAttribute('#brand-version', 'title')) === 'What is new in this version?');
    await p.click('#brand-version');
    await web.wait(200);
    check('sidebar: a click on the version opens the release notes', await p.isVisible('#settings-dialog') && (await p.textContent('#settings-dialog-title')) === `New in OpenFolk ${VERSION}`
        && (await p.locator('#settings-dialog .release-notes-current li').count()) > 3);
    await p.click('#settings-dialog [data-close]');
    await web.wait(100);
    check('sidebar: closed again, the notes back in the settings', !(await p.isVisible('#settings-dialog')) && (await p.locator('#settings-about #release-notes').count()) === 1);
    check('no page errors', web.errors.length === 0, web.errors);
    await web.close();

    const german = await start({ bots: [bot('pdf', 'PDF-Reader')], online: [], language: 'de' });
    await german.page.click('[data-tab=settings]');
    await german.wait(200);
    await german.page.click('#about-list .about-version');
    await german.wait(200);
    check('German: title, and the notes are said to be in English', (await german.page.textContent('#settings-dialog-title')) === `Neu in OpenFolk ${VERSION}`
        && (await german.page.textContent('#settings-dialog-body')).includes('nur auf Englisch'));
    await german.close();
}
