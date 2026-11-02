// An iPhone or iPad in a Safari tab is told in the settings that the home screen app has storage of its own (pair the
// device again there) and is the only place for notifications. Not shown in the home screen app, on other systems
// and in the desktop app.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ELECTRON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenFolk/0.1.2 Chrome/140.0.0.0 Electron/44.7.0 Safari/537.36';

const variants = [
    ['iPhone in Safari', { ua: IPHONE }, true],
    ['iPhone, home screen app', { ua: IPHONE, standalone: true }, false],
    ['iPad (reports a Mac with touch)', { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', platform: 'MacIntel', touch: 5 }, true],
    ['Android and other browsers', {}, false],
    ['desktop app', { ua: ELECTRON }, false],
];

export default async function ({ start, check }) {
    for (const [name, v, shown] of variants) {
        const h = await start({
            // runs before the page: what Safari on an iPhone reports
            before: `(() => {
                const v = ${JSON.stringify(v)};
                if (v.ua) Object.defineProperty(navigator, 'userAgent', { get: () => v.ua });
                if (v.platform) Object.defineProperty(navigator, 'platform', { get: () => v.platform });
                if (v.touch) Object.defineProperty(navigator, 'maxTouchPoints', { get: () => v.touch });
                if (v.standalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
            })()`,
        });
        const p = h.page;
        await p.click('#btn-settings');
        await h.wait(150);
        const notes = await p.$$eval('#settings .ios-hint', (n) => n.map((x) => !x.hidden && x.getClientRects().length > 0));
        check(`${name}: both notes ${shown ? 'shown' : 'hidden'}`, notes.length === 2 && notes.every((x) => x === shown), notes);
        if (shown) {
            const text = await p.$$eval('#settings .ios-hint', (n) => n.map((x) => x.textContent).join(' '));
            check(`${name}: says to pair again and where notifications work`, text.includes('pair this device again') && text.includes('home screen'), text);
        }
        await h.close();
    }
}
