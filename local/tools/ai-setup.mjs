// The desktop app's third setup step, "Sign in to an AI provider" (desktop/setup.html, right below step 2): what the
// web app's sign-in card does through the relay, here for the backend on this computer, run by the app with that
// backend's data folder and .env (DATA_DIR, OPENFOLK_ENV_FILE). Works in the machine owner's account. Prints one line
// of JSON per state, never a key.
//
//   node local/tools/ai-setup.mjs status   {"ok":true,"ready":false,"known":true,"claude":"sign_in"}
//   node local/tools/ai-setup.mjs claude   {"state":"browser"} … {"state":"done"} | {"state":"failed","message":…}
//   node local/tools/ai-setup.mjs device X Codex or Copilot with a device code: {"state":"code","url":…,"code":…} … done
//   node local/tools/ai-setup.mjs key      the key on stdin; {"ok":true} | {"ok":false,"error":"invalid"|"forbidden"}
//   node local/tools/ai-setup.mjs on X     engine X the only one on (claude: with the subscription); {"ok":true}
//
// key and on write the machine settings: the app runs them only once the backend has written its own at its first
// start (backend.pid), and restarts it afterwards, as it caches them. claude and device only sign in; `on` follows.
import { checkAnthropicKey } from '../src/anthropic-key.ts';
import { startClaudeLogin, startDeviceLogin } from '../src/engine-login.ts';
import { machineSettings, saveAnthropicKey, saveMachineSettings } from '../src/machine-settings.ts';
import { inAccount, ownerAccount, readJson } from '../src/store.ts';
import { OTHER_ENGINES } from '../../shared/protocol.ts';

const say = (o) => console.log(JSON.stringify(o));
/**
 * The provider chosen in step 3 becomes the only one on: the step chooses one, and another one left on from before
 * (a data folder with every engine on) would start new bots without a sign-in ("Not logged in").
 */
const switchOn = (engine, extra = {}) => saveMachineSettings({ ...extra, disabledEngines: ['claude', ...OTHER_ENGINES].filter((e) => e !== engine) });

async function readStdin() {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    return text.trim();
}

const command = process.argv[2];
await inAccount(ownerAccount(), async () => {
    if (command === 'status') {
        // Written by the backend once it asked its engines (on start, after a sign-in); missing before that
        const engines = readJson('engines.json', null);
        const ready = Boolean(engines) && Object.values(engines).includes('ready');
        say({ ok: true, known: Boolean(engines), ready, claude: engines?.claude ?? '' });
    } else if (command === 'claude') {
        const timer = setTimeout(() => { say({ state: 'failed', message: 'timeout' }); process.exit(1); }, 16 * 60_000);
        startClaudeLogin((r) => {
            say(r);
            if (r.state !== 'browser') {
                clearTimeout(timer);
                process.exitCode = r.state === 'done' ? 0 : 1;
            }
        });
    } else if (command === 'device' && ['codex', 'copilot'].includes(process.argv[3])) {
        startDeviceLogin(process.argv[3], (r) => {
            say(r);
            if (r.state !== 'code') process.exitCode = r.state === 'done' ? 0 : 1;
        });
    } else if (command === 'key') {
        const key = await readStdin();
        if (!key) return say({ ok: false, error: 'empty' });
        const result = await checkAnthropicKey(key);
        if (result === 'invalid' || result === 'forbidden') return say({ ok: false, error: result });
        saveAnthropicKey(key);
        switchOn('claude', { claudeAuth: 'apikey' });
        say({ ok: true, checked: result === 'ok' });
    } else if (command === 'on' && ['claude', 'codex', 'copilot', 'opencode'].includes(process.argv[3])) {
        const engine = process.argv[3];
        switchOn(engine, engine === 'claude' && machineSettings().claudeAuth === 'apikey' ? { claudeAuth: 'subscription' } : {});
        say({ ok: true });
    } else {
        console.error('Usage: node local/tools/ai-setup.mjs status | claude | device codex|copilot | key | on claude|codex|copilot|opencode');
        process.exitCode = 2;
    }
});
