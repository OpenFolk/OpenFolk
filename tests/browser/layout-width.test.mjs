// Layout width on a wide screen: the browser caps the app at 1500 px and centres it, the desktop apps (Electron)
// fill the whole window.

/** Runs in the page before the app: the user agent of the Electron shell. */
function electronAgent() {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenFolk/0.1.0 Chrome/140.0.0.0 Electron/44.7.0 Safari/537.36' });
}

const appWidth = (page) => page.evaluate(() => Math.round(document.querySelector('.app').getBoundingClientRect().width));

export default async function ({ start, check }) {
    const web = await start();
    await web.page.setViewportSize({ width: 1900, height: 900 });
    check('browser: marked as web', await web.page.evaluate(() => document.documentElement.dataset.platform) === 'web');
    check('browser: layout capped at 1500 px', await appWidth(web.page) === 1500, await appWidth(web.page));
    await web.close();

    const desk = await start({ before: electronAgent });
    await desk.page.setViewportSize({ width: 1900, height: 900 });
    check('desktop: marked as desktop', await desk.page.evaluate(() => document.documentElement.dataset.platform) === 'desktop');
    check('desktop: layout fills the window', await appWidth(desk.page) === 1900, await appWidth(desk.page));
    await desk.close();
}
