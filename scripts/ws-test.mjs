// End-to-end test: simulates a browser at the relay (reads the password from the .env, never prints it).
//
//   node scripts/ws-test.mjs <chat-id> "<message>" [--approve|--reject] [--download]
//   node scripts/ws-test.mjs - - --wrong-password
import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

const [chatId, text, ...flags] = process.argv.slice(2);
const base = process.env.RELAY_TEST_URL || `ws://localhost:${process.env.RELAY_PORT || 8787}`;
const ws = new WebSocket(`${base}/ws/client`, { maxPayload: 64 * 1024 * 1024 });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), ...a);
let sent = false;
let waitingForFile = false;

ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: flags.includes('--wrong-password') ? 'wrong' : process.env.USER_PASSWORD || process.env.CLIENT_TOKEN })));
ws.on('message', (d) => {
    const f = JSON.parse(d.toString());
    switch (f.type) {
        case 'auth': log('auth', f.ok, f.message ?? ''); if (!f.ok) process.exit(flags.includes('--wrong-password') ? 0 : 1); break;
        case 'agents':
            log('machines online:', f.online);
            if (f.online?.length && chatId && chatId !== '-' && !sent) {
                sent = true;
                ws.send(JSON.stringify({ type: 'presence', visible: true }));
                ws.send(JSON.stringify({ type: 'send', chatId, text }));
            }
            break;
        case 'bots': log('bots:', f.bots.map((b) => `${b.id}(${b.approval})`).join(', '), '| groups:', f.groups.map((g) => g.id).join(', ') || '–', '| open approvals:', f.approvals.length); break;
        case 'settings': log('settings:', JSON.stringify(f.settings)); break;
        case 'push_key': log('push_key:', f.publicKey.slice(0, 12) + '…'); break;
        case 'account': log('account:', f.subscription, f.model, 'apiKeySource=' + f.apiKeySource); break;
        case 'usage': log('usage:', JSON.stringify(f.usage)); break;
        case 'user': log('user', f.chatId, 'from', f.entry.from + ':', f.entry.text.slice(0, 100)); break;
        case 'tool': log('tool:', f.tool.name, f.tool.summary); break;
        case 'tool_result': log('  ↳', f.ok ? 'ok' : 'ERROR', f.durationMs + ' ms', f.result.slice(0, 80).replace(/\s+/g, ' ')); break;
        case 'approval':
            log('approval:', f.approval.kind, f.approval.summary, '|', f.approval.detail.slice(0, 80).replace(/\s+/g, ' '));
            if (flags.includes('--approve') || flags.includes('--reject')) {
                ws.send(JSON.stringify({ type: 'approval_reply', id: f.approval.id, allow: flags.includes('--approve') }));
            }
            break;
        case 'approval_done': log('approval_done:', f.result); break;
        case 'attachment': log('attachment:', f.attachment.name, f.attachment.size, 'B'); break;
        case 'state': if (f.detail) log('state:', f.botId, f.state, f.detail); break;
        case 'error': log('ERROR:', f.code ?? '', f.message); break;
        case 'file': log('file:', f.name, f.mime, Buffer.from(f.data, 'base64').length, 'B'); ws.close(); process.exit(0); break;
        case 'done':
            log('done:', f.botId, JSON.stringify(f.entry.text.slice(0, 200)), `${f.durationMs} ms`, f.entry.attachments ? '📎 ' + f.entry.attachments.map((a) => a.name) : '');
            if (flags.includes('--download') && f.entry.attachments?.length) {
                waitingForFile = true;
                ws.send(JSON.stringify({ type: 'file_get', path: f.entry.attachments[0].path }));
                break;
            }
            if (!waitingForFile) { ws.close(); process.exit(0); }
            break;
    }
});
ws.on('close', (c) => { log('close', c); process.exit(0); });
setTimeout(() => { log('Timeout'); process.exit(2); }, 180000);
