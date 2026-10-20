// The shared chat list: the bots of every account this device is signed in to, each other account's with its
// badge, from a lightweight connection per account (webapp/js/others.js); a tap opens the chat in that account.
import { bot } from './harness.mjs';

const MAIN = { id: 'main', name: 'Alex', admin: true };
const WORK = { id: 'work', name: 'Work', admin: false };
const OFFER = bot('offer', 'Offer bot');

/** Before the first load only: the accounts this device knows, and that everything of Work since 2020 counts as new. */
const knows = `if (!sessionStorage.getItem('__accounts')) {
    sessionStorage.setItem('__accounts', '1');
    localStorage.setItem('openfolk-accounts', JSON.stringify([{ id: 'main', name: 'Alex', admin: true, device: 'test' }, { id: 'work', name: 'Work', admin: false, device: 'w.key' }]));
    localStorage.setItem('openfolk-seen:work', JSON.stringify({ _since: '2020-01-01T00:00:00.000Z' }));
}`;

export default async function ({ start, check }) {
    const now = new Date().toISOString();
    const h = await start({
        before: knows,
        auth: (f) => ({ type: 'auth', ok: true, account: f.device === 'w.key' ? WORK : MAIN }),
        botsFor: (f) => (f.device === 'w.key' ? [OFFER] : undefined),
        history: { offer: [{ id: 'e1', role: 'assistant', text: 'The offer is ready', ts: now, botId: 'offer' }] },
    });
    const p = h.page;
    await h.wait(400);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#chat-list li[data-chat]')].map((li) => ({
        chat: li.dataset.chat, account: li.dataset.account || '', badge: (li.querySelector('.account-badge') || {}).textContent || '',
        last: (li.querySelector('.last') || {}).textContent || '', unread: li.classList.contains('unread'),
    })));
    const offer = rows.find((r) => r.chat === 'offer');
    check('one list with the bots of both accounts', rows.some((r) => r.chat === 'pdf' && !r.account) && !!offer, rows);
    check('the other account\'s bot carries its badge, the own ones none', offer?.badge === 'Work' && rows.filter((r) => r.badge).length === 1, rows);
    check('its last message and that it is new', offer?.last === 'The offer is ready' && offer?.unread === true, offer);
    check('the other account signs in with its own key, nothing else of it is asked', h.sent.some((f) => f.type === 'auth' && f.device === 'w.key')
        && !h.sent.some((f) => f.type === 'presence' && h.sent.indexOf(f) > h.sent.findIndex((x) => x.device === 'w.key')));
    check('the badge counts the other account\'s unread too', await p.evaluate(() => otherUnreadCount() === 1));

    // What that account's backend reports arrives in the row
    await p.evaluate(() => others.get('work').ws.push({ type: 'state', machine: 'desk', botId: 'offer', chatId: 'offer', state: 'thinking', activity: 'Writing the offer' }));
    await h.wait(150);
    const running = await p.evaluate(() => {
        const li = document.querySelector('#chat-list li[data-chat="offer"]');
        const section = li && li.previousElementSibling && li.previousElementSibling.classList.contains('section') ? li.previousElementSibling.textContent : '';
        return { last: li ? li.querySelector('.last').textContent : '', section };
    });
    check('its bot at work: on top with what it does', running.last === 'Writing the offer' && running.section === 'Running now', running);
    await p.evaluate(() => others.get('work').ws.push({ type: 'approval', machine: 'desk', approval: { id: 'a1', chatId: 'offer', botId: 'offer', tool: 'Bash', summary: 'npm publish' } }));
    await h.wait(150);
    const waiting = await p.evaluate(() => {
        const li = document.querySelector('#chat-list li[data-chat="offer"]');
        return { last: li?.querySelector('.last').textContent, badge: li?.querySelector('.badge')?.textContent };
    });
    check('an approval waiting there shows as waiting, with its count', waiting.last === '⏳ waiting for you' && waiting.badge === '1', waiting);

    // A tap opens the chat in that account
    await p.click('#chat-list li[data-chat="offer"]');
    await p.waitForLoadState('load');
    await h.wait(900);
    check('tap: the page is in the other account', await p.evaluate(() => state.account?.id === 'work' && localStorage.getItem('openfolk-device') === 'w.key'));
    check('… with that chat open', await p.evaluate(() => activePane().chatId === 'offer'));
    check('… and the first account in the list with its badge now', await p.evaluate(() => document.querySelector('#chat-list li[data-chat="pdf"] .account-badge')?.textContent === 'Alex'));

    // Off in the settings: only the active account
    await p.evaluate(() => openSettings());
    check('setting offered on a device with several accounts', await p.isVisible('#settings-all-accounts') && await p.isChecked('#settings-all-accounts'));
    await p.click('#settings-all-accounts');
    await h.wait(150);
    check('switched off: the other account\'s bots leave the list', await p.evaluate(() => !document.querySelector('#chat-list li.other-account') && others.size === 0));
    check('… and it stays so on this device', await p.evaluate(() => localStorage.getItem('openfolk-all-accounts') === '0'));
    await h.close();

    // ---- encrypted, as in production: the relay's account frames stay readable, and each connection keeps its own
    // replay guard. A backend numbers all its frames in one sequence; frames of two sockets may arrive interleaved.
    const KEY = Buffer.alloc(32, 7).toString('base64url');
    const enc = await start({
        secure: true, path: `#e2e=${KEY}`, before: knows,
        auth: (f) => ({ type: 'auth', ok: true, account: f.device === 'w.key' ? WORK : MAIN }),
        onSend: async (f, push) => { if (f.type === 'accounts') await push({ type: 'accounts', list: [{ ...MAIN, created: '' }, { ...WORK, created: '' }], current: 'main' }); },
    });
    const q = enc.page;
    await enc.wait(400);
    await q.evaluate(() => openAccounts());
    await enc.wait(200);
    check('encrypted: the relay\'s account list still arrives', await q.isVisible('#accounts-admin') && (await q.locator('#accounts-list li').count()) === 2);
    await q.evaluate(() => closeDialog(document.getElementById('settings')));
    // The backend's frames: number 2 to the other account's socket first, then number 1 to the main one
    const delivered = await q.evaluate(async () => {
        const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt']);
        const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
        const seal = async (frame, n) => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('openfolk:b2c') }, key,
                new TextEncoder().encode(JSON.stringify({ ...frame, _r: { t: Date.now(), s: 'backend-desk', n } })));
            return { type: 'e2e', iv: b64(iv), data: b64(data), machine: 'desk' };
        };
        const main = window.__ws;
        const other = others.get('work').ws;
        other.push(await seal({ type: 'bots', bots: [{ id: 'offer', name: 'Offer bot', role: '', folder: 'C:/www/offer', model: 'default', approval: 'risky', tone: '', avatar: '', machine: '' }], groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] }, 2));
        main.push(await seal({ type: 'bots', bots: [{ id: 'pdf', name: 'PDF-Reader', role: '', folder: 'C:/www/pdf', model: 'default', approval: 'risky', tone: '', avatar: '', machine: '' }], groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] }, 1));
        await new Promise((r) => setTimeout(r, 300));
        return [...document.querySelectorAll('#chat-list li[data-chat]')].map((li) => li.dataset.chat).sort().join();
    });
    check('encrypted: interleaved frames of one backend are taken on both connections', delivered === 'offer,pdf', delivered);
    const ids = enc.sent.filter((f) => f.type === 'e2e').length;
    check('encrypted: the further connection asks encrypted too', ids > 0);
    await enc.close();

    // One account only: no further connection, no setting
    const one = await start({ auth: () => ({ type: 'auth', ok: true, account: MAIN }) });
    await one.wait(300);
    check('one account: no further connection', one.sent.filter((f) => f.type === 'auth').length === 1 && await one.page.evaluate(() => others.size === 0));
    await one.page.evaluate(() => openSettings());
    check('… and no setting for it', await one.page.isHidden('#settings-all-accounts'));
    await one.close();
}
