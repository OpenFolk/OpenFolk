// Decides per bot setting whether a tool call needs an approval in the chat.

import path from 'node:path';
import { isUnder } from './bots.ts';
import { shellRisk } from './shell-policy.ts';
import { t } from './i18n.ts';
import type { ApprovalPolicy } from '../../shared/protocol.ts';

/** Tools that only read or plan: never ask. */
const READ_ONLY = new Set([
    'Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
    'NotebookRead', 'ToolSearch', 'Skill', 'EnterPlanMode', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
    'Monitor', 'TaskOutput', 'BashOutput',
]);

/** Tools that write or execute. */
const WRITING = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'KillShell', 'TaskStop']);

/** Commands that ask even in "risky" mode. */
const RISKY = [
    /\brm\s+-[a-z]*[rf]/i, /\brm\s+(?!-)/, /\brmdir\b/i, /\bdel\s/i, /\bRemove-Item\b/i, /\brd\s+\/s/i,
    /\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|rebase|branch\s+-D|stash\s+drop|filter-branch)/i,
    /\b(drop|truncate)\s+(table|database|schema)\b/i, /\bdelete\s+from\b/i,
    /\b(shutdown|Restart-Computer|Stop-Computer|format)\b/i,
    /\b(Stop-Service|Restart-Service|sc(\.exe)?\s+(stop|delete|config))\b/i,
    /\b(npm|pnpm|yarn)\s+publish\b/i, /\bdocker\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i,
    /\bcurl\b.*\s-X\s*(POST|PUT|PATCH|DELETE)\b/i, /\bInvoke-(RestMethod|WebRequest)\b.*-Method\s+(Post|Put|Patch|Delete)/i,
    /\bssh\s/i, /\bscp\s/i, /\brsync\s/i,
    /\bdeploy/i, /\bSet-ItemProperty\b.*HKLM/i, /\breg\s+(add|delete)\b/i,
    /\bchmod\s+-R\b/i, /\bicacls\b/i, /\bmklink\b/i,
    /\bschtasks\s+\/(create|delete|change)/i, /\b(Register|Unregister)-ScheduledTask\b/i,
];

/** Sensitive file names ('zugangsdaten' is German for credentials, a common name in existing setups). */
const SENSITIVE = /\.env(\.|$)|\.(pem|key|pfx|p12|ppk)$|zugangsdaten|credentials|secrets\./i;
/** Templates of .env files, without values (AGENTS.md: .env.sample may be read). */
const TEMPLATE = /\.env\.(sample|example|tpl|template|dist)$/i;

export interface Decision {
    ask: boolean;
    /** Refused without asking, whatever the approval level. */
    deny?: boolean;
    reason?: string;
}

/** Reading tools and the parameters that name a file, a folder or a file pattern. */
const READ_TARGETS: Record<string, string[]> = {
    Read: ['file_path'], NotebookRead: ['notebook_path'], Grep: ['path', 'glob'], Glob: ['pattern', 'path'],
};

/**
 * Reason to refuse a reading tool aimed at a secret (.env, keys), in every approval level: secrets never go into a
 * conversation. Claude does not pass reads through canUseTool, so its sessions check this in a PreToolUse hook as
 * well (session.ts). A shell command such as `cat .env` is not covered here.
 */
export function secretRead(tool: string, input: Record<string, unknown>): string | null {
    const keys = READ_TARGETS[tool];
    if (!keys) return null;
    for (const k of keys) {
        const value = typeof input[k] === 'string' ? (input[k] as string) : '';
        // A pattern like **/.env* or *.pem aims at the same files as the name itself; templates stay readable
        if (value && SENSITIVE.test(value.replace(/[*?]+$/, '')) && !TEMPLATE.test(value)) return t('policy.secretRead');
    }
    return null;
}

export function needsApproval(policy: ApprovalPolicy, tool: string, input: Record<string, unknown>, folder: string): Decision {
    if (tool === 'AskUserQuestion') return { ask: true, reason: t('policy.question') };
    const secret = secretRead(tool, input);
    if (secret) return { ask: false, deny: true, reason: secret };
    if (tool.startsWith('mcp__openfolk__')) return { ask: false };
    if (policy === 'never' || READ_ONLY.has(tool)) return { ask: false };

    const writing = WRITING.has(tool) || tool.startsWith('mcp__');
    if (policy === 'write') return { ask: writing, reason: t('policy.writing') };

    // risky: writing outside the bot folder, risky commands, foreign MCP tools with external effect
    if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
        // Codex changes several files at once with a patch (input.files)
        const files = Array.isArray(input.files) ? input.files.map(String) : [String(input.file_path ?? input.notebook_path ?? '')];
        for (const file of files.filter(Boolean)) {
            if (!isUnder(path.resolve(folder, file), folder)) return { ask: true, reason: t('policy.outsideFolder') };
            if (SENSITIVE.test(file)) return { ask: true, reason: t('policy.sensitiveFile') };
        }
        return { ask: false };
    }
    if (tool === 'Bash' || tool === 'PowerShell') {
        const command = String(input.command ?? '');
        if (RISKY.some((r) => r.test(command))) return { ask: true, reason: t('policy.riskyCommand') };
        // Each command of the line by its effect: writing outside the folder, secrets, code from the internet, installs
        const risk = shellRisk(command, folder);
        return risk ? { ask: true, reason: t(`policy.${risk}`) } : { ask: false };
    }
    if (tool.startsWith('mcp__')) {
        // ACP calls of unknown kind are named after their title ("list and delete branches"), which proves nothing
        if (tool.startsWith('mcp__acp__')) return { ask: true, reason: t('policy.externalService') };
        // Reading MCP tools are mostly called get/list/search/read …
        const short = tool.split('__').pop() ?? '';
        if (/^(get|list|search|read|query|find|fetch|describe|explore|validate|resolve|help)/i.test(short)) return { ask: false };
        return { ask: true, reason: t('policy.externalService') };
    }
    return { ask: false };
}

/** Summary and detail for the approval card. */
export function approvalText(tool: string, input: Record<string, unknown>): { summary: string; detail: string } {
    const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
    switch (tool) {
        case 'Bash':
        case 'PowerShell':
            return { summary: s('description') || t('policy.runCommand'), detail: s('command') };
        case 'Write':
            if (Array.isArray(input.files)) return { summary: t(input.files.length > 1 ? 'policy.changeFiles' : 'policy.changeFile', { path: s('file_path') }), detail: s('content').slice(0, 1500) };
            return { summary: t('policy.writeFile', { path: s('file_path') }), detail: s('content').slice(0, 1500) };
        case 'Edit':
        case 'MultiEdit':
            return { summary: t('policy.changeFile', { path: s('file_path') }), detail: `- ${s('old_string').slice(0, 600)}\n+ ${s('new_string').slice(0, 600)}` };
        default:
            return { summary: tool.replace(/^mcp__/, '').replace(/__/g, ' › '), detail: JSON.stringify(input, null, 2).slice(0, 1500) };
    }
}
