// A module of the app that does not load (a network gap while the phone wakes, the relay restarting during a deploy)
// leaves only the bare page. boot.js loads it again until the app starts; after three tries within two minutes it says
// so with a button instead of reloading for ever.
export default async function ({ start, check }) {
    const h = await start({});
    const p = h.page;
    const started = () => p.evaluate(() => window.openfolkStarted === true).catch(() => false);
    check('a normal start sets the mark', await started());

    // menus.js fails once: the page loads again by itself and the app is there
    let fails = 1;
    await h.ctx.route(/\/js\/menus\.js$/, (r) => (fails-- > 0 ? r.abort('failed') : r.fallback()));
    await p.reload();
    await p.waitForFunction(() => window.openfolkStarted === true, null, { timeout: 15000 }).catch(() => undefined);
    check('one failed module: reloaded, the app started', await started() && (await p.getAttribute('#search', 'placeholder')) === 'Search all chats', await p.getAttribute('#search', 'placeholder'));

    // It never loads: three more tries, then the message with a button, no endless reloading
    fails = Infinity;
    let loads = 0;
    p.on('load', () => { loads++; });
    await p.reload();
    await p.waitForSelector('.boot-failed', { timeout: 20000 }).catch(() => undefined);
    const box = await p.$('.boot-failed');
    check('gives up after the tries, with a reload button', box && (await p.textContent('.boot-failed button')) === 'Reload' && !(await started()), { loads });
    check('did not reload endlessly', loads <= 4, loads);
}
