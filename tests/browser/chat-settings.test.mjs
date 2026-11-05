// The gear next to the chat's title opens the same page as a tap on the title: the bot's page, for a group its editor.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('skool', 'Skool Sven'), bot('cloud', 'Cloud Carlo')],
        groups: [{ id: 'team', name: 'Team', avatar: '', members: ['skool', 'cloud'], createdAt: '', updatedAt: '' }],
    });
    const p = h.page;
    const gear = '[data-el=chat-settings]';

    await h.openChat('Skool Sven');
    await h.wait(200);
    check('gear in the header, labelled', await p.isVisible(gear) && (await p.getAttribute(gear, 'aria-label')) === 'Bot settings' && (await p.getAttribute(gear, 'title')) === 'Bot settings');
    await p.click(gear);
    await h.wait(200);
    check('gear opens the bot\'s page', await p.isVisible('#info') && (await p.evaluate(() => state.infoChat)) === 'skool');
    await p.keyboard.press('Escape');
    await h.wait(100);
    check('page closed again', await p.isHidden('#info'));
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('a tap on the title still does the same', await p.isVisible('#info') && (await p.evaluate(() => state.infoChat)) === 'skool');
    await p.keyboard.press('Escape');
    await h.wait(100);

    await p.click('[data-el=btn-back]');
    await h.wait(300);
    await h.openChat('Team');
    await h.wait(200);
    check('group: labelled for the group', (await p.getAttribute(gear, 'aria-label')) === 'Group settings');
    await p.click(gear);
    await h.wait(200);
    check('group: gear opens the editor', await p.isVisible('#group-editor'));
    await h.close();
}
