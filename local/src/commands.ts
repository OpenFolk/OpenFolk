// Slash commands of Claude Code for the picker in the web app's input field. The CLI itself runs them: a message
// that starts with "/name" is dispatched as that command, as long as nothing stands in front of it (agent.ts sends
// such messages without quote, delegation or group context).

import { query, type SDKUserMessage, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { claudeEnv, claudeSettings } from './engine-home.ts';
import type { BotCommand } from '../../shared/protocol.ts';

/**
 * Built-in commands worth offering in a chat. The others duplicate OpenFolk's own controls (model, new session, rename),
 * change the terminal (color, focus) or need it; they can still be typed.
 */
const CHAT_BUILTINS = new Set(['compact', 'context', 'usage', 'init', 'code-review', 'review', 'security-review', 'simplify', 'verify', 'batch', 'insights', 'recap']);

/** Whether a message is a slash command for the CLI: "/name" at the start, a path like "/etc/hosts" is not. */
export function isCommand(text: string): boolean {
    return /^\/[\p{L}\p{N}_][\p{L}\p{N}_:.-]*(?:\s|$)/u.test(text);
}

/** What the picker offers: every command of the user, the project, plugins and MCP servers, of the built-in ones a choice. */
export function chatCommands(list: SlashCommand[]): BotCommand[] {
    const seen = new Set<string>();
    const out: BotCommand[] = [];
    for (const c of list) {
        if (seen.has(c.name) || (c.builtin && !CHAT_BUILTINS.has(c.name))) continue;
        seen.add(c.name);
        out.push({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' });
    }
    return out;
}

/**
 * The commands of a folder without a running session: the CLI starts there without a prompt, reports them and ends.
 * No MCP servers and no hooks, so that typing "/" does not start the user's servers or run SessionStart hooks;
 * prompts of MCP servers are therefore only listed while a session runs.
 */
export async function folderCommands(folder: string): Promise<SlashCommand[]> {
    // eslint-disable-next-line require-yield
    async function* noMessage(): AsyncGenerator<SDKUserMessage> {
        await new Promise<never>(() => undefined);
    }
    const q = query({
        prompt: noMessage(),
        options: {
            cwd: folder, settingSources: ['user', 'project', 'local'], strictMcpConfig: true, mcpServers: {},
            env: claudeEnv(), settings: { ...claudeSettings(), disableAllHooks: true },
        },
    });
    try {
        return await q.supportedCommands();
    } finally {
        q.close();
    }
}
