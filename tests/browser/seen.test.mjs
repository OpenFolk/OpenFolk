// Read state across all devices: opening reports "seen" to the machines, the state of another device removes the
// dot or sets it (unread by hand), on connecting newer state goes from here to them. An older state does not win.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const old = (id) => [{ id: 'old-' + id, role: 'assistant', botId: id, text: 'Old answer', ts: '2026-10-07T10:00:00Z' }];
    const h = await start({ bots: [bot('anna', 'Anna'), bot('bert', 'Bert')], history: { anna: old('anna'), bert: old('bert') } });
    const p = h.page;
    const dots = () => p.evaluate(() => [...document.querySelectorAll('#chat-list li.unread')].map((l) => l.dataset.chat).sort().join());
    const reported = () => h.sent.filter((f) => f.type === 'seen');
    const time = (s) => new Date(Date.now() + s * 1000).toISOString();

    // new answer at Anna: dot; another device read it afterwards: dot gone
    await h.push({ type: 'done', chatId: 'anna', botId: 'anna', entry: { id: 'n1', role: 'assistant', botId: 'anna', text: 'New', ts: time(0) }, durationMs: 1 });
    await h.wait(150);
    check('new answer: dot at Anna', (await dots()) === 'anna', await dots());
    await h.push({ type: 'seen', machine: 'desk', state: { anna: { until: time(5), updatedAt: time(5) } } });
    await h.wait(150);
    check('read on another device: dot gone', (await dots()) === '', await dots());

    // another device marks Bert unread by hand; an older state afterwards changes nothing
    await h.push({ type: 'seen', machine: 'desk', state: { bert: { unread: true, updatedAt: time(6) } } });
    await h.push({ type: 'seen', machine: 'desk', state: { bert: { until: time(1), updatedAt: time(1) } } });
    await h.wait(150);
    check('unread by hand arrives, an older state does not win', (await dots()) === 'bert', await dots());

    // open here: reported to the machines (bundled), dot gone
    await h.openChat('Bert');
    await h.wait(1200);
    const f = reported().pop();
    check('opening reports seen to the machines', f && f.state.bert && f.state.bert.until && !f.state.bert.unread, f);
    await p.click('[data-el=btn-back]');
    await h.wait(300);
    check('Bert read', (await dots()) === '', await dots());

    // on connecting: the machine knows Bert only in an old state, Anna not differently → newer state from here is sent
    const before = reported().length;
    await h.push({ type: 'seen', machine: 'desk', all: true, state: { bert: { until: time(-60), updatedAt: time(-60) }, anna: { until: time(5), updatedAt: time(5) } } });
    await h.wait(700);
    const after = reported().slice(before);
    check('on connecting: only newer state from here is sent', after.length === 1 && Object.keys(after[0].state).join() === 'bert', after);
    check('stays stored in the browser', await p.evaluate(() => JSON.parse(localStorage.getItem('openfolk-seen')).anna.updatedAt.length > 0));
}
