// Context size: in the chat header and on the bot's page, hint from 300k, update via frame, separate per conversation.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader', { conversations: [{ id: 'aa11', title: 'On the side', createdAt: '' }] })] });
    const p = h.page;
    const sub = () => p.locator('[data-el=chat-sub]').textContent();
    // the context line of the bot's page (opened via the header, closed with the arrow)
    const info = async (sel = '.menu-info') => {
        await p.click('[data-el=chat-title]');
        await h.wait(100);
        const t = await p.locator(`#info-switches ${sel}`).allTextContents();
        await p.click('#info [data-page-back]');
        await h.wait(100);
        return t.join('');
    };
    await h.openChat('PDF');
    check('without a measurement no figure', !(await sub()).includes('context') && (await info()) === '');
    await h.push({ type: 'context', botId: 'pdf', tokens: 42000 });
    await h.wait(100);
    check('header shows the size', (await sub()).endsWith('· context 42k'), await sub());
    check('the page shows the exact number without hint', (await info()) === 'Context: 42,000 tokens', await info());
    await h.push({ type: 'context', botId: 'pdf', tokens: 595697 });
    await h.wait(100);
    check('large context in the header', (await sub()).endsWith('· context 596k'), await sub());
    check('from 300k with a recommendation', (await info()).startsWith('Context: 595,697 tokensLarge:'), await info());
    check('hint colored', (await info('.menu-info.large')) !== '');
    await h.push({ type: 'context', botId: 'pdf', tokens: 0 });
    await h.wait(100);
    check('after "New session" no figure', !(await sub()).includes('context'), await sub());
    await p.click('[data-el=btn-back]');
    await p.locator('#chat-list li.sub').click();
    await h.wait(200);
    await h.push({ type: 'context', botId: 'pdf~aa11', tokens: 1250000 });
    await h.wait(100);
    check('the conversation has its own size (millions)', (await sub()).endsWith('· context 1.3M'), await sub());
    const conv = await info();
    check('the conversation\'s page: its title, then its own size', conv.startsWith('On the side') && conv.includes('Context: 1,250,000 tokens'), conv);
}
