// Tools allowed for good: the approval card of a foreign MCP tool offers "Always for this bot", other cards do not;
// the bot editor lists the allowed tools, and unticking one takes it off when saving.
import { bot } from './harness.mjs';

const GMAIL = 'mcp__claude_ai_Gmail__search_threads';
const DRIVE = 'mcp__claude_ai_Google_Drive__read_file_content';

export default async function ({ start, check }) {
    const h = await start({
        bots: [
            bot('mail', 'Mail', { machine: 'desk', allowedTools: [GMAIL, DRIVE] }),
            bot('dev', 'Dev', { machine: 'desk' }),
        ],
        async onSend(f, push) {
            if (f.type === 'folder_check') await push({ type: 'folder_checked', asked: f.folder, ok: true, folder: f.folder });
        },
    });
    const p = h.page;
    const buttons = () => p.locator('.approval:not(.sent) .actions button').allTextContents();

    await h.openChat('Dev');
    await h.push({ type: 'approval', machine: 'desk', approval: { id: 'ap1', chatId: 'dev', botId: 'dev', kind: 'tool', tool: 'Bash', summary: 'Run rm -rf build', detail: '', ts: new Date().toISOString() } });
    await h.wait(200);
    check('a shell command: no "Always for this bot"', !(await buttons()).includes('Always for this bot'), await buttons());

    await h.push({ type: 'approval', machine: 'desk', approval: { id: 'ap2', chatId: 'dev', botId: 'dev', kind: 'tool', tool: 'mcp__github__list_issues', summary: 'github › list_issues', detail: '', ts: new Date().toISOString(), rememberable: true } });
    await h.wait(200);
    check('a foreign MCP tool: "Always for this bot" offered', (await buttons()).includes('Always for this bot'), await buttons());
    await p.locator('.approval', { hasText: 'list_issues' }).locator('button', { hasText: 'Always for this bot' }).click();
    await h.wait(100);
    const reply = h.sent.findLast((f) => f.type === 'approval_reply');
    check('the answer allows and remembers for the bot', reply?.id === 'ap2' && reply.allow === true && reply.remember === true && !reply.always, reply);

    const edit = async (id) => {
        await p.evaluate((x) => openEditor(bot(x)), id);
        await h.wait(150);
    };
    const save = async () => {
        await p.click('#editor-form button[type=submit]');
        await h.wait(200);
        return h.sent.findLast((f) => f.type === 'bot_save');
    };

    await edit('mail');
    const listed = await p.locator('#editor-allowed-tools label').allTextContents();
    check('the editor lists the allowed tools', await p.isVisible('#editor-allowed-tools') && listed.map((s) => s.trim()).join('|') === 'claude_ai_Gmail › search_threads|claude_ai_Google_Drive › read_file_content', listed);
    await p.uncheck(`#editor-allowed-tools input[value="${GMAIL}"]`);
    let saved = await save();
    check('unticked: taken off when saving', JSON.stringify(saved?.bot.allowedTools) === JSON.stringify([DRIVE]), saved?.bot);

    await edit('dev');
    check('a bot without allowed tools: no list', !(await p.isVisible('#editor-allowed-tools')));
    saved = await save();
    check('and the field stays out of the save', saved?.bot.id === 'dev' && !('allowedTools' in saved.bot), saved?.bot);
}
