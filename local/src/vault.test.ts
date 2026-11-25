// Tests for the vault (vault.ts):  node local/src/vault.test.ts
// Entries are kept encrypted with a key of the machine, a bot sees only its entries as environment variables and
// names in its prompt, every value is blacked out of text, and the vault merges between machines like the rest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-vault-'));
process.env.E2E_KEY = Buffer.alloc(32, 3).toString('base64');
const folder = path.resolve(import.meta.dirname, '..', '..');
process.env.ALLOWED_ROOTS = folder;
const { deleteVaultEntry, nameProblem, redact, resetVaultCache, saveVaultEntry, vaultEntries, vaultEnv, vaultErrorText, vaultForSync, vaultNames, vaultViews, VaultError } = await import('./vault.ts');
const { inAccount, tombstones, accountPath, dataPath } = await import('./store.ts');
const { persona } = await import('./session.ts');
const { merge, snapshot } = await import('./sync.ts');
const { checkClientFrame } = await import('./frames.ts');
const { shellRisk } = await import('./shell-policy.ts');
const { secretRead } = await import('./policy.ts');

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };
const fails = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return e instanceof VaultError ? e.code : (e as Error).message; } };

inAccount('main', () => {
    // ---- names
    check('name: like an environment variable', nameProblem('HETZNER_API_TOKEN') === null && nameProblem('X1') === null);
    check('name: lower case, a digit first or a hyphen refused', nameProblem('hetzner') === 'shape' && nameProblem('1X') === 'shape' && nameProblem('A-B') === 'shape' && nameProblem('A') === 'shape');
    check('name: the engines\' sign-in and the system are reserved', ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GH_TOKEN', 'CODEX_HOME', 'PATH', 'OPENCODE_X', 'NODE_OPTIONS'].every((n) => nameProblem(n) === 'reserved'));

    // ---- saving
    const a = saveVaultEntry({ id: '', name: ' hetzner_api_token ', note: 'Cloud', bots: null, value: 'hz-secret-0123456789' });
    check('saved: name upper case and trimmed, id, times, all bots', a.name === 'HETZNER_API_TOKEN' && a.id.length === 12 && a.bots === null && a.createdAt === a.updatedAt && a.note === 'Cloud');
    const b = saveVaultEntry({ id: '', name: 'MAIL_PASSWORD', note: '', bots: ['mail', 'mail', 'chief'], value: 'pw-abcdef' });
    check('saved: a list of bots without doubles', JSON.stringify(b.bots) === '["mail","chief"]');
    check('refused: a reserved name, a taken name, a short value, a missing value, an unknown id',
        fails(() => saveVaultEntry({ id: '', name: 'OPENAI_API_KEY', note: '', bots: null, value: 'sk-123456' })) === 'reserved'
        && fails(() => saveVaultEntry({ id: '', name: 'mail_password', note: '', bots: null, value: 'other-value' })) === 'taken'
        && fails(() => saveVaultEntry({ id: '', name: 'SHORT', note: '', bots: null, value: 'abc' })) === 'value'
        && fails(() => saveVaultEntry({ id: '', name: 'NEW_ONE', note: '', bots: null })) === 'value'
        && fails(() => saveVaultEntry({ id: 'nope', name: 'NEW_ONE', note: '', bots: null, value: 'abcdefgh' })) === 'missing');
    check('the reasons have a text', vaultErrorText(new VaultError('value')).includes('6') && vaultErrorText(new VaultError('taken')).length > 5);
    const b2 = saveVaultEntry({ id: b.id, name: 'MAIL_PASSWORD', note: 'IMAP', bots: ['mail'] });
    check('changed without a value: the value stays, the note and the bots change', b2.value === 'pw-abcdef' && b2.note === 'IMAP' && JSON.stringify(b2.bots) === '["mail"]' && b2.createdAt === b.createdAt);
    check('the browsers\' view has no value', vaultViews().every((v) => !('value' in v)) && vaultViews().length === 2);

    // ---- on disk
    const file = fs.readFileSync(accountPath('vault.json'), 'utf8');
    check('the file holds no name and no value in plain text', !file.includes('HETZNER') && !file.includes('hz-secret') && !file.includes('pw-abcdef') && file.includes('"iv"'));
    check('the machine\'s key exists, not in the account folder', fs.existsSync(dataPath('vault-key')) && !fs.existsSync(accountPath('vault-key')));
    resetVaultCache();
    check('read again from disk after a restart', vaultEntries().map((e) => e.name).join() === 'HETZNER_API_TOKEN,MAIL_PASSWORD' && vaultEntries()[1].value === 'pw-abcdef');

    // ---- for the bots
    check('a bot gets the entries for all and its own as environment', JSON.stringify(vaultEnv('mail')) === JSON.stringify({ HETZNER_API_TOKEN: 'hz-secret-0123456789', MAIL_PASSWORD: 'pw-abcdef' }) // gitleaks:allow
        && JSON.stringify(vaultEnv('chief')) === JSON.stringify({ HETZNER_API_TOKEN: 'hz-secret-0123456789' })); // gitleaks:allow
    check('the names for the prompt, sorted', vaultNames('mail').join() === 'HETZNER_API_TOKEN,MAIL_PASSWORD' && vaultNames('other').join() === 'HETZNER_API_TOKEN');
    const bot = { id: 'mail', name: 'Marie', role: '', folder, model: 'default', tone: '', avatar: '', approval: 'risky' as const, machine: 'x', createdAt: '', updatedAt: '' };
    const p = persona(bot, '', 'claude', vaultNames('mail'));
    check('the system prompt names the entries, not the values', p.includes('HETZNER_API_TOKEN, MAIL_PASSWORD') && !p.includes('hz-secret') && p.includes('Vault'));
    check('without entries the prompt says nothing of a vault', !persona(bot, '', 'claude', []).includes('Vault'));

    // ---- redaction
    check('a value is blacked out wherever it stands, the longest first', redact('token hz-secret-0123456789 and pw-abcdef!') === 'token [vault:HETZNER_API_TOKEN] and [vault:MAIL_PASSWORD]!');
    check('text without a value stays the same object', redact('nothing here') === 'nothing here' && redact('') === '');
    const dot = saveVaultEntry({ id: '', name: 'REGEX_CHARS', note: '', bots: null, value: 'a.b*c(d)' });
    check('special characters of a value do not count as a pattern', redact('x a.b*c(d) y axbxc(d)') === 'x [vault:REGEX_CHARS] y axbxc(d)');
    deleteVaultEntry(dot.id);

    // ---- deleting
    check('deleted with a tombstone', deleteVaultEntry(b.id) && vaultEntries().length === 1 && typeof tombstones()[`vault:${b.id}`] === 'string' && !deleteVaultEntry(b.id));
    check('the redactor follows the change', redact('pw-abcdef') === 'pw-abcdef');

    // ---- sync
    const mine = vaultForSync()!;
    check('the snapshot carries the vault with E2E on', snapshot(false).vault?.entries.length === 1 && mine.entries[0].value === 'hz-secret-0123456789');
    const later = new Date(Date.now() + 60_000).toISOString();
    const theirs = {
        entries: [
            { ...mine.entries[0], note: 'changed there', updatedAt: later },
            { id: 'theirs1', name: 'FROM_THERE', note: '', bots: null, value: 'there-value', createdAt: later, updatedAt: later },
            { id: b.id, name: 'MAIL_PASSWORD', note: '', bots: null, value: 'pw-abcdef', createdAt: b.createdAt, updatedAt: b.updatedAt },
            { id: 'bad', name: 'OPENAI_API_KEY', note: '', bots: null, value: 'sk-zzzzzz', createdAt: later, updatedAt: later },
        ],
        updatedAt: later,
    };
    const r = merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], vault: theirs });
    const names = vaultEntries().map((e) => `${e.name}:${e.note}`).join();
    check('merged: the newer note, the new entry, not the deleted one, not a reserved name', r.vault && names === 'HETZNER_API_TOKEN:changed there,FROM_THERE:', names);
    check('merged again: nothing new', !merge({ bots: [], groups: [], routines: [], deleted: {}, push: [], vault: theirs }).vault);
    const tomb = new Date(Date.now() + 120_000).toISOString();
    check('a newer tombstone from there removes the entry here', merge({ bots: [], groups: [], routines: [], deleted: { 'vault:theirs1': tomb }, push: [] }).vault && !vaultEntries().some((e) => e.id === 'theirs1'));
    check('the environment follows the merge', JSON.stringify(Object.keys(vaultEnv('x'))) === '["HETZNER_API_TOKEN"]');

    // ---- another account does not open this account's file
    fs.mkdirSync(accountPath('..', 'other'), { recursive: true });
    fs.copyFileSync(accountPath('vault.json'), accountPath('..', 'other', 'vault.json'));
    resetVaultCache();
    inAccount('other', () => check('the blob of one account is empty for another', vaultEntries().length === 0));
    resetVaultCache();
    check('… and still there for its own', vaultEntries().length === 1);
});

// ---- frames and the shell policy
check('frame: a new entry passes, a reserved shape fails already at the schema', checkClientFrame({ type: 'vault_save', entry: { id: '', name: 'X_TOKEN', note: '', bots: null, value: 'abcdefgh' } }).ok
    && !checkClientFrame({ type: 'vault_save', entry: { id: '', name: 'X', note: '', bots: null, value: 'abc' } }).ok
    && checkClientFrame({ type: 'vault_delete', id: 'abc' }).ok && checkClientFrame({ type: 'vault' }).ok);
check('shell: printing the whole environment asks, using a variable does not', shellRisk('printenv', folder) === 'envDump' && shellRisk('env', folder) === 'envDump' && shellRisk('Get-ChildItem Env:', folder) === 'envDump'
    && shellRisk('gci env:HETZNER_API_TOKEN', folder) === 'envDump' && shellRisk('set', folder) === 'envDump' && shellRisk('export -p', folder) === 'envDump'
    && shellRisk('curl -H "Authorization: Bearer $HETZNER_API_TOKEN" https://api.hetzner.cloud/v1/servers', folder) === null && shellRisk('env FOO=1 node x.js', folder) === null
    && shellRisk('export FOO=1', folder) === null && shellRisk('set -e', folder) === null);
check('reads: the vault\'s files are secrets', secretRead('Read', { file_path: 'C:/x/local/data/accounts/main/vault.json' }) !== null && secretRead('Read', { file_path: '/srv/data/vault-key' }) !== null
    && secretRead('Read', { file_path: '/srv/my-vaults.json' }) === null && shellRisk('cat local/data/vault-key', folder) === 'sensitiveFile');

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
