// @ mentions by first name: typing "@hu" or "@Hu" offers Hugo (id hub), choosing inserts "@Hugo"; a name shared with
// another bot's id falls back to the id. The backend matches names and ids alike (mention.test.ts).
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({ bots: [bot('pdf', 'PDF-Reader'), bot('hub', 'Hugo'), bot('cloud', 'Carlo'), bot('bruno', 'Bea'), bot('bea', 'Bernd')] });
    const p = h.page;
    await h.openChat('PDF');
    const input = '[data-el=text]';
    const rows = () => p.locator('[data-el=mention]:visible .match').allTextContents();
    await p.click(input);
    await p.type(input, 'Frag @Hu');
    await h.wait(100);
    const list = await rows();
    check('"@Hu" offers Hugo with his id', list.length === 1 && list[0].includes('Hugo') && list[0].includes('@hub'), list);
    await p.keyboard.press('Enter');
    check('chosen: the first name goes in', (await p.inputValue(input)) === 'Frag @Hugo ', await p.inputValue(input));
    await p.type(input, 'und @car');
    await h.wait(100);
    await p.keyboard.press('Enter');
    check('lower case typed: Carlo', (await p.inputValue(input)).endsWith('@Carlo '), await p.inputValue(input));
    await p.type(input, '@bea');
    await h.wait(100);
    const bea = await rows();
    check('"@bea" offers the bot named Bea and the bot with the id bea', bea.length === 2, bea);
    await p.locator('[data-el=mention] .match', { hasText: 'Bea ·' }).dispatchEvent('mousedown');
    check('a name that is another bot\'s id: the id goes in', (await p.inputValue(input)).endsWith('@bruno '), await p.inputValue(input));
}
