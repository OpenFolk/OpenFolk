// The set of profile pictures in the bot editor: "AI avatar" opens it first (two groups, all pictures loaded), a tap takes
// a picture over like an upload and the bot is saved with it, "Make a new one" asks the model as before.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('pdf', 'PDF-Reader', { machine: 'desk' })],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    const openEditor = async () => {
        await p.locator('#chat-list li[data-chat="pdf"]').click({ button: 'right' });
        await p.locator('#row-menu button', { hasText: 'Edit bot' }).click();
        await h.wait(200);
    };
    await openEditor();
    await p.click('#editor-avatar-ai');
    await h.wait(600);
    const set = await p.evaluate(() => ({
        open: !document.getElementById('avatar-picker').hidden, groups: [...document.querySelectorAll('#avatar-grid h4')].map((x) => x.textContent),
        count: document.querySelectorAll('#avatar-grid .avatar-choice').length, width: document.querySelector('#avatar-grid img').naturalWidth,
        noSuggest: true,
    }));
    check('"AI avatar" opens the set first: two groups, 24 pictures, loaded', set.open && set.groups.join('|') === 'Female|Male' && set.count === 24 && set.width === 512
        && !h.sent.some((f) => f.type === 'bot_suggest'), set);
    await p.click('#avatar-grid .avatar-choice[data-file="m03.png"]');
    await h.wait(500);
    const picked = await p.evaluate(() => ({ closed: document.getElementById('avatar-picker').hidden, src: (document.querySelector('#editor-avatar img') || {}).src || '' }));
    check('a tap takes the picture over as the bot\'s avatar and closes the set', picked.closed && picked.src.startsWith('data:image/jpeg;base64,') && await p.isVisible('#editor'), picked.src.slice(0, 40));
    await p.click('#editor-form button[type=submit]');
    await h.wait(300);
    const saved = h.sent.findLast((f) => f.type === 'bot_save');
    check('saved with the picture, like an uploaded one', saved && saved.bot.avatar.startsWith('data:image/jpeg;base64,') && saved.bot.avatar.length > 2000, saved && saved.bot.avatar.slice(0, 40));

    // the image model is the last entry; Escape closes the set only
    await openEditor();
    await p.click('#editor-avatar-ai');
    await h.wait(200);
    await p.keyboard.press('Escape');
    check('Escape closes the set, the editor stays', await p.evaluate(() => document.getElementById('avatar-picker').hidden) && await p.isVisible('#editor'));
    await p.click('#editor-avatar-ai');
    await h.wait(200);
    await p.click('#avatar-generate');
    await h.wait(200);
    const asked = h.sent.find((f) => f.type === 'bot_suggest');
    check('"Make a new one": the set closes, the model is asked', await p.evaluate(() => document.getElementById('avatar-picker').hidden) && asked && asked.request.what === 'avatar', asked);
    check('no errors', h.errors.length === 0, h.errors);
}
