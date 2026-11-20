// Moving in the chat list's folders: a bot dragged onto a folder's heading goes into it, onto "In no folder" out of it;
// a folder dragged onto another takes its place; on the phone the folder's menu moves it up or down.
import { bot } from './harness.mjs';

/** Runs in the page before the app: a mouse instead of the harness' touch screen (dragging needs one). */
function finePointer() {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(pointer: fine)' ? /** @type {any} */ ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) : original(q));
}

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('cloud', 'Cloud Carlo'), bot('mail', 'Marie', { category: 'agenten' })],
        categories: [
            { id: 'agenten', name: 'Agenten', createdAt: '', updatedAt: '' },
            { id: 'delivery', name: 'Delivery', createdAt: '', updatedAt: '' },
            { id: 'kunden', name: 'Kunden', createdAt: '', updatedAt: '' },
        ],
        before: finePointer,
        async onSend(f, push, state) {
            if (f.type === 'category_assign') state.bots.find((b) => b.id === f.chatId).category = f.categoryId || undefined;
            if (f.type === 'category_order') f.ids.forEach((id, order) => { state.categories.find((c) => c.id === id).order = order; });
            if (f.type.startsWith('category_')) await h.sendBots();
        },
    });
    const p = h.page;
    const headings = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li.section.category .name')].map((n) => n.textContent).join(','));
    const sent = (type) => h.sent.filter((f) => f.type === type);
    // Drag and drop as the browser does it: one DataTransfer through dragstart, dragover and drop
    const drag = (from, to, below = false) => p.evaluate(({ from, to, below }) => {
        const a = document.querySelector(from);
        const b = document.querySelector(to);
        const dt = new DataTransfer();
        a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        const r = b.getBoundingClientRect();
        const y = below ? r.bottom - 2 : r.top + 2;
        b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
    }, { from, to, below });

    check('folders by name to begin with', (await headings()) === 'Agenten,Delivery,Kunden', await headings());
    check('"In no folder" stands as a drop place', await p.isVisible('#chat-list li.section[data-category=""]'));

    await drag('#chat-list li[data-chat="cloud"]', '#chat-list li.section[data-category="agenten"]');
    await h.wait(200);
    check('a bot dropped on a folder goes into it', sent('category_assign').at(-1)?.chatId === 'cloud' && sent('category_assign').at(-1)?.categoryId === 'agenten', sent('category_assign'));
    await drag('#chat-list li[data-chat="mail"]', '#chat-list li.section[data-category=""]');
    await h.wait(200);
    check('… on "In no folder" out of its folder', sent('category_assign').at(-1)?.chatId === 'mail' && sent('category_assign').at(-1)?.categoryId === '');

    await drag('#chat-list li.section[data-category="kunden"]', '#chat-list li.section[data-category="agenten"]');
    await h.wait(200);
    check('a folder dropped on the upper half of another goes before it', (await headings()) === 'Kunden,Agenten,Delivery' && JSON.stringify(sent('category_order').at(-1)?.ids) === '["kunden","agenten","delivery"]', await headings());
    await drag('#chat-list li.section[data-category="kunden"]', '#chat-list li.section[data-category="delivery"]', true);
    await h.wait(200);
    check('… on the lower half after it', (await headings()) === 'Agenten,Delivery,Kunden', await headings());

    // Without a mouse: the folder's menu (right click here, a long press on the phone)
    await p.click('#chat-list li.section[data-category="delivery"]', { button: 'right' });
    await h.wait(150);
    const entries = await p.locator('#row-menu button').allTextContents();
    check('the folder\'s menu offers up and down', entries.includes('Move up') && entries.includes('Move down'), entries);
    await p.locator('#row-menu button', { hasText: 'Move up' }).click();
    await h.wait(200);
    check('"Move up" moves it one place up', (await headings()) === 'Delivery,Agenten,Kunden', await headings());
    await p.click('#chat-list li.section[data-category="delivery"]', { button: 'right' });
    await h.wait(150);
    check('the first folder: no "Move up"', !(await p.locator('#row-menu button').allTextContents()).includes('Move up'));
    check('no page errors', h.errors.length === 0, h.errors);
}
