// A machine that runs bots and lost its sign-in (an expired Claude login): not above the chats but on the status page,
// which names the machine and its bots and how to sign in there, also while another machine is signed in; the status
// tab carries a "!" meanwhile. Gone once the machine is ready again.
import { bot } from './harness.mjs';

export default async function ({ start, check }) {
    const h = await start({
        bots: [bot('anna', 'Anna', { machine: 'desk' }), bot('paul', 'Paul', { machine: 'nas' })],
        online: ['desk', 'nas'],
    });
    const p = h.page;
    const inList = () => p.evaluate(() => Boolean(document.querySelector('#chat-list .start-setup')));
    const badge = () => p.evaluate(() => !document.getElementById('tab-status-badge').hidden);
    const card = () => p.evaluate(() => {
        const c = document.querySelector('#machines-signin:not([hidden]) .welcome-body');
        return c ? `${c.querySelector('strong').textContent} | ${c.querySelector('span').textContent}` : '';
    });

    await h.push({ type: 'setup_status', machine: 'desk', relay: 'remote', container: false, engines: { claude: 'ready' } });
    await h.push({ type: 'setup_status', machine: 'nas', relay: 'remote', container: true, engines: { claude: 'ready' } });
    await h.wait(150);
    check('both signed in: no card, no "!"', !(await inList()) && !(await badge()));

    await h.push({ type: 'setup_status', machine: 'nas', relay: 'remote', container: true, engines: { claude: 'sign_in' } });
    await h.wait(150);
    check('the login on NAS lost: nothing above the chats, the bots in the list', !(await inList()) && await p.isVisible('#chat-list li[data-chat="paul"]') && await p.isVisible('#chat-list li[data-chat="anna"]'));
    check('… a "!" on the status tab', await badge());
    await p.click('[data-tab=machines]');
    await h.wait(200);
    const lost = await card();
    check('… the status page names the machine and its bot, although DESK is fine', lost.startsWith('Sign in on NAS again | ') && lost.includes('Paul') && !lost.includes('Anna'), lost);
    check('… with the way to sign in there (a container)', lost.includes('container'), lost);
    const text = await p.evaluate(() => { const c = document.getElementById('machines-signin'); return { card: c.getBoundingClientRect().width, body: c.querySelector('.welcome-body').getBoundingClientRect().width }; });
    check('… its text runs across the card', text.body > text.card * 0.8, text);
    const layout = await p.evaluate(() => [...document.querySelectorAll('#chat-list > li')].map((li) => `${li.dataset.chat ? 'chat' : li.className}:${getComputedStyle(li).display}`));
    check('only the chats\' rows take the row grid in the list', layout.every((x) => (x.startsWith('chat:') ? x.endsWith(':grid') : !x.endsWith(':grid'))), layout);

    await h.push({ type: 'setup_status', machine: 'nas', relay: 'remote', container: true, engines: { claude: 'ready' } });
    await h.wait(150);
    check('signed in again: the card and the "!" go', (await card()) === '' && !(await badge()));

    // A machine without bots that was never signed in stays quiet while another one is ready (nothing lost there)
    await h.push({ type: 'agents', online: ['desk', 'nas', 'spare'] });
    await h.push({ type: 'setup_status', machine: 'spare', relay: 'remote', container: false, engines: { claude: 'sign_in' } });
    await h.wait(150);
    check('a machine without bots, not signed in: no card, no "!"', (await card()) === '' && !(await badge()));
    check('no page errors', h.errors.length === 0, h.errors);
}
