// Reconnected while the machines stayed awake: the open chat and the previews of the others are fetched again.
// Seemingly dead connection after a pause: without an answer to the sign of life it reconnects, with an answer not.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('anna', 'Anna'), bot('bert', 'Bert')] });
    const p = h.page;
    await h.openChat('Anna');
    await h.wait(200);
    const history = (id, withLimit) => h.sent.filter((f) => f.type === 'history' && f.chatId === id && Boolean(f.limit) === withLimit).length;
    const auth = () => h.sent.filter((f) => f.type === 'auth').length;
    const before = { anna: history('anna', false), bert: history('bert', true), auth: auth() };

    await p.evaluate(() => window.__ws.onclose({ code: 1006 }));
    await h.wait(2500);
    check('signed in again', auth() === before.auth + 1);
    check('open chat: history fetched again', history('anna', false) === before.anna + 1, [before.anna, history('anna', false)]);
    check('other chat: preview fetched again', history('bert', true) === before.bert + 1, [before.bert, history('bert', true)]);

    // sign of life answered: the connection stays
    const a1 = auth();
    await p.evaluate(() => checkConnection());
    await h.wait(200);
    await h.push({ type: 'machine_status', configured: true, hosts: {} });
    await h.wait(6500);
    check('with an answer: no reconnect', auth() === a1, auth());
    check('sign of life via the relay', h.sent.some((f) => f.type === 'wake_status'));

    // no answer: reconnect
    await p.evaluate(() => checkConnection());
    await h.wait(7000);
    check('without an answer: reconnected', auth() === a1 + 1, auth());
}
