// Name suggestion in the bot editor: each chip is a first name with a field of work; a tap fills both fields, saving
// sends the field of work, the info panel shows it under the name. A backend before the field sends names only.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    let withAreas = true;
    const h = await start({
        bots: [bot('research', 'Research', { role: 'Web research', machine: 'desk' })],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
            if (f.type !== 'bot_suggest') return;
            const result = withAreas
                ? { what: 'name', names: ['Rudolf', 'Petra', 'Astrid'], areas: ['Research', 'Personnel', ''] }
                : { what: 'name', names: ['Bernd'] };
            await push({ type: 'bot_suggestion', what: 'name', result });
        },
    });
    const p = h.page;
    const chips = () => p.locator('#editor-name-suggestions .chip').allTextContents();

    await h.openChat('Research');
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('info without a field of work: line hidden', !(await p.isVisible('#info-area')));
    await p.click('#info-edit');
    await h.wait(200);

    await p.click('#editor-name-suggest');
    await h.wait(200);
    const asked = h.sent.find((f) => f.type === 'bot_suggest');
    check('request carries the field of work', asked && asked.request.area === '', asked);
    check('chips show name and field of work', (await chips()).join('|') === 'Rudolf · Research|Petra · Personnel|Astrid', await chips());
    await p.locator('#editor-name-suggestions .chip', { hasText: 'Rudolf' }).click();
    check('a tap fills name and field of work', (await p.inputValue('#editor-name')) === 'Rudolf' && (await p.inputValue('#editor-area')) === 'Research');

    // An old backend: names only, the field of work stays as typed
    withAreas = false;
    await p.click('#editor-name-suggest');
    await h.wait(200);
    const again = h.sent.findLast((f) => f.type === 'bot_suggest');
    check('shown pairs are not suggested again', again.request.previous.includes('Rudolf (Research)') && again.request.area === 'Research', again.request);
    check('names only: chip without field of work', (await chips()).join('|') === 'Bernd', await chips());
    await p.locator('#editor-name-suggestions .chip', { hasText: 'Bernd' }).click();
    check('names only: field of work kept', (await p.inputValue('#editor-name')) === 'Bernd' && (await p.inputValue('#editor-area')) === 'Research');

    await p.fill('#editor-name', 'Rudolf');
    await p.click('#editor-form button[type=submit]');
    await h.wait(200);
    const saved = h.sent.findLast((f) => f.type === 'bot_save');
    check('saving sends name, field of work and role', saved && saved.bot.name === 'Rudolf' && saved.bot.area === 'Research' && saved.bot.role === 'Web research', saved);

    await h.push({ type: 'bots', bots: [bot('research', 'Rudolf', { area: 'Research', role: 'Web research', machine: 'desk' })], groups: [] });
    await h.wait(200);
    const listName = await p.locator('#chat-list li[data-chat=research] .name').textContent();
    check('chat list shows the field of work beside the name', listName === 'Rudolf · Research', listName);
    await p.click('[data-el=chat-title]');
    await h.wait(200);
    check('info shows field of work and role', (await p.textContent('#info-area')) === 'Research' && (await p.isVisible('#info-area')) && (await p.textContent('#info-role')) === 'Web research');
}
