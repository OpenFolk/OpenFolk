// The sidebar's width: the desktop apps (Electron) let the user drag its right edge, keep the width across a reload
// and restore it on a double click; the browser keeps the fixed width without a handle.

/** Runs in the page before the app: the user agent of the Electron shell. */
function electronAgent() {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenFolk/0.1.0 Chrome/140.0.0.0 Electron/44.7.0 Safari/537.36' });
}

const sidebarWidth = (page) => page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width));

/** Drags the sidebar's edge to x. */
async function dragTo(page, x) {
    const box = await page.locator('#sidebar-resize').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(x, box.y + 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(50);
}

export default async function ({ start, check }) {
    const web = await start();
    await web.page.setViewportSize({ width: 1600, height: 900 });
    check('browser: no handle', !(await web.page.locator('#sidebar-resize').isVisible()));
    check('browser: sidebar 360 px', await sidebarWidth(web.page) === 360, await sidebarWidth(web.page));
    await web.close();

    const desk = await start({ before: electronAgent });
    const { page } = desk;
    await page.setViewportSize({ width: 1600, height: 900 });
    check('desktop: handle shown', await page.locator('#sidebar-resize').isVisible());
    check('desktop: sidebar starts at 360 px', await sidebarWidth(page) === 360, await sidebarWidth(page));

    await dragTo(page, 500);
    check('desktop: dragging widens the sidebar', await sidebarWidth(page) === 500, await sidebarWidth(page));
    await page.reload();
    await page.waitForSelector('#sidebar-resize');
    check('desktop: width kept after a reload', await sidebarWidth(page) === 500, await sidebarWidth(page));

    await dragTo(page, 100);
    check('desktop: not narrower than 260 px', await sidebarWidth(page) === 260, await sidebarWidth(page));

    await page.locator('#sidebar-resize').dblclick();
    await page.waitForTimeout(50);
    check('desktop: double click restores 360 px', await sidebarWidth(page) === 360, await sidebarWidth(page));

    await page.setViewportSize({ width: 700, height: 900 });
    check('desktop, narrow window: no handle', !(await page.locator('#sidebar-resize').isVisible()));
    await desk.close();
}
