// "Read answers to voice messages aloud" sits with the voice for reading aloud, not under Appearance. Where it is
// changes, what it does does not: it stays on by default, and a stored "off" is still honored.

export default async function ({ start, check }) {
    const h = await start({ online: [] });
    const p = h.page;
    const box = '#settings-auto-read';
    const where = () => p.evaluate((sel) => {
        const n = document.querySelector(sel);
        const headings = [...document.querySelectorAll('#settings h3')];
        return { inAi: !!n.closest('#settings-ai'), afterVoice: !!(document.getElementById('settings-read-aloud').compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING), headings: headings.length };
    }, box);

    await p.click('[data-tab=settings]');
    await h.wait(200);
    const at = await where();
    check('with the voice for reading aloud, below it', at.inAi && at.afterVoice, at);
    const heading = await p.evaluate((sel) => {
        const n = document.querySelector(sel);
        const before = [...document.querySelectorAll('#settings h3')].filter((x) => x.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
        return before.length ? before[before.length - 1].textContent : '';
    }, box);
    check('under the heading of the AI services, no longer under "Appearance"', heading !== 'Appearance' && heading !== '', heading);
    check('on by default', await p.isChecked(box));
    check('no machine awake: the voice choice is off, this one still works', await p.isDisabled('#settings-read-aloud') && await p.isEnabled(box));

    await p.uncheck(box);
    check('off is stored under the same key as before', await p.evaluate(() => localStorage.getItem('openfolk-read-voice-answers')) === 'off');
    await p.check(box);
    check('and on again', await p.evaluate(() => localStorage.getItem('openfolk-read-voice-answers')) === 'on');

    await p.evaluate(() => localStorage.setItem('openfolk-read-voice-answers', 'off'));
    await p.evaluate(() => openSettings());
    check('a value stored before is shown', !(await p.isChecked(box)));
    await h.close();
}
