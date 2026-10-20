// The bots' own tools (list_bots, message_bot, send_file, knowledge, history), the same for every engine: Claude gets
// them as an MCP server, the other engines as plain functions (EngineTool). What a tool needs of the bot manager
// comes through ToolHost; this module imports only types from agent.ts.

import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Sender } from './agent.ts';
import { loadBots, mayMessage, roleLine } from './bots.ts';
import type { EngineTool } from './codex.ts';
import { config } from './config.ts';
import { botFile } from './files.ts';
import { AROUND_MAX, readHistoryText, searchHistoryText } from './history-tools.ts';
import { deleteFact, factName, folderKey, knowledgeSections, locationText, readFact, saveFact, sees } from './knowledge.ts';
import type { BotSession } from './session.ts';
import { KNOWLEDGE_TYPES, type Bot, type KnowledgeLocation, type KnowledgeScope } from '../../shared/protocol.ts';

const SCOPES = ['bot', 'folder', 'group', 'all'] as const;

export type ToolText = { content: { type: 'text'; text: string }[]; isError: boolean };
export const toolText = (text: string, isError = false): ToolText => ({ content: [{ type: 'text', text }], isError });

/** What the tools need of the bot manager. */
export interface ToolHost {
    /** The machines awake right now; asked on every call, it changes while a session runs. */
    online(): string[];
    /** The machine a bot runs on now (responsibleMachine), null while it sleeps. */
    machineOf(bot: Pick<Bot, 'machine'>): string | null;
    send: Sender;
    messageBot(s: BotSession, target: string, job: string, wait: boolean): Promise<ToolText>;
    knowledgeChanged(locations: KnowledgeLocation[], by: BotSession): void;
}

export function botToolServer(s: BotSession, host: ToolHost): McpServerConfig {
    return createSdkMcpServer({
        name: 'openfolk',
        version: '0.3.0',
        // available directly, without going through the tool search
        alwaysLoad: true,
        tools: botTools(s, host),
    });
}

export function engineToolsFor(s: BotSession, host: ToolHost): EngineTool[] {
    return botTools(s, host).map((w) => ({
        name: w.name,
        description: w.description,
        schema: z.toJSONSchema(z.object(w.inputSchema)) as Record<string, unknown>,
        run: async (args) => {
            const r = await w.handler(args as never, undefined);
            return { text: r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'), error: r.isError };
        },
    }));
}

export function botTools(s: BotSession, host: ToolHost) {
    return [
        tool('list_bots', 'Lists the user\'s bots you can give jobs, with id, name, field of work, role, folder and the machine they would run on right now.', {}, async () => {
            const reachable = loadBots().filter((b) => b.id === s.bot.id || mayMessage(s.bot, b));
            const lines = reachable.map((b) => {
                const where = host.machineOf(b);
                return `- ${b.id}: ${b.name}${roleLine(b) ? ` – ${roleLine(b)}` : ''} (folder ${b.folder}, ${where ? `runs on ${where.toUpperCase()}` : `asleep, needs ${b.machine.toUpperCase()}`})${b.id === s.bot.id ? ' [you]' : ''}`;
            });
            const none = reachable.length <= 1 && s.bot.canMessage ? '\nThe user has not allowed you to give other bots jobs.' : '';
            return toolText(`You run on ${config.machine.toUpperCase()}. Machines awake: ${host.online().map((r) => r.toUpperCase()).join(', ')}.\n${lines.join('\n') || 'No bots.'}${none}`);
        }),
        tool(
            'message_bot',
            'Gives another bot a job (it works in its own folder with its own session, possibly on another machine). With wait_for_reply=true (default) its answer comes back as the result.',
            {
                bot: z.string().describe('Id or name of the target bot, see list_bots'),
                text: z.string().describe('Job or question, fully phrased'),
                wait_for_reply: z.boolean().optional().describe('Default true'),
            },
            async (args) => host.messageBot(s, args.bot, args.text, args.wait_for_reply !== false),
        ),
        tool(
            'send_file',
            'Sends the user a file as an attachment to the current answer (max. 20 MB), e.g. a report, an image or an export.',
            { path: z.string().describe('Path, relative to the working folder or absolute') },
            async (args) => {
                try {
                    const a = botFile(s.bot.folder, args.path);
                    s.addAttachment(a);
                    const turn = s.currentTurn;
                    if (turn) host.send({ type: 'attachment', chatId: turn.chatId, botId: s.bot.id, attachment: a });
                    return toolText(`${a.name} will be shown to the user with the answer.`);
                } catch (e) {
                    return toolText((e as Error).message, true);
                }
            },
        ),
        tool(
            'remember_fact',
            'Keeps a fact permanently (preferences and corrections of the user, decisions, agreements, references). The same name replaces an existing fact. The index is in the system prompt from the next session on.',
            {
                name: z.string().describe('Short slug of a-z, 0-9 and hyphens, e.g. "deploy-process"; use an existing name to update'),
                description: z.string().describe('One line that appears in the index and shows when the fact matters'),
                text: z.string().describe('The fact itself, concise; for ways of working with the reason. No secrets or credentials'),
                type: z.enum(KNOWLEDGE_TYPES).optional().describe('user | workstyle | project | reference | note (default)'),
                scope: z.enum(SCOPES).optional()
                    .describe('bot (default, only you) | folder (all bots in your folder) | group (members of this group chat) | all'),
            },
            async (args) => {
                const location = knowledgeLocation(s, args.scope);
                if (typeof location === 'string') return toolText(location, true);
                try {
                    const before = readFact(location, args.name);
                    const f = saveFact(location, { name: args.name, description: args.description, text: args.text, type: args.type ?? before?.type ?? 'note' });
                    host.knowledgeChanged([location], s);
                    return toolText(`${before ? 'Updated' : 'Remembered'}: ${f.name} (${locationText(location)}).`);
                } catch (e) {
                    return toolText((e as Error).message, true);
                }
            },
        ),
        tool(
            'read_knowledge',
            'Without a name: the current index of all knowledge you see. With a name: the full text of that fact.',
            {
                name: z.string().optional().describe('Name of the fact'),
                scope: z.enum(SCOPES).optional().describe('Only needed if the name occurs in several scopes'),
            },
            async (args) => {
                const sections = knowledgeSections(s.bot).filter((a) => !args.scope || a.location.scope === args.scope);
                if (!args.name) {
                    const blocks = sections.filter((a) => a.facts.length)
                        .map((a) => `${a.title} (${locationText(a.location)}):\n${a.facts.map((f) => `- ${f.name} (${f.type}, ${f.updatedAt.slice(0, 10)}): ${f.description}`).join('\n')}`);
                    return toolText(blocks.join('\n\n') || 'No knowledge yet.');
                }
                const hits = sections.flatMap((a) => a.facts.filter((f) => f.name === args.name).map((f) => ({ a, f })));
                if (!hits.length) return toolText(`No fact "${args.name}". read_knowledge without a name shows the index.`, true);
                return toolText(hits.map(({ a, f }) => `# ${f.name} (${f.type}, ${a.title}, as of ${f.updatedAt.slice(0, 10)})\n${f.description}\n\n${f.text}`).join('\n\n'));
            },
        ),
        tool(
            'forget_fact',
            'Deletes an outdated or wrong fact.',
            {
                name: z.string().describe('Name of the fact'),
                scope: z.enum(SCOPES).optional().describe('Default: the first scope in which the name occurs'),
            },
            async (args) => {
                const a = knowledgeSections(s.bot).find((x) => (!args.scope || x.location.scope === args.scope) && x.facts.some((f) => f.name === args.name));
                if (!a || !deleteFact(a.location, args.name)) return toolText(`No fact "${args.name}".`, true);
                host.knowledgeChanged([a.location], s);
                return toolText(`Forgotten: ${args.name} (${locationText(a.location)}).`);
            },
        ),
        tool(
            'remember_note',
            'Short form of remember_fact for a single sentence (type note, only for you). Better use remember_fact with name and description.',
            { note: z.string().describe('One sentence, without secrets or credentials') },
            async (args) => {
                const location: KnowledgeLocation = { scope: 'bot', key: s.bot.id };
                const base = factName(args.note.split(/\s+/).slice(0, 6).join(' ')) || 'note';
                let name = base;
                for (let i = 2; readFact(location, name); i++) name = `${base.slice(0, 36)}-${i}`;
                try {
                    saveFact(location, { name, description: args.note, text: args.note, type: 'note' });
                } catch (e) {
                    return toolText((e as Error).message, true);
                }
                host.knowledgeChanged([location], s);
                return toolText(`Remembered as ${name}.`);
            },
        ),
        tool(
            'search_history',
            'Searches the earlier messages of all chats on this machine (the user\'s, yours, other bots\', groups, routines), '
            + 'not the tools\' output. Use it for questions about earlier conversations, decisions and agreements instead of guessing. '
            + 'Every word must occur; "…" keeps a phrase together. Best hits first, each with chat and entry id for read_history.',
            {
                query: z.string().describe('Words to find, e.g. "relay deploy" or "\\"push mirror\\""'),
                chat: z.string().optional().describe('Only this chat: "this", a bot\'s or group\'s name or id, or a chat id from an earlier hit'),
                from: z.string().optional().describe('Only messages of "user", of a bot (name or id) or "routine:<name>"'),
                since: z.string().optional().describe('From then on: a date like 2026-10-01 or a span back from now: 12h, 7d, 2w, 3m'),
                until: z.string().optional().describe('Up to then, same forms as since'),
                max: z.number().int().optional().describe('Number of hits, default 20, at most 50'),
            },
            async (args) => {
                const elsewhere = loadBots().filter((b) => {
                    const m = host.machineOf(b);
                    return b.id !== s.bot.id && m && m !== config.machine;
                }).map((b) => `${b.name} (${host.machineOf(b)!.toUpperCase()})`);
                const r = searchHistoryText(args, s.currentTurn?.chatId ?? s.key, elsewhere);
                return toolText(r.text, r.error);
            },
        ),
        tool(
            'read_history',
            'Shows an entry found with search_history together with what was said before and after it, without the tools\' output.',
            {
                chat: z.string().describe('The chat of the hit (its chat id, or "this")'),
                entry_id: z.string().describe('The entry id of the hit'),
                before: z.number().int().optional().describe(`Entries before it, default 3, at most ${AROUND_MAX}`),
                after: z.number().int().optional().describe(`Entries after it, default 3, at most ${AROUND_MAX}`),
            },
            async (args) => {
                const r = readHistoryText(args, s.currentTurn?.chatId ?? s.key);
                return toolText(r.text, r.error);
            },
        ),
    ];
}

/** Scope for a knowledge tool; a string = error message. */
function knowledgeLocation(s: BotSession, scope: KnowledgeScope | undefined): KnowledgeLocation | string {
    switch (scope ?? 'bot') {
        case 'folder': return { scope: 'folder', key: folderKey(s.bot.folder) };
        case 'all': return { scope: 'all', key: '' };
        case 'group': {
            const chatId = s.currentTurn?.chatId ?? '';
            if (!chatId.startsWith('g:')) return 'scope "group" only works while you answer in a group chat.';
            const location: KnowledgeLocation = { scope: 'group', key: chatId.slice(2) };
            return sees(s.bot, location) ? location : 'You are not a member of this group.';
        }
        default: return { scope: 'bot', key: s.bot.id };
    }
}
