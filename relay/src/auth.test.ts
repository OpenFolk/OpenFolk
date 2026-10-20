// Tests for the client address behind reverse proxies:  node relay/src/auth.test.ts
import { clientAddress, originAllowed, parseTrustProxy } from './auth.ts';

let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}`); if (!ok) failures++; };

check('TRUST_PROXY empty = auto', parseTrustProxy(undefined) === 'auto' && parseTrustProxy('') === 'auto' && parseTrustProxy('auto') === 'auto');
check('TRUST_PROXY number', parseTrustProxy('0') === 0 && parseTrustProxy('1') === 1 && parseTrustProxy('2') === 2);
check('TRUST_PROXY nonsense = auto', parseTrustProxy('yes') === 'auto' && parseTrustProxy('-1') === 'auto');

// Relay reachable straight from the internet: the header is the client's own invention
check('auto, public peer: header ignored', clientAddress('203.0.113.7', '100.100.1.1', 'auto') === '203.0.113.7');
check('auto, public IPv4-mapped peer: header ignored', clientAddress('::ffff:203.0.113.7', '10.0.0.1', 'auto') === '::ffff:203.0.113.7');
// Behind a proxy in the Docker network: its own entry is the last one, whatever the client put in front
check('auto, proxy in a private network: last entry', clientAddress('172.18.0.5', '1.2.3.4, 198.51.100.9', 'auto') === '198.51.100.9');
check('auto, proxy on loopback', clientAddress('::ffff:127.0.0.1', '198.51.100.9', 'auto') === '198.51.100.9');
check('auto, proxy on IPv6 ULA', clientAddress('fd00::5', '198.51.100.9', 'auto') === '198.51.100.9');
check('auto, Tailscale peer is not a proxy', clientAddress('100.101.102.103', '1.2.3.4', 'auto') === '100.101.102.103');
check('auto, private peer without header', clientAddress('172.18.0.5', undefined, 'auto') === '172.18.0.5');
check('0: never', clientAddress('172.18.0.5', '198.51.100.9', 0) === '172.18.0.5');
check('1: last entry even from a public peer', clientAddress('203.0.113.7', 'spoofed, 198.51.100.9', 1) === '198.51.100.9');
check('2: second from the right (CDN in front of the proxy)', clientAddress('172.18.0.5', 'spoofed, 198.51.100.9, 104.16.0.1', 2) === '198.51.100.9');
check('more hops than entries: the leftmost', clientAddress('172.18.0.5', '198.51.100.9', 3) === '198.51.100.9');
check('header given twice', clientAddress('172.18.0.5', ['spoofed', '198.51.100.9'], 1) === '198.51.100.9');

check('origin: same host', originAllowed('https://relay.example.com', 'relay.example.com'));
check('origin: proxy rewrote Host, X-Forwarded-Host matches', originAllowed('https://relay.example.com', 'relay:8787', 'relay.example.com'));
check('origin: foreign page refused', !originAllowed('https://evil.example', 'relay.example.com', undefined));
check('origin: lookalike refused', !originAllowed('https://relay.example.com.evil.example', 'relay.example.com'));
check('origin: mobile apps allowed', originAllowed('capacitor://localhost', 'relay.example.com') && originAllowed('https://localhost', 'relay.example.com'));
check('origin: none (not a browser) allowed', originAllowed(undefined, 'relay.example.com'));
check('origin: garbage refused', !originAllowed('null', 'relay.example.com'));

if (failures) process.exit(1);
console.log('all tests passed');
