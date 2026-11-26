// Editing a bot saves every change by itself: no Save or Cancel, typing goes out after a short pause, a choice at once,
// the line below says "Saved", and closing right after a change saves it too. A new bot keeps its "Create" button.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const pdf = bot('pdf', 'PDF-Reader', { machine: 'desk' });
    const h = await start({ bots: [pdf] });
    const p = h.page;
    const saves = () => h.sent.filter((f) => f.type === 'bot_save');
    await p.evaluate(() => openEditor(bot('pdf')));
    await h.wait(200);
    check('editing: no Save or Cancel', !(await p.isVisible('#editor-form .actions')));
    await p.fill('#editor-role', 'Reads PDFs');
    await h.wait(300);
    check('typing: not at once', saves().length === 0);
    await h.wait(800);
    const first = saves().at(-1);
    check('after a short pause the change is saved, the editor stays open', saves().length === 1 && first.bot.role === 'Reads PDFs' && first.bot.name === 'PDF-Reader' && await p.isVisible('#editor-form'), first?.bot);
    check('… and the line says so', (await p.textContent('#editor-saved')) === 'Saved', await p.textContent('#editor-saved'));
    const beforeChoice = saves().length;
    await p.selectOption('#editor-approval', 'write');
    await h.wait(200);
    check('… exactly one save for it', saves().length === beforeChoice + 1, saves().slice(beforeChoice).map((f) => f.bot.approval));
    check('a choice: saved at once', saves().at(-1).bot.approval === 'write', saves().at(-1)?.bot);
    const before = saves().length;
    await p.fill('#editor-name', '');
    await h.wait(1200);
    check('without a name nothing is saved', saves().length === before, saves().slice(before).map((f) => f.bot.name + '|' + f.bot.approval));
    await p.fill('#editor-name', 'PDF-Writer');
    await p.keyboard.press('Escape');
    await h.wait(200);
    check('closed right after typing: saved as it goes', saves().length === before + 1 && saves().at(-1).bot.name === 'PDF-Writer', saves().length - before);
    await p.evaluate(() => openEditor(null));
    await h.wait(200);
    check('a new bot keeps its button', await p.isVisible('#editor-form button[type=submit]'));
    check('no errors', h.errors.length === 0, h.errors);
    await h.close();
}
