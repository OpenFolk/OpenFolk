// Commands in answers: ▶ after single-line code of a known tool; a tap sends the command after asking
// as a message to the bot (in groups with @). No ▶ for other code or multi-line blocks.
import { bot } from './harness.mjs';

const TEXT = 'Restart the backend: `npm run restart -w local -- seen`. File: `local/src/x.ts`.\n\n'
    + '```\nphp bin/autodeploy.php --env=prod\n```\n\n```\nnpm install\nnpm test\n```';

export default async function ({ start, check }) {
    const answer = (id) => [{ id: 'a1', role: 'assistant', botId: id, text: TEXT, ts: '2026-10-10T10:00:00Z' }];
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('cloud', 'Cloud Carlo')],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
        history: { skool: answer('skool'), 'g:team': answer('cloud') },
    });
    const p = h.page;
    let accept = false;
    let dialog = null;
    p.on('dialog', (d) => { dialog = d.message(); return accept ? d.accept() : d.dismiss(); });
    const buttons = () => p.locator('[data-el=messages] .command-run').evaluateAll((ks) => ks.map((k) => k.getAttribute('aria-label').replace('Let it run: ', '')));
    const jobs = () => h.sent.filter((f) => f.type === 'send');

    await h.openChat('Skool Sven');
    await h.wait(200);
    check('▶ only for commands, not for a path or a multi-line block',
        JSON.stringify(await buttons()) === JSON.stringify(['npm run restart -w local -- seen', 'php bin/autodeploy.php --env=prod']), await buttons());

    await p.locator('[data-el=messages] .command-run').first().click();
    await h.wait(100);
    check('cancel: nothing sent', dialog && dialog.includes('npm run restart') && jobs().length === 0, dialog);
    accept = true;
    await p.locator('[data-el=messages] .command-run').first().click();
    await h.wait(150);
    const f = jobs()[0];
    check('as a message to the bot\'s machine', f && f.chatId === 'skool' && f.machine === 'desk' && f.text.endsWith('`npm run restart -w local -- seen`'), f);

    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Team');
    await h.wait(200);
    await p.locator('[data-el=messages] .command-run').nth(1).click();
    await h.wait(150);
    const g = jobs().pop();
    check('in the group to the bot that named it', g && g.chatId === 'g:team' && g.text.startsWith('@cloud ') && g.text.includes('php bin/autodeploy.php'), g);
}
