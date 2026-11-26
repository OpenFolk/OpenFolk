# Missions

A mission is a long-term goal a team of bots pursues on its own, led by one of them, the supervisor
(`local/src/missions.ts`, `mission-control.ts`, `mission-tools.ts`, `mission-builder.ts`, `webapp/js/missions.js`).

## No field of work in OpenFolk

OpenFolk runs missions of any kind and knows none of them. There is no code per mission type: `type` is a label, and
team, criteria, milestones, rules and guardrails are data that the builder proposes and the user edits. What a mission
does in its field lives in its folder, a project like any other, which its bots build and change under their approval
levels. The contract with that project is two files under `<folder>/.openfolk/`: `mission.json`, written by the backend
and read by the project (status, autonomy, guardrails, which rules ask now, the kill switch), and `metrics.json`,
written by the project and shown by the mission page (`kpis`, `series`, `tables`). Figures therefore come from the
project's code and never from a model. A deterministic check of an action (a risk limit, an order) belongs into the
project, which reads `mission.json` before it acts; a prompt is never the only guard.

One folder holds one mission that is not over, because there is one `mission.json` per folder.

## A cycle is a turn

The supervisor works in cycles, each one turn in a conversation of its own (`Mission.chatId`) with the mission's state
as fenced data (`cyclePrompt`). A turn never waits for the team: a delegated task is a job between bots (`jobs.ts`)
into the assignee's main chat, where the user follows that bot's work anyway (a main chat that is busy queues it; the
queue does not survive a restart, which reports the job as interrupted and fails the task for the next cycle), and its
result comes back through `deliverFeedback`, which hands it to the
mission (`MissionControl.jobResult`) instead of starting a turn of the giving bot. That result, the user's decision on
an approval, a team member's `mission_event`, a resume or the mission's cron each add a reason to `loop.pending`; a
cycle collects all reasons that arrived meanwhile. Waiting inside a turn would tie up the session for hours and lose
the state on a restart, which is exactly what the jobs between bots were changed to avoid.

The delegation is recorded on the task before the job goes out (`delegate` returns `send`): on the same machine a job
that fails at once (missing folder) answers before `dispatchJob` returns, and its result must find its task.

What keeps the loop from running away is code, not instructions: one cycle per mission at a time (`loop.running`),
at least two minutes between two, the budget checked before each (cost from API-key turns, turns in total and per
day), three failed cycles in a row block the mission, a cycle that has not ended after 30 minutes is given up, and a
scheduled cycle is skipped while delegated work runs and nothing happened, except at autonomy 4. The scheduler checks
every 20 seconds like the routines'; a daily limit holds the pending reasons until the next day.

## Limits only change through the user

Budget, autonomy, approval rules, guardrails, team and the kill switch change only through the user's frames
(`mission_save`, `mission_control`, `mission_approval_reply`). The bots' tools have no parameter for any of them, so
nothing a bot reads, a web page or a task's result, can talk a bot into raising one; every change the user makes is
logged with old and new value, those of limits as critical. The backend enforces the rules it carries out itself
('delegate' asks before `mission_delegate` at the levels named, 'status' before completing or failing); the other
kinds are for the bots, which ask with `mission_request_approval`, and for the project. Approval requests are stored in
the mission, not in memory like a tool's approval, so they survive restarts; nobody answering for seven days denies.

`mission.json` is refused to bots in `policy.ts` at every approval level, "never" included, and in a PreToolUse hook,
because an allow rule in the user's settings skips `canUseTool`. A program a bot runs can still write it; the backend
compares the file before every cycle and writes it back with a critical event.

The kill switch stops the running cycle, cancels every delegated job (its task goes back to open) and keeps every
cycle and every mission tool away until the user resumes; it stays set across restarts and is in `mission.json`.

## Machines

A mission runs on the machine of its folder (`Mission.machine`), and so does its team (v1): the tools refuse to change
a mission elsewhere, and the builder refuses bots of other machines. `missions.json` travels in the sync like routines,
newest wins; only the mission's machine changes a mission, so another machine's copy follows it. The log
(`missions/<id>/events.jsonl`) stays on the mission's machine like the sessions, and the page asks that machine for it
(`mission_open`).

A restart gives up the cycle that ran (its turn died with the process) and starts a new one; delegated jobs are
reported as interrupted by `interruptedJobs`, which fails their tasks, so the next cycle sees them.
