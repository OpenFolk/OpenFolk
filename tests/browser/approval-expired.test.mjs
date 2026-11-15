// An approval card nobody answered in time stays in the chat, without its buttons and with the backend's word that
// nothing happened; a card closed otherwise goes and leaves the event line.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('dev', 'Dev', { machine: 'desk' })] });
    const p = h.page;
    const card = (id) => ({ type: 'approval', machine: 'desk', approval: { id, chatId: 'dev', botId: 'dev', kind: 'tool', tool: 'Bash', summary: `Run ${id}`, detail: '', ts: new Date().toISOString() } });

    await h.openChat('Dev');
    await h.push(card('ap1'));
    await h.push(card('ap2'));
    await h.wait(200);
    await h.push({ type: 'approval_done', id: 'ap1', chatId: 'dev', result: 'expired after 30 minutes without an answer, nothing happened', expired: true });
    await h.wait(200);
    const expired = p.locator('.approval[data-approval=ap1]');
    check('the expired card stays, marked', (await expired.count()) === 1 && await expired.evaluate((k) => k.classList.contains('expired')));
    check('… without buttons or fields, with the note', (await expired.locator('button, input').count()) === 0
        && (await expired.locator('.approval-expired').textContent()).includes('nothing happened'));
    check('the other card still asks', (await p.locator('.approval[data-approval=ap2] .actions button').count()) > 0);

    await h.push(card('ap3'));
    await h.wait(200);
    check('a new card: the expired one is still there', (await expired.count()) === 1 && (await p.locator('.approval[data-approval=ap3]').count()) === 1);

    await h.push({ type: 'approval_done', id: 'ap2', chatId: 'dev', result: 'not answered, you wrote a new message; nothing happened' });
    await h.wait(200);
    check('closed otherwise: the card goes, the event line says why', (await p.locator('.approval[data-approval=ap2]').count()) === 0
        && (await p.locator('[data-el=messages]').textContent()).includes('you wrote a new message'));
}
