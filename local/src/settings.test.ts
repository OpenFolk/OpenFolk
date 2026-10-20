// Tests for the shared settings and their API keys:  node local/src/settings.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-settings-'));
process.env.DATA_DIR = dir;
process.env.E2E_KEY = 'off';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failures++; };

const settings = await import('./settings.ts');
const { checkClientFrame } = await import('./frames.ts');
const { snapshot } = await import('./sync.ts');

check('defaults', settings.avatarModel() === 'gemini-3.1-flash-image' && settings.gitAutoPull() && settings.pushPreview() === 'title' && settings.voiceLanguage() === '');
const saved = settings.saveSettings({ avatarModel: 'gpt-image-1', gitAutoPull: false, voiceLanguage: 'de', pushPreview: 'none' });
check('saved with a time', settings.avatarModel() === 'gpt-image-1' && !settings.gitAutoPull() && settings.voiceLanguage() === 'de' && settings.pushPreview() === 'none' && Boolean(saved.updatedAt));
check('language stays when other fields change', settings.loadSettings().language === 'en');

check('keys: stored, trimmed', settings.saveApiKeys({ openai: ' sk-1 ' }) && settings.apiKey('openai') === 'sk-1');
check('keys: the same again is no change', !settings.saveApiKeys({ openai: 'sk-1' }));
const browser = settings.settingsForBrowser();
check('browsers learn only which keys are stored', browser.apiKeys?.openai === true && browser.apiKeys?.gemini === false && !JSON.stringify(browser).includes('sk-1'), browser);
check('without encryption the keys stay out of the sync', snapshot(false).apiKeys === undefined && !JSON.stringify(snapshot(false)).includes('sk-1'));
check('without encryption keys from elsewhere are not taken', !settings.mergeApiKeys({ keys: { gemini: 'g' }, updatedAt: '2099-01-01T00:00:00Z' }) && settings.apiKey('gemini') === '');
check('keys: empty removes', settings.saveApiKeys({ openai: '' }) && settings.apiKey('openai') === '');

const older = { ...settings.loadSettings(), avatarModel: 'gemini-3-pro-image' as const, updatedAt: '2000-01-01T00:00:00Z' };
check('older settings from another machine: ignored', !settings.mergeSettings(older) && settings.avatarModel() === 'gpt-image-1');
const newer = { language: 'de' as const, avatarModel: 'nonsense' as never, updatedAt: '2099-01-01T00:00:00Z' };
check('newer ones: taken, unknown values dropped', settings.mergeSettings(newer) && settings.loadSettings().language === 'de' && settings.avatarModel() === 'gemini-3.1-flash-image');

check('frame: settings_save accepted', checkClientFrame({ type: 'settings_save', settings: { pushPreview: 'full' }, apiKeys: { gemini: 'x' } }).ok);
check('frame: unknown model refused', !checkClientFrame({ type: 'settings_save', settings: { avatarModel: 'dall-e' } }).ok);
check('frame: machine settings in range accepted', checkClientFrame({ type: 'machine_settings_save', settings: { shutdownDelaySeconds: 120, voiceDevice: 'cpu' } }).ok);
check('frame: machine settings out of range refused', !checkClientFrame({ type: 'machine_settings_save', settings: { idleMinutes: 100000 } }).ok);
check('frame: engines, their sign-in and keys accepted', checkClientFrame({
    type: 'machine_settings_save', settings: { engineAuth: { codex: 'apikey' }, disabledEngines: ['cursor', 'opencode'] }, engineKeys: { codex: 'sk-1', copilot: '' },
}).ok);
check('frame: unknown engine or sign-in refused', !checkClientFrame({ type: 'machine_settings_save', settings: { disabledEngines: ['gemini'] } }).ok
    && !checkClientFrame({ type: 'machine_settings_save', settings: { engineAuth: { codex: 'token' } } }).ok);

const machine = await import('./machine-settings.ts');
machine.saveMachineSettings({ claudeAuth: 'apikey', voiceModel: 'small' });
machine.resetMachineSettingsCache();
check('machine settings: kept in the data folder', machine.machineSettings().claudeAuth === 'apikey' && machine.machineSettings().voiceModel === 'small');
machine.saveAnthropicKey(' sk-ant ');
check('Anthropic key: stored apart, trimmed', machine.anthropicKey() === 'sk-ant' && !fs.readFileSync(path.join(dir, 'machine-settings.json'), 'utf8').includes('sk-ant'));
machine.saveAnthropicKey('');
check('Anthropic key: removed', machine.anthropicKey() === '');
check('engines: all on by default, subscription everywhere', machine.machineSettings().disabledEngines.length === 0 && Object.keys(machine.machineSettings().engineAuth).length === 0);
const cleaned = machine.cleanMachineSettings({ engineAuth: { codex: 'apikey', opencode: 'apikey', cursor: 'token' }, disabledEngines: ['codex', 'codex', 'gemini'] });
check('engines: only known engines and modes, once each', JSON.stringify(cleaned.engineAuth) === '{"codex":"apikey"}' && cleaned.disabledEngines.join() === 'codex', cleaned);
check('engines: all of them may be off', machine.cleanMachineSettings({ disabledEngines: ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'opencode'] }).disabledEngines.length === 6);
machine.saveMachineSettings({ disabledEngines: ['cursor'] });
check('engines: switched off', !machine.engineEnabled('cursor') && machine.engineEnabled('claude') && !machine.noEngine());
machine.startWithoutEngines();
check('engines: a machine with settings keeps its engines', machine.engineEnabled('claude') && !machine.noEngine());
const { isNewDataDir } = await import('./migrate.ts');
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-fresh-'));
fs.writeFileSync(path.join(fresh, 'local.log'), '');
const used = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-used-'));
fs.mkdirSync(path.join(used, 'accounts'));
check('new data folder: only without version marker, accounts and old bots', isNewDataDir(fresh) && !isNewDataDir(used) && !isNewDataDir(dir));
fs.rmSync(path.join(dir, 'machine-settings.json'));
machine.resetMachineSettingsCache();
check('engines: a machine without settings keeps all on', machine.machineSettings().disabledEngines.length === 0);
machine.startWithoutEngines();
machine.resetMachineSettingsCache();
check('engines: a new installation starts with none', machine.noEngine() && !machine.engineEnabled('claude'));
fs.rmSync(fresh, { recursive: true, force: true });
fs.rmSync(used, { recursive: true, force: true });
machine.saveEngineKey('codex', ' sk-openai ');
check('engine key: stored apart, trimmed', machine.engineKey('codex') === 'sk-openai' && !fs.readFileSync(path.join(dir, 'machine-settings.json'), 'utf8').includes('sk-openai'));
machine.saveEngineKey('codex', '');
check('engine key: removed', machine.engineKey('codex') === '');

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
