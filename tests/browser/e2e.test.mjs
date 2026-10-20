// End-to-end encryption in the web app: with the key on the device, only encrypted backend frames count, a frame the
// relay delivers a second time or one that is far too old is dropped, and every frame the app sends carries the
// replay guard (counter, sender, time) inside the encryption.
import crypto from 'node:crypto';
import { bot } from './harness.mjs';

const KEY = crypto.randomBytes(32);

function encrypt(frame, direction = 'b2c') {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    c.setAAD(Buffer.from(`openfolk:${direction}`));
    const data = Buffer.concat([c.update(JSON.stringify(frame), 'utf8'), c.final(), c.getAuthTag()]);
    return { type: 'e2e', machine: 'desk', iv: iv.toString('base64'), data: data.toString('base64') };
}

function decrypt(f, direction = 'c2b') {
    const raw = Buffer.from(f.data, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(f.iv, 'base64'));
    d.setAAD(Buffer.from(`openfolk:${direction}`));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
}

const botsFrame = (...bots) => ({ type: 'bots', bots, groups: [], states: {}, activity: {}, activeChats: {}, approvals: [] });

export default async function ({ start, check }) {
    const h = await start({
        secure: true,
        path: `#e2e=${KEY.toString('base64url')}`,
        before: () => { window.alert = (m) => { window.__alerts = (window.__alerts || []).concat(String(m)); }; },
    });
    const p = h.page;
    const listed = async (name) => (await p.locator('#chat-list li', { hasText: name }).count()) > 0;
    check('key taken over from the link', await p.evaluate(() => !!e2e.key));

    // The scaffold answers the sign-in with an unencrypted bot list, as a relay injecting frames would
    check('unencrypted bot list ignored', !(await listed('PDF-Reader')));
    const alerts = await p.evaluate(() => window.__alerts || []);
    check('says once which machine sends unencrypted', alerts.length === 1 && alerts[0].includes('DESK'), alerts);
    await h.sendBots();
    check('no second warning', (await p.evaluate(() => (window.__alerts || []).length)) === 1);

    const sender = crypto.randomBytes(8).toString('hex');
    await h.push(encrypt({ ...botsFrame(bot('alpha', 'Alpha')), _r: { t: Date.now(), s: sender, n: 5 } }));
    await h.wait(200);
    check('encrypted bot list shown', await listed('Alpha'));

    await h.push(encrypt({ ...botsFrame(bot('beta', 'Beta')), _r: { t: Date.now(), s: sender, n: 5 } }));
    await h.wait(200);
    check('counter seen before: dropped', !(await listed('Beta')) && await listed('Alpha'));

    await h.push(encrypt({ ...botsFrame(bot('gamma', 'Gamma')), _r: { t: Date.now() - 11 * 60_000, s: sender, n: 6 } }));
    await h.wait(200);
    check('frame older than ten minutes: dropped', !(await listed('Gamma')));

    await h.push(encrypt({ ...botsFrame(bot('delta', 'Delta')), _r: { t: Date.now(), s: sender, n: 7 } }));
    await h.wait(200);
    check('next counter of the same sender shown', await listed('Delta'));

    await h.push(encrypt(botsFrame(bot('old', 'Old backend'))));
    await h.wait(200);
    check('frame of a backend without guard (before protocol 2) shown', await listed('Old backend'));

    // What the app sends
    await h.openChat('Old backend');
    const out = h.sent.filter((f) => f.type === 'e2e').map((f) => decrypt(f));
    check('app sends encrypted frames', out.length >= 2, h.sent.map((f) => f.type));
    const guards = out.map((f) => f._r);
    check('every frame carries the guard', guards.every((r) => r && typeof r.s === 'string' && r.s.length >= 8 && Math.abs(Date.now() - r.t) < 60_000), guards);
    check('one sender, counter grows', new Set(guards.map((r) => r.s)).size === 1 && guards.every((r, i) => i === 0 || r.n > guards[i - 1].n), guards);
    check('nothing sensitive in plain text', !h.sent.some((f) => f.type === 'history' || f.type === 'send'));
    await h.close();
}
