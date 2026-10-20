// A chat's header shows the bot's model and machine as badges; a tap on either opens its switch right below the
// header: the model changes at once, another machine opens the small move dialog. With one machine known, it says so.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ online: ['desk', 'workstation'], bots: [bot('pdf', 'PDF-Reader', { machine: 'desk', model: 'opus' })] });
    const p = h.page;
    await h.openChat('PDF-Reader');
    const menu = () => p.locator('[data-el=header-menu]').first();

    check('the machine as a badge in the header', (await p.textContent('[data-el=chat-machine]')) === 'DESK' && await p.isVisible('[data-el=chat-machine]'));
    check('the line below no longer repeats it', !(await p.textContent('[data-el=chat-sub]')).includes('DESK'), await p.textContent('[data-el=chat-sub]'));

    await p.click('[data-el=chat-model]');
    await h.wait(100);
    check('a tap on the model: its switch below the header', await menu().isVisible() && (await menu().locator('.model-switch .chip').count()) >= 2);
    await menu().locator('.chip', { hasText: 'Sonnet' }).click();
    await h.wait(100);
    const model = h.sent.find((f) => f.type === 'model');
    check('picked: the model changes, the switch closes', model && model.model === 'sonnet' && !(await menu().isVisible()), model);

    await p.click('[data-el=chat-machine]');
    await h.wait(100);
    check('a tap on the machine: the machines below the header', (await menu().locator('.machine-switch .chip').allTextContents()).join('|') === 'DESK|WORKSTATION');
    await p.click('[data-el=chat-machine]');
    await h.wait(100);
    check('a second tap closes it', !(await menu().isVisible()));

    await p.click('[data-el=chat-machine]');
    await menu().locator('.chip', { hasText: 'WORKSTATION' }).click();
    await h.wait(200);
    check('another machine: the small move dialog', await p.isVisible('#editor.moving') && (await p.textContent('#editor-title')) === 'Move PDF-Reader to WORKSTATION');
    await p.click('#editor [data-close]');
    await h.wait(100);

    await h.push({ type: 'agents', online: ['desk'] });
    await h.wait(100);
    await p.click('[data-el=chat-machine]');
    await h.wait(100);
    check('one machine known: said so', (await menu().textContent()).includes('Only this machine is known'));
    await p.click('[data-el=chat-name]');
    await h.wait(100);
    check('a tap elsewhere closes it', !(await menu().isVisible()));
}
