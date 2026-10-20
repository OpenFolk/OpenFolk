// The app's tools (message_bot, send_file, …) as an MCP server over HTTP for ACP agents such as Cursor.
// ACP passes MCP servers as a URL when a session is created; the agent calls them itself. The server listens
// on 127.0.0.1 only, every session gets its own secret path. Streamable HTTP with JSON answers only, without an
// SSE stream: tools without questions and progress notifications need nothing more.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { EngineTool } from './codex.ts';
import { bindAccount } from './store.ts';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1024 * 1024;

const accesses = new Map<string, EngineTool[]>();
let start: Promise<number> | null = null;

export interface ToolAccess {
    url: string;
    /** Close the path again (session ended). */
    close(): void;
}

/** Opens access to these tools; the server starts on the first call. */
export async function toolAccess(tools: EngineTool[]): Promise<ToolAccess> {
    const port = await startServer();
    const secret = randomBytes(24).toString('hex');
    // Requests arrive in the context of whoever started the server; the tools belong to the session's account
    accesses.set(secret, tools.map((x) => ({ ...x, run: bindAccount(x.run) })));
    return { url: `http://127.0.0.1:${port}/mcp/${secret}`, close: () => accesses.delete(secret) };
}

function startServer(): Promise<number> {
    start ??= new Promise<number>((ok, fail) => {
        const server = http.createServer((req, res) => void request(req, res));
        server.on('error', (e) => {
            start = null;
            fail(e);
        });
        server.listen(0, '127.0.0.1', () => ok((server.address() as { port: number }).port));
        // The server does not keep the backend alive
        server.unref();
    });
    return start;
}

interface RpcRequest {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: Record<string, unknown>;
}

async function request(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const secret = /^\/mcp\/([0-9a-f]+)$/.exec(req.url ?? '')?.[1];
    const tools = secret ? accesses.get(secret) : undefined;
    // Browsers send an Origin; the agent does not. So no web page can talk to the server.
    if (!tools || req.headers.origin) return respond(res, 404);
    if (req.method === 'DELETE') return respond(res, 200);
    if (req.method !== 'POST') return respond(res, 405, undefined, { Allow: 'POST, DELETE' });

    let body: unknown;
    try {
        body = JSON.parse(await readBody(req));
    } catch {
        return respond(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
    }
    const list = (Array.isArray(body) ? body : [body]) as RpcRequest[];
    const answers = (await Promise.all(list.map((n) => handle(n, tools)))).filter((a) => a !== null);
    if (!answers.length) return respond(res, 202);
    respond(res, 200, Array.isArray(body) ? answers : answers[0]);
}

/** One JSON-RPC message; null for notifications without id (notifications/initialized etc.). */
export async function handle(n: RpcRequest, tools: EngineTool[]): Promise<Record<string, unknown> | null> {
    if (n.id === undefined || n.id === null) return null;
    const result = (r: unknown) => ({ jsonrpc: '2.0', id: n.id, result: r });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: n.id, error: { code, message } });
    switch (n.method) {
        case 'initialize': {
            const wanted = String(n.params?.protocolVersion ?? '');
            return result({
                protocolVersion: VERSIONS.includes(wanted) ? wanted : VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'openfolk', version: '0.1.2' },
            });
        }
        case 'ping':
            return result({});
        case 'tools/list':
            return result({ tools: tools.map((w) => ({ name: w.name, description: w.description, inputSchema: w.schema })) });
        case 'tools/call': {
            const w = tools.find((x) => x.name === n.params?.name);
            if (!w) return error(-32602, `Tool ${String(n.params?.name)} does not exist`);
            try {
                const r = await w.run((n.params?.arguments ?? {}) as Record<string, unknown>);
                return result({ content: [{ type: 'text', text: r.text }], isError: !!r.error });
            } catch (e) {
                return result({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
            }
        }
        default:
            return error(-32601, `${String(n.method)} is not supported`);
    }
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((ok, fail) => {
        const parts: Buffer[] = [];
        let length = 0;
        req.on('data', (d: Buffer) => {
            length += d.length;
            if (length > MAX_BODY) {
                fail(new Error('too large'));
                req.destroy();
                return;
            }
            parts.push(d);
        });
        req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
        req.on('error', fail);
    });
}

function respond(res: http.ServerResponse, status: number, data?: unknown, headers: Record<string, string> = {}): void {
    if (data === undefined) {
        res.writeHead(status, headers).end();
        return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(data));
}
