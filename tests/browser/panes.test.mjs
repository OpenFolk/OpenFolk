// Several chats side by side on a wide screen: Ctrl-click opens a chat in a new pane, every pane takes its own
// input, frames land in the pane of their chat, both visible chats count as read, a chat is never open twice,
// narrowing the window parks panes with their draft, a reload brings them back. Phones keep one pane.
import { bot } from './harness.mjs';

const BOTS = [bot('pdf', 'PDF-Reader'), bot('anna', 'Anna'), bot('carl', 'Carl')];
const visible = (page) => page.evaluate(() => [...document.querySelectorAll('.pane:not([hidden])')].map((p) => p.querySelector('[data-el=chat-name]').firstChild?.textContent));
const paneText = (page, i, selector) => page.evaluate(([i, selector]) => {
    const p = document.querySelectorAll('.pane')[i];
    return [...p.querySelectorAll(selector)].map((n) => n.textContent.trim()).join('|');
}, [i, selector]);

export default async function ({ start, check }) {
    const h = await start({
        bots: BOTS,
        history: {
            pdf: [{ id: 'p1', role: 'user', from: 'me', text: 'Hello PDF', ts: '2026-10-14T08:00:00Z', readAt: '2026-10-14T08:00:01Z' }],
            anna: [{ id: 'a1', role: 'user', from: 'me', text: 'Hello Anna', ts: '2026-10-14T08:00:00Z', readAt: '2026-10-14T08:00:01Z' }],
        },
    });
    const p = h.page;
    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    check('wide, no chat yet: the + strip is there', await p.isVisible('#pane-add'));
    await h.openChat('PDF');
    check('wide: one pane, the + strip offers a second', (await visible(p)).join() === 'PDF-Reader' && await p.isVisible('#pane-add'));

    // ---- Ctrl-click opens beside
    await p.locator('#chat-list li', { hasText: 'Anna' }).first().click({ modifiers: ['Control'] });
    // the list redraws only after the tap is over (listTap)
    await h.wait(500);
    check('Ctrl-click: Anna opens in a second pane', (await visible(p)).join() === 'PDF-Reader,Anna', await visible(p));
    check('two panes lift the width cap', await p.evaluate(() => document.querySelector('.app').classList.contains('multi') && Math.round(document.querySelector('.app').getBoundingClientRect().width) === 1900));
    check('no room for a third: no + strip', !(await p.isVisible('#pane-add')));
    check('each pane shows its own history', (await paneText(p, 0, '.bubble .text')) === 'Hello PDF' && (await paneText(p, 1, '.bubble .text')) === 'Hello Anna');
    check('list: Anna active, PDF open beside', await p.evaluate(() => document.querySelector('#chat-list li[data-chat="anna"]').classList.contains('active') && document.querySelector('#chat-list li[data-chat="pdf"]').classList.contains('open')));

    // ---- typing in each pane
    const texts = p.locator('[data-el=text]');
    await texts.nth(0).fill('Draft for PDF');
    await texts.nth(1).fill('Question to Anna');
    await texts.nth(1).press('Enter');
    await h.wait(200);
    const sentTo = h.sent.filter((f) => f.type === 'send').map((f) => `${f.chatId}:${f.text}`);
    check('Enter in pane 2 sends to Anna', sentTo.join() === 'anna:Question to Anna', sentTo);
    check('the draft in pane 1 stays', (await texts.nth(0).inputValue()) === 'Draft for PDF');

    // ---- frames land in their pane
    await h.push({ type: 'delta', chatId: 'pdf', botId: 'pdf', text: 'Reading the file' });
    await h.wait(300);
    check('a running answer of PDF shows in pane 1 only', (await paneText(p, 0, '.answer.live .content')) === 'Reading the file' && (await paneText(p, 1, '.answer.live')) === '');
    await h.push({ type: 'approval', machine: 'desk', approval: { id: 'ap1', chatId: 'anna', botId: 'anna', kind: 'tool', tool: 'Bash', summary: 'Run rm -rf build', detail: '', ts: '2026-10-14T08:01:00Z' } });
    await h.wait(200);
    check('an approval for Anna shows in pane 2 only', (await paneText(p, 1, '.approval .approval-what')) === 'Run rm -rf build' && (await paneText(p, 0, '.approval')) === '');
    await h.push({ type: 'done', chatId: 'pdf', botId: 'pdf', entry: { id: 'p2', role: 'assistant', botId: 'pdf', text: 'Done reading', ts: new Date().toISOString() }, durationMs: 1 });
    await h.push({ type: 'done', chatId: 'anna', botId: 'anna', entry: { id: 'a2', role: 'assistant', botId: 'anna', text: 'Done thinking', ts: new Date().toISOString() }, durationMs: 1 });
    await h.wait(200);
    check('answers in both visible chats count as read', await p.evaluate(() => !window.isUnread('pdf') && !window.isUnread('anna')));

    // ---- a chat is open once
    await h.openChat('PDF');
    check('clicking a chat that is open focuses its pane', (await visible(p)).join() === 'PDF-Reader,Anna' && await p.evaluate(() => window.activePane() === window.panes[0]));

    // ---- narrowing parks, widening brings back
    await texts.nth(1).fill('Anna draft');
    await h.openChat('PDF');
    await p.setViewportSize({ width: 1200, height: 900 });
    await h.wait(200);
    check('1200 px: only the active pane remains visible', (await visible(p)).join() === 'PDF-Reader', await visible(p));
    await h.push({ type: 'done', chatId: 'anna', botId: 'anna', entry: { id: 'a3', role: 'assistant', botId: 'anna', text: 'While parked', ts: new Date().toISOString() }, durationMs: 1 });
    await h.wait(200);
    check('a parked chat gets unread', await p.evaluate(() => window.isUnread('anna')));
    await p.setViewportSize({ width: 1900, height: 900 });
    await h.wait(200);
    check('1900 px again: the parked pane is back with its draft', (await visible(p)).join() === 'PDF-Reader,Anna' && (await texts.nth(1).inputValue()) === 'Anna draft');

    // ---- reload restores the panes of this device
    await p.reload();
    await h.wait(900);
    check('after a reload both panes are back', (await visible(p)).join() === 'PDF-Reader,Anna', await visible(p));

    // ---- closing
    await p.locator('.pane:not([hidden]) [data-el=btn-close]').nth(1).click();
    await h.wait(200);
    check('× closes the second pane', (await visible(p)).join() === 'PDF-Reader' && await p.evaluate(() => window.panes.length === 1));
    check('a single pane has no close button', !(await p.isVisible('[data-el=btn-close]')));

    // ---- + adds an empty pane; the next chat from the list goes there
    await p.click('#pane-add');
    await h.wait(200);
    check('+ adds an empty pane with a hint', await p.evaluate(() => window.panes.length === 2 && window.panes[1].root.classList.contains('no-chat')) && await p.isVisible('.pane.no-chat .pane-empty'));
    await h.openChat('Carl');
    check('the next chat opens in the empty pane', (await visible(p)).join() === 'PDF-Reader,Carl', await visible(p));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();

    // ---- phone: one pane, Ctrl-click like a click
    const phone = await start({ bots: BOTS });
    await phone.openChat('PDF');
    await phone.page.locator('[data-el=btn-back]').click();
    await phone.wait(200);
    await phone.page.locator('#chat-list li', { hasText: 'Anna' }).first().click({ modifiers: ['Control'] });
    await phone.wait(300);
    check('phone: Ctrl-click opens in the one pane', await phone.page.evaluate(() => window.panes.length === 1 && window.panes[0].chatId === 'anna'));
    check('phone: no + strip', !(await phone.page.isVisible('#pane-add')));
    await phone.close();
}
