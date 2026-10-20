// Terminal chat for testing a bot without web app and relay.
//
//   npm run cli -- <bot-id>
//   npm run cli -- --new <folder> [name] [model]
//   npm run cli                       (lists the bots)
//
// Approvals and questions are answered in the terminal (y/n or the number of the option).

import readline from 'node:readline';
import { BotManager } from './agent.ts';
import { findBot, loadBots, saveBot } from './bots.ts';
import { readHistory } from './history.ts';
import { migrateDataDir } from './migrate.ts';
import type { AgentFrame, Approval, Bot } from '../../shared/protocol.ts';

migrateDataDir();
const args = process.argv.slice(2);

let bot: Bot | undefined;
if (args[0] === '--new') {
    const [, folder, name, model] = args;
    if (!folder) {
        console.error('Usage: npm run cli -- --new <folder> [name] [model]');
        process.exit(2);
    }
    bot = saveBot({ id: '', folder, name: name ?? '', role: '', model: model ?? 'default', tone: '', avatar: '', approval: 'risky', machine: '' });
    console.log(`Bot created: ${bot.id} (${bot.folder}, model ${bot.model})`);
} else if (args[0]) {
    bot = findBot(args[0]);
    if (!bot) {
        console.error(`Bot "${args[0]}" not found.`);
        process.exit(1);
    }
} else {
    const bots = loadBots();
    if (bots.length === 0) console.log('No bots yet. Create one with: npm run cli -- --new <folder> [name] [model]');
    for (const b of bots) console.log(`${b.id.padEnd(16)} ${b.folder}  (${b.model}, approvals: ${b.approval}${b.sessionId ? ', session exists' : ''})`);
    process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let answerOpen = false;
let openApproval: Approval | null = null;
const lineBreak = () => {
    if (answerOpen) process.stdout.write('\n');
    answerOpen = false;
};

const manager = new BotManager((f: AgentFrame) => {
    switch (f.type) {
        case 'account':
            console.log(`[Account: ${f.apiKeySource !== 'none' ? 'API key' : `subscription ${f.subscription ?? 'unknown'}`}, model ${f.model}, Claude Code ${f.version}]`);
            break;
        case 'usage':
            console.log(`[Subscription usage: 5 h ${pct(f.usage.fiveHour?.utilization)}, week ${pct(f.usage.sevenDay?.utilization)}${f.usage.status === 'rejected' ? ', LIMIT REACHED' : ''}]`);
            break;
        case 'state':
            if (f.detail) console.log(`[${f.state}: ${f.detail}]`);
            break;
        case 'delta':
            answerOpen = true;
            process.stdout.write(f.text);
            break;
        case 'tool':
            lineBreak();
            console.log(`  ⚙ ${f.tool.name}: ${f.tool.summary}`);
            break;
        case 'attachment':
            lineBreak();
            console.log(`  📎 ${f.attachment.name} (${f.attachment.path})`);
            break;
        case 'error':
            lineBreak();
            console.error(`[Error] ${f.message}`);
            break;
        case 'approval':
            lineBreak();
            openApproval = f.approval;
            if (f.approval.kind === 'question') {
                for (const q of f.approval.questions ?? []) {
                    console.log(`? ${q.question}`);
                    q.options.forEach((o, i) => console.log(`   ${i + 1}) ${o.label} – ${o.description}`));
                }
                console.log('Answer: number(s) per question separated by ;, or free text');
            } else {
                console.log(`! Approval: ${f.approval.summary}\n${f.approval.detail}\nApprove? (y/n/always)`);
            }
            break;
        case 'done':
            lineBreak();
            console.log(`[${(f.durationMs / 1000).toFixed(1)} s]`);
            rl.prompt();
            break;
        default:
            break;
    }
});

function pct(u?: number): string {
    return typeof u === 'number' ? `${Math.round(u * 100)} %` : '–';
}

function answerApproval(input: string): void {
    const a = openApproval!;
    openApproval = null;
    if (a.kind === 'question') {
        const parts = input.split(';').map((x) => x.trim());
        const answers: Record<string, string> = {};
        (a.questions ?? []).forEach((q, i) => {
            const x = parts[i] ?? '';
            const numbers = x.split(',').map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= q.options.length);
            answers[q.question] = numbers.length ? numbers.map((n) => q.options[n - 1].label).join(', ') : x;
        });
        manager.handle({ type: 'approval_reply', id: a.id, allow: true, answers }, 'cli');
        return;
    }
    const yes = /^(y|yes|j|ja|always)$/i.test(input);
    manager.handle({ type: 'approval_reply', id: a.id, allow: yes, always: /^always$/i.test(input) }, 'cli');
}

const history = readHistory(bot.id, 6);
if (history.length) {
    console.log(`--- last ${history.length} entries ---`);
    for (const e of history) console.log(`${e.role === 'user' ? (e.from && e.from !== 'me' ? e.from : 'You') : bot.name}: ${e.text.slice(0, 200)}`);
    console.log('---');
}
console.log(`Chat with ${bot.name} (${bot.folder}). Commands: /new (new session), /stop (interrupt), /exit`);
rl.setPrompt('> ');
rl.prompt();

rl.on('line', (line) => {
    const text = line.trim();
    if (openApproval) return answerApproval(text);
    if (!text) return rl.prompt();
    if (text === '/exit') return rl.close();
    if (text === '/new') { manager.handle({ type: 'restart', botId: bot.id }, 'cli'); return rl.prompt(); }
    if (text === '/stop') { manager.handle({ type: 'interrupt', chatId: bot.id }, 'cli'); return; }
    manager.handle({ type: 'send', chatId: bot.id, text }, 'cli');
});

rl.on('close', () => {
    manager.close();
    process.exit(0);
});
