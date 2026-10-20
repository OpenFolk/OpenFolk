// Sign-in of an ACP agent without a browser on the machine: the agent names the sign-in link, which is printed here
// (e.g. to open it on the phone); the agent waits for the callback and stores the credentials itself.
//
//   npm run acp-login -w local -- antigravity      # Google account (Google AI Pro/Ultra)
//
// Currently only for Antigravity: Cursor and Copilot sign in with `agent login` or `npx copilot login`.

import { ACP_AGENTS } from '../src/acp.ts';
import { RpcProcess } from '../src/rpc.ts';

const engine = process.argv[2];
const agent = engine === 'antigravity' ? ACP_AGENTS.antigravity : null;
if (!agent?.signIn) {
    console.error('Usage: npm run acp-login -w local -- antigravity');
    process.exit(1);
}

const b = agent.command();
// BROWSER: the server opens the link with it instead of the default browser; the placeholder %s becomes the link.
// A command that only prints the link shows it here in the terminal.
const display = process.platform === 'win32' ? 'cmd /c echo %s' : 'echo %s';
const p = new RpcProcess(agent.name, b.command, b.args, { ...b.env, BROWSER: display }, true);
p.onNotification = () => undefined;
p.onRequest = async () => ({});
let rest = '';
p.onStderr = (text) => {
    // The link comes on stderr, often in pieces; print whole lines with https://accounts.google.com
    rest += text;
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const l of lines) if (/https:\/\/accounts\.google\.com\S+/.test(l)) console.log(`\nSign-in link:\n${l.match(/https:\/\/accounts\.google\.com\S+/)[0]}\n`);
};
p.onEnd = (error) => {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
};
console.log(`${agent.name} is starting …`);
try {
    await p.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'openfolk', title: 'OpenFolk', version: '0.1.0' } });
    console.log(`Sign-in running (${agent.signIn}). Open the link that appears shortly and sign in with the Google account.`);
    await p.call('authenticate', { methodId: agent.signIn });
    console.log(`${agent.name} is signed in. Restart the backend so ${agent.name} appears in the model list.`);
} catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
} finally {
    p.stop();
}
