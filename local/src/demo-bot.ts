// The demo bot of the app stores' reviewers: an account the relay marks as demo (DEMO_ACCOUNTS there) that has no bot
// gets one from the template in DEMO_BOT, a JSON file with name, role, tone, folder and model of the bot. The relay
// creates a deleted demo account again under a new id, so after a reviewer's "Delete my account" the next one finds
// the bot again. Only one machine of the relay should have DEMO_BOT: each would add one.

import fs from 'node:fs';
import { allPeople } from './people.ts';
import { loadBots, saveBot } from './bots.ts';
import { config } from './config.ts';
import type { ApprovalPolicy, Bot } from '../../shared/protocol.ts';

interface Template {
    name?: unknown;
    area?: unknown;
    role?: unknown;
    tone?: unknown;
    folder?: unknown;
    model?: unknown;
    approval?: unknown;
}

const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/**
 * Creates the demo bot in the current account's context when it is a demo account without bots and DEMO_BOT names a
 * template; returns it, or null when there is nothing to do. A broken template is logged, not thrown: the account works
 * without a bot.
 */
export function seedDemoBot(account: string, file = process.env.DEMO_BOT ?? '', log: (text: string) => void = console.log): Bot | null {
    if (!file.trim() || !allPeople().find((p) => p.id === account)?.demo || loadBots().length) return null;
    try {
        const t = JSON.parse(fs.readFileSync(file.trim(), 'utf8')) as Template;
        const name = text(t.name);
        if (!name || !text(t.folder)) throw new Error('name and folder are required');
        const bot = saveBot({
            id: '', name, area: text(t.area) || undefined, role: text(t.role), tone: text(t.tone), folder: text(t.folder),
            model: text(t.model) || 'default', avatar: '', machine: config.machine,
            // A support bot by default: it answers, it does not write or run commands
            approval: (text(t.approval) || 'read') as ApprovalPolicy,
        });
        log(`demo: bot ${bot.id} created for account ${account}`);
        return bot;
    } catch (e) {
        log(`demo: no demo bot for account ${account} (DEMO_BOT ${file}): ${(e as Error).message}`);
        return null;
    }
}
