// Search in a chat: "Search in chat" on the bot's page, counter, ▲ older / ▼ newer hit, older ones are loaded on demand.
const all = Array.from({ length: 40 }, (_, i) => ({
    id: 'e' + i, role: i % 2 ? 'assistant' : 'user', from: 'me', botId: 'pdf', readAt: '2026-10-08T04:00:00Z',
    text: i === 2 ? 'First deploy to Coolify.' : i === 35 ? 'Second deploy, this time with tests.' : `Message ${i} `.repeat(6),
    ts: `2026-10-08T05:${String(i).padStart(2, '0')}:00Z`,
}));

export default async function ({ start, check }) {
    const h = await start({
        ownHistory: true,
        onSend: async (f, push) => {
            // at first only the last 10, with limit 5000 everything
            if (f.type === 'history') await push({ type: 'history', chatId: f.chatId, entries: f.limit && f.limit < 10 ? all.slice(-f.limit) : f.limit ? all : all.slice(-10), live: [] });
            if (f.type === 'search' && f.chatId) {
                await push({ type: 'search_result', text: f.text, chatId: f.chatId, hits: f.text.toLowerCase() === 'deploy' ? [
                    { chatId: 'pdf', id: 'e35', ts: all[35].ts, from: 'pdf', excerpt: all[35].text },
                    { chatId: 'pdf', id: 'e2', ts: all[2].ts, from: 'me', excerpt: all[2].text },
                ] : [] });
            }
        },
    });
    const p = h.page;
    const highlighted = (id) => p.evaluate((id) => { const b = document.querySelector(`.bubble[data-eid="${id}"]`); if (!b) return false; const r = b.getBoundingClientRect(); return b.classList.contains('highlighted') && r.top > 0 && r.bottom < innerHeight; }, id);
    const count = () => p.locator('[data-el=cs-count]').textContent();
    await h.openChat('PDF');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('"Search in chat" on the bot\'s page', (await p.locator('#info-actions button[data-action="search"]').textContent()) === 'Search in chat');
    await p.click('#info-actions button[data-action="search"]');
    await h.wait(100);
    check('the page closes, search bar open and focused', await p.isHidden('#info') && await p.evaluate(() => !document.querySelector('[data-el=chat-search]').hidden && document.activeElement.dataset.el === 'cs-text'));
    await p.type('[data-el=cs-text]', 'Deploy');
    await h.wait(500);
    const request = h.sent.find((f) => f.type === 'search');
    check('search only in this chat', request && request.chatId === 'pdf' && request.text === 'Deploy', request);
    check('newest hit jumped to, counter 1/2', (await count()) === '1/2' && await highlighted('e35'), await count());
    const marks = () => p.evaluate(() => [...document.querySelectorAll('mark.search-mark')].map((m) => `${m.closest('.bubble').dataset.eid}:${m.textContent}${m.classList.contains('current') ? '!' : ''}`).join(' '));
    check('search word strongly marked in the message jumped to', (await marks()) === 'e35:deploy!', await marks());
    await p.click('[data-el=cs-older]');
    await h.wait(500);
    check('▲: an older hit outside the loaded history is loaded', h.sent.some((f) => f.type === 'history' && f.limit === 5000));
    check('▲: jumped to the older one, counter 2/2', (await count()) === '2/2' && await highlighted('e2'), await count());
    check('after loading: both marked, the current one strongly', (await marks()) === 'e2:deploy! e35:deploy', await marks());
    check('at the oldest ▲ is disabled', await p.evaluate(() => document.querySelector('[data-el=cs-older]').disabled));
    await p.click('[data-el=cs-newer]');
    await h.wait(400);
    check('▼: back to the newer one', (await count()) === '1/2' && await highlighted('e35'));
    await p.fill('[data-el=cs-text]', 'xyz');
    await h.wait(500);
    check('no hit: counter 0', (await count()) === '0');
    check('new search word: old marks gone', (await marks()) === '');
    await p.fill('[data-el=cs-text]', 'Deploy');
    await h.wait(500);
    const clear = p.locator('[data-el=chat-search] .field-clear');
    check('× in the field visible as soon as there is text', await clear.isVisible());
    await clear.click();
    await h.wait(200);
    check('× in the field: text and marks gone, bar stays open and focused', await p.evaluate(() => document.querySelector('[data-el=cs-text]').value === '' && !document.querySelector('[data-el=chat-search]').hidden && document.activeElement.dataset.el === 'cs-text') && (await marks()) === '' && (await count()) === '');
    check('empty field: no ×', !(await clear.isVisible()));
    await p.fill('[data-el=cs-text]', 'Deploy');
    await h.wait(500);
    await p.click('[data-el=cs-close]');
    check('× closes the search bar and removes the marks', await p.evaluate(() => document.querySelector('[data-el=chat-search]').hidden) && (await marks()) === '');
    check('text of the message unchanged afterwards', (await p.locator('.bubble[data-eid="e35"] .content').textContent()).trim() === 'Second deploy, this time with tests.');
}
