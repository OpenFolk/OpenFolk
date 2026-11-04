// Settings: reachable from the tabs; autologin per machine with a question to exactly this machine,
// switching on only with a stored password, sleeping machines cannot be set; appearance selectable.

export default async function ({ start, check }) {
    const h = await start({ online: ['desk', 'workstation'] });
    const p = h.page;
    await h.push({ type: 'machine_status', configured: true, hosts: { desk: { active: true }, workstation: { active: true }, laptop: { active: false } } });
    await p.click('[data-tab=settings]');
    await h.wait(100);
    check('dialog open', await p.isVisible('#settings'));
    const queries = h.sent.filter((f) => f.type === 'machine_autologon' && f.on === undefined).map((f) => f.machine).sort();
    check('state queried from every machine that is awake when opening', queries.join() === 'desk,workstation', queries);

    const machines = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#settings-machines li')].map((li) => {
        const box = li.querySelector('input');
        return [li.querySelector('strong').textContent.toLowerCase(), { on: box.checked, locked: box.disabled, hint: li.querySelector('.settings-hint').textContent }];
    })));
    let r = await machines();
    check('locked without a state', r.desk.locked && r.desk.hint.includes('querying'), r.desk);
    check('sleeping machine locked', r.laptop && r.laptop.locked && r.laptop.hint.includes('asleep'), r.laptop);

    await h.push({ type: 'machine_autologon_status', machine: 'desk', ok: true, on: true, password: true });
    await h.push({ type: 'machine_autologon_status', machine: 'workstation', ok: true, on: false, password: false });
    await h.wait(100);
    r = await machines();
    check('DESK on and switchable', r.desk.on && !r.desk.locked, r.desk);
    check('no switching on without a password, with a hint', !r.workstation.on && r.workstation.locked && r.workstation.hint.includes('Password'), r.workstation);

    await h.push({ type: 'machine_autologon_status', machine: 'workstation', ok: true, on: false, password: true });
    await h.wait(100);
    r = await machines();
    check('password stored: WORKSTATION can be switched on', !r.workstation.on && !r.workstation.locked, r.workstation);

    let dialog = null;
    let accept = false;
    p.on('dialog', (d) => { dialog = d.message(); return accept ? d.accept() : d.dismiss(); });
    const tap = (host) => p.evaluate((host) => {
        const li = [...document.querySelectorAll('#settings-machines li')].find((l) => l.querySelector('strong').textContent.toLowerCase() === host);
        li.querySelector('input').click();
    }, host);
    const requests = () => h.sent.filter((f) => f.type === 'machine_autologon' && f.on !== undefined);

    await tap('desk');
    await h.wait(100);
    r = await machines();
    check('cancel: no request, the tick stays', dialog && dialog.includes('turn off') && !requests().length && r.desk.on, [dialog, r.desk]);

    accept = true;
    await tap('workstation');
    await h.wait(100);
    const request = requests()[0];
    check('request to WORKSTATION: on', request && request.on === true && request.machine === 'workstation', request);
    r = await machines();
    check('locked until the answer', r.workstation.locked && r.workstation.hint.includes('switched'), r.workstation);
    await h.push({ type: 'machine_autologon_status', machine: 'workstation', ok: true, on: true, password: true });
    await h.wait(100);
    r = await machines();
    check('after the answer: on', r.workstation.on && !r.workstation.locked, r.workstation);

    // a machine without AUTOLOGON_METHOD: not queried, locked with a hint
    await h.push({ type: 'machine_capabilities', machine: 'desk', shutdown: true, shutdownSeconds: 60, cancelShutdown: true, autologon: false });
    await h.wait(100);
    r = await machines();
    check('autologin not set up: locked with a hint', r.desk.locked && r.desk.hint.includes('not set up'), r.desk);

    // shared settings of the bots: shown as the backend reports them, changes go to every machine that is awake
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', avatarModel: 'gpt-image-1', gitAutoPull: false, apiKeys: { gemini: true, openai: false }, updatedAt: '2026-10-18T10:00:00Z' } });
    await h.wait(100);
    const shared = await p.evaluate(() => ({
        model: document.querySelector('#settings-avatar-model').value, pull: document.querySelector('#settings-git-pull').checked,
        services: [...document.querySelectorAll('#settings-ai-list li[data-provider]')].map((li) => li.dataset.provider + ': ' + li.querySelector('span').textContent),
        addable: !document.getElementById('settings-ai-add-row').hidden,
    }));
    check('shared settings shown as reported', shared.model === 'gpt-image-1' && !shared.pull, shared);
    // image model from OpenAI without its key; with Gemini's key alone the automatic voice is Gemini
    check('AI services: the stored key listed with its use, the other one to add', shared.services.join() === 'gemini: Key stored · reading aloud' && shared.addable, shared);
    await p.selectOption('#settings-voice-language', 'de');
    await h.wait(100);
    const saves = h.sent.filter((f) => f.type === 'settings_save' && f.settings.voiceLanguage === 'de').map((f) => f.machine).sort();
    check('a shared change goes to every machine that is awake', saves.join() === 'desk,workstation', saves);
    await p.click('#settings-ai-add');
    check('add: the form opens in the settings dialog, with its own buttons', await p.isVisible('#settings-dialog') && await p.isHidden('#settings-dialog-actions')
        && await p.evaluate(() => document.getElementById('settings-ai-form').parentElement.id === 'settings-dialog-body'));
    check('add: the form offers only the provider without a key', (await p.inputValue('#settings-ai-provider')) === 'openai'
        && await p.evaluate(() => [...document.querySelectorAll('#settings-ai-provider option')].filter((o) => !o.hidden).map((o) => o.value).join() === 'openai'));
    await p.fill('#settings-ai-key', 'sk-new');
    await p.click('#settings-ai-save');
    await h.wait(100);
    const key = h.sent.find((f) => f.type === 'settings_save' && f.apiKeys);
    check('a new key is sent, the form closes', key && key.apiKeys.openai === 'sk-new' && await p.evaluate(() => document.getElementById('settings-ai-form').hidden), key);
    await h.push({ type: 'settings', machine: 'desk', settings: { language: 'en', avatarModel: 'gpt-image-1', gitAutoPull: false, apiKeys: { gemini: true, openai: true }, updatedAt: '2026-10-18T10:01:00Z' } });
    await h.wait(100);
    const both = await p.evaluate(() => ({
        services: [...document.querySelectorAll('#settings-ai-list li[data-provider]')].map((li) => li.dataset.provider + ': ' + li.querySelector('span').textContent),
        addable: !document.getElementById('settings-ai-add-row').hidden,
    }));
    check('both stored: listed with their uses, nothing left to add', both.services.join('|') === 'openai: Key stored · profile pictures, reading aloud|gemini: Key stored · not used right now' && !both.addable, both);

    // settings of one machine: only once its backend reported them, changes only to that machine
    const form = () => p.evaluate(() => [...document.querySelectorAll('#settings-machines li')].map((li) => [li.querySelector('strong').textContent.toLowerCase(), Boolean(li.querySelector('details'))]));
    check('no machine settings before a backend reports them', (await form()).every(([, has]) => !has), await form());
    await h.push({
        type: 'machine_settings', machine: 'desk', anthropicKey: false, shutdownMethod: 'script', offers: { shutdown: true, ide: true, terminal: false, voice: true },
        settings: { claudeAuth: 'subscription', shutdown: true, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300, afterWakeWaitMinutes: 60, idleMinutes: 15,
            handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true },
    });
    await h.wait(100);
    check('DESK has its settings, WORKSTATION not', JSON.stringify(await form()) === JSON.stringify([['desk', true], ['laptop', false], ['workstation', false]]), await form());
    await p.click('#settings-machines details summary');
    const deskForm = await p.evaluate(() => {
        const d = document.querySelector('#settings-machines details');
        const box = (text) => [...d.querySelectorAll('label.check')].find((l) => l.textContent.includes(text)).querySelector('input');
        return { terminal: box('terminal').checked, terminalLocked: box('terminal').disabled, ide: box('IDE').checked };
    });
    check('a target the machine does not offer is off and locked', !deskForm.terminal && deskForm.terminalLocked && deskForm.ide, deskForm);
    await p.evaluate(() => {
        const d = document.querySelector('#settings-machines details');
        [...d.querySelectorAll('label.check')].find((l) => l.textContent.includes('shut down')).querySelector('input').click();
    });
    await h.wait(100);
    const machineSave = h.sent.find((f) => f.type === 'machine_settings_save');
    check('a machine change goes to that machine only', machineSave && machineSave.machine === 'desk' && machineSave.settings.shutdown === false, machineSave);

    // claude.ai connectors: no switch from a backend that does not know it, off by default, a click lets them in
    const connectorBox = () => p.evaluate(() => {
        const label = [...document.querySelectorAll('#settings-machines details label.check')].find((l) => l.textContent.includes('connectors'));
        return label ? label.querySelector('input').checked : null;
    });
    check('older backend: no connector switch', (await connectorBox()) === null);
    await h.push({
        type: 'machine_settings', machine: 'desk', anthropicKey: false, shutdownMethod: 'script', offers: { shutdown: true, ide: true, terminal: false, voice: true },
        settings: { claudeAuth: 'subscription', shutdown: false, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300, afterWakeWaitMinutes: 60, idleMinutes: 15,
            handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true, claudeAiConnectors: false },
    });
    await h.wait(100);
    check('connector switch shown, off', (await connectorBox()) === false);
    await p.evaluate(() => [...document.querySelectorAll('#settings-machines details label.check')].find((l) => l.textContent.includes('connectors')).querySelector('input').click());
    await h.wait(100);
    const connectorSave = h.sent.findLast((f) => f.type === 'machine_settings_save');
    check('switching connectors on goes to that machine', connectorSave?.machine === 'desk' && connectorSave.settings.claudeAiConnectors === true, connectorSave);

    // voice messages not set up: the button asks exactly this machine
    await h.push({
        type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: false, shutdownMethod: 'script', voice: { state: 'missing' },
        offers: { shutdown: true, ide: true, terminal: false, voice: true },
        settings: { claudeAuth: 'subscription', shutdown: false, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300, afterWakeWaitMinutes: 60, idleMinutes: 15,
            handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true, gitPushUser: '', gitPushHost: '' },
    });
    await h.wait(100);
    await p.click('#settings-machines .settings-voice-setup button');
    await h.wait(100);
    const setup = h.sent.find((f) => f.type === 'voice_setup');
    check('voice setup goes to that machine', setup && setup.machine === 'desk', setup);
    await h.push({ type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: true, shutdownMethod: 'script', voice: { state: 'failed', detail: 'no_python' },
        offers: { shutdown: true, ide: true, terminal: false, voice: true },
        settings: { claudeAuth: 'subscription', shutdown: false, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300, afterWakeWaitMinutes: 60, idleMinutes: 15,
            handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true, gitPushUser: 'bot', gitPushHost: 'git.example.test' } });
    await h.wait(100);
    const after = await p.evaluate(() => ({
        voice: document.querySelector('#settings-machines .settings-voice-setup').textContent,
        token: [...document.querySelectorAll('#settings-machines .settings-key')].map((b) => b.querySelector('.settings-hint').textContent),
    }));
    check('without Python: says what is missing, offers to try again', after.voice.includes('Python 3.9') && after.voice.includes('Try again'), after);
    check('git token stored; with the subscription no field for an Anthropic key', after.token.join() === 'stored', after);
    // The git host typed as an address: the field and the frame carry the host only (older backends refuse the rest)
    const hostTyped = await p.evaluate(() => {
        const label = [...document.querySelectorAll('#settings-machines label')].find((l) => l.querySelector('span')?.textContent === 'Git host');
        const input = label?.querySelector('input');
        if (!input) return null;
        input.value = 'https://Git.Example.com/team/repo.git';
        input.dispatchEvent(new Event('change'));
        return input.value;
    });
    await h.wait(50);
    const hostSaved = h.sent.findLast((f) => f.type === 'machine_settings_save' && f.settings && 'gitPushHost' in f.settings);
    check('git host typed as an address: cut down to the host in the field and in the frame', hostTyped === 'git.example.com' && hostSaved?.settings.gitPushHost === 'git.example.com', [hostTyped, hostSaved]);

    // The setup loads the speech model as a step of its own, with its size
    await h.push({ type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: true, shutdownMethod: 'script', voice: { state: 'installing', detail: 'model:large-v3-turbo' },
        offers: { shutdown: true, ide: true, terminal: false, voice: true },
        settings: { claudeAuth: 'subscription', shutdown: false, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300, afterWakeWaitMinutes: 60, idleMinutes: 15,
            handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true, gitPushUser: 'bot', gitPushHost: 'git.example.com' } });
    await h.wait(100);
    const loading = await p.textContent('#settings-machines .settings-voice-setup');
    check('voice setup: the speech model is loading, with its size, no button meanwhile', loading.includes('large-v3-turbo') && loading.includes('1.6 GB')
        && !(await p.locator('#settings-machines .settings-voice-setup button').count()), loading);

    // machines joined by invitation (main account): the relay is asked when the page opens
    check('the relay is asked for the joined machines', h.sent.some((f) => f.type === 'machine_tokens'));
    check('no "Add machine" before the relay answered (another account, an older relay)', !(await p.isVisible('#machine-add')));
    await h.push({ type: 'machine_tokens', list: [{ machine: 'workstation', created: '2026-10-18T10:00:00Z' }] });
    await h.wait(100);
    check('main account: "Add machine"', await p.isVisible('#machine-add'));
    const joinedRow = await p.evaluate(() => [...document.querySelectorAll('#settings-machines li')]
        .map((li) => [li.querySelector('strong').textContent.toLowerCase(), Boolean(li.querySelector('.settings-machine-joined button'))]));
    check('"Log out" only at the joined machine', JSON.stringify(joinedRow) === JSON.stringify([['desk', false], ['laptop', false], ['workstation', true]]), joinedRow);
    await p.click('#machine-add');
    await h.wait(50);
    const ask = h.sent.find((f) => f.type === 'machine_join_link');
    check('the invitation comes from a backend that is awake (it has the key)', ask && ['desk', 'workstation'].includes(ask.machine), ask);
    await h.push({ type: 'machine_join_link', machine: ask?.machine, url: 'https://test.local/#join=abc&e2e=key', command: 'npm run join -- "https://test.local/#join=abc&e2e=key"',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), e2e: true });
    await h.wait(50);
    check('the command to run on the new machine, in the settings dialog', (await p.inputValue('#machine-join input')) === 'npm run join -- "https://test.local/#join=abc&e2e=key"'
        && await p.isVisible('#settings-dialog') && (await p.textContent('#settings-dialog-title')) === 'Add machine');
    await p.click('#settings-dialog [data-close]');
    await h.wait(50);
    check('closed: the box is back in the machines block', await p.isHidden('#settings-dialog') && await p.evaluate(() => document.getElementById('machine-join').hidden && document.getElementById('machine-join').parentElement.id !== 'settings-dialog-body'));
    await p.click('#settings-machines .settings-machine-joined button');
    await h.wait(50);
    const removal = h.sent.find((f) => f.type === 'machine_token_remove');
    check('log out after asking: to the relay, for that machine', removal && removal.machine === 'workstation' && dialog.includes('WORKSTATION'), [removal, dialog]);

    // appearance
    await p.selectOption('#settings-theme', 'dark');
    check('appearance dark', (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
    await p.selectOption('#settings-theme', 'auto');
    check('appearance automatic', (await p.evaluate(() => document.documentElement.dataset.theme)) === undefined);

    // notifications, devices and accounts are blocks of the settings, without pages of their own
    check('notifications and devices: blocks of the settings', await p.isVisible('#settings #settings-push #push-kinds') && await p.isVisible('#settings #settings-devices #device-list'));
    check('opening the settings loads the devices block', h.sent.some((f) => f.type === 'devices') && h.sent.some((f) => f.type === 'totp_status'));
}
