// Fake ACP agent for acp.test.ts: speaks ACP over stdio like Cursor's `agent acp` and calls the app's tools via
// the MCP server passed in (HTTP). Behaviour depends on a keyword in the prompt.
import readline from 'node:readline';

let nr = 1000;
const pending = new Map();
let mcpUrl = '';
let model = 'auto';
let abort = null;

const write = (n) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...n }) + '\n');
const call = (method, params) => new Promise((ok) => { const id = ++nr; pending.set(id, ok); write({ id, method, params }); });
const update = (sessionId, u) => write({ method: 'session/update', params: { sessionId, update: u } });
const text = (sessionId, t) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
const options = () => ({ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: [{ value: 'auto', name: 'Auto' }, { value: 'gpt-x', name: 'GPT X' }] });
const permissionOptions = [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
];

async function mcp(method, params, id = 1) {
    const r = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    return r.status === 202 ? null : r.json();
}

async function prompt(p) {
    const s = p.sessionId;
    const all = p.prompt.map((b) => (b.type === 'text' ? b.text : `[${b.type} ${b.mimeType ?? ''}]`)).join('\n');
    if (p.prompt[0]?.type === 'text' && p.prompt[0].text.startsWith('<instructions>')) text(s, '[with instructions] ');
    if (all.includes('image')) text(s, all.includes('[image image/png]') ? 'Image received' : 'no image');
    if (all.includes('model')) text(s, `Model ${model}`);
    if (all.includes('command')) {
        update(s, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run git status', kind: 'execute', status: 'pending', rawInput: { command: 'git status' } });
        const r = await call('session/request_permission', { sessionId: s, toolCall: { toolCallId: 't1' }, options: permissionOptions });
        const allowed = r.outcome.outcome === 'selected' && r.outcome.optionId.startsWith('allow');
        update(s, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: allowed ? 'clean' : 'rejected' } }] });
        text(s, `Answer ${r.outcome.optionId ?? r.outcome.outcome}`);
    }
    if (all.includes('change')) {
        update(s, { sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Edit a.txt', kind: 'edit', status: 'pending', locations: [{ path: 'C:/p/a.txt' }], content: [{ type: 'diff', path: 'C:/p/a.txt', oldText: 'old', newText: 'new' }] });
        const r = await call('session/request_permission', { sessionId: s, toolCall: { toolCallId: 't2' }, options: permissionOptions });
        update(s, { sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'completed' });
        text(s, `File ${r.outcome.optionId}`);
    }
    if (all.includes('tool')) {
        const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } });
        await mcp('notifications/initialized', undefined, undefined);
        const list = await mcp('tools/list', {}, 2);
        update(s, { sessionUpdate: 'tool_call', toolCallId: 't3', title: 'openfolk: remember_note', kind: 'other', status: 'in_progress', rawInput: { note: 'Tea' } });
        const r = await mcp('tools/call', { name: 'remember_note', arguments: { note: 'Tea' } }, 3);
        update(s, { sessionUpdate: 'tool_call_update', toolCallId: 't3', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: r.result.content[0].text } }] });
        text(s, `MCP ${init.result.protocolVersion} ${list.result.tools.map((t) => t.name).join(',')}`);
    }
    if (all.includes('question')) {
        const r = await call('cursor/ask_question', { toolCallId: 'q', title: 'Drink', questions: [{ id: 'g', prompt: 'Tea or coffee?', options: [{ id: 'o1', label: 'Tea' }, { id: 'o2', label: 'Coffee' }] }] });
        text(s, `Choice ${JSON.stringify(r.outcome)}`);
    }
    if (all.includes('wait')) {
        update(s, { sessionUpdate: 'tool_call', toolCallId: 't4', title: 'Run sleep', kind: 'execute', status: 'pending', rawInput: { command: 'sleep 100' } });
        const r = await new Promise((ok) => {
            abort = () => ok({ stop: true });
            call('session/request_permission', { sessionId: s, toolCall: { toolCallId: 't4' }, options: permissionOptions }).then(ok);
        });
        // after session/cancel the open permission request comes back as "cancelled"
        if (!r.stop) await new Promise((ok) => { abort = ok; });
        return { stopReason: 'cancelled' };
    }
    if (all.includes('hello')) {
        text(s, 'Hello ');
        text(s, 'world');
    }
    update(s, { sessionUpdate: 'usage_update', used: 1234, size: 200000 });
    return { stopReason: 'end_turn' };
}

async function request(method, params) {
    switch (method) {
        case 'initialize':
            return {
                protocolVersion: 1, agentInfo: { name: 'fake', version: '9.9' },
                agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, promptCapabilities: { image: true } },
                authMethods: [{ id: 'test_login', name: 'Test' }],
            };
        case 'authenticate':
            if (process.env.FAKE_NOT_SIGNED_IN) throw Object.assign(new Error('Authentication required'), { data: { message: 'Please run agent login' } });
            return {};
        case 'session/new':
            // like Copilot without a login
            if (process.env.FAKE_SESSION_WITHOUT_LOGIN) throw new Error('Authentication required');
            mcpUrl = params.mcpServers.find((m) => m.type === 'http')?.url ?? '';
            return { sessionId: 's-new', configOptions: [options()] };
        case 'session/load':
            if (params.sessionId === 'gone') throw new Error('Session not found');
            mcpUrl = params.mcpServers.find((m) => m.type === 'http')?.url ?? '';
            text(params.sessionId, 'OLD HISTORY');
            return { configOptions: [options()] };
        case 'session/set_config_option':
            if (params.value === 'doesnotexist') throw new Error('Unknown model');
            model = params.value;
            return { configOptions: [options()] };
        case 'session/prompt':
            return prompt(params);
        default:
            throw new Error(`unknown: ${method}`);
    }
}

readline.createInterface({ input: process.stdin }).on('line', (l) => {
    const m = JSON.parse(l);
    if (m.id !== undefined && !m.method) {
        pending.get(m.id)?.(m.result);
        pending.delete(m.id);
        return;
    }
    if (m.method === 'session/cancel') {
        abort?.();
        return;
    }
    if (m.id === undefined) return;
    request(m.method, m.params ?? {}).then(
        (result) => write({ id: m.id, result }),
        (e) => write({ id: m.id, error: { code: -32000, message: e.message, data: e.data } }),
    );
});
