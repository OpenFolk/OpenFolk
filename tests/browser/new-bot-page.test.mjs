// The page "New bot" asks for role, name, folder and repository only. The templates stand behind the role as chips: a
// tap takes the role and, unseen, the template's working instructions, which a role typed over it drops again; the
// approval level is the one of the settings for new bots. Three names alliterating with the role come without the model and follow its initial; "Others" gives
// three more. The machine shows only where there is a choice. Editing a bot shows the whole editor as before.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        online: ['desk'],
        bots: [bot('pdf', 'PDF-Reader', { machine: 'desk', role: 'Reads PDFs' })],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
            if (f.type === 'folder_create') await push({ type: 'folder_created', name: f.name, ok: true, folder: `/work/${f.name}` });
        },
    });
    const p = h.page;
    const visible = (sel) => p.isVisible(sel);
    const chips = (sel) => p.locator(`${sel} .chip`).allTextContents();
    const button = async () => (await p.textContent('#editor-form button[type=submit]')).trim();
    const above = (a, b) => p.evaluate(([a, b]) => document.querySelector(a).getBoundingClientRect().top < document.querySelector(b).getBoundingClientRect().top, [a, b]);

    await p.evaluate(() => openEditor(null));
    await h.wait(150);
    check('shown: hint, role, name, folder, repository', await visible('#editor-new-hint') && await visible('#editor-role') && await visible('#editor-name') && await visible('#editor-folder') && await visible('#editor-repo'));
    check('hidden: picture, field of work, machine (no choice), model, approvals, tone, the model\'s suggestions',
        !(await visible('#editor-avatar')) && !(await visible('#editor-area')) && !(await visible('#editor-machine')) && !(await visible('#editor-model'))
        && !(await visible('#editor-approval')) && !(await visible('#editor-tone')) && !(await visible('#editor-name-suggest')) && !(await visible('#editor-role-suggest')));
    check('role above name, button "Create"', await above('#editor-role', '#editor-name') && (await button()) === 'Create', await button());
    check('the templates as role chips', (await chips('#editor-role-suggestions')).join('|') === 'Chief of Staff|Developer|Infrastructure|Social Media|Landing Pages|Product Scout|Mail', await chips('#editor-role-suggestions'));
    check('no names without a role', !(await visible('#editor-name-suggestions')));

    await p.locator('#editor-role-suggestions .chip', { hasText: 'Developer' }).click();
    const names = await chips('#editor-name-suggestions');
    check('a template chip fills the role', (await p.inputValue('#editor-role')) === 'Code, tests and reviews in one project', await p.inputValue('#editor-role'));
    check('three names with the role\'s initial, then "Others"', names.length === 4 && names.slice(0, 3).every((n) => n.startsWith('C')) && names[3] === 'Others', names);
    await p.locator('#editor-name-suggestions .chip', { hasText: 'Others' }).click();
    const others = await chips('#editor-name-suggestions');
    check('"Others": three other names, same initial', others.length === 4 && others.slice(0, 3).every((n) => n.startsWith('C') && !names.includes(n)), others);
    await p.locator('#editor-name-suggestions .chip').first().click();
    check('a tap takes the name', (await p.inputValue('#editor-name')) === others[0], await p.inputValue('#editor-name'));

    await p.fill('#editor-role', 'the Server team');
    const s = await chips('#editor-name-suggestions');
    check('a role typed: names of its first real word\'s initial', s.length === 4 && s.slice(0, 3).every((n) => n.startsWith('S')), s);
    await p.fill('#editor-role', 'Server team, also deployments');
    check('the same names while the initial stays', (await chips('#editor-name-suggestions')).join() === s.join());
    await p.fill('#editor-role', 'Übersetzungen');
    check('an umlaut lends its plain letter', (await chips('#editor-name-suggestions')).slice(0, 3).every((n) => n.startsWith('U')), await chips('#editor-name-suggestions'));
    await p.fill('#editor-role', '');
    check('no role, no names', !(await visible('#editor-name-suggestions')));

    // Saving: the template's presets travel unseen, and only while its role stays
    await p.locator('#editor-role-suggestions .chip', { hasText: 'Mail' }).click();
    await p.fill('#editor-name', 'Mira');
    await p.evaluate(() => document.getElementById('editor-form').requestSubmit());
    await h.wait(400);
    const mail = h.sent.findLast((f) => f.type === 'bot_save');
    check('saved with setup, the template\'s working instructions and approval level, a folder of its own',
        mail?.setup === true && mail.bot.name === 'Mira' && mail.bot.role === 'Inbox and mail workflows' && mail.bot.tone.length > 0 && mail.bot.approval === 'risky' && mail.bot.folder === '/work/Mira', mail?.bot);

    await p.evaluate(() => openEditor(null));
    await h.wait(150);
    await p.locator('#editor-role-suggestions .chip', { hasText: 'Product Scout' }).click();
    await p.fill('#editor-role', 'Product ideas');
    await p.fill('#editor-name', 'Pia');
    await p.evaluate(() => document.getElementById('editor-form').requestSubmit());
    await h.wait(400);
    const pia = h.sent.findLast((f) => f.type === 'bot_save');
    check('a role typed over the template: its presets dropped', pia?.bot.role === 'Product ideas' && pia.bot.tone === '' && pia.bot.approval === 'risky', pia?.bot);

    // The approval level of the settings: every new bot starts with it, whatever template
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', botApproval: 'write', updatedAt: '2099-01-01T00:00:00Z' } });
    await h.wait(100);
    for (const [template, name] of [['Mail', 'Mona'], ['Product Scout', 'Paul']]) {
        await p.evaluate(() => openEditor(null));
        await h.wait(150);
        await p.locator('#editor-role-suggestions .chip', { hasText: template }).click();
        await p.fill('#editor-name', name);
        await p.evaluate(() => document.getElementById('editor-form').requestSubmit());
        await h.wait(400);
        const saved = h.sent.findLast((f) => f.type === 'bot_save');
        check(`settings on "every change": ${template} starts with it`, saved?.bot.name === name && saved.bot.approval === 'write', saved?.bot);
    }

    // Editing: the whole editor as before
    await p.evaluate(() => openEditor(bot('pdf')));
    await h.wait(150);
    check('editing shows every field again, no role chips, button "Save"',
        await visible('#editor-area') && await visible('#editor-model') && await visible('#editor-tone') && await visible('#editor-machine') && await visible('#editor-name-suggest')
        && !(await visible('#editor-role-suggestions')) && (await button()) === 'Save', await button());
    await p.fill('#editor-role', 'Reads PDFs and more');
    check('typing a role while editing changes nothing else', (await p.inputValue('#editor-tone')) === '' && !(await visible('#editor-name-suggestions')));
    await p.keyboard.press('Escape');
    await h.wait(100);

    // A second machine: the choice shows
    await h.push({ type: 'agents', online: ['desk', 'laptop'] });
    await h.wait(100);
    await p.evaluate(() => openEditor(null));
    await h.wait(150);
    check('two machines: the machine shows', await visible('#editor-machine') && (await p.inputValue('#editor-machine')) === 'desk');
    await h.close();
}
