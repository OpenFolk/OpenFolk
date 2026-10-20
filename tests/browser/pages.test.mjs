// Phone: detail dialogs are pages over the full screen; back via the arrow or a swipe to the right, without a question
// about changes. The chat's header opens the bot's page with switches, open changes and the chat's entries;
// "Search in chat" leaves it for the chat. PC: dialogs stay.

export default async function ({ start, check }) {
    const h = await start({
        onSend: async (f, push) => {
            if (f.type === 'git_changes') await push({ type: 'git_changes', machine: 'desk', botId: f.botId, repos: [{ name: 'pdf', path: '', branch: 'main', ahead: 0, behind: 0, files: [{ status: ' M', path: 'a.ts' }], more: 0 }] });
        },
    });
    const p = h.page;
    const shown = (sel) => p.locator(sel).isVisible();
    const box = (sel) => p.locator(sel).boundingBox();
    await h.openChat('PDF');

    await p.evaluate(() => window.openEditor(window.bot('pdf')));
    await h.wait(300);
    const editor = await box('#editor .dialog');
    check('editor fills the screen', editor && editor.x === 0 && editor.width === 400 && editor.height >= 850, editor);
    check('editor: back arrow', await shown('#editor [data-page-back]'));
    await p.click('#editor [data-page-back]');
    await h.wait(100);
    check('arrow closes the editor, the chat stays', !(await shown('#editor')) && (await p.evaluate(() => window.activePane().chatId)) === 'pdf');

    await p.evaluate(() => window.openInfo('pdf'));
    await h.wait(300);
    check('info: arrow instead of the cross', (await shown('#info [data-page-back]')) && !(await shown('#info .panel-head [data-close]')));
    await h.swipe(60, 400, 360, 400);
    check('swipe to the right closes the info', !(await shown('#info')));
    check('chat still open after the swipe', await shown('[data-el=composer]'));

    await p.evaluate(() => window.openEditor(window.bot('pdf')));
    await h.wait(300);
    await p.fill('#editor-tone', 'changed');
    let asked = '';
    p.once('dialog', (d) => { asked = d.message(); void d.dismiss(); });
    // Filling the tone scrolls the form; the swipe starts on the title, so bring it back into view
    await p.locator('#editor-title').scrollIntoViewIfNeeded();
    const title = await box('#editor-title');
    await h.swipe(60, title.y + 10, 360, title.y + 10);
    await h.wait(200);
    check('changed and swiped back: closed without a question', asked === '' && !(await shown('#editor')), asked);
    p.removeAllListeners('dialog');

    await p.click('[data-el=chat-title]');
    await h.wait(300);
    const info = await box('#info-panel');
    check('the header opens the bot\'s page over the full screen', info && info.x === 0 && info.width === 400 && info.height >= 850, info);
    check('the page: model switch, open changes, the chat\'s entries', (await p.locator('#info-switches .model-switch .chip.on').count()) === 1
        && h.sent.some((f) => f.type === 'git_changes' && f.botId === 'pdf') && (await p.locator('#info-git .git-repo').count()) === 1
        && (await p.locator('#info-actions button[data-action]').count()) === 6);
    await p.click('#info-actions button[data-action="search"]');
    await h.wait(200);
    check('"Search in chat" leaves the page, the chat search is open', !(await shown('#info')) && (await shown('[data-el=chat-search]')) && (await p.evaluate(() => window.activePane().chatId)) === 'pdf');
    await p.click('[data-el=cs-close]');

    await p.setViewportSize({ width: 1200, height: 860 });
    await p.evaluate(() => window.openEditor(window.bot('pdf')));
    await h.wait(300);
    const wide = await box('#editor .dialog');
    check('PC: the editor stays a dialog without arrow', wide && wide.width <= 460 && !(await shown('#editor [data-page-back]')), wide);
    await p.click('#editor [data-close]');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('PC: the bot\'s page with the cross instead of the arrow', (await shown('#info .panel-head [data-close]')) && !(await shown('#info [data-page-back]')));
    check('no page errors', h.errors.length === 0, h.errors);
}
