// Language: a German browser gets the German UI, switching to English in the settings sends the `language` frame and
// re-renders in English, static texts (data-i18n*) are translated, the backends' setting applies without a choice of
// its own and message codes are translated.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    // German browser, no language chosen
    const h = await start({ language: null, locale: 'de-DE', bots: [bot('anna', 'Anna'), bot('bert', 'Bert')], online: ['desk', 'workstation'] });
    const p = h.page;
    const texts = () => p.evaluate(() => ({
        lang: document.documentElement.lang,
        settings: document.querySelector('[data-tab=settings]').textContent.trim(),
        search: document.getElementById('search').placeholder,
        searchLabel: document.getElementById('search').getAttribute('aria-label'),
        newTitle: document.getElementById('btn-new').title,
        empty: document.querySelector('#chat-empty p').textContent,
        status: document.querySelector('#agent-status span').textContent,
        machines: document.querySelector('[data-tab=machines]').textContent.trim(),
    }));
    let s = await texts();
    check('German browser: German UI and <html lang="de">', s.lang === 'de' && s.settings === 'Einstellungen' && s.status === 'DESK, WORKSTATION verbunden · über test.local', s);
    check('data-i18n texts, placeholders, titles and aria labels in German', s.search === 'In allen Chats suchen' && s.searchLabel === 'In allen Chats suchen'
        && s.newTitle === 'Neue Unterhaltung, neuer Bot, neue Gruppe oder neuer Ordner' && s.empty.startsWith('Wähle links einen Bot') && s.machines === 'Status', s);

    // a message code from the relay in German
    await h.openChat('Anna');
    await h.push({ type: 'error', code: 'no_machine_connected', message: 'No machine is connected.' });
    await h.wait(100);
    const event = await p.locator('[data-el=messages] .event.error').last().textContent();
    check('message code translated', event === 'Kein Rechner ist verbunden.', event);
    await p.click('[data-el=btn-back]');
    await h.wait(300);

    // switch to English in the settings
    await p.click('[data-tab=settings]');
    await h.wait(100);
    check('language select: automatic is chosen', (await p.inputValue('#settings-language')) === '', await p.inputValue('#settings-language'));
    check('language options', (await p.locator('#settings-language option').allTextContents()).join('|') === 'Automatisch|English|Deutsch');
    await p.selectOption('#settings-language', 'en');
    await h.wait(200);
    const frames = h.sent.filter((f) => f.type === 'language');
    check('`language` frame to every machine that is awake', frames.length === 2 && frames.every((f) => f.language === 'en') && frames.map((f) => f.machine).sort().join() === 'desk,workstation', frames);
    s = await texts();
    check('re-rendered in English without a reload', s.lang === 'en' && s.settings === 'Settings' && s.search === 'Search all chats' && s.status === 'DESK, WORKSTATION connected · via test.local'
        && s.newTitle === 'New conversation, bot, group or folder' && s.machines === 'Status', s);
    check('the open settings page is English too', (await p.textContent('#settings .settings-bar strong')) === 'Settings'
        && (await p.locator('#settings-language option').allTextContents()).join('|') === 'Automatic|English|Deutsch');
    check('chosen language stored on this device', await p.evaluate(() => localStorage.getItem('openfolk-language') === 'en'));
    // the arrow on a phone, the X on a wide screen
    await p.locator('#settings .settings-bar .round:visible').first().click();
    await p.click('#btn-new');
    check('"+" menu rebuilt in English', (await p.locator('#new-menu button').allTextContents()).join('|') === 'New conversation|New bot|New group|New folder');
    await p.click('#btn-new');

    // without a choice of its own the backends' setting applies; a backend whose language was never chosen gets this page's
    const g = await start({ language: null, locale: 'de-DE' });
    const pg = g.page;
    await g.push({ type: 'settings', machine: 'desk', settings: { language: 'en', updatedAt: '' } });
    await g.wait(100);
    const offered = g.sent.filter((f) => f.type === 'language');
    check('setting never chosen: the page offers its language once', offered.length === 1 && offered[0].language === 'de' && offered[0].machine === 'desk', offered);
    await g.push({ type: 'settings', machine: 'desk', settings: { language: 'en', updatedAt: new Date().toISOString() } });
    await g.wait(100);
    check('setting of the backends applies without a choice of its own', (await pg.evaluate(() => document.documentElement.lang)) === 'en'
        && (await pg.textContent('[data-tab=settings]')).trim() === 'Settings' && await pg.evaluate(() => localStorage.getItem('openfolk-language-backend') === 'en'));
}
