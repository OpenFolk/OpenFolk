// iOS ignores interactive-widget=resizes-content: with the keyboard open the app takes the height left above it
// (visualViewport) and the window is scrolled back, so it does not jump. Other devices keep 100dvh.
import { bot } from './harness.mjs';

const fakeIpad = () => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    const vv = new EventTarget();
    // like Safari: the window's height while nothing covers it
    let covered = 0;
    Object.defineProperty(vv, 'height', { get: () => covered || window.innerHeight, set: (v) => { covered = v === window.innerHeight ? 0 : v; } });
    Object.defineProperty(window, 'visualViewport', { get: () => vv });
    window.__vv = vv;
};

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader')], before: fakeIpad });
    const p = h.page;
    await h.openChat('PDF-Reader');
    const appHeight = () => p.evaluate(() => Math.round(document.getElementById('app').getBoundingClientRect().height));
    const full = await p.evaluate(() => window.innerHeight);
    check('iPad, keyboard closed: the whole height', (await appHeight()) === full, [await appHeight(), full]);
    await p.evaluate(() => { window.__vv.height = 480; window.__vv.dispatchEvent(new Event('resize')); });
    await h.wait(100);
    check('iPad, keyboard open: the app as high as what stays visible', (await appHeight()) === 480, await appHeight());
    const composer = await p.locator('.pane:not([hidden]) [data-el=text]').boundingBox();
    check('… the input field above the keyboard', composer && composer.y + composer.height <= 480, composer);
    await p.evaluate(() => askText({ title: 'Rename', value: 'Docs', done: () => {} }));
    await h.wait(100);
    const field = await p.locator('#text-input').boundingBox();
    check('a dialog stays above the keyboard too', field && field.y + field.height <= 480, field);
    await p.keyboard.press('Escape');
    await p.evaluate(() => { window.__vv.height = window.innerHeight; window.__vv.dispatchEvent(new Event('resize')); });
    await h.wait(100);
    check('keyboard closed again: the whole height', (await appHeight()) === full, await appHeight());
    await h.close();

    const other = await start({ bots: [bot('pdf', 'PDF-Reader')] });
    check('not iOS: no height of its own', await other.page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height') === ''));
    check('no errors', h.errors.length === 0 && other.errors.length === 0, [...h.errors, ...other.errors]);
    await other.close();
}
