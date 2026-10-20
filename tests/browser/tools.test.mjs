// Tool outputs only when expanded (loaded from the machine of the history); an unchanged history is not re-rendered.
export default async function ({ start, check }) {
    const history = [
        { id: 'u1', role: 'user', from: 'me', text: 'Search a bit', ts: '2026-10-08T05:00:00Z', readAt: '2026-10-08T05:00:00Z' },
        {
            id: 'a1', role: 'assistant', botId: 'pdf', text: 'Found.', ts: '2026-10-08T05:00:05Z',
            tools: [{ id: 't1', name: 'Grep', summary: 'pattern', ok: true, deferred: true }, { id: 't2', name: 'Read', summary: 'file', ok: true, result: 'already there' }],
        },
    ];
    let delayAnswer = 0;
    let nextHistory = history;
    const h = await start({
        ownHistory: true,
        onSend: async (f, push) => {
            if (f.type === 'history') {
                const entries = f.limit ? history.slice(-f.limit) : nextHistory;
                const answer = () => push({ type: 'history', machine: 'desk', chatId: f.chatId, entries, live: [] });
                if (delayAnswer && !f.limit) setTimeout(answer, delayAnswer);
                else await answer();
            }
            if (f.type === 'tool_output') setTimeout(() => push({ ...f, machine: 'desk', result: f.toolId === 't1' ? 'lots of output' : undefined }), 200);
        },
    });
    const p = h.page;
    await h.openChat('PDF-Reader');
    const group = p.locator('[data-el=messages] details.tools');
    const rows = p.locator('[data-el=messages] .tool-list details.tool');
    check('finished answer: one collapsed summary row', (await group.count()) === 1 && !(await group.evaluate((d) => d.open)));
    check('the summary row names count and tools', (await group.locator('summary').textContent()).includes('2 tools') && (await group.locator('summary').textContent()).includes('Grep, Read'));
    check('single rows and outputs not in the DOM yet', (await rows.count()) === 0 && (await p.locator('[data-el=messages] pre').count()) === 0);
    await group.locator('summary').first().click();
    await h.wait(100);
    check('expanded: both tools on their own, collapsed', (await rows.count()) === 2 && (await p.locator('[data-el=messages] pre').count()) === 0);

    await rows.nth(1).locator('summary').click();
    await h.wait(100);
    check('an existing output is there right away when expanding', (await rows.nth(1).locator('pre').textContent()) === 'already there');
    check('no request for it', !h.sent.some((f) => f.type === 'tool_output'));

    await rows.first().locator('summary').click();
    await h.wait(50);
    const request = h.sent.find((f) => f.type === 'tool_output');
    check('a missing output is requested from the machine of the history',
        request && request.chatId === 'pdf' && request.entryId === 'a1' && request.toolId === 't1' && request.machine === 'desk', request);
    check('meanwhile "loading …"', (await rows.first().locator('pre').textContent()) === 'loading …');
    await h.wait(300);
    check('the output arrives', (await rows.first().locator('pre').textContent()) === 'lots of output');

    // open again: the remembered history right away, the same one from the machine is not re-rendered
    await p.evaluate(() => closeChat());
    delayAnswer = 400;
    await h.openChat('PDF-Reader');
    await p.evaluate(() => { document.querySelector('[data-el=messages] .bubble').dataset.mark = 'old'; });
    await h.wait(500);
    check('unchanged history: not re-rendered', (await p.locator('[data-el=messages] .bubble[data-mark="old"]').count()) === 1);
    check('loading bar gone anyway', await p.evaluate(() => document.querySelector('[data-el=loading-bar]').hidden));
    await group.locator('summary').first().click();
    await rows.first().locator('summary').click();
    await h.wait(100);
    check('the loaded output stays remembered', (await rows.first().locator('pre').textContent()) === 'lots of output');

    // changed history: re-render
    await p.evaluate(() => closeChat());
    nextHistory = [...history, { id: 'u2', role: 'user', from: 'me', text: 'Thanks', ts: '2026-10-08T05:01:00Z' }];
    await h.openChat('PDF-Reader');
    await p.evaluate(() => { document.querySelector('[data-el=messages] .bubble').dataset.mark = 'old'; });
    await h.wait(500);
    check('changed history: re-rendered', (await p.locator('[data-el=messages] .bubble[data-mark="old"]').count()) === 0 && (await p.locator('[data-el=messages] .bubble.me').count()) === 2);

    // running answer: tools one by one; done: collapsed into one row
    const tools = [{ id: 'l1', name: 'Bash', summary: 'ls' }, { id: 'l2', name: 'mcp__openfolk__send_file', summary: 'report.md' }];
    for (const tool of tools) await h.push({ type: 'tool', chatId: 'pdf', botId: 'pdf', tool });
    await h.wait(100);
    const last = p.locator('[data-el=messages] .answer').last();
    check('during the answer: tools one by one', (await last.locator('details.tool').count()) === 2 && (await last.locator('details.tools').count()) === 0);
    await h.push({ type: 'done', chatId: 'pdf', botId: 'pdf', durationMs: 900,
        entry: { id: 'a2', role: 'assistant', botId: 'pdf', text: 'Done.', ts: '2026-10-08T05:02:00Z', tools: tools.map((tool) => ({ ...tool, ok: true, durationMs: 400 })) } });
    await h.wait(100);
    const done = p.locator('[data-el=messages] .answer').last();
    check('done: one collapsed row with a short MCP name',
        (await done.locator('details.tools').count()) === 1 && (await done.locator('details.tools > summary').textContent()).includes('Bash, send_file'),
        await done.locator('details.tools > summary').textContent().catch(() => ''));
}
