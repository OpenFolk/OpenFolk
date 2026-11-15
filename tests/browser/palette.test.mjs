// The command palette (Ctrl+K) on a wide screen: chats, actions, routines, settings, messages of the last weeks with
// "Search older messages" and files, opened from the keyboard; the shortcuts, their overview (Ctrl+/) and the desktop
// menu's commands. On the phone the sidebar's search has chips for messages, bots, files and routines instead.
import { bot } from './harness.mjs';

const BOTS = [bot('cloud', 'Cloud Carlo', { conversations: [{ id: 'ab12', title: 'Release', createdAt: '' }] }), bot('skool', 'Skool Sven'), bot('anna', 'Anna')];
const at = (h) => `2026-11-1${h}T08:00:00Z`;
const history = {
    cloud: Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, role: i % 2 ? 'assistant' : 'user', from: 'me', botId: 'cloud', text: i === 3 ? 'The deploy to Coolify went through.' : `Message ${i} `.repeat(4), ts: `2026-11-10T08:${String(i).padStart(2, '0')}:00Z`, readAt: 'x' })),
    skool: [{ id: 's1', role: 'user', from: 'me', text: 'Hello Sven', ts: at(1), readAt: 'x' }],
    anna: [{ id: 'n1', role: 'user', from: 'me', text: 'Hello Anna', ts: at(2), readAt: 'x' }],
};
const WIDE = { viewport: { width: 1400, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

/** The backend's answer to the searches: recent, older and file hits for "deploy". */
function answer(f) {
    if (f.type !== 'search' || f.chatId) return null;
    const deploy = f.text.toLowerCase() === 'deploy';
    const hits = !deploy ? [] : f.files ? [{ chatId: 'skool', id: 's1', ts: at(1), from: 'me', excerpt: 'deploy-plan.pdf' }]
        : f.since ? [{ chatId: 'cloud', id: 'c3', ts: '2026-11-10T08:03:00Z', from: 'cloud', excerpt: 'The deploy to Coolify went through.' }]
            : [{ chatId: 'cloud', id: 'c3', ts: '2026-11-10T08:03:00Z', from: 'cloud', excerpt: 'The deploy to Coolify went through.' }, { chatId: 'anna', id: 'old1', ts: '2026-05-01T08:00:00Z', from: 'me', excerpt: 'Deploy in May' }];
    return { type: 'search_result', text: f.text, since: f.since, files: f.files, hits };
}

export default async function ({ start, check }) {
    const h = await start({
        bots: BOTS, history, context: WIDE,
        onSend: async (f, push) => { const a = answer(f); if (a) await push(a); },
    });
    const p = h.page;
    await p.evaluate(() => {
        state.routines.push({ id: 'r1', botId: 'skool', name: 'Nightly report', cron: '0 3 * * *', prompt: 'Summarize the day', enabled: true });
    });
    await h.push({ type: 'machine_status', configured: true, hosts: { laptop: {} } });
    const open = () => p.evaluate(() => !document.getElementById('palette').hidden);
    const options = () => p.evaluate(() => [...document.querySelectorAll('#palette-list [role=option]')].map((o) => o.querySelector('.palette-label').textContent));
    const sections = () => p.evaluate(() => [...document.querySelectorAll('#palette-list .palette-section')].map((o) => o.textContent));
    const selected = () => p.evaluate(() => document.querySelector('#palette-list [aria-selected=true] .palette-label')?.textContent);
    const type = async (text) => { await p.fill('#palette-input', text); await h.wait(450); };

    // ---- opening, without a query: the chats written in last and the actions
    await p.keyboard.press('Control+k');
    await h.wait(100);
    check('Ctrl+K opens the palette with the focus in its field', await open() && await p.evaluate(() => document.activeElement.id === 'palette-input'));
    check('accessible: a combobox controlling a listbox, the first option selected', await p.evaluate(() => {
        const input = document.getElementById('palette-input');
        const first = document.querySelector('#palette-list [role=option]');
        return input.getAttribute('role') === 'combobox' && input.getAttribute('aria-controls') === 'palette-list' && document.getElementById('palette-list').getAttribute('role') === 'listbox'
            && first.getAttribute('aria-selected') === 'true' && input.getAttribute('aria-activedescendant') === first.id;
    }));
    const empty = await options();
    check('without a query: recent chats first, then the actions with "Wake" for a machine that is off', empty[0] === 'Anna' && empty.includes('New bot') && empty.includes('New group') && empty.includes('Settings') && empty.includes('Status') && empty.includes('Wake LAPTOP') && empty.includes('Keyboard shortcuts'), empty);
    check('the actions show their keys', await p.evaluate(() => [...document.querySelectorAll('#palette-list [role=option]')].find((o) => o.textContent.includes('New bot')).querySelector('.palette-meta').textContent) === 'Ctrl + N');

    // ---- a bot, by the keyboard
    await type('carl');
    check('a bot by part of its name', (await options())[0] === 'Cloud Carlo', await options());
    await p.keyboard.press('Enter');
    await h.wait(300);
    check('Enter opens its chat and closes the palette', !(await open()) && await p.evaluate(() => activePane().chatId === 'cloud'));

    // ---- a conversation, arrows
    await p.keyboard.press('Control+k');
    await type('release');
    check('a conversation with its bot', (await options()).includes('Cloud Carlo · Release'), await options());
    await type('o');
    const first = await selected();
    await p.keyboard.press('ArrowDown');
    check('the arrow moves the selection', (await selected()) !== first && (await selected()) === (await options())[1], [first, await selected()]);
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('ArrowUp');
    check('… and wraps around at the top', (await selected()) === (await options()).at(-1), await selected());

    // ---- messages of the last weeks, older ones, files
    await type('deploy');
    const recent = h.sent.findLast((f) => f.type === 'search' && f.text === 'deploy' && f.since);
    const days = recent ? (Date.now() - Date.parse(recent.since)) / 864e5 : 0;
    check('messages are searched in the backend from four weeks ago', days > 27.9 && days < 28.1, recent);
    check('… and files by their names', h.sent.some((f) => f.type === 'search' && f.text === 'deploy' && f.files === true));
    check('sections for messages and files', JSON.stringify(await sections()) === JSON.stringify(['Messages', 'Files']), await sections());
    let list = await options();
    check('the recent hit, "Search older messages" and the file', list.join('|') === 'Cloud Carlo|Search older messages|Skool Sven', list);
    await p.locator('#palette-list [role=option]', { hasText: 'Search older messages' }).click();
    await h.wait(200);
    check('"Search older messages" asks without a limit and keeps the palette open', await open() && h.sent.findLast((f) => f.type === 'search' && f.text === 'deploy' && !f.files)?.since === undefined);
    list = await options();
    check('… then the older hit is there too', list.join('|') === 'Cloud Carlo|Anna|Skool Sven', list);
    await p.locator('#palette-list [role=option]').first().click();
    await h.wait(600);
    check('a message hit opens its chat at the message', await p.evaluate(() => { const b = document.querySelector('.bubble[data-eid="c3"]'); return !!b && b.classList.contains('highlighted'); }) && h.sent.findLast((f) => f.type === 'history' && f.chatId === 'cloud')?.limit === 5000);

    // ---- a routine, a block of the settings
    await p.keyboard.press('Control+k');
    await type('nightly');
    check('a routine, with its bot', (await options())[0] === 'Nightly report' && await p.evaluate(() => document.querySelector('#palette-list [role=option] .palette-sub').textContent.startsWith('Skool Sven')));
    await p.keyboard.press('Enter');
    await h.wait(300);
    check('… opens the routine\'s editor', await p.evaluate(() => !document.getElementById('routine-editor').hidden && document.getElementById('routine-name').value === 'Nightly report'));
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+k');
    await type('appear');
    check('a block of the settings', (await options())[0] === 'Appearance', await options());
    await p.keyboard.press('Enter');
    await h.wait(300);
    check('… opens the settings', await p.evaluate(() => !document.getElementById('settings').hidden));
    await p.keyboard.press('Escape');
    await h.wait(100);

    // ---- Escape gives the focus back
    await p.click('[data-el=text]');
    await p.keyboard.press('Control+k');
    await p.keyboard.press('Escape');
    check('Escape closes the palette and the focus goes back', !(await open()) && await p.evaluate(() => document.activeElement === activePane().el.text));

    // ---- the shortcuts
    await p.keyboard.press('Control+/');
    await h.wait(100);
    const overview = await p.evaluate(() => ({ shown: !document.getElementById('shortcuts').hidden, rows: document.querySelectorAll('#shortcuts-list dt').length, first: document.querySelector('#shortcuts-list dt').textContent, note: !document.getElementById('shortcuts-note').hidden }));
    check('Ctrl+/ shows the overview of the shortcuts, with the browser\'s keys noted', overview.shown && overview.rows >= 14 && overview.first === 'Ctrl + K' && overview.note, overview);
    await p.keyboard.press('Escape');
    check('Escape closes it', await p.evaluate(() => document.getElementById('shortcuts').hidden));
    await p.keyboard.press('Control+n');
    await h.wait(100);
    check('Ctrl+N: new bot', await p.evaluate(() => !document.getElementById('editor').hidden));
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+Shift+N');
    await h.wait(100);
    check('Ctrl+Shift+N: new group', await p.evaluate(() => !document.getElementById('group-editor').hidden));
    await p.keyboard.press('Control+b');
    check('… and no shortcut navigates behind a dialog', await p.evaluate(() => !document.getElementById('app').classList.contains('sidebar-hidden')));
    await p.keyboard.press('Escape');

    const listed = await p.evaluate(() => [...document.querySelectorAll('#chat-list > li[data-chat]')].map((li) => li.dataset.chat));
    await p.keyboard.press('Control+1');
    await h.wait(200);
    check('Ctrl+1: the first chat of the list', await p.evaluate(() => activePane().chatId) === listed[0], [listed, await p.evaluate(() => activePane().chatId)]);
    await p.keyboard.press('Alt+ArrowDown');
    await h.wait(200);
    const second = await p.evaluate(() => activePane().chatId);
    check('Alt+Down: the next one', second === listed[1], [listed, second]);
    await p.keyboard.press('Control+[');
    await h.wait(200);
    check('Ctrl+[: back to the chat before', await p.evaluate(() => activePane().chatId) === listed[0]);
    await p.keyboard.press('Control+]');
    await h.wait(200);
    check('Ctrl+]: forward again', await p.evaluate(() => activePane().chatId) === second);
    await p.keyboard.press('Alt+ArrowUp');
    await h.wait(200);
    check('Alt+Up: the previous one', await p.evaluate(() => activePane().chatId) === listed[0]);

    await p.click('#search');
    await p.keyboard.press('Control+i');
    check('Ctrl+I: into the input field', await p.evaluate(() => document.activeElement === activePane().el.text));
    await p.keyboard.press('Control+f');
    await h.wait(100);
    check('Ctrl+F: the search in the chat', await p.evaluate(() => !activePane().el.chatSearch.hidden && document.activeElement === activePane().el.csText));
    await p.keyboard.press('Escape');
    await p.fill('[data-el=text]', 'Sent from anywhere');
    await p.click('#search');
    await p.keyboard.press('Control+Enter');
    await h.wait(100);
    check('Ctrl+Enter sends, with the focus elsewhere', h.sent.some((f) => f.type === 'send' && f.text === 'Sent from anywhere' && f.chatId === listed[0]));
    check('… once', h.sent.filter((f) => f.type === 'send' && f.text === 'Sent from anywhere').length === 1);

    await p.keyboard.press('Control+b');
    await h.wait(100);
    check('Ctrl+B hides the chat list, the chats take its room', await p.evaluate(() => document.getElementById('app').classList.contains('sidebar-hidden') && getComputedStyle(document.querySelector('.sidebar')).display === 'none' && document.querySelector('.pane').getBoundingClientRect().left < 5));
    await p.keyboard.press('Control+b');
    await h.wait(100);
    check('… and shows it again', await p.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).display !== 'none'));
    await p.keyboard.press('Control+,');
    await h.wait(100);
    check('Ctrl+,: the settings', await p.evaluate(() => !document.getElementById('settings').hidden));
    await p.keyboard.press('Escape');

    // ---- the desktop app's menu
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('openfolk:command', { detail: 'palette' })));
    check('the desktop menu\'s command opens the palette', await open());
    await p.keyboard.press('Control+k');
    check('Ctrl+K again closes it', !(await open()));

    // ---- German
    await p.evaluate(() => chooseLanguage('de'));
    await h.wait(200);
    await p.keyboard.press('Control+/');
    check('German: the overview in German, Shift is "Umschalt"', await p.evaluate(() => [...document.querySelectorAll('#shortcuts-list dt')].some((d) => d.textContent === 'Ctrl + Umschalt + N') && document.getElementById('shortcuts-title').textContent === 'Tastenkürzel'));
    await p.keyboard.press('Escape');

    // ---- the phone: chips in the sidebar's search instead of the palette
    const m = await start({ bots: BOTS, history, onSend: async (f, push) => { const a = answer(f); if (a) await push(a); } });
    const q = m.page;
    await q.evaluate(() => state.routines.push({ id: 'r1', botId: 'skool', name: 'Nightly report', cron: '0 3 * * *', prompt: 'Summarize the day', enabled: true }));
    await q.evaluate(() => document.getElementById('search-box').classList.remove('closed'));
    await m.wait(300);
    const chips = await q.evaluate(() => [...document.querySelectorAll('#search-filters .chip')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.textContent));
    check('phone: chips for messages, bots, files and routines', chips.join('|') === 'Messages|Bots|Files|Routines', chips);
    const hits = () => q.evaluate(() => [...document.querySelectorAll('#search-results li')].map((l) => l.querySelector('.s-head')?.firstChild?.textContent ?? l.textContent));
    await q.click('#search-filters [data-filter=bots]');
    await q.fill('#search', 'sv');
    await m.wait(400);
    check('phone, bots: found by name without the backend', (await hits()).join('|') === 'Skool Sven' && !m.sent.some((f) => f.type === 'search'), await hits());
    await q.click('#search-filters [data-filter=routines]');
    await q.fill('#search', 'nightly');
    await m.wait(100);
    check('phone, routines', (await hits()).join('|') === 'Nightly report', await hits());
    await q.click('#search-filters [data-filter=files]');
    await q.fill('#search', 'deploy');
    await m.wait(500);
    check('phone, files: the backend matches the attachments\' names', m.sent.some((f) => f.type === 'search' && f.files === true) && (await hits()).join('|') === 'Skool Sven', await hits());
    await q.click('#search-filters [data-filter=messages]');
    await m.wait(500);
    const all = m.sent.findLast((f) => f.type === 'search');
    check('phone, messages: the last weeks first, then "Search older messages"', all && !all.files && !!all.since && (await hits()).join('|') === 'Cloud Carlo|Search older messages', [all, await hits()]);
    await q.click('#search-results li.search-older');
    await m.wait(300);
    check('phone, older: the whole history, newest first', !m.sent.findLast((f) => f.type === 'search').since && (await hits()).join('|') === 'Cloud Carlo|Anna', await hits());
    check('phone: the chips are radio buttons', await q.evaluate(() => document.querySelector('#search-filters [data-filter=messages]').getAttribute('aria-checked') === 'true' && document.querySelector('#search-filters [data-filter=files]').getAttribute('aria-checked') === 'false'));
}
