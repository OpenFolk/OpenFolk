// Push for the apps through the relay (bridge.ts): a backend without APNs/FCM credentials hands a notification to
// the relay, which delivers over the channels it has credentials for, trims what it forwards and reports tokens
// the push services no longer know. Backends and browsers are stand-ins.
//   node relay/src/bridge-push.test.ts
import { Bridge } from './bridge.ts';
import type { AgentInbound, NativePushMessage, NativePushSubscription } from '../../shared/protocol.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failed++;
};

/** A backend's socket as the bridge sees it. */
function fakeAgent() {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const received: AgentInbound[] = [];
    const ws = {
        OPEN: 1, readyState: 1,
        on: (event: string, fn: (...args: unknown[]) => void) => { (handlers[event] = handlers[event] ?? []).push(fn); },
        once: (event: string, fn: (...args: unknown[]) => void) => { (handlers[event] = handlers[event] ?? []).push(fn); },
        send: (raw: string) => { received.push(JSON.parse(raw) as AgentInbound); },
        close: () => undefined, terminate: () => undefined, ping: () => undefined,
    };
    const emit = (event: string, ...args: unknown[]) => (handlers[event] ?? []).forEach((fn) => fn(...args));
    const sendToRelay = (data: unknown) => emit('message', Buffer.from(JSON.stringify(data)));
    return { ws, received, sendToRelay };
}

const delivered: { subscriptions: NativePushSubscription[]; message: NativePushMessage }[] = [];
const bridge = new Bridge(() => undefined);
bridge.pushChannels = ['fcm'];
bridge.onPush = async (subscriptions, message) => {
    delivered.push({ subscriptions, message });
    return subscriptions.filter((s) => s.token.includes('gone'));
};

const backend = fakeAgent();
await bridge.connectAgent(backend.ws as never, '203.0.113.9', 'desk');
const hello = backend.received.find((m) => 'type' in m && m.type === 'relay_hello');
check('backend learns the relay\'s push channels on connect', !!hello && 'pushChannels' in hello && hello.pushChannels.join() === 'fcm', hello);

backend.sendToRelay({
    push: {
        subscriptions: [
            { channel: 'fcm', token: 'pixel-token-123456' },
            { channel: 'fcm', token: 'gone-token-123456' },
            { channel: 'apns', token: 'iphone-token-123456' },
            { channel: 'pigeon', token: 'x' },
            'garbage',
        ],
        message: { title: 'Cloud agent', body: 'x'.repeat(900), url: '/?chat=cloud', tag: 'cloud', priority: 'loud', ttlSeconds: 10 },
    },
});
await new Promise((r) => setTimeout(r, 20));
check('delivered once, only to channels the relay has credentials for', delivered.length === 1 && delivered[0].subscriptions.map((s) => s.token).join() === 'pixel-token-123456,gone-token-123456', delivered[0]?.subscriptions);
const m = delivered[0]?.message;
check('message trimmed: body cut, unknown priority normal, ttl at least a minute', m && m.body.length === 500 && m.priority === 'normal' && m.ttlSeconds === 60 && m.tag === 'cloud' && m.url === '/?chat=cloud', m);
const result = backend.received.find((x) => 'type' in x && x.type === 'push_result');
check('backend is told which tokens are gone', !!result && 'gone' in result && result.gone.length === 1 && result.gone[0].token === 'gone-token-123456', result);

backend.sendToRelay({ push: { subscriptions: [{ channel: 'apns', token: 'iphone-token-123456' }], message: { title: 'x', url: '/' } } });
backend.sendToRelay({ push: { subscriptions: [], message: { title: 'x', url: '/' } } });
backend.sendToRelay({ push: { message: { title: 'x', url: '/' } } });
backend.sendToRelay({ push: null });
await new Promise((r) => setTimeout(r, 20));
check('nothing to deliver: no call, no answer', delivered.length === 1 && backend.received.filter((x) => 'type' in x && x.type === 'push_result').length === 1);

bridge.pushChannels = [];
const plain = fakeAgent();
await bridge.connectAgent(plain.ws as never, '203.0.113.10', 'workstation');
const hello2 = plain.received.find((x) => 'type' in x && x.type === 'relay_hello');
check('relay without credentials reports no channels', !!hello2 && 'pushChannels' in hello2 && hello2.pushChannels.length === 0);

if (failed) process.exit(1);
console.log('all bridge push tests passed');
