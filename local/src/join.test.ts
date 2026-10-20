// A machine joined by invitation takes the web push keys from the machines already there:  node local/src/join.test.ts
// Asked for and handed over only through encrypted sync, and only while the marker of npm run join is there.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PeerData } from '../../shared/protocol.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-join-'));
process.env.DATA_DIR = dir;
process.env.ALLOWED_ROOTS = dir;
process.env.MACHINE_NAME = 'newbie';
process.env.E2E_KEY = crypto.randomBytes(32).toString('base64');
// Empty values count as set for the .env loader: the .env of this checkout must not bring its own key pair
process.env.PUSH_VAPID_PUBLIC_KEY = '';
process.env.PUSH_VAPID_PRIVATE_KEY = '';

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || info === undefined ? '' : ` (is ${JSON.stringify(info)})`}`); if (!ok) failures++; };

const { BotManager } = await import('./agent.ts');
const { joinPending } = await import('./join.ts');
const { publicKey } = await import('./push.ts');

const sent: { data: PeerData; to?: string }[] = [];
const m = new BotManager(() => undefined, (data, to) => { sent.push({ data, to }); });
const ownKey = publicKey();

m.updateAgents(['newbie', 'desktop']);
check('without the marker: no request', !sent.some((s) => s.data.kind === 'keys_request'));

fs.writeFileSync(path.join(dir, 'join-pending.json'), '{}');
m.updateAgents(['newbie']);
m.updateAgents(['newbie', 'desktop']);
check('joined: asks the machines already there', sent.some((s) => s.data.kind === 'keys_request'));

const shared = { publicKey: 'B'.repeat(87), privateKey: 'p'.repeat(43) };
m.peerInbound('desktop', { kind: 'keys', vapid: shared });
check('takes over the shared key pair', publicKey() === shared.publicKey && publicKey() !== ownKey);
check('the marker is gone', !joinPending());
const stored = JSON.parse(fs.readFileSync(path.join(dir, 'vapid.json'), 'utf8')) as { publicKey: string };
check('kept for the next start', stored.publicKey === shared.publicKey);

m.peerInbound('desktop', { kind: 'keys', vapid: { publicKey: 'C'.repeat(87), privateKey: 'q'.repeat(43) } });
check('a second answer later changes nothing', publicKey() === shared.publicKey);

sent.length = 0;
m.peerInbound('other', { kind: 'keys_request' });
const answer = sent.find((s) => s.data.kind === 'keys');
check('answers another joined machine, to it only', answer?.to === 'other' && answer.data.kind === 'keys' && answer.data.vapid.publicKey === shared.publicKey, answer);

fs.rmSync(dir, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('all tests passed');
