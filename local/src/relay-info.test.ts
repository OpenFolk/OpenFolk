// The relay's version from relay_hello is taken only in the shape of a version.
//   node local/src/relay-info.test.ts
import { cleanRelayVersion } from './relay-info.ts';

let failed = 0;
const check = (name: string, ok: boolean) => {
    console.log(`${ok ? 'ok' : 'FAILED'}  ${name}`);
    if (!ok) failed++;
};

check('a version is taken as it is', cleanRelayVersion('0.9.0') === '0.9.0');
check('a pre-release is taken as well', cleanRelayVersion('0.9.0-beta.1') === '0.9.0-beta.1');
check('nothing is taken from a relay that sends none', cleanRelayVersion(undefined) === '');
check('a number or an object is not a version', cleanRelayVersion(9) === '' && cleanRelayVersion({}) === '');
check('text that is not a version is dropped (it reaches the web app\'s page)', cleanRelayVersion('<b>0.9.0</b>') === '' && cleanRelayVersion('latest') === '' && cleanRelayVersion('') === '');
check('a very long string is dropped', cleanRelayVersion(`1.2.3-${'x'.repeat(60)}`) === '');

process.exit(failed ? 1 : 0);
