// Folders of the chat list: a heading per folder (even an empty one), folding, "+" → new folder, the chooser in a chat's
// menu, rename and delete by a long press on the heading, the field in the bot and group editors; running bots leave
// their folder for the top of the list meanwhile. The test plays the backend for the folder frames.
import { bot, onDialog } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader', { category: 'kunden' }), bot('cloud', 'Cloud Carlo'), bot('anna', 'Anna')],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['pdf', 'cloud'], createdAt: '', updatedAt: '' }],
        categories: [{ id: 'kunden', name: 'Kunden', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }],
        async onSend(f, push, state) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
            const of = (chatId) => (chatId.startsWith('g:') ? state.groups.find((g) => 'g:' + g.id === chatId) : state.bots.find((b) => b.id === chatId));
            if (f.type === 'category_save') {
                const c = state.categories.find((x) => x.id === f.category.id);
                if (c) c.name = f.category.name;
                else state.categories.push({ id: f.category.name.toLowerCase(), name: f.category.name, createdAt: 'now', updatedAt: 'now' });
                if (f.chatId) of(f.chatId).category = f.category.name.toLowerCase();
            }
            if (f.type === 'category_assign') of(f.chatId).category = f.categoryId || undefined;
            if (f.type === 'category_delete') {
                state.categories = state.categories.filter((c) => c.id !== f.categoryId);
                for (const o of [...state.bots, ...state.groups]) if (o.category === f.categoryId) delete o.category;
            }
            if (f.type.startsWith('category_')) await h.sendBots();
        },
    });
    const p = h.page;
    await onDialog(p, (d) => d.accept());
    const sections = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li')].map((l) => l.classList.contains('section') ? `[${l.textContent}]` : l.querySelector('.name').firstChild.textContent.trim()).join(' '));
    const sent = (type) => h.sent.filter((f) => f.type === type);
    // without the back arrow of the menu's head on the phone (no text)
    const menuItems = async () => (await p.locator('#row-menu button').allTextContents()).filter(Boolean);
    const openMenu = async (selector) => { await p.locator(selector).click({ button: 'right' }); await h.wait(100); };

    check('a folder heading with its bot, the rest under "No folder"', (await sections()) === '[Kunden] PDF-Reader [No folder] Cloud Carlo Anna Team', await sections());

    // folding: a tap on the heading, remembered across renders
    await p.click('#chat-list li.section[data-category="kunden"]');
    await h.wait(100);
    check('folded: the bot hidden, the count on the heading', (await sections()) === '[Kunden1] [No folder] Cloud Carlo Anna Team' && await p.evaluate(() => document.querySelector('#chat-list li.section[data-category="kunden"]').classList.contains('closed')), await sections());
    await p.evaluate(() => renderChatList());
    check('stays folded after a render', (await sections()) === '[Kunden1] [No folder] Cloud Carlo Anna Team', await sections());
    await p.click('#chat-list li.section[data-category="kunden"]');
    await h.wait(100);
    check('unfolded again', (await sections()) === '[Kunden] PDF-Reader [No folder] Cloud Carlo Anna Team', await sections());

    // "+" → new folder: a name in the text dialog, the backend answers with the list
    await p.click('#btn-new');
    await p.click('#new-menu [data-new="category"]');
    await h.wait(100);
    check('the text dialog asks for the name', await p.evaluate(() => !document.getElementById('text-dialog').hidden && document.activeElement === document.getElementById('text-input')));
    await p.keyboard.type('Intern');
    await p.keyboard.press('Enter');
    await h.wait(200);
    check('sent as a new folder', sent('category_save').length === 1 && sent('category_save')[0].category.id === '' && sent('category_save')[0].category.name === 'Intern', sent('category_save'));
    check('listed by name, empty folders too', (await sections()) === '[Intern] [Kunden] PDF-Reader [No folder] Cloud Carlo Anna Team', await sections());

    // the chooser in a chat's menu
    await openMenu('#chat-list li[data-chat="cloud"]');
    check('the menu offers the folder', (await menuItems()).includes('Folder'), await menuItems());
    await p.locator('#row-menu button', { hasText: 'Folder' }).click();
    await h.wait(100);
    check('the chooser: none (current), the folders, a new one', (await menuItems()).join('|') === 'No folder|Intern|Kunden|New folder …' && await p.evaluate(() => document.querySelector('#row-menu .menu-info').textContent === 'Into which folder?'), await menuItems());
    await p.locator('#row-menu button', { hasText: 'Kunden' }).click();
    await h.wait(100);
    check('into the folder: sent, in the list right away, menu closed', sent('category_assign').length === 1 && sent('category_assign')[0].chatId === 'cloud' && sent('category_assign')[0].categoryId === 'kunden'
        && (await sections()) === '[Intern] [Kunden] PDF-Reader Cloud Carlo [No folder] Anna Team' && await p.evaluate(() => document.getElementById('row-menu').hidden), await sections());
    await openMenu('#chat-list li[data-chat="pdf"]');
    check('a bot in a folder: the entry names it', (await menuItems()).includes('Folder: Kunden'), await menuItems());
    await p.evaluate(() => { document.getElementById('row-menu').hidden = true; });
    await openMenu('#chat-list li[data-chat="anna"]');
    await p.locator('#row-menu button', { hasText: 'Folder' }).click();
    await p.locator('#row-menu button', { hasText: 'New folder …' }).click();
    await p.keyboard.type('Extern');
    await p.keyboard.press('Enter');
    await h.wait(200);
    const withChat = sent('category_save')[1];
    check('a new folder from the chooser takes the chat along', withChat && withChat.category.name === 'Extern' && withChat.chatId === 'anna' && (await sections()) === '[Extern] Anna [Intern] [Kunden] PDF-Reader Cloud Carlo [No folder] Team', await sections());

    // rename and delete by a long press (with the mouse: right click) on the heading
    await openMenu('#chat-list li.section[data-category="kunden"]');
    check('the heading\'s menu: rename, delete', (await menuItems()).join('|') === 'Rename folder|Delete folder', await menuItems());
    await p.locator('#row-menu button', { hasText: 'Rename folder' }).click();
    await h.wait(100);
    check('the dialog with the name', (await p.inputValue('#text-input')) === 'Kunden');
    await p.keyboard.type('Kundschaft');
    await p.keyboard.press('Enter');
    await h.wait(200);
    const rename = sent('category_save')[2];
    check('renamed: sent, shown right away', rename && rename.category.id === 'kunden' && rename.category.name === 'Kundschaft' && (await sections()).includes('[Kundschaft] PDF-Reader'), await sections());

    // a running bot sits at the top meanwhile, whatever folder it is in
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'thinking', chatId: 'pdf' });
    await h.wait(150);
    check('running: at the top, its folder stays listed', (await sections()) === '[Running now] PDF-Reader [Extern] Anna [Intern] [Kundschaft] Cloud Carlo [No folder] Team', await sections());
    await h.push({ type: 'state', machine: 'desk', botId: 'pdf', state: 'idle' });
    await h.wait(150);

    // the editors
    await openMenu('#chat-list li[data-chat="cloud"]');
    await p.locator('#row-menu button', { hasText: 'Edit bot' }).click();
    await h.wait(200);
    const options = await p.evaluate(() => [...document.querySelectorAll('#editor-category option')].map((o) => o.value + '=' + o.textContent).join('|'));
    check('bot editor: the folders to choose from, the current one chosen', options === '=No folder|extern=Extern|intern=Intern|kunden=Kundschaft' && (await p.inputValue('#editor-category')) === 'kunden', options);
    await p.selectOption('#editor-category', 'intern');
    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    check('saving sends the folder', sent('bot_save').at(-1)?.bot.category === 'intern', sent('bot_save').at(-1));
    await openMenu('#chat-list li[data-chat="g:team"]');
    await p.locator('#row-menu button', { hasText: 'Edit group' }).click();
    await h.wait(200);
    check('group editor: no folder chosen', (await p.inputValue('#group-category')) === '');
    await p.selectOption('#group-category', 'kunden');
    await p.click('#group-form button[type=submit]');
    await h.wait(200);
    check('the group is saved with the folder', sent('group_save').at(-1)?.group.category === 'kunden', sent('group_save').at(-1));

    // delete: the bots stay, without a folder; without any folder the list is as before
    await openMenu('#chat-list li.section[data-category="kunden"]');
    await p.locator('#row-menu button', { hasText: 'Delete folder' }).click();
    await h.wait(200);
    check('deleted: sent, the bots under "No folder"', sent('category_delete').length === 1 && sent('category_delete')[0].categoryId === 'kunden'
        && (await sections()) === '[Extern] Anna [Intern] [No folder] PDF-Reader Cloud Carlo Team', await sections());
    for (const id of ['extern', 'intern']) {
        await openMenu(`#chat-list li.section[data-category="${id}"]`);
        await p.locator('#row-menu button', { hasText: 'Delete folder' }).click();
        await h.wait(200);
    }
    check('no folder left: no headings', (await sections()) === 'PDF-Reader Cloud Carlo Anna Team', await sections());
    check('no errors', h.errors.length === 0, h.errors);
}
