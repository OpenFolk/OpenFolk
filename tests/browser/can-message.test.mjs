// Who a bot can give jobs: the editor shows the stored choice (all, selected, none), lists the other bots without the
// bot itself, and saving sends null for all, the ticked ids for selected and an empty list for none.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [
            bot('chief', 'Chief', { machine: 'desk', canMessage: ['dev'] }),
            bot('dev', 'Dev', { machine: 'desk' }),
            bot('infra', 'Infra', { machine: 'desk' }),
        ],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    const ticked = () => p.locator('#editor-can-message-bots input:checked').evaluateAll((l) => l.map((i) => /** @type {HTMLInputElement} */ (i).value));
    const listed = () => p.locator('#editor-can-message-bots input').evaluateAll((l) => l.map((i) => /** @type {HTMLInputElement} */ (i).value));
    const edit = async (id) => {
        await p.evaluate((x) => openEditor(bot(x)), id);
        await h.wait(150);
    };
    const save = async () => {
        await p.click('#editor-form button[type=submit]');
        await h.wait(200);
        return h.sent.findLast((f) => f.type === 'bot_save');
    };

    await edit('chief');
    check('stored list: "selected" with its bots ticked', (await p.inputValue('#editor-can-message')) === 'some' && (await ticked()).join() === 'dev', await ticked());
    check('the bot itself is not offered', (await listed()).join() === 'dev,infra', await listed());
    await p.check('#editor-can-message-bots input[value=infra]');
    let saved = await save();
    check('selected: ticked ids are sent', JSON.stringify(saved?.bot.canMessage) === '["dev","infra"]', saved?.bot);

    await edit('chief');
    await p.selectOption('#editor-can-message', 'none');
    check('none: bot list hidden', !(await p.isVisible('#editor-can-message-bots')));
    saved = await save();
    check('none: empty list is sent', JSON.stringify(saved?.bot.canMessage) === '[]', saved?.bot);

    await edit('dev');
    check('no list: "all bots", bot list hidden', (await p.inputValue('#editor-can-message')) === 'all' && !(await p.isVisible('#editor-can-message-bots')));
    saved = await save();
    check('all: null is sent', saved?.bot.canMessage === null, saved?.bot);
}
