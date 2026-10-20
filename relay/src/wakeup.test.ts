// Tests for the wake settings of the relay (WAKE_METHOD and friends), without network:  node relay/src/wakeup.test.ts
import { magicPacket, normalizeMac, parseMachines, parseWakeConfig, wakeCommand } from './wakeup.ts';
import { GRACE_MS, LEAD_MS, wakeTiming } from './wake-schedule.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); if (!ok) failed++; };
const token = 'x'.repeat(32);

check('MAC: separators and case', normalizeMac('AA-BB-cc:dd.ee:FF') === 'aa:bb:cc:dd:ee:ff' && normalizeMac('aabbccddeeff') === 'aa:bb:cc:dd:ee:ff');
check('MAC: invalid', normalizeMac('aa:bb:cc') === null && normalizeMac('zz:bb:cc:dd:ee:ff') === null);

const m = parseMachines('Desktop=AA:BB:CC:DD:EE:FF; laptop , bad name=1, nas=12:34');
check('machines: names lower case, MAC optional', m.machines.desktop === 'aa:bb:cc:dd:ee:ff' && m.machines.laptop === '', m.machines);
check('machines: invalid entries reported', m.invalid.join('|') === 'bad name=1|nas=12:34', m.invalid);

check('nothing set: none without problem', parseWakeConfig({}).method === 'none' && !parseWakeConfig({}).problem);
check('WAKEUP_URL: service (as before)', parseWakeConfig({ WAKEUP_URL: 'https://wake.example.com/', WAKEUP_API_TOKEN: token }).method === 'service');
check('service URL without trailing slash', parseWakeConfig({ WAKEUP_URL: 'https://wake.example.com//', WAKEUP_API_TOKEN: token }).serviceUrl === 'https://wake.example.com');
const short = parseWakeConfig({ WAKEUP_URL: 'https://wake.example.com', WAKEUP_API_TOKEN: 'short' });
check('service with short token: off, with reason', short.method === 'none' && Boolean(short.problem?.includes('WAKEUP_API_TOKEN')), short);
check('MAC addresses alone: wol', parseWakeConfig({ WAKE_MACHINES: 'desktop=aa:bb:cc:dd:ee:ff' }).method === 'wol');
check('names without MAC: none', parseWakeConfig({ WAKE_MACHINES: 'desktop' }).method === 'none');
const wol = parseWakeConfig({ WAKE_METHOD: 'WOL', WAKE_MACHINES: 'desktop=aa:bb:cc:dd:ee:ff', WOL_ADDRESS: '192.168.1.255', WOL_PORT: '7' });
check('wol: address and port', wol.method === 'wol' && wol.wolAddress === '192.168.1.255' && wol.wolPort === 7, wol);
const wolDefaults = parseWakeConfig({ WAKE_MACHINES: 'desktop=aa:bb:cc:dd:ee:ff' });
check('wol: defaults', wolDefaults.wolAddress === '255.255.255.255' && wolDefaults.wolPort === 9);
check('wol without MAC: off', parseWakeConfig({ WAKE_METHOD: 'wol', WAKE_MACHINES: 'desktop' }).method === 'none');
const cmd = parseWakeConfig({ WAKE_COMMAND: 'ssh router etherwake {mac}', WAKE_MACHINES: 'desktop=aa:bb:cc:dd:ee:ff' });
check('WAKE_COMMAND: command wins over MAC addresses', cmd.method === 'command', cmd);
check('command without machines: off', parseWakeConfig({ WAKE_METHOD: 'command', WAKE_COMMAND: 'x' }).method === 'none');
check('explicit none beats WAKEUP_URL', parseWakeConfig({ WAKE_METHOD: 'none', WAKEUP_URL: 'https://x', WAKEUP_API_TOKEN: token }).method === 'none');
const unknown = parseWakeConfig({ WAKE_METHOD: 'magic' });
check('unknown method: off, with reason', unknown.method === 'none' && Boolean(unknown.problem?.includes('magic')), unknown);

check('command placeholders', wakeCommand('wake {machine} {mac} {machine}', 'desktop', 'aa:bb:cc:dd:ee:ff') === 'wake desktop aa:bb:cc:dd:ee:ff desktop');
const packet = magicPacket('aa:bb:cc:dd:ee:ff');
check('magic packet: 102 bytes, 6 x ff, then the MAC 16 times', packet.length === 102 && packet.subarray(0, 6).every((b) => b === 0xff)
    && packet.subarray(6, 12).toString('hex') === 'aabbccddeeff' && packet.subarray(96).toString('hex') === 'aabbccddeeff');

check('timing: defaults', wakeTiming({}).leadMs === LEAD_MS && wakeTiming({}).graceMs === GRACE_MS);
check('timing: from seconds', wakeTiming({ WAKE_LEAD_SECONDS: '600' }).leadMs === 600_000 && wakeTiming({ WAKE_GRACE_SECONDS: '0' }).graceMs === 0);
check('timing: invalid -> default', wakeTiming({ WAKE_LEAD_SECONDS: 'soon' }).leadMs === LEAD_MS && wakeTiming({ WAKE_LEAD_SECONDS: '-5' }).leadMs === LEAD_MS);

if (failed) {
    console.log(`\n${failed} test(s) failed`);
    process.exit(1);
}
console.log('\nall wake setting tests passed');
