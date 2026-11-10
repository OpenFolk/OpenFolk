// A clone git refused for want of credentials (folder_cloned with `credentials`): the editor says where the git token
// goes and leads to the settings of the bot's machine at "Pushing with git". Another failure gets no such hint.
const REPO = 'https://git.example.com/team/private.git';
const SETTINGS = {
    claudeAuth: 'subscription', claudeFallback: 'limit', claudeKeyBudgetUsd: 0, engineAuth: {}, disabledEngines: [], shutdown: true, shutdownDelaySeconds: 60, afterWake: 'ifIdle', afterWakeSeconds: 300,
    afterWakeWaitMinutes: 60, idleMinutes: 15, handoverIde: true, handoverTerminal: true, voiceModel: '', voiceDevice: 'auto', voicePreload: true, gitPushUser: '', gitPushHost: '',
};

export default async function ({ start, check }) {
    let answer = { ok: false, message: 'Cloning failed: remote: Repository not found.', credentials: true };
    const h = await start({
        online: ['desk'],
        bots: [],
        async onSend(f, push) {
            if (f.type === 'folder_propose') await push({ type: 'folder_proposed', url: f.url, ok: true, folder: '/work/private' });
            if (f.type === 'folder_clone') await push({ type: 'folder_cloned', url: f.url, ...answer });
        },
    });
    const p = h.page;
    // What a backend sends on its own when a device connects
    await h.push({ type: 'machine_settings', machine: 'desk', anthropicKey: false, gitPushToken: false, engineKeys: {}, shutdownMethod: 'script',
        offers: { shutdown: true, ide: true, terminal: true, voice: true }, settings: SETTINGS });
    const save = async () => {
        await p.evaluate(() => openEditor(null));
        await h.wait(150);
        await p.fill('#editor-name', 'Private');
        await p.fill('#editor-repo', REPO);
        await p.click('#editor-form button[type=submit]');
        await h.wait(300);
    };

    await save();
    const error = await p.textContent('#editor-error');
    check('the reason and where the token goes', error.includes('Repository not found') && error.includes('git token for git.example.com') && error.includes('settings of DESK'), error);
    check('a button to the settings of the machine', await p.isVisible('#editor-error button:has-text("Settings of DESK")'));
    await p.click('#editor-error button');
    await h.wait(300);
    check('the editor closes, the settings open with that machine unfolded', await p.isHidden('#editor') && await p.isVisible('#settings')
        && await p.evaluate(() => Boolean(document.querySelector('#settings-machines details.settings-machine[data-host="desk"]')?.open)));

    answer = { ok: false, message: 'Cloning failed: Could not resolve host: git.example.com' };
    await save();
    check('another failure: no token hint', !(await p.textContent('#editor-error')).includes('git token') && !(await p.isVisible('#editor-error button')));
    check('no page errors', h.errors.length === 0, h.errors);
    await h.close();
}
