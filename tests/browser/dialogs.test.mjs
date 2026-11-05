// Questions and notices are HTML dialogs (webapp/js/dialogs.js): the keyboard answers them, focus stays inside, a
// second one waits for the first, and Escape does not also close a dialog below.

export default async function ({ start, check }) {
    const h = await start({});
    const p = h.page;
    const ask = (call) => p.evaluate(async (c) => {
        const { confirmDialog, alertDialog } = await import('/js/dialogs.js');
        window.__answer = undefined;
        const r = c === 'confirm' ? confirmDialog('Delete it?\nReally.') : alertDialog('Done.');
        r.then((v) => { window.__answer = v === undefined ? 'closed' : v; });
    }, call);
    const answer = async () => { await h.wait(50); return p.evaluate(() => window.__answer); };
    const open = () => p.locator('.overlay.ask').count();
    const focused = () => p.evaluate(() => document.activeElement && document.activeElement.textContent);

    await ask('confirm');
    check('question shown, line break kept', (await open()) === 1 && (await p.textContent('.ask-text')) === 'Delete it?\nReally.' && (await p.evaluate(() => getComputedStyle(document.querySelector('.ask-text')).whiteSpace)) === 'pre-line');
    check('focus is on "OK"', (await focused()) === 'OK');
    await p.keyboard.press('Tab');
    check('Tab stays inside the dialog', (await focused()) === 'Cancel');
    await p.keyboard.press('Tab');
    check('Tab wraps around', (await focused()) === 'OK');
    await p.keyboard.press('Enter');
    check('Enter confirms', (await answer()) === true && (await open()) === 0);

    await ask('confirm');
    await p.keyboard.press('Escape');
    check('Escape declines', (await answer()) === false && (await open()) === 0);

    await ask('confirm');
    await p.click('.overlay.ask .btn');
    check('"Cancel" declines', (await answer()) === false && (await open()) === 0);

    await ask('confirm');
    await p.mouse.click(2, 2);
    check('a click beside the dialog declines', (await answer()) === false && (await open()) === 0);

    await ask('alert');
    check('notice has one button', (await p.locator('.overlay.ask button').count()) === 1);
    await p.keyboard.press('Escape');
    check('Escape closes a notice', (await answer()) === 'closed' && (await open()) === 0);

    // two at once: the second opens when the first is answered
    await p.evaluate(async () => {
        const { alertDialog, confirmDialog } = await import('/js/dialogs.js');
        window.__order = [];
        alertDialog('First').then(() => window.__order.push('first'));
        confirmDialog('Second').then((v) => window.__order.push('second:' + v));
    });
    await h.wait(50);
    check('one dialog at a time', (await open()) === 1 && (await p.textContent('.ask-text')) === 'First');
    await p.keyboard.press('Enter');
    await h.wait(50);
    check('the second follows', (await open()) === 1 && (await p.textContent('.ask-text')) === 'Second');
    await p.keyboard.press('Enter');
    await h.wait(50);
    check('answered in order', JSON.stringify(await p.evaluate(() => window.__order)) === '["first","second:true"]');

    // Escape belongs to the question, not to the dialog below it
    await p.evaluate(() => askForKey(''));
    await ask('confirm');
    await p.keyboard.press('Escape');
    check('Escape does not close the dialog below', (await answer()) === false && await p.isVisible('#key-dialog'));
    check('focus returns to the dialog below', await p.evaluate(() => document.activeElement === document.getElementById('key-input')));
    await h.close();
}
