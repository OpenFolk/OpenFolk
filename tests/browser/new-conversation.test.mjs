// New conversation from the overview: "+" → "New conversation" shows the bots, a tap creates and opens it.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('cloud', 'Cloud Carlo'), bot('pdf', 'PDF-Reader', { machine: 'workstation' })],
        onSend: async (f, push, z) => {
            if (f.type !== 'conversation_new') return;
            z.bots.find((b) => b.id === f.botId).conversations = [{ id: 'cc33', title: '', createdAt: '' }];
            await push({ type: 'bots', machine: 'desk', bots: z.bots, groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
            await push({ type: 'conversation_created', chatId: `${f.botId}~cc33` });
        },
    });
    const p = h.page;
    const entries = () => p.evaluate(() => [...document.querySelectorAll('#new-menu button')].map((b) => b.textContent.trim() + (b.disabled ? ' (disabled)' : '')));

    await p.click('#btn-new');
    await p.locator('#new-menu button span', { hasText: 'New conversation' }).click();
    await h.wait(100);
    check('the menu stays open and shows the bots', await p.evaluate(() => !document.getElementById('new-menu').hidden), await entries());
    check('sleeping bot disabled', (await entries()).join('|') === 'Skool Sven|Cloud Carlo|PDF-Reader · asleep (disabled)', await entries());
    check('the menu says what a new conversation is', (await p.textContent('#new-menu .menu-info')).includes('without the history of its other chats'));
    await p.locator('#new-menu button', { hasText: 'Cloud Carlo' }).click();
    await h.wait(300);
    const request = h.sent.find((f) => f.type === 'conversation_new');
    check('request to the bot\'s machine', request && request.botId === 'cloud' && request.machine === 'desk', request);
    check('new conversation opened', await p.evaluate(() => document.getElementById('app').classList.contains('chat-open')
        && document.querySelector('[data-el=chat-name]').textContent === 'New conversation' && document.querySelector('[data-el=chat-sub]').textContent.startsWith('Cloud Carlo')));
    check('the empty conversation says what it is for', await p.isVisible('.conversation-hint') && (await p.textContent('.conversation-hint')).includes('Cloud Carlo') && (await p.textContent('.conversation-hint')).includes('without the history'));
    // The backend echoes the user's message as a frame
    await h.push({ type: 'user', chatId: 'cloud~cc33', entry: { id: 'u1', role: 'user', from: 'me', text: 'First task', ts: '2026-10-08T05:00:00Z' } });
    await h.wait(200);
    check('gone as soon as there is a message', !(await p.isVisible('.conversation-hint')));
    check('menu closed afterwards', await p.evaluate(() => document.getElementById('new-menu').hidden));

    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Skool Sven');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('bot page: "New conversation" explains itself in its tooltip', (await p.getAttribute('#info-actions [data-action=conversation_new], #info-switches [data-action=conversation_new]', 'title') || '').includes('Good for a new task'));
    await p.locator('#info [data-close], #info [data-page-back]').locator('visible=true').first().click();
    await h.wait(200);
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await p.click('#btn-new');
    check('opened again: the basic entries again', (await entries()).join('|') === 'New conversation|New bot|New group|New folder|Machine sessions', await entries());
}
