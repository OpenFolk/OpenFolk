// A bot's chat shows its main chat and its conversations as tabs at the top: a tap switches the pane, "+" asks the
// bot's machine for a new conversation, a dot marks a tab that works or has something unread. No tabs without
// conversations, in a group or a person's chat.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [
            bot('skool', 'Skool Sven', { conversations: [{ id: 'aa11', title: 'Release', createdAt: '' }, { id: 'bb22', title: 'Docs', createdAt: '' }] }),
            bot('pdf', 'PDF-Reader'),
        ],
    });
    const p = h.page;
    const tabs = () => p.evaluate(() => {
        const nav = document.querySelector('.pane:not([hidden]) [data-el=conv-tabs]');
        return nav && !nav.hidden ? [...nav.querySelectorAll('.conv-tab')].map((k) => k.textContent + (k.classList.contains('on') ? '*' : '') + (k.querySelector('.dot') ? '•' : '')) : null;
    });
    const open = () => p.evaluate(() => activePane().chatId);

    await h.openChat('PDF-Reader');
    check('a bot without conversations: no tabs', (await tabs()) === null, await tabs());
    await p.evaluate(() => openChat('skool'));
    await h.wait(200);
    check('main chat, then the conversations in their order, then "+"', (await tabs())?.join('|') === 'Main chat*|Release|Docs|+', await tabs());
    const box = await p.locator('.pane:not([hidden]) [data-el=conv-tabs]').boundingBox();
    const head = await p.locator('.pane:not([hidden]) header.bar').boundingBox();
    check('the tabs sit right below the header', box && head && Math.abs(box.y - (head.y + head.height)) <= 2, { box, head });

    await p.locator('.pane:not([hidden]) .conv-tab', { hasText: 'Docs' }).click();
    await h.wait(200);
    check('a tap on a tab opens that conversation in the pane', (await open()) === 'skool~bb22' && (await tabs())?.join('|') === 'Main chat|Release|Docs*|+', [await open(), await tabs()]);

    await h.push({ type: 'state', machine: 'desk', botId: 'skool~aa11', state: 'thinking', chatId: 'skool~aa11' });
    await h.wait(150);
    check('a working conversation: a dot on its tab', (await tabs())?.includes('Release•'), await tabs());

    await p.locator('.pane:not([hidden]) .conv-tab.conv-new').click();
    await h.wait(100);
    const made = h.sent.findLast((f) => f.type === 'conversation_new');
    check('"+" asks for a new conversation of the bot', made?.botId === 'skool', made);

    await p.locator('.pane:not([hidden]) .conv-tab', { hasText: 'Main chat' }).click();
    await h.wait(200);
    check('back to the main chat', (await open()) === 'skool', await open());

    // A long press on a conversation's tab: the dialog to rename it; the tap that ends it opens nothing
    const tb = await p.locator('.pane:not([hidden]) .conv-tab', { hasText: 'Docs' }).boundingBox();
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }] });
    await h.wait(700);
    await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await h.wait(200);
    const dialog = await p.evaluate(() => ({ open: !document.getElementById('text-dialog').hidden, value: document.querySelector('#text-dialog input, #text-dialog textarea')?.value, focus: document.activeElement?.id }));
    check('long press on a tab: the rename dialog with its title', dialog.open && dialog.value === 'Docs' && dialog.focus === 'text-input' && (await open()) === 'skool', [dialog, await open()]);
    await p.fill('#text-dialog input', 'Documentation');
    await p.keyboard.press('Enter');
    await h.wait(200);
    const renamed = h.sent.findLast((f) => f.type === 'conversation_rename');
    check('… renamed: sent and shown on the tab', renamed?.chatId === 'skool~bb22' && renamed.title === 'Documentation' && (await tabs())?.some((x) => x.startsWith('Documentation')), [renamed, await tabs()]);
    await p.locator('.pane:not([hidden]) .conv-tab', { hasText: 'Main chat' }).click({ button: 'right' });
    await h.wait(150);
    check('the tab of the main chat has nothing to rename', await p.evaluate(() => document.getElementById('text-dialog').hidden));
    await p.locator('.pane:not([hidden]) .conv-tab', { hasText: 'Release' }).click({ button: 'right' });
    await h.wait(150);
    check('a right click with the mouse renames as well', await p.evaluate(() => !document.getElementById('text-dialog').hidden && document.getElementById('text-input').value === 'Release'));
    await p.keyboard.press('Escape');
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
