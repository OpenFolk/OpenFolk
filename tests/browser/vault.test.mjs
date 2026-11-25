// The vault in the settings: admins see the list and manage entries as a phone page (name, note, value, which bots);
// the value is write-only and travels only in the save frame; an invited person does not see the block.
import { onDialog } from './harness.mjs';

const MAIN = { id: 'main', name: 'Alex', admin: true };
const GUEST = { id: 'erik', name: 'Erik', admin: false };
const byDevice = (keys) => (f) => (f.device && keys[f.device] ? { type: 'auth', ok: true, account: keys[f.device] } : { type: 'auth', ok: false, code: 'device_logged_out', message: 'no', loggedOut: true });
const bot = (id, name, area) => ({ id, name, area, role: '', folder: `C:/w/${id}`, model: 'default', tone: '', avatar: '', approval: 'risky', machine: 'desk' });
const ENTRY = { id: 'e1', name: 'HETZNER_API_TOKEN', note: 'Cloud', bots: null, createdAt: '2026-11-21T10:00:00Z', updatedAt: '2026-11-21T10:00:00Z' };

export default async function ({ start, check }) {
    // ---- a relay with accounts: the admin
    const vault = [ENTRY];
    const h = await start({
        auth: byDevice({ test: MAIN }), bots: [bot('cloud', 'Carlo', 'Cloud'), bot('mail', 'Marie', 'Mail')],
        onSend: async (f, push) => {
            if (f.type === 'vault_save') {
                if (f.entry.name === 'TAKEN_NAME') { await push({ type: 'error', request: 'vault_save', message: 'There is an entry of that name already.' }); return; }
                const old = vault.find((e) => e.id === f.entry.id);
                const e = { ...(old ?? { id: 'e' + (vault.length + 1), createdAt: '2026-11-21T11:00:00Z' }), name: f.entry.name, note: f.entry.note, bots: f.entry.bots, updatedAt: '2026-11-21T11:00:00Z' };
                if (old) vault[vault.indexOf(old)] = e; else vault.push(e);
                await push({ type: 'vault', entries: [...vault] });
            }
            if (f.type === 'vault_delete') {
                vault.splice(vault.findIndex((e) => e.id === f.id), 1);
                await push({ type: 'vault', entries: [...vault] });
            }
        },
    });
    const p = h.page;
    onDialog(p, (d) => d.accept());
    await h.push({ type: 'vault', entries: [...vault] });
    await p.click('[data-tab=settings]');
    await h.wait(150);
    const rows = () => p.evaluate(() => [...document.querySelectorAll('#settings-vault-list li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
    check('the admin sees the block with the entry, its note and "all bots"', await p.isVisible('#settings-vault') && (await rows())[0].includes('HETZNER_API_TOKEN') && (await rows())[0].includes('Cloud') && (await rows())[0].includes('all bots'));
    check('the backend sent no value', await p.evaluate(() => window.state.vault.every((e) => !('value' in e))));

    // ---- a new entry: the form is a page on the phone, the value goes only into the frame
    await p.click('#settings-vault-add');
    await h.wait(150);
    const page = await p.evaluate(() => {
        const d = document.getElementById('settings-dialog');
        const r = d.querySelector('.dialog').getBoundingClientRect();
        return { shown: !d.hidden, full: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1, title: document.getElementById('settings-dialog-title').textContent, value: document.getElementById('settings-vault-value').type };
    });
    check('the form fills the phone screen, titled, the value as a password field', page.shown && page.full && page.title === 'New vault entry' && page.value === 'password', page);
    await p.fill('#settings-vault-name', 'mail password');
    await p.fill('#settings-vault-value', 'pw-secret-1');
    await p.click('#settings-vault-save');
    await h.wait(100);
    check('a name that is no variable: refused in the form, nothing sent', await p.isVisible('#settings-vault-error') && !h.sent.some((f) => f.type === 'vault_save'));
    await p.fill('#settings-vault-name', 'mail_password');
    await p.fill('#settings-vault-value', 'short');
    await p.click('#settings-vault-save');
    check('a short value: refused in the form', (await p.textContent('#settings-vault-error')).includes('6') && !h.sent.some((f) => f.type === 'vault_save'));
    await p.fill('#settings-vault-value', 'pw-secret-1');
    await p.fill('#settings-vault-note', 'IMAP');
    await p.selectOption('#settings-vault-bots', 'some');
    check('"only the bots ticked" shows the bots', await p.isVisible('#settings-vault-bot-list') && (await p.locator('#settings-vault-bot-list input').count()) === 2);
    await p.check('#settings-vault-bot-list input[value=mail]');
    await p.click('#settings-vault-save');
    await h.wait(200);
    const saved = h.sent.find((f) => f.type === 'vault_save');
    check('saved: name upper case, note, the ticked bot, the value in the frame', saved && saved.entry.id === '' && saved.entry.name === 'MAIL_PASSWORD' && saved.entry.note === 'IMAP'
        && JSON.stringify(saved.entry.bots) === '["mail"]' && saved.entry.value === 'pw-secret-1', saved);
    check('the list arrived: the form is closed, the entry names its bot', await p.isHidden('#settings-dialog') && (await rows()).length === 2 && (await rows())[1].includes('Marie'));

    // ---- editing keeps the value unless a new one is typed; an error of the backend stays in the form
    await p.click('#settings-vault-list li[data-id=e2] button');
    await h.wait(150);
    const edit = await p.evaluate(() => ({ name: document.getElementById('settings-vault-name').value, value: document.getElementById('settings-vault-value').value, placeholder: document.getElementById('settings-vault-value').placeholder, bots: document.getElementById('settings-vault-bots').value }));
    check('the form of an entry: name and bots filled, the value empty with "stored"', edit.name === 'MAIL_PASSWORD' && edit.value === '' && edit.placeholder.startsWith('Stored') && edit.bots === 'some', edit);
    await p.fill('#settings-vault-name', 'TAKEN_NAME');
    await p.click('#settings-vault-save');
    await h.wait(150);
    const refused = h.sent.findLast((f) => f.type === 'vault_save');
    check('without a new value none is sent; the backend\'s refusal shows in the open form', refused && refused.entry.id === 'e2' && !('value' in refused.entry)
        && await p.isVisible('#settings-dialog') && (await p.textContent('#settings-vault-error')).includes('already') && !(await p.isDisabled('#settings-vault-save')));
    await p.fill('#settings-vault-name', 'MAIL_PASSWORD');
    await p.selectOption('#settings-vault-bots', 'all');
    await p.click('#settings-vault-save');
    await h.wait(150);
    check('changed to all bots', await p.isHidden('#settings-dialog') && (await rows())[1].includes('all bots'));

    // ---- deleting asks
    await p.click('#settings-vault-list li[data-id=e1] button.danger');
    await h.wait(150);
    check('deleted after the question', h.sent.some((f) => f.type === 'vault_delete' && f.id === 'e1') && (await rows()).length === 1 && (await rows())[0].includes('MAIL_PASSWORD'));

    // ---- asleep: nothing to change
    await h.push({ type: 'agents', online: [] });
    await h.wait(100);
    check('all machines asleep: the hint, add and edit disabled', await p.isVisible('#settings-vault-asleep') && await p.isDisabled('#settings-vault-add') && await p.isDisabled('#settings-vault-list li button'));
    await h.close();

    // ---- an invited person: no block, whatever a backend sends
    const g = await start({ auth: byDevice({ test: GUEST }) });
    await g.push({ type: 'vault', entries: [] });
    await g.page.click('[data-tab=settings]');
    await g.wait(150);
    check('an invited person does not see the vault', await g.page.isHidden('#settings-vault'));
    await g.close();

    // ---- a relay without accounts: the one person manages it
    const solo = await start({});
    await solo.push({ type: 'vault', entries: [] });
    await solo.page.click('[data-tab=settings]');
    await solo.wait(150);
    check('a relay without accounts: the block with "no entry yet"', await solo.page.isVisible('#settings-vault') && (await solo.page.textContent('#settings-vault-list')).includes('No entry'));
    await solo.close();
}
