// Duplicating a bot from its page: the name asked in the app's text dialog, the frame to the bot's machine, then the
// copy's page with a note on the paused routines. Bots of an admin's setup have no such entry.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven', { machine: 'desk' }), bot('help', 'Helpdesk', { machine: 'desk', managed: 'support' })],
        onSend: async (f, push, state) => {
            if (f.type !== 'bot_duplicate') return;
            state.bots.push(bot('skool-copy', f.name, { machine: 'desk' }));
            await push({ type: 'bots', machine: 'desk', bots: state.bots, groups: [], categories: [], states: {}, activity: {}, activeChats: {}, approvals: [] });
            await push({ type: 'routines', routines: [{ id: 'r2', botId: 'skool-copy', name: 'Report', cron: '0 8 * * *', prompt: 'x', enabled: false, updatedAt: '' }] });
            await push({ type: 'bot_duplicated', botId: f.botId, id: 'skool-copy' });
        },
    });
    const p = h.page;
    await h.openChat('Skool Sven');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    const entry = p.locator('#info-actions [data-action=duplicate]');
    check('the bot\'s page has "Duplicate bot"', (await entry.count()) === 1 && (await entry.textContent()) === 'Duplicate bot');
    await entry.click();
    await h.wait(100);
    check('the name is asked, "(copy)" suggested, with what comes along', await p.isVisible('#text-dialog') && (await p.inputValue('#text-input')) === 'Skool Sven (copy)'
        && (await p.textContent('#text-hint')).includes('paused') && (await p.textContent('#text-submit')) === 'Duplicate');
    await p.fill('#text-input', 'Skool Susi');
    await p.click('#text-submit');
    await h.wait(300);
    const sent = h.sent.find((f) => f.type === 'bot_duplicate');
    check('bot_duplicate with the name to the bot\'s machine', sent && sent.botId === 'skool' && sent.name === 'Skool Susi' && sent.machine === 'desk', sent);
    check('the copy\'s page opens', (await p.textContent('#info-name')) === 'Skool Susi', await p.textContent('#info-name'));
    check('a note names the paused routine', (await p.textContent('#toast')).includes('one paused routine'), await p.textContent('#toast'));

    await p.click('#info [data-page-back]');
    await h.wait(200);
    await p.click('[data-el=btn-back]');
    await h.wait(200);
    await h.openChat('Helpdesk');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('a bot of an admin\'s setup: no "Duplicate bot"', (await p.locator('#info-actions [data-action=duplicate]').count()) === 0);
}
