// The tools of the bots in a mission's team (Mission Control). Only bots in an active mission get them; the logic is
// in mission-control.ts. What limits a mission (budget, autonomy, rules, guardrails, kill switch) has no tool on
// purpose: only the user's frames change it, so nothing a bot reads can talk it into raising a limit.

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ToolHost } from './bot-tools.ts';
import type { BotSession } from './session.ts';

const mission = z.string().max(80).optional().describe('Id or name of the mission; only needed when you are in several');

export function missionTools(s: BotSession, host: ToolHost) {
    const call = (name: string) => async (args: Record<string, unknown>) => host.missionTool(s, name, args);
    return [
        tool('mission_state', 'The state of your mission: goal, success and abort criteria, autonomy and what needs approval, guardrails, budget, team, milestones, tasks with results, open requests and recent events.',
            { mission }, call('mission_state')),
        tool(
            'mission_plan',
            'Supervisor only: creates or changes milestones and tasks of the mission. A task without id is new; with id it changes that one. '
            + 'Give every task one assignee from the team and the tasks it depends on. status "cancelled" takes a task off the plan, "open" opens a failed one again.',
            {
                mission,
                milestones: z.array(z.object({
                    id: z.string().max(40).optional(), title: z.string().max(200).optional(), due: z.string().max(10).optional().describe('YYYY-MM-DD'), done: z.boolean().optional(),
                })).max(30).optional(),
                tasks: z.array(z.object({
                    id: z.string().max(40).optional(), title: z.string().max(200).optional(), detail: z.string().max(4000).optional(),
                    assignee: z.string().max(80).optional().describe('Bot id of a team member'), milestone: z.string().max(40).optional(),
                    depends_on: z.array(z.string().max(40)).max(20).optional(), status: z.enum(['open', 'cancelled']).optional(),
                })).max(30).optional(),
                progress: z.number().min(0).max(100).optional().describe('Overall progress in percent, if the milestones do not say it well'),
            },
            call('mission_plan'),
        ),
        tool(
            'mission_delegate',
            'Supervisor only: hands a task to its assignee. It gets the task in its main chat (queued while it works on something else); its result comes back by itself and starts the next cycle. '
            + 'At autonomy level 1 the user approves each delegation first.',
            { mission, task: z.string().max(40).describe('Id of the task') },
            call('mission_delegate'),
        ),
        tool(
            'mission_task_update',
            'Reports on a task of yours: running, blocked (with what blocks it), done or failed, with a note. Your final answer delivers the result anyway; use this for progress and blockers.',
            { mission, task: z.string().max(40), status: z.enum(['running', 'blocked', 'done', 'failed']).optional(), note: z.string().max(4000).optional() },
            call('mission_task_update'),
        ),
        tool(
            'mission_decide',
            'Supervisor only: records a decision in the mission\'s decision history: what was decided, why, and which data it rests on (sources, numbers, results).',
            { mission, decision: z.string().max(1000), reason: z.string().max(2000).optional(), data: z.string().max(2000).optional() },
            call('mission_decide'),
        ),
        tool('mission_result', 'Records a result of the mission for the user (a finding, a deliverable, a number), optionally with a file in the project folder.',
            { mission, result: z.string().max(4000), file: z.string().max(500).optional().describe('Path in the project folder') }, call('mission_result')),
        tool(
            'mission_event',
            'Reports something the supervisor should react to (a run finished, a limit reached, a source failed). From a team member it starts a cycle; critical marks it red for the user.',
            { mission, text: z.string().max(1000), critical: z.boolean().optional() },
            call('mission_event'),
        ),
        tool(
            'mission_request_approval',
            'Asks the user to approve an action before it is done (kind e.g. "external", "money", "limit" as the rules of the mission name them). '
            + 'The answer comes as an event into the next cycle; do nothing of it before.',
            { mission, kind: z.string().max(40), title: z.string().max(200).describe('What should happen, in one line'), detail: z.string().max(4000).optional().describe('Why, what it costs, what could go wrong') },
            call('mission_request_approval'),
        ),
        tool(
            'mission_recommend',
            'Supervisor only: recommends pausing, completing, cancelling or failing the mission, with the reason. Pausing happens at once; the others need the user\'s approval unless the autonomy allows them.',
            { mission, action: z.enum(['pause', 'complete', 'cancel', 'fail']), reason: z.string().max(2000) },
            call('mission_recommend'),
        ),
    ];
}
