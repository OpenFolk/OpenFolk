// Automatic test of the bot manager without a browser, against real sessions.
//
//   node src/selftest.ts <test> <bot-id> [target-bot-id]
//
// Tests: context (two messages, context stays), resume (new manager, context from the session), tool (Bash
// call with result), approval (risky command runs only after approval), question (AskUserQuestion),
// delegation (message_bot to target-bot), group (group chat with @ hand-off), routine (run a routine right away),
// file (send_file), background (answer to a background agent's report arrives in the chat), queue (second message
// during the first: order of user, read and done), conversations (second conversation: own context, in parallel to
// the main chat, title, delete), parallel (move a waiting message into a conversation), delete (delete from the queue).

import { BotManager } from './agent.ts';
import { deleteGroup, findBot, saveGroup } from './bots.ts';
import { deleteRoutine, saveRoutine } from './routines.ts';
import { readVisible } from './history.ts';
import { migrateDataDir } from './migrate.ts';
import type { AgentFrame } from '../../shared/protocol.ts';

migrateDataDir();
const [test, botId = '', targetId = ''] = process.argv.slice(2);
const bot = findBot(botId);
if (!bot) {
    console.error(`Bot "${botId}" not found. Usage: node src/selftest.ts <test> <bot-id> [target-bot-id]`);
    process.exit(1);
}

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), ...a);
const frames: AgentFrame[] = [];
let waitFor: ((f: AgentFrame) => boolean) | null = null;
let proceed: (() => void) | null = null;
let approvalAnswer: ((f: Extract<AgentFrame, { type: 'approval' }>) => void) | null = null;

const manager = new BotManager((f) => {
    frames.push(f);
    switch (f.type) {
        case 'tool': log(`⚙ ${f.botId} ${f.tool.name}: ${f.tool.summary}`); break;
        case 'tool_result': log(`  ↳ ${f.ok ? 'ok' : 'ERROR'} ${f.durationMs} ms: ${f.result.slice(0, 120).replace(/\s+/g, ' ')}`); break;
        case 'approval': log(`! ${f.approval.kind} ${f.approval.summary} | ${f.approval.detail.slice(0, 100).replace(/\s+/g, ' ')} ${JSON.stringify(f.approval.questions ?? '')}`); approvalAnswer?.(f); break;
        case 'approval_done': log(`  ✓ done: ${f.result}`); break;
        case 'done': log(`done ${f.chatId} from ${f.botId}: ${JSON.stringify(f.entry.text.slice(0, 300))}${f.entry.attachments ? ` 📎 ${f.entry.attachments.map((a) => a.name)}` : ''}`); break;
        case 'user': log(`user ${f.chatId} from ${f.entry.from}: ${f.entry.text.slice(0, 120)}`); break;
        case 'read': log(`✓✓ read ${f.chatId} ${f.id}`); break;
        case 'context': log(`context ${f.botId}: ${f.tokens} tokens`); break;
        case 'background': log(`background ${f.botId}: ${f.tasks.length ? f.tasks.map((a) => a.description).join(' | ') : '(none)'}`); break;
        case 'error': log(`ERROR ${f.message}`); break;
        case 'account': log(`account ${f.subscription} ${f.model} apiKeySource=${f.apiKeySource}`); break;
        case 'usage': log(`usage 5h=${f.usage.fiveHour?.utilization} 7d=${f.usage.sevenDay?.utilization} ${f.usage.status}`); break;
        case 'routines': log(`routines: ${f.routines.map((r) => `${r.name}=${r.lastStatus}`).join(', ')}`); break;
        case 'attachment': log(`📎 ${f.attachment.name} ${f.attachment.size} B`); break;
        default: break;
    }
    if (waitFor?.(f)) {
        waitFor = null;
        proceed?.();
    }
});

function until(condition: (f: AgentFrame) => boolean, maxSec = 240): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), maxSec * 1000);
        waitFor = condition;
        proceed = () => { clearTimeout(timer); resolve(); };
    });
}

const doneIn = (chatId: string, from = botId) => (f: AgentFrame) => f.type === 'done' && f.chatId === chatId && f.botId === from;
async function ask(text: string, chatId = botId, from = botId): Promise<void> {
    const w = until(doneIn(chatId, from));
    manager.handle({ type: 'send', chatId, text }, 'test');
    await w;
}

// as in the backend (index.ts): only report errors of the SDK when closing a session
process.on('unhandledRejection', (e) => log(`unhandled: ${e instanceof Error ? e.message : String(e)}`));
manager.start();
manager.greet('test');
manager.handle({ type: 'presence', visible: true }, 'test');

try {
    switch (test) {
        case 'context':
            await ask('Remember the code word "Pumpernickel". Answer only with OK.');
            await ask('What is the code word? Only the word.');
            break;
        case 'resume':
            await ask('What was the code word from our conversation? Only the word.');
            break;
        case 'tool':
            await ask('How many files are in local/src? Count with a command, answer with the number.');
            break;
        case 'approval': {
            let n = 0;
            approvalAnswer = (f) => {
                n++;
                // reject the first approval, allow the second
                setTimeout(() => manager.handle({ type: 'approval_reply', id: f.approval.id, allow: n > 1, message: n === 1 ? 'please ask first' : undefined }, 'test'), 300);
            };
            await ask('Delete with the Bash command `rm -f local/data/_selftest.tmp` (the file may be missing). If the command is rejected, try exactly once more with the same command. Answer briefly what happened.');
            log(`approval requests: ${n}`);
            break;
        }
        case 'question':
            approvalAnswer = (f) => {
                const q = f.approval.questions?.[0];
                setTimeout(() => manager.handle({ type: 'approval_reply', id: f.approval.id, allow: true, answers: q ? { [q.question]: q.options[1]?.label ?? q.options[0].label } : {} }, 'test'), 300);
            };
            await ask('Use the AskUserQuestion tool to ask me whether I want tea or coffee (two options: Tea, Coffee). Afterwards answer only with my choice.');
            break;
        case 'conversations': {
            // Second conversation: own context, runs in parallel to the main chat, title from the first message
            const created = new Promise<string>((resolve) => {
                const old = waitFor;
                waitFor = (f) => { if (f.type === 'conversation_created') { resolve(f.chatId); return false; } return old ? old(f) : false; };
            });
            manager.handle({ type: 'conversation_new', botId }, 'test');
            const chatId = await created;
            log(`conversation created: ${chatId}`);
            await ask('Remember the code word "Pumpernickel". Answer only with OK.');
            const both = new Promise<void>((resolve) => {
                const doneChats = new Set<string>();
                waitFor = (f) => { if (f.type === 'done' && (f.chatId === botId || f.chatId === chatId)) doneChats.add(f.chatId); return doneChats.size === 2; };
                proceed = resolve;
            });
            const start = Date.now();
            manager.handle({ type: 'send', chatId, text: 'Do you know a code word from this conversation? Answer only with the word or with "none".' }, 'test');
            manager.handle({ type: 'send', chatId: botId, text: 'What is the code word? Only the word.' }, 'test');
            await both;
            log(`both done after ${((Date.now() - start) / 1000).toFixed(1)} s`);
            const b = findBot(botId);
            log(`title: ${JSON.stringify(b?.conversations?.find((c) => `${botId}~${c.id}` === chatId)?.title)}`);
            manager.handle({ type: 'conversation_delete', chatId }, 'test');
            log(`deleted, left: ${findBot(botId)?.conversations?.length ?? 0}`);
            break;
        }
        case 'parallel': {
            // The second message waits; moved into a new conversation it runs there in parallel and is done before the first
            approvalAnswer = (f) => setTimeout(() => manager.handle({ type: 'approval_reply', id: f.approval.id, allow: true }, 'test'), 300);
            const sequence: string[] = [];
            let to = '';
            const bothDone = new Promise<void>((resolve) => {
                waitFor = (f) => {
                    if (f.type === 'moved') { to = f.to; sequence.push(`moved to ${f.to}`); }
                    if (f.type === 'done' && (f.chatId === botId || f.chatId === to)) sequence.push(`done ${f.chatId === botId ? 'main chat' : 'conversation'}: ${JSON.stringify(f.entry.text.slice(0, 40))}`);
                    return sequence.filter((a) => a.startsWith('done')).length === 2;
                };
                proceed = resolve;
            });
            manager.handle({ type: 'send', chatId: botId, text: 'Run "sleep 20" via Bash and afterwards answer only with "long done".' }, 'test');
            await new Promise((r) => setTimeout(r, 2000));
            manager.handle({ type: 'send', chatId: botId, text: 'Answer only with the word "parallel".' }, 'test');
            await new Promise((r) => setTimeout(r, 500));
            const second = frames.findLast((f) => f.type === 'user' && f.chatId === botId);
            if (second?.type !== 'user') throw new Error('second message not found');
            manager.handle({ type: 'queue_to_conversation', chatId: botId, entryId: second.entry.id! }, 'test');
            await bothDone;
            log(`sequence: ${sequence.join(' → ')}`);
            log(`title: ${JSON.stringify(findBot(botId)?.conversations?.find((c) => `${botId}~${c.id}` === to)?.title)}`);
            manager.handle({ type: 'conversation_delete', chatId: to }, 'test');
            break;
        }
        case 'delete': {
            // The second message waits and is deleted: no second turn, history without it, deleting again fails
            approvalAnswer = (f) => setTimeout(() => manager.handle({ type: 'approval_reply', id: f.approval.id, allow: true }, 'test'), 300);
            manager.handle({ type: 'send', chatId: botId, text: 'Run "sleep 8" via Bash and afterwards answer only with "done".' }, 'test');
            await new Promise((r) => setTimeout(r, 2000));
            manager.handle({ type: 'send', chatId: botId, text: 'Answer only with the word "deleted?".' }, 'test');
            await new Promise((r) => setTimeout(r, 500));
            const second = frames.findLast((f) => f.type === 'user' && f.chatId === botId);
            if (second?.type !== 'user') throw new Error('second message not found');
            manager.handle({ type: 'queue_delete', chatId: botId, entryId: second.entry.id! }, 'test');
            await until(doneIn(botId), 120);
            await new Promise((r) => setTimeout(r, 5000));
            const dones = frames.filter((f) => f.type === 'done' && f.chatId === botId).length;
            log(`deleted report: ${frames.some((f) => f.type === 'deleted')}, answers: ${dones}`);
            log(`visible in the history: ${readVisible(botId).some((e) => e.id === second.entry.id)}`);
            manager.handle({ type: 'queue_delete', chatId: botId, entryId: second.entry.id! }, 'test');
            await new Promise((r) => setTimeout(r, 300));
            log(`second delete: ${JSON.stringify(frames.findLast((f) => f.type === 'error'))}`);
            break;
        }
        case 'queue': {
            // Second message while the first runs: "read" for it only after the first one's done, before its answer
            const twoDone = new Promise<void>((resolve) => {
                let n = 0;
                waitFor = (f) => doneIn(botId)(f) && ++n === 2;
                proceed = resolve;
            });
            manager.handle({ type: 'send', chatId: botId, text: 'Count the files in this folder with a command (without subfolders) and name only the number.' }, 'test');
            setTimeout(() => manager.handle({ type: 'send', chatId: botId, text: 'Answer only with the word "two".' }, 'test'), 1500);
            await twoDone;
            const order = frames.filter((f) => ['user', 'read', 'done'].includes(f.type)).map((f) => f.type);
            log(`order: ${order.join(' → ')}`);
            break;
        }
        case 'background': {
            // The background agent's report starts a turn of the CLI; its answer must arrive as a second done
            approvalAnswer = (f) => setTimeout(() => manager.handle({ type: 'approval_reply', id: f.approval.id, allow: true }, 'test'), 300);
            await ask('Start a background agent with the Agent tool (run_in_background: true) that only answers with the word "Pumpernickel". Do not wait for it, answer me right away only with "started". When its report comes, answer with its word.');
            await until(doneIn(botId), 300);
            break;
        }
        case 'delegation':
            await ask(`Ask the bot "${targetId}" via message_bot what its working folder is called and answer with its answer in one sentence.`);
            break;
        case 'group': {
            const g = saveGroup({ id: '_selftest', name: 'Selftest', avatar: '', members: [botId, targetId] });
            const chatId = `g:${g.id}`;
            const w = until(doneIn(chatId, targetId), 300);
            manager.handle({ type: 'send', chatId, text: `@${botId} say hello in one sentence and ask @${targetId} to double the number 7.` }, 'test');
            await w;
            deleteGroup(g.id);
            break;
        }
        case 'routine': {
            const r = saveRoutine({ id: '', botId, name: 'Selftest', cron: '0 7 * * 1-5', prompt: 'Answer only with today\'s weekday.', enabled: false });
            const w = until((f) => f.type === 'routines' && f.routines.some((x) => x.id === r.id && (x.lastStatus === 'ok' || x.lastStatus === 'error')));
            manager.handle({ type: 'routine_run', id: r.id }, 'test');
            await w;
            deleteRoutine(r.id);
            break;
        }
        case 'file':
            await ask('Send me the project\'s README.md via send_file. Answer only with "sent".');
            break;
        default:
            console.error('Unknown test');
    }
} catch (e) {
    log(`FAILED: ${(e as Error).message}`);
    manager.close();
    process.exit(1);
}
manager.close();
setTimeout(() => process.exit(0), 300);
