// Machine list: if a machine runs according to the wake service but its backend does not come back, the app says so
// (also after a reload, because the relay sends the time along), after a planned shutdown as "stuck".

export default async function ({ start, check }) {
    const h = await start({ online: ['desk', 'workstation'] });
    const p = h.page;
    const row = (host) => p.evaluate((host) => {
        const z = [...document.querySelectorAll('.machine-row')].find((e) => e.querySelector('strong').textContent.toLowerCase() === host);
        return z ? z.querySelector('.machine-text').textContent : '';
    }, host);
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
    const status = { type: 'machine_status', configured: true, hosts: { desk: { active: true }, workstation: { active: true } } };

    await h.push(status);
    await h.push({ type: 'agents', online: ['desk'], gone: { workstation: ago(0.2) } });
    await h.wait(100);
    check('just disconnected: still "bots not there yet"', (await row('workstation')).includes('bots not there yet'), await row('workstation'));

    await h.push({ type: 'agents', online: ['desk'], gone: { workstation: ago(10) } });
    await h.wait(100);
    check('gone for long: backend gone, check the machine', /running, but backend gone since \d\d:\d\d [AP]M/.test(await row('workstation')), await row('workstation'));

    // shutdown planned, then the backend is gone, the machine keeps running
    await h.push({ type: 'agents', online: ['desk', 'workstation'], gone: {} });
    await h.push({ type: 'machine_shutdown_result', machine: 'workstation', cancel: false, ok: true, at: new Date(Date.now() + 60000).toISOString() });
    await h.wait(100);
    check('planned: "shuts down at …"', (await row('workstation')).includes('shuts down'), await row('workstation'));
    await h.push({ type: 'agents', online: ['desk'], gone: { workstation: ago(5) } });
    await h.wait(100);
    check('shutdown is stuck', (await row('workstation')).includes('Shutdown is stuck'), await row('workstation'));

    await h.push({ type: 'agents', online: ['desk', 'workstation'], gone: {} });
    await h.wait(100);
    check('connected again', (await row('workstation')).includes('connected'), await row('workstation'));

    check('footer without autologin', !(await row('desk')).includes('utologin'), await row('desk'));

    // machine settings: with shutting down switched off no "shut down"; the delay comes from the machine's settings
    const buttons = (host) => p.evaluate((host) => {
        const z = [...document.querySelectorAll('.machine-row')].find((e) => e.querySelector('strong').textContent.toLowerCase() === host);
        return z ? [...z.querySelectorAll('button')].map((b) => b.textContent) : [];
    }, host);
    check('without settings known: shut down offered', (await buttons('desk')).includes('shut down'), await buttons('desk'));
    await h.push({ type: 'machine_capabilities', machine: 'desk', shutdown: false, shutdownSeconds: 60, cancelShutdown: false, autologon: false });
    await h.push({ type: 'machine_capabilities', machine: 'workstation', shutdown: true, shutdownSeconds: 120, cancelShutdown: true, autologon: false });
    await h.wait(100);
    check('shutdown not set up: no button', !(await buttons('desk')).includes('shut down'), await buttons('desk'));
    let question = '';
    p.once('dialog', (d) => { question = d.message(); return d.dismiss(); });
    await p.evaluate(() => {
        const z = [...document.querySelectorAll('.machine-row')].find((e) => e.querySelector('strong').textContent.toLowerCase() === 'workstation');
        [...z.querySelectorAll('button')].find((b) => b.textContent === 'shut down').click();
    });
    await h.wait(100);
    check('question names the set delay', question.includes('120 seconds'), question);

    // restart: only offered when the backend reports it (an older one would shut down instead)
    check('restart unknown: no restart button', !(await buttons('workstation')).includes('restart'), await buttons('workstation'));
    await h.push({ type: 'machine_capabilities', machine: 'workstation', shutdown: true, shutdownSeconds: 120, cancelShutdown: true, autologon: false, restart: true });
    await h.wait(100);
    check('restart reported: button', (await buttons('workstation')).includes('restart'), await buttons('workstation'));
    p.once('dialog', (d) => { question = d.message(); return d.accept(); });
    await p.evaluate(() => {
        const z = [...document.querySelectorAll('.machine-row')].find((e) => e.querySelector('strong').textContent.toLowerCase() === 'workstation');
        [...z.querySelectorAll('button')].find((b) => b.textContent === 'restart').click();
    });
    await h.wait(100);
    check('restart question', question.startsWith('Restart WORKSTATION in 120 seconds'), question);
    const frame = h.sent.findLast((f) => f.type === 'machine_shutdown');
    check('restart frame to that machine', frame && frame.restart === true && frame.machine === 'workstation', frame);
    await h.push({ type: 'machine_shutdown_result', machine: 'workstation', cancel: false, ok: true, at: new Date(Date.now() + 120000).toISOString(), restart: true });
    await h.wait(100);
    check('planned restart: "restarts at …" and cancel', (await row('workstation')).includes('restarts at') && (await buttons('workstation')).join() === 'cancel', [await row('workstation'), await buttons('workstation')]);
    await h.push({ type: 'agents', online: ['desk'], gone: { workstation: ago(5) } });
    await h.wait(100);
    check('restart without return: backend gone, not "shutdown is stuck"', (await row('workstation')).includes('backend gone'), await row('workstation'));
}
