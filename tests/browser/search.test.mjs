// Search across all chats: hits instead of the chat list, search word marked, a tap opens the chat and jumps to the message.
import { bot } from './harness.mjs';

const long = Array.from({ length: 40 }, (_, i) => ({ id: 'e' + i, role: i % 2 ? 'assistant' : 'user', from: 'me', botId: 'cloud', text: i === 3 ? 'The deploy to Coolify went through, commit abc123.' : `Message ${i} `.repeat(5), ts: `2026-10-07T${String(8 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00Z`, readAt: 'x' }));

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('cloud', 'Cloud Carlo'), bot('skool', 'Skool Sven', { conversations: [{ id: 'ab12', title: 'Release', createdAt: '' }] })],
        history: { cloud: long },
        onSend: async (f, push) => {
            if (f.type !== 'search') return;
            const hits = f.text.toLowerCase() === 'deploy' ? [
                { chatId: 'skool~ab12', id: 's1', ts: '2026-10-08T11:00:00Z', from: 'me', excerpt: 'When does the next deploy go out?' },
                { chatId: 'cloud', id: 'e3', ts: '2026-10-07T08:30:00Z', from: 'cloud', excerpt: 'The deploy to Coolify went through, commit abc123.' },
            ] : [];
            await push({ type: 'search_result', text: f.text, hits });
        },
    });
    const p = h.page;
    const fieldOpen = () => p.evaluate(() => document.getElementById('search-box').getBoundingClientRect().height > 20);
    check('search box on the phone collapsed at first', !(await fieldOpen()));
    const list = await p.evaluate(() => { const r = document.getElementById('chat-list').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; });
    await h.swipe(list.x, list.y, list.x + 5, list.y + 30, 5, 20);
    await h.wait(300);
    check('a short pull (30 px) does not open it', !(await fieldOpen()));
    await h.swipe(list.x, list.y, list.x + 5, list.y + 120, 8, 20);
    await h.wait(300);
    check('pulling the list down opens the search box', await fieldOpen());
    await p.fill('#search', 'd');
    await h.wait(400);
    check('one character: no search yet, chat list visible', !h.sent.some((f) => f.type === 'search') && await p.evaluate(() => !document.getElementById('chat-list').hidden));
    await p.fill('#search', 'Deploy');
    await h.wait(500);
    check('the search goes to the backend', h.sent.some((f) => f.type === 'search' && f.text === 'Deploy'));
    const rows = await p.evaluate(() => [...document.querySelectorAll('#search-results li')].map((l) => ({ head: l.querySelector('.s-head').firstChild.textContent, text: l.querySelector('.s-text').textContent, mark: l.querySelector('mark')?.textContent })));
    check('hits replace the chat list', await p.evaluate(() => document.getElementById('chat-list').hidden && !document.getElementById('search-results').hidden));
    check('chat name, conversation with title, sender and marked word', rows.length === 2 && rows[0].head === 'Skool Sven · Release' && rows[1].head === 'Cloud Carlo' && rows[1].text.startsWith('Cloud Carlo: ') && rows[1].mark === 'deploy', rows);
    await p.locator('#search-results li').nth(1).click();
    await h.wait(600);
    const request = h.sent.findLast((f) => f.type === 'history' && f.chatId === 'cloud');
    check('opens the chat and fetches more history', request && request.limit === 5000, request);
    check('jumps to the message and highlights it', await p.evaluate(() => { const b = document.querySelector('.bubble[data-eid="e3"]'); if (!b) return false; const r = b.getBoundingClientRect(); return b.classList.contains('highlighted') && r.top > 0 && r.bottom < innerHeight; }));
    const marks = () => p.evaluate(() => [...document.querySelectorAll('[data-el=messages] mark.search-mark')].map((m) => `${m.closest('.bubble').dataset.eid}:${m.textContent}${m.classList.contains('current') ? '!' : ''}`).join(' '));
    check('search word marked in the chat, strongly at the hit', (await marks()) === 'e3:deploy!', await marks());
    await p.click('[data-el=btn-back]');
    await h.wait(200);
    await p.evaluate(() => [...document.querySelectorAll('#chat-list li')].find((l) => l.textContent.includes('Cloud Carlo')).click());
    await h.wait(400);
    check('chat opened normally: no marks', (await marks()) === '', await marks());
    await p.click('[data-el=btn-back]');
    await h.wait(200);
    check('back: the hits are still there', await p.evaluate(() => !document.getElementById('search-results').hidden));
    await p.fill('#search', 'xyz');
    await h.wait(500);
    check('nothing found', (await p.locator('#search-results li').textContent()).includes('Nothing found'));
    await p.locator('#search-box .field-clear').click();
    await h.wait(200);
    check('× in the field: search cleared, chat list back, field open', await p.evaluate(() => document.getElementById('search').value === '' && !document.getElementById('chat-list').hidden && document.getElementById('search-results').hidden) && await fieldOpen());
    await p.fill('#search', 'xyz');
    await h.wait(500);
    await p.fill('#search', '');
    await h.wait(100);
    check('field emptied: chat list back', await p.evaluate(() => !document.getElementById('chat-list').hidden && document.getElementById('search-results').hidden));
    check('empty but still focused: stays open', await fieldOpen());
    await p.evaluate(() => { document.getElementById('search').blur(); const l = document.getElementById('chat-list'); l.style.paddingBottom = '2000px'; l.scrollTop = 200; });
    await h.wait(400);
    check('empty and list scrolled down: collapses again', !(await fieldOpen()));
}
