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
        settings: document.querySelector('#btn-settings').title,
        search: document.getElementById('search').placeholder,
        searchLabel: document.getElementById('search').getAttribute('aria-label'),
        newTitle: document.getElementById('btn-new').title,
        empty: document.querySelector('#chat-empty p').textContent,
        status: document.querySelector('#agent-status span').textContent,
        footer: document.getElementById('footer-handle').getAttribute('aria-label'),
    }));
    let s = await texts();
    check('German browser: German UI and <html lang="de">', s.lang === 'de' && s.settings.startsWith('Einstellungen:') && s.status === 'DESK, WORKSTATION verbunden', s);
    check('data-i18n texts, placeholders, titles and aria labels in German', s.search === 'In allen Chats suchen' && s.searchLabel === 'In allen Chats suchen'
        && s.newTitle === 'Neue Unterhaltung, neuer Bot oder neue Gruppe' && s.empty.startsWith('Wähle links einen Bot') && s.footer === 'Mehr anzeigen', s);

    // a message code from the relay in German
    await h.openChat('Anna');
    await h.push({ type: 'error', code: 'no_machine_connected', message: 'No machine is connected.' });
    await h.wait(100);
    const event = await p.locator('[data-el=messages] .event.error').last().textContent();
    check('message code translated', event === 'Kein Rechner ist verbunden.', event);
    await p.click('[data-el=btn-back]');
    await h.wait(300);

    // switch to English in the settings
    await p.click('#btn-settings');
    await h.wait(100);
    check('language select: automatic is chosen', (await p.inputValue('#settings-language')) === '', await p.inputValue('#settings-language'));
    check('language options', (await p.locator('#settings-language option').allTextContents()).join('|') === 'Automatisch|English|Deutsch');
    await p.selectOption('#settings-language', 'en');
    await h.wait(200);
    const frames = h.sent.filter((f) => f.type === 'language');
    check('`language` frame to every machine that is awake', frames.length === 2 && frames.every((f) => f.language === 'en') && frames.map((f) => f.machine).sort().join() === 'desk,workstation', frames);
    s = await texts();
    check('re-rendered in English without a reload', s.lang === 'en' && s.settings.startsWith('Settings:') && s.search === 'Search all chats' && s.status === 'DESK, WORKSTATION connected'
        && s.newTitle === 'New conversation, new bot or new group' && s.footer === 'Show more', s);
    check('the open settings dialog is English too', (await p.textContent('#settings h2')) === 'Settings'
        && (await p.locator('#settings-language option').allTextContents()).join('|') === 'Automatic|English|Deutsch');
    check('chosen language stored on this device', await p.evaluate(() => localStorage.getItem('openfolk-language') === 'en'));
    await p.click('#settings .settings-close-row [data-close]');
    await p.click('#btn-new');
    check('"+" menu rebuilt in English', (await p.locator('#new-menu button').allTextContents()).join('|') === 'New conversation|New bot|New group');
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
        && (await pg.getAttribute('#btn-settings', 'title')).startsWith('Settings:') && await pg.evaluate(() => localStorage.getItem('openfolk-language-backend') === 'en'));
}
