// Every new bot is set up in its chat: the template "Set up in the chat" is chosen by default, saving sends `setup`
// with the bot, also from another template; editing a bot sends none. Once the bot list names the new bot, its chat opens.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        online: ['desk'],
        bots: [bot('pdf', 'PDF-Reader', { machine: 'desk', role: 'Reads PDFs' })],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    const save = async (name, folder, template) => {
        await p.evaluate(() => openEditor(null));
        await h.wait(150);
        if (template !== undefined) await p.selectOption('#editor-template', template);
        await p.fill('#editor-name', name);
        await p.fill('#editor-folder', folder);
        await h.wait(900);
        await p.click('#editor-form button[type=submit]');
        await h.wait(300);
        return h.sent.findLast((f) => f.type === 'bot_save');
    };

    await p.evaluate(() => openEditor(null));
    await h.wait(150);
    check('a new bot starts with "set up in the chat"', (await p.inputValue('#editor-template')) === 'ask' && (await p.inputValue('#editor-role')) === '');
    await p.click('#editor [data-close]').catch(() => undefined);
    await h.wait(100);

    await p.evaluate(() => openChat('pdf'));
    const asked = await save('Web', 'C:/www/web');
    check('saved with setup, without role and tone', asked?.setup === true && asked.bot.name === 'Web' && asked.bot.role === '' && asked.bot.tone === '', asked);
    check('the chat stays until the new bot is listed', await p.evaluate(() => window.activePane().chatId === 'pdf'));
    h.state.bots.push(bot('web', 'Web', { machine: 'desk' }));
    await h.sendBots();
    await h.wait(200);
    check('then its chat opens', await p.evaluate(() => window.panes.some((x) => x.chatId === 'web') && window.activePane().chatId === 'web'));
    await p.evaluate(() => openChat('pdf'));
    await h.sendBots();
    await h.wait(200);
    check('only once', await p.evaluate(() => window.activePane().chatId === 'pdf'));

    const developer = await save('Dev', 'C:/www/dev', 'developer');
    check('a template: role and tone from it, also with setup', developer?.setup === true && developer.bot.role.length > 0 && developer.bot.tone.length > 0, developer);

    await p.evaluate(() => openEditor(bot('pdf')));
    await h.wait(150);
    await p.fill('#editor-name', 'PDF-Writer');
    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    const edited = h.sent.findLast((f) => f.type === 'bot_save');
    check('editing a bot: no setup', edited?.bot.id === 'pdf' && !('setup' in edited), edited);
    await h.close();
}
