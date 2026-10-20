// The first device with the code from the container log (first-device.ts): the code, how it is typed, the sealed
// pairing link that opens only with the device's key and the right code, and the guard against floods.
//   node local/src/first-device.test.ts
import { webcrypto } from 'node:crypto';
import { answerFirstDevice, newFirstDeviceCode, normalizeCode, openFirstDevice, sealFirstDevice } from './first-device.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures++;
};

const code = newFirstDeviceCode();
check('code: four groups of four, Crockford base32', /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(code), code);
check('codes differ', newFirstDeviceCode() !== code);
check('typed loosely: case, spaces, dashes, O and I/L', normalizeCode(' abcd-efgh jkmn-po1l ') === 'ABCDEFGHJKMNP011');

const device = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as webcrypto.CryptoKeyPair;
const pk = Buffer.from(await webcrypto.subtle.exportKey('raw', device.publicKey)).toString('base64url');
const text = 'pair=tok-1&e2e=KEY';
const box = await sealFirstDevice(text, 'req-1', pk, code);
check('box: nothing of the link readable', !JSON.stringify(box).includes('tok-1'));
check('opens with the key and the code, typed loosely', await openFirstDevice(device.privateKey, 'req-1', box, code.toLowerCase().replace(/-/g, ' ')) === text);
const fails = (p: Promise<unknown>) => p.then(() => false, () => true);
check('does not open with another code', await fails(openFirstDevice(device.privateKey, 'req-1', box, newFirstDeviceCode())));
check('does not open for another request', await fails(openFirstDevice(device.privateKey, 'req-2', box, code)));
const other = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as webcrypto.CryptoKeyPair;
check('does not open with another key (a relay that swapped it)', await fails(openFirstDevice(other.privateKey, 'req-1', box, code)));

check('no code on this backend: no answer, nothing minted', await answerFirstDevice('req-3', pk, async () => { throw new Error('minted'); }, '') === null);
let minted = 0;
const slowMint = () => new Promise<string>((r) => setTimeout(() => { minted++; r(text); }, 200));
const [one, two] = await Promise.all([answerFirstDevice('req-4', pk, slowMint, code), answerFirstDevice('req-5', pk, slowMint, code)]);
check('one request at a time: the second gets nothing', !!one && two === null && minted === 1, { one: !!one, two, minted });
check('after it: the next one is answered', !!(await answerFirstDevice('req-6', pk, async () => text, code)));

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exitCode = failures ? 1 : 0;
