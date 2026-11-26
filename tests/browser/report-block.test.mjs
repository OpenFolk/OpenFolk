// Reporting a message and blocking a person: "Report" in the ⋯ menu of a bot's answer or a person's message opens a
// page with reason and note, goes to the backend, which sends it to the admins or, without one, to the OpenFolk team;
// "Block" in the menu of a person chat stops writing there and turns into "Unblock".
import { bot, onDialog } from './harness.mjs';

const admins = [{ id: 'chef', name: 'Chefin', admin: true, reach: 'all' }, { id: 'kunde', name: 'Kunde Müller', admin: false, reach: 'all' }];
let people = admins;
let chats = [];

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader')],
        history: {
            pdf: [
                { id: 'u1', role: 'user', from: 'me', text: 'Tell me a joke', ts: '2026-11-22T09:00:00Z', readAt: '2026-11-22T09:00:01Z' },
                { id: 'a1', role: 'assistant', botId: 'pdf', text: 'A joke that offends', ts: '2026-11-22T09:00:05Z' },
            ],
            'p:kunde': [{ id: 'k1', role: 'user', from: 'person:kunde', text: 'Rude words', ts: '2026-11-22T08:00:00Z' }],
        },
        onSend: async (f, push, z, reply) => {
            if (f.type === 'auth' || f.type === 'people') await reply({ type: 'people', machine: 'desk', list: people, chats });
            if (f.type === 'person_block') {
                chats = [{ id: f.account, blocked: f.on || undefined, updatedAt: new Date().toISOString() }];
                await reply({ type: 'people', machine: 'desk', list: people, chats });
            }
        },
    });
    const p = h.page;
    await onDialog(p, (d) => d.accept());
    const menu = () => p.locator('#message-menu button').allTextContents();

    await h.openChat('PDF');
    await p.click('.bubble[data-eid="u1"] .more');
    check('no "Report" on the user\'s own message', !(await menu()).includes('Report'), await menu());
    await p.evaluate(() => { document.getElementById('message-menu').hidden = true; });
    await p.click('.bubble[data-eid="a1"] .more');
    check('"Report" on a bot\'s answer', (await menu()).includes('Report'), await menu());
    await p.locator('#message-menu button', { hasText: 'Report' }).click();
    await h.wait(100);
    check('the report page opens with the message', await p.evaluate(() => !document.getElementById('report').hidden
        && document.getElementById('report-quote').textContent === 'A joke that offends'));
    const to = await p.textContent('#report-to');
    check('it says the report goes to the admins, by name, and names the support address', to.includes('Chefin') && !to.includes('Kunde') && to.includes('support@openfolk.app'), to);
    await p.selectOption('#report-reason', 'false');
    await p.fill('#report-note', 'Made up');
    await p.click('#report-send');
    await h.wait(100);
    const sent = h.sent.findLast((f) => f.type === 'report');
    check('the frame names chat, message, reason and note', sent && sent.chatId === 'pdf' && sent.entryId === 'a1' && sent.reason === 'false' && sent.note === 'Made up', sent);
    check('the page waits for the answer', await p.evaluate(() => !document.getElementById('report').hidden && document.getElementById('report-send').disabled));
    await h.push({ type: 'error', machine: 'desk', request: 'report', message: 'This message is no longer here to report.' });
    await h.wait(100);
    check('an error shows on the page, which stays open to try again', await p.evaluate(() => !document.getElementById('report').hidden
        && !document.getElementById('report-error').hidden && !document.getElementById('report-send').disabled));
    await p.click('#report-send');
    await h.push({ type: 'report_sent', machine: 'desk', chatId: 'pdf', entryId: 'a1', admins: ['chef'] });
    await h.wait(150);
    check('sent: the page closes and says to whom', await p.evaluate(() => document.getElementById('report').hidden) && (await p.textContent('#toast')).includes('Chefin'), await p.textContent('#toast'));

    // A person's message can be reported too
    await p.evaluate(() => openChat('p:kunde'));
    await h.wait(200);
    await p.click('.bubble[data-eid="k1"] .more');
    check('"Report" on a person\'s message', (await menu()).includes('Report'), await menu());
    await p.evaluate(() => { document.getElementById('message-menu').hidden = true; });

    // Blocking the person
    await p.evaluate(() => openRowMenu('p:kunde', 50, 50));
    await p.locator('#row-menu button', { hasText: 'Block' }).click();
    await h.wait(200);
    const block = h.sent.findLast((f) => f.type === 'person_block');
    check('"Block" in the chat\'s menu, after asking', block && block.account === 'kunde' && block.on === true, block);
    const head = () => p.evaluate(() => {
        const pane = [...document.querySelectorAll('.pane')].find((x) => !x.hidden && x.querySelector('[data-el=chat-name]').textContent === 'Kunde Müller');
        return { sub: pane.querySelector('[data-el=chat-sub]').textContent, placeholder: pane.querySelector('[data-el=text]').placeholder, send: pane.querySelector('[data-el=btn-send]').disabled };
    });
    const blocked = await head();
    check('blocked: the header says so, the input field cannot send', blocked.sub === 'Blocked' && blocked.placeholder === 'You blocked Kunde Müller' && blocked.send, blocked);
    await p.evaluate(() => openRowMenu('p:kunde', 50, 50));
    const rows = await p.locator('#row-menu button').allTextContents();
    check('the menu offers "Unblock" instead', rows.includes('Unblock') && !rows.includes('Block'), rows);
    await p.locator('#row-menu button', { hasText: 'Unblock' }).click();
    await h.wait(200);
    const unblock = h.sent.findLast((f) => f.type === 'person_block');
    check('"Unblock" sends the way back', unblock && unblock.on === false, unblock);
    check('unblocked: the header is back', (await head()).sub === 'Person', await head());
    // Without an admin: the report goes by mail
    people = [];
    await h.push({ type: 'people', machine: 'desk', list: people, chats: [] });
    await p.evaluate(() => openChat('pdf'));
    await h.wait(200);
    await p.click('.bubble[data-eid="a1"] .more');
    await p.locator('#message-menu button', { hasText: 'Report' }).click();
    await h.wait(100);
    const toTeam = await p.textContent('#report-to');
    check('no admin: "Report" stays in the app and names the OpenFolk team, the mail is the second way', await p.evaluate(() => !document.getElementById('report-send').hidden
        && !document.getElementById('report-mail').hidden) && toTeam.includes('no admin') && toTeam.includes('OpenFolk team'), toTeam);
    await p.fill('#report-note', 'Not funny');
    const href = await p.evaluate(() => {
        const a = document.getElementById('report-mail');
        a.addEventListener('click', (ev) => ev.preventDefault(), { once: true });
        a.click();
        return decodeURIComponent(a.href);
    });
    check('the mail goes to the support address with reason, bot, note and message', href.startsWith('mailto:support@openfolk.app?subject=') && href.includes('Offensive or hateful')
        && href.includes('PDF-Reader') && href.includes('Not funny') && href.includes('A joke that offends'), href);
    await p.click('#report-send');
    await h.push({ type: 'report_sent', machine: 'desk', chatId: 'pdf', entryId: 'a1', admins: [] });
    await h.wait(150);
    check('sent without an admin: the toast names the OpenFolk team', (await p.textContent('#toast')).includes('OpenFolk team'), await p.textContent('#toast'));

    // The contact address in the settings
    await p.evaluate(() => renderAbout());
    check('Settings › About names the support address', (await p.textContent('#about-list')).includes('support@openfolk.app'));
    const links = await p.evaluate(() => [...document.querySelectorAll('#about-list a[target=_blank]')].map((a) => a.href));
    check('… and links the privacy policy and the deletion page (the stores want both in the app)',
        links.includes('https://openfolk.app/en/privacy') && links.includes('https://openfolk.app/en/delete-account'), links);
}
