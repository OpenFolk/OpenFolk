// Deleting one's own account in the app (the stores want it): "Delete my account" in the own account's form, asked
// twice, then account_delete for the own id; 'main' owns the relay and has no such button.
import { onDialog } from './harness.mjs';

const byDevice = (keys) => (f) => (f.device && keys[f.device] ? { type: 'auth', ok: true, account: keys[f.device] } : { type: 'auth', ok: false, code: 'device_logged_out', message: 'no', loggedOut: true });

export default async function ({ start, check }) {
    for (const who of [{ id: 'erik', name: 'Erik', admin: false }, { id: 'main', name: 'Alex', admin: true }]) {
        const h = await start({
            auth: byDevice({ test: who }),
            onSend: async (f, push) => {
                if (f.type === 'accounts') await push({ type: 'accounts', list: [{ ...who, created: '2026-11-01T00:00:00Z', reach: 'all' }], current: who.id });
            },
        });
        const p = h.page;
        const asked = [];
        onDialog(p, (d) => { asked.push(d.message()); d.accept(); });
        await p.click('[data-tab=settings]');
        await h.wait(300);
        await p.locator('#accounts-list li button', { hasText: 'Edit' }).first().click();
        await h.wait(200);
        if (who.id === 'main') {
            check('main: no delete button', await p.isHidden('#accounts-delete-own'));
        } else {
            check('an invited person: the delete button with its hint', await p.isVisible('#accounts-delete-own') && (await p.textContent('#accounts-delete-own-hint')).includes('devices'));
            await p.click('#accounts-delete-own');
            await h.wait(300);
            const sent = h.sent.find((f) => f.type === 'account_delete');
            check('asked twice, then account_delete for the own id', asked.length === 2 && asked[0].includes('Erik') && sent?.id === 'erik', { asked, sent });
        }
        await h.close();
    }
}
