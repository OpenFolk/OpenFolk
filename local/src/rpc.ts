// JSON-RPC over stdio with a child process, requests in both directions (Codex app-server, ACP agents).

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

export type Params = Record<string, unknown>;

interface Message {
    jsonrpc?: '2.0';
    id?: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export class RpcProcess {
    private p: ChildProcessWithoutNullStreams;
    private nr = 0;
    private pending = new Map<number, { ok: (r: unknown) => void; fail: (e: Error) => void }>();
    private ended = false;
    private stderr = '';
    onNotification: (method: string, params: Params) => void = () => undefined;
    /** Request from the process; the result goes back as the answer, an exception as an error. */
    onRequest: (method: string, params: Params, id: number | string) => Promise<unknown> = async (m) => {
        throw new Error(`${m} is not supported`);
    };
    onEnd: (error: string | null) => void = () => undefined;
    /** Output of the process on stderr (Antigravity prints its login link there). */
    onStderr: (text: string) => void = () => undefined;

    /**
     * @param name    for logs and error messages, e.g. 'Codex'
     * @param jsonrpc with field `jsonrpc: '2.0'` (ACP); the Codex app-server omits it
     */
    private name: string;
    private jsonrpc: boolean;
    constructor(name: string, command: string, args: string[], env: NodeJS.ProcessEnv, jsonrpc = false, cwd?: string) {
        this.name = name;
        this.jsonrpc = jsonrpc;
        this.p = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env, cwd, windowsHide: true });
        this.p.stderr.on('data', (d: Buffer) => {
            this.stderr = (this.stderr + d.toString()).slice(-2000);
            if (process.env.OPENFOLK_DEBUG) process.stderr.write(`[${name.toLowerCase()}] ${d}`);
            this.onStderr(d.toString());
        });
        this.p.on('error', (e) => this.end(e.message));
        this.p.on('exit', (code) => this.end(code ? `${name} process exited (code ${code})${this.stderr ? `: ${this.stderr.trim().split('\n').pop()}` : ''}` : null));
        readline.createInterface({ input: this.p.stdout }).on('line', (l) => this.line(l));
    }

    get running(): boolean {
        return !this.ended;
    }

    call<T = Params>(method: string, params?: unknown): Promise<T> {
        if (this.ended) return Promise.reject(new Error(`${this.name} process is not running`));
        const id = ++this.nr;
        return new Promise<T>((ok, fail) => {
            this.pending.set(id, { ok: ok as (r: unknown) => void, fail });
            this.write({ id, method, params });
        });
    }

    notify(method: string, params?: unknown): void {
        this.write({ method, params });
    }

    stop(): void {
        if (this.ended) return;
        // On Windows kill() only hits the process itself; Antigravity starts child processes that would keep running
        if (process.platform === 'win32' && this.p.pid) {
            execFile('taskkill.exe', ['/T', '/F', '/PID', String(this.p.pid)], { windowsHide: true }, () => undefined);
        } else {
            this.p.kill();
        }
        this.end(null);
    }

    private write(n: Message): void {
        if (!this.ended) this.p.stdin.write(JSON.stringify(this.jsonrpc ? { jsonrpc: '2.0', ...n } : n) + '\n');
    }

    private line(l: string): void {
        let m: Message;
        try {
            m = JSON.parse(l) as Message;
        } catch {
            return;
        }
        if (m.id !== undefined && m.id !== null && !m.method) {
            const o = this.pending.get(Number(m.id));
            this.pending.delete(Number(m.id));
            if (m.error) o?.fail(new Error(errorText(m.error)));
            else o?.ok(m.result);
        } else if (m.id !== undefined && m.id !== null && m.method) {
            const id = m.id;
            this.onRequest(m.method, (m.params ?? {}) as Params, id).then(
                (result) => this.write({ id, result: result ?? null }),
                (e: Error) => this.write({ id, error: { code: -32000, message: e.message } }),
            );
        } else if (m.method) {
            this.onNotification(m.method, (m.params ?? {}) as Params);
        }
    }

    private end(error: string | null): void {
        if (this.ended) return;
        this.ended = true;
        for (const o of this.pending.values()) o.fail(new Error(error ?? `${this.name} process exited`));
        this.pending.clear();
        this.onEnd(error);
    }
}

/** Error message including `data.message` if the process says more there (ACP: "Authentication required …"). */
function errorText(e: { message: string; data?: unknown }): string {
    const detail = (e.data as { message?: unknown } | undefined)?.message;
    return typeof detail === 'string' && detail && detail !== e.message ? detail : e.message;
}
