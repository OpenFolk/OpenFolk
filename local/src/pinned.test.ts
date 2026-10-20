// Tests for pinned messages:  node local/src/pinned.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-pinned-'));
const { pin, pinnedForBrowser, mergePinned, loadPinned } = await import('./pinned.ts');

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };
const e = (id: string) => ({ id, text: `Text ${id}`, ts: '2026-10-08T06:00:00Z', from: 'me' });
const ids = (chatId: string) => (pinnedForBrowser()[chatId] ?? []).map((x) => x.id).join(',');

pin('skool', e('a'), true);
pin('skool', e('b'), true);
check('most recently pinned first', ids('skool') === 'b,a');
pin('skool', e('a'), true);
check('pinning again moves to the front, without duplicate', ids('skool') === 'a,b');
pin('skool', e('c'), true);
pin('skool', e('d'), true);
check('at most three, the oldest drops out', ids('skool') === 'd,c,a');
pin('skool', e('c'), false);
check('unpin', ids('skool') === 'd,a');
check('chats separate', ids('skool~x1') === '');
pin('skool', { ...e('long'), text: 'x'.repeat(1000) }, true);
check('text truncated', pinnedForBrowser().skool[0].text.length === 300);

// Sync: the newer state wins per chat, an older one changes nothing
const now = loadPinned().skool.updatedAt;
check('older state is ignored', mergePinned({ skool: { entries: [e('old')], updatedAt: '2000-01-01T00:00:00Z' } }).length === 0 && ids('skool').startsWith('long'));
const newer = new Date(Date.parse(now) + 1000).toISOString();
check('newer state is taken over', mergePinned({ skool: { entries: [e('new')], updatedAt: newer }, cloud: { entries: [e('z')], updatedAt: newer } }).length === 2 && ids('skool') === 'new' && ids('cloud') === 'z');
check('broken entries are skipped', mergePinned({ x: { entries: 'broken', updatedAt: newer } } as never).length === 0);

if (failures) process.exit(1);
console.log('all tests passed');
