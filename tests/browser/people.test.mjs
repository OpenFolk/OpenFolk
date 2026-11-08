// Person chats: "+" → "Person" opens a chat with someone on the relay, messages go out with `p:<account>` and come in
// from `person:<account>`, the list shows the chat with name, last message and unread, its menu deletes this side, a
// bot's hand-over event leads to the chat with the person, and the bot editor offers the contact.
import { bot, onDialog } from './harness.mjs';

const people = [{ id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'admins' }];

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('anna', 'Anna')],
        history: {
            anna: [
                { id: 'u1', role: 'user', from: 'me', text: 'I need a person', ts: '2026-11-05T09:00:00Z', readAt: '2026-11-05T09:00:01Z' },
                { id: 'e1', role: 'event', from: 'anna', person: 'kunde', text: 'Handed over to Kunde Müller.', ts: '2026-11-05T09:00:05Z' },
            ],
        },
        onSend: async (f, push, z, reply) => {
            if (f.type === 'auth' || f.type === 'people') await reply({ type: 'people', machine: 'desk', list: people, chats: [] });
            if (f.type === 'folder_check') await reply({ type: 'folder_checked', machine: 'desk', asked: f.folder, ok: true, folder: f.folder });
            if (f.type === 'send' && f.chatId.startsWith('p:')) {
                await push({ type: 'user', machine: 'desk', chatId: f.chatId, entry: { id: 's' + h.sent.length, role: 'user', from: 'me', text: f.text, ts: new Date().toISOString() } });
            }
        },
    });
    const p = h.page;
    await onDialog(p, (d) => d.accept());
    const rows = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li[data-chat]')].map((l) => l.dataset.chat));

    check('no person chat in the list before a message', !(await rows()).includes('p:kunde'), await rows());
    await p.click('#btn-new');
    const entries = await p.locator('#new-menu button').allTextContents();
    check('"+" offers "Person"', entries.some((x) => x.includes('Person')), entries);
    await p.locator('#new-menu button', { hasText: 'Person' }).click();
    const names = await p.locator('#new-menu button').allTextContents();
    check('… with the people this account can write to', names.some((x) => x.includes('Kunde Müller')), names);
    await p.locator('#new-menu button', { hasText: 'Kunde Müller' }).click();
    await h.wait(300);
    const head = await p.evaluate(() => {
        const pane = document.querySelector('.pane:not([hidden])') || document;
        return {
            name: pane.querySelector('[data-el=chat-name]').textContent, sub: pane.querySelector('[data-el=chat-sub]').textContent,
            model: pane.querySelector('[data-el=chat-model]').hidden, placeholder: pane.querySelector('[data-el=text]').placeholder,
        };
    });
    check('header: the person, no model', head.name === 'Kunde Müller' && head.sub === 'Person' && head.model && head.placeholder === 'Message to Kunde Müller', head);
    check('the open chat stands in the list', (await rows()).includes('p:kunde'));

    await p.fill('[data-el=text]', 'Hello, your invoice is on its way');
    await p.evaluate(() => document.querySelector('[data-el=composer]').requestSubmit());
    await h.wait(200);
    const sent = h.sent.find((f) => f.type === 'send');
    check('the message goes to p:kunde', sent && sent.chatId === 'p:kunde' && sent.text === 'Hello, your invoice is on its way', sent);
    check('own message on the right', await p.locator('.bubble.me', { hasText: 'invoice is on its way' }).count() === 1);

    await h.push({ type: 'user', machine: 'desk', chatId: 'p:kunde', entry: { id: 'k1', role: 'user', from: 'person:kunde', text: 'Thanks!', ts: new Date().toISOString() } });
    await h.wait(200);
    const answer = await p.evaluate(() => { const b = document.querySelector('.bubble[data-eid="k1"]'); return b ? { cls: b.className, sender: !!b.querySelector('.sender') } : null; });
    check('the person\'s answer on the left, without a "job from" head', answer && answer.cls.includes('person') && !answer.cls.includes('me') && !answer.sender, answer);

    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.push({ type: 'user', machine: 'desk', chatId: 'p:kunde', entry: { id: 'k2', role: 'user', from: 'person:kunde', text: 'One more question', ts: new Date().toISOString() } });
    await h.wait(200);
    const row = await p.evaluate(() => { const l = document.querySelector('#chat-list li[data-chat="p:kunde"]'); return l ? { unread: l.classList.contains('unread'), text: l.textContent } : null; });
    check('in the list: unread, name and the last message', row && row.unread && row.text.includes('Kunde Müller') && row.text.includes('One more question'), row);

    // A bot handed a chat over: the event leads to the person
    await h.openChat('Anna');
    const link = p.locator('.event .handover-link');
    check('the hand-over event links to the person', (await link.textContent()) === 'Continue with Kunde Müller');
    await link.click();
    await h.wait(300);
    check('… and opens the chat with them', await p.evaluate(() => [...document.querySelectorAll('.pane')].some((x) => !x.hidden && x.querySelector('[data-el=chat-name]').textContent === 'Kunde Müller')));

    // The menu of the chat: favorite, mute, delete this side
    await p.evaluate(() => openRowMenu('p:kunde', 50, 50));
    const menu = await p.locator('#row-menu button').allTextContents();
    check('menu of a person chat: search, favorite, mute, delete; nothing of bots', menu.some((x) => /favorite/i.test(x)) && menu.some((x) => x.includes('Delete chat'))
        && !menu.some((x) => /session|Edit bot|conversation/i.test(x)), menu);
    await p.locator('#row-menu button', { hasText: 'Delete chat' }).click();
    await h.wait(200);
    const del = h.sent.find((f) => f.type === 'person_chat_delete');
    check('deleting asks the backend for this side', del && del.account === 'kunde', del);

    // The bot editor offers the contact for hand-overs
    await p.evaluate(() => openEditor(state.bots[0]));
    await h.wait(200);
    const contact = await p.evaluate(() => ({ hidden: document.getElementById('editor-contact-block').hidden, options: [...document.querySelectorAll('#editor-contact option')].map((o) => o.textContent) }));
    check('bot editor: "Hand over to" with the people', !contact.hidden && contact.options.join() === 'Nobody,Kunde Müller', contact);
    await p.selectOption('#editor-contact', 'kunde');
    await p.evaluate(() => document.getElementById('editor-form').requestSubmit());
    await h.wait(300);
    const saved = h.sent.find((f) => f.type === 'bot_save');
    check('saving sends the contact along', saved && saved.bot.contact === 'kunde', saved);
    check('no page errors', h.errors.length === 0, h.errors);
}
