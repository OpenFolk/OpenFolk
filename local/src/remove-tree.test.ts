// removeTree deletes a folder but never what a link inside points to (fs.rmSync follows junctions under Node 24).
//   node local/src/remove-tree.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from './remove-tree.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failed++; };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-remove-'));
const outside = path.join(base, 'outside');
fs.mkdirSync(path.join(outside, 'deep'), { recursive: true });
fs.writeFileSync(path.join(outside, 'deep', 'keep.txt'), 'keep');
const tree = path.join(base, 'tree');
fs.mkdirSync(path.join(tree, 'a', 'b'), { recursive: true });
fs.writeFileSync(path.join(tree, 'a', 'b', 'f.txt'), 'f');
fs.writeFileSync(path.join(tree, 'top.txt'), 't');
// Junction on Windows, symbolic link elsewhere
fs.symlinkSync(outside, path.join(tree, 'a', 'link'), process.platform === 'win32' ? 'junction' : 'dir');

removeTree(tree);
check('the folder is gone, links included', !fs.existsSync(tree));
check('what the link pointed to is untouched', fs.readFileSync(path.join(outside, 'deep', 'keep.txt'), 'utf8') === 'keep');
removeTree(path.join(base, 'missing'));
check('a missing folder is no error', true);
const file = path.join(base, 'single.txt');
fs.writeFileSync(file, 'x');
removeTree(file);
check('a single file', !fs.existsSync(file));

removeTree(base);
if (failed) process.exit(1);
console.log('all tests passed');
