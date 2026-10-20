# Architecture

Everything that matters happens on the user's machines. A backend (`local/`) owns the agent sessions, the history,
the knowledge, the uploads, git and the approvals of the bots on that machine. The relay (`relay/`) connects
browsers and apps with the backends and is deliberately dumb: it stores no messages, keeps no model credentials
and, with end-to-end encryption (on unless `E2E_KEY=off`), sees only routing. Clients (web app, desktop apps, mobile apps) show what the
backends send and never substitute their own state for a backend's.

## Trust boundaries

Three parties, three secrets:

| Party | Holds | Must never see |
| --- | --- | --- |
| Backend | model credentials, `E2E_KEY`, `AGENT_TOKEN`, `USER_PASSWORD`, all data | nothing it does not own anyway |
| Relay | hashes of `USER_PASSWORD`, `AGENT_TOKEN`, the device keys and the other accounts' passwords | chat contents (with E2E), model credentials |
| Client | its device key, the end-to-end key | `AGENT_TOKEN`, other devices' keys |

The relay authenticates browsers (device key, pairing token or password) and backends (`AGENT_TOKEN` plus
machine name). Authentication of a socket and the account it belongs to (see Accounts) is all the relay decides;
what a frame may do is the backend's call, and the backend checks every frame before acting (`local/src/frames.ts`).

**Every secret is born on the backend** (`E2E_KEY`, `AGENT_TOKEN`, `USER_PASSWORD`, in `data/` on the first start,
`local/src/tokens.ts`) and travels in one direction only: the key to devices behind `#` of a pairing link, the two
tokens to the relay, the `.env` to further machines. Values set in the environment win, so people who manage their
own keep doing so. The tokens reach the relay one of three ways, all ending in the same hashes (`relay/src/owner.ts`):

- the relay runs inside the backend (no `RELAY_URL`, `relay/src/relay.ts` started on 127.0.0.1): handed over
  in memory;
- a relay started without tokens is unclaimed: it prints a setup code to its log only, never on a page, and the
  first backend that sends that code with its two tokens owns it (`npm run claim`, or `RELAY_SETUP_CODE` for a
  container started next to it). Claiming hands the relay nothing it would not hold anyway, so a lost race costs
  a restart of the relay, not a secret. The code is 50 bits and falls under the login throttle;
- the operator sets `USER_PASSWORD` and `AGENT_TOKEN` on the relay; these win over a claim.

The pairing link carries the end-to-end key and therefore goes to an interactive terminal or an encrypted frame,
never into a log file: a backend started as a service or container prints how to get one instead.

**End-to-end encryption** (`E2E_KEY` on all machines) wraps every frame between a client and a backend and the
sync between backends in AES-256-GCM, with the direction as authenticated data so a frame cannot be replayed the
other way. It is on by default: a backend without `E2E_KEY` generates a key on its first start
(`data/e2e-key`), because an opt-in left every first setup readable on the relay. The price is a second machine
started before it got the first one's key: it generates its own, and the two ignore each other's sync until the
user copies the key. The key reaches a device only through a pairing link, in the part behind `#` that browsers
never send to a server. Whoever controls the relay could still serve manipulated JavaScript to browsers; the mobile
apps are immune to that because they bring the web app along.

A recording relay could also deliver a captured frame again (a `send`, a `git_commit`, a peer job). Every encrypted
frame therefore carries a `ReplayGuard` (`shared/protocol.ts`): sender id, counter, sending time. Receivers drop a
counter they have seen from that sender and anything more than ten minutes off, which also bounds how long they
must remember senders across a restart. Backends insist on the guard; the web app accepts frames without one so it
can still show an old backend's version notice. With a key, the web app also drops unencrypted backend frames, so
the relay cannot inject bots, history or approvals in plain text.

**Push** is the one place where contents leave this model, see [push.md](./push.md).

## Pairing

A device signs in once and then uses a key of its own; the relay keeps only a hash. Three ways in:

- The password (`USER_PASSWORD`), optionally with TOTP.
- A pairing link `https://<relay>/#pair=<token>&e2e=<key>`: a one-time token the relay mints for a backend
  (`POST /pair` with `AGENT_TOKEN`, valid 15 minutes, redeemed once) plus the end-to-end key. The backend builds
  the link, not the relay, because only the backend has the key and the link must reach the asking browser
  encrypted. A signed-in device asks for the link in the devices block of the settings; the terminal tool `local/tools/e2e.mjs
  link` does the same. The mobile app accepts the whole link in its address field or scans its QR code. The browser
  and the desktop app scan it too: `scanQrCode` in `platform.js` reads the camera with getUserMedia and decodes with
  jsQR, which the relay serves under `/vendor/` and the page loads only on the first scan. This needs
  `camera=(self)` in the relay's Permissions-Policy and a secure context.
- A QR code on the new device's sign-in page (`webapp/js/qr-login.js`), for devices without a camera worth
  using. The page opens an unsigned connection with `pair_wait`, gets a request id and shows
  `<relay>/#approve=<id>&pk=<P-256 key>`. A signed-in device that opens it asks the relay who is waiting (name and
  address, so the user can tell a code someone else put in front of them), gets a pairing link from its backend and
  sends the part behind `#` sealed for `pk` (ECDH, HKDF, AES-GCM bound to the id). The relay forwards the box and
  cannot open it; the key is in the QR code only, so a relay cannot swap it for its own. The QR code is drawn in the
  browser for the same reason. Requests live 10 minutes in memory, like pairing tokens.

- The main account's first device with a code from the backend's log (`local/src/first-device.ts`), for a backend
  in a container where nobody has a terminal at hand. While the main account has no device, the relay adds `first` to
  `pair_wait`; the page sends its P-256 key with `pair_first`, the relay passes it to a backend (`first_device`), and
  the backend seals the pairing link with ECDH and the code, stretched with PBKDF2 (210,000 rounds), through HKDF bound
  to the request id. The code is typed on the device and never sent. It is not the relay's setup code, because the
  relay knows that one and could then open the box it asked for with a key of its own; with the backend's code, a
  relay that swaps the key gets a box it would have to brute-force against 80 bits of code and PBKDF2. Only backends
  in a container make a code (`OPENFOLK_CONTAINER=1`), a new one on every start, and one request runs at a time on the
  relay and on the backend, so nobody mints a flood of pairing tokens.

Pairing tokens live only in the relay's memory. A relay restart invalidates open links, which is acceptable for
something valid for 15 minutes and avoids another file to migrate.

**Moving from the embedded relay to one on a server** (`local/src/relay-switch.ts`) happens inside the running
backend: claim, a pairing link at the new relay for the asking device, `RELAY_URL` into the `.env`, then
`config.relay` switches, the relay client reconnects and the embedded relay closes. A restart would not do, because
`npm start` has nothing that starts the backend again. The answer goes out over the embedded relay before it closes,
so the page learns where to go. Accounts live in the relay, so a backend whose embedded relay has further accounts
refuses to move from the app.

## Several machines

The same backend runs on every machine; bots exist once. Configuration (bots, groups, routines, knowledge,
settings, push subscriptions) is synced between backends through the relay as peer data, newest wins per record
(`local/src/sync.ts`). History is per chat and travels when a bot switches machines. Sessions are per machine;
switching moves them with their context (`session-transfer.ts`), from the bot's old folder into its folder on the
new machine.

A bot lives on exactly one machine (`responsibleMachine`), and its folder is a folder on that machine. Until 0.1 a
bot fell back to any machine awake when its own slept; that needed the same folder on every machine, which nobody
could keep true, and turned a sleeping PC into bots failing on the server. Now a bot sleeps with its machine, and
machines share work through git like people do. Only the bot's machine can check its folder, so the web app asks
that machine (`folder_check`, `folder_clone`) before it saves; a backend accepts a bot for another machine only
with its folder unchanged, and checks the folder again before every run. Bots saved before 0.2 have no machine;
the machine that runs them by the old rule claims them once the relay reports who is awake (`claimUnplacedBots`).
`machineOnly` stays in the frames, always true, so apps from the stores before 0.2 do not move bots around. The relay only knows which machines are awake
and when it last saw each one; waking goes through the relay (`WAKE_METHOD`) because a sleeping machine cannot
wake itself.

Code goes through the git server, never through the sync: files would overwrite each other where git merges lines,
and `.env`, `node_modules` and builds would travel along. Backends only fetch and fast-forward on their own
(`fastForward()` in `git.ts`); they never commit or push by themselves, because a push can trigger a deploy webhook
and the user decides what reaches the server. A work-in-progress branch with automatic pushes was rejected for the
same reason. The one gap, work not on the server when a bot moves, is closed like the sessions: on request the
previous machine packs it (patch, new files without credentials, a bundle of the unpushed commits) once the move has
reached it, so a save the new machine refused sends nothing, and sends it end-to-end encrypted as peer data
(`work-transfer.ts`). The new machine applies only what fits without a decision and parks the rest in the repo's
`.git`, where git ignores it and the bot can still reach it.

## Accounts

An account is a person or role sharing the relay and the machines: its own devices, bots, chats and data. `main` is
the relay's owner (its password is `USER_PASSWORD` or the claim, its second factor kept by the relay and set up in the app) and always an
admin; admins create further accounts (`relay/src/accounts.ts`), whose first device comes through a pairing link and
who may set a password of their own later. The relay routes by account and stays dumb otherwise: every browser
belongs to the account of its device key, the frames between relay and backends carry `account` (missing = `main`),
and a frame from a backend reaches only browsers of that account. Machines belong to nobody and serve every account,
one `BotManager` each (`local/src/accounts.ts`); what concerns the machine itself and the VS Code sessions under its
home folder stays with `main` (`MAIN_ONLY` in `agent.ts`), and shutting down after wake routines waits for every account.

Each account signs in to the engines itself, so subscriptions, limits and usage stay apart (`local/src/engine-home.ts`).
`main` keeps the machine's `~/.claude` and `~/.codex`; another account gets `CLAUDE_CONFIG_DIR` and `CODEX_HOME` in its
data folder (`accounts/<id>/engines/`), which every setup keeps and which goes with the account when it is deleted.
Its Claude transcripts, global `CLAUDE.md` and skills live there too, so nothing of the owner's setup carries over.
Copilot, Cursor, Antigravity and OpenCode are not known to keep their login in a folder one can move (a keychain, a fixed
path); an account running on someone else's login without noticing is the failure this design exists to prevent, so
they serve `main` only. For the same reason the keys in a machine's settings are the owner's: other accounts always run on a
subscription login of their own.

Subscription or key is a choice per engine in the machine settings, never something an engine picks up from the environment:
the adapters remove the provider variables a CLI would read (`OPENAI_API_KEY`, `CURSOR_API_KEY`, `GH_TOKEN`,
`GEMINI_API_KEY`, …) and set the stored key only in key mode, so a variable left in a shell never bills an API or
replaces a login. The Codex app-server ignores keys in the environment and replaces the ChatGPT login by a key login in its
`CODEX_HOME`, so in key mode it runs in a folder of its own (`<data>/codex-apikey`) and signs in there on every start;
`~/.codex` keeps the subscription for switching back, and a thread does not survive the switch. OpenCode takes no key.

Only Claude has a third mode, 'both' (`local/src/key-fallback.ts`): the subscription until its rate limit event says
`rejected` (or `allowed_warning`, as set), then the key until the reset time that event named. The event arrives
before the error that ends the turn, so the session restarts that turn on the key with the same session id instead of
failing it; each CLI process keeps the sign-in it started with, and a change of sides reloads the sessions between
turns. While on the key the subscription reports nothing, so the way back is a timer, not an event. Codex is left out
on purpose: its key runs in another `CODEX_HOME`, so every switch would start a new thread; the ACP engines do not
report a limit at all.

No version bump was needed, but old backends are the danger: one without accounts takes every frame and sync for
its own data, so it would merge a stranger's bots into `main` and greet a stranger's browser with `main`'s chats.
A backend that knows accounts signs in with `X-Accounts: 1`; the relay sends any other one the traffic of `main`
only, answers a browser of another account with `machine_outdated`, and treats whatever it sends as `main`. The
backend in turn serves accounts other than `main` only after a hello that lists them, so an older relay never sees
them.

Deleting an account is an order from the relay, which must not be able to destroy what it cannot read: the backend
moves the folder to `deleted-accounts/` instead of removing it, accepts only ids of `a-z0-9-` (they become folder
names), and never deletes `main`. The relay keeps a tombstone, so a machine asleep at the time gets the order on its
next connect, and never gives out a deleted id again, which a backend would take for the old account. All accounts
share the end-to-end key: it keeps chats from whoever hosts the relay, while separating accounts is the relay's
routing and, on the machine, the account folders; the owner of a machine can read every account on it anyway.

In the web app a device keeps its accounts with one device key each (`openfolk-accounts`, `webapp/js/accounts.js`).
Switching sets the stored key and loads the page again rather than swapping state in place: everything the page
holds and what it keeps per chat (seen, panes, collapsed groups, keyed per account in `core.js`) then belongs to one
account without anything to forget. An invitation is built by a backend, because the page cannot export the
end-to-end key; the admin gets the token from the relay and the backend only wraps it, never minting one for another
account. A backend from before accounts ignores the token and answers with a link into `main`, so the page shows an
invitation only if the link carries its token.

The shared chat list shows the other accounts of the device through one lightweight connection each
(`webapp/js/others.js`), signed in with that account's key, so it sees nothing a switch would not show. It asks only
for the list (bots, state, the last entry of each chat) and never sends `presence`, so that account's push stays on.
The trap is the replay guard: a backend numbers all its encrypted frames in one sequence across its clients, and the
frames of two sockets arrive interleaved, so every connection keeps its own sender id, counter and highest counter
seen (`newChannel` in `e2e.js`). With one shared guard either side would drop valid frames as repeated.

The data folder holds the machine's own files at its root (tokens, `e2e-key`, `vapid.json`, the embedded relay) and
everything of an account under `accounts/<id>/`; data from before accounts lives in `main`. The store does not take
the account as a parameter; it reads it from the async context (`inAccount` in `local/src/store.ts`). A
`BotManager` is created and started in its account, so its timers, sessions and child processes stay in it, and the
relay client calls it through `accountHandler`. The trap is a resource shared across accounts: a server or emitter
created once runs its callbacks in the context of whoever created it, so a callback registered there for one
account must be wrapped with `bindAccount` (the ACP tool server in `mcp-http.ts` does). A cache in a module is keyed
by path or account, never by chat or bot id alone, since the same id can exist in two accounts. Without a context the
store uses the only account there is; with several it throws instead of guessing, so a missed path fails loudly
rather than writing into a stranger's account.

## Handing a session to the machine

"Open this chat in the IDE / in a terminal" ends the bot's process for the chat (two processes must never write one
transcript) and runs a command line on the machine (`local/src/handover.ts`). Many backends run where nobody sees a
window: a Windows task or service in session 0, a Linux service. A window opened there is not refused; it opens
invisibly, and the command reports success. So the backend first asks whether it has a
desktop (on Windows the session of its own process) and otherwise leaves the command in `~/.openfolk/handover`, where
the desktop app in the user's session runs it. The folder is fixed because the app cannot read the backend's
settings, and the job carries the finished command line rather than a target, so the app needs no knowledge of IDEs
and the templates stay in one place. The IDE default relies on VS Code routing a `vscode://` URI to its last active
window, which is why it opens the folder with `code` first.

## Versions move at different speeds

The web app is served by the relay and is therefore always as new as the relay; the desktop apps load it from
there. The mobile apps bring their own copy and update through the stores. Backends update when the user pulls
and restarts. Nothing can assume a coordinated release:

- `PROTOCOL_VERSION` in `shared/protocol.ts` (copy in `webapp/js/core.js`, kept equal by a test) is raised only for
  a change the other side cannot ignore. Backends report theirs; the web app says which side needs an update.
- A new optional field or a new frame type is not such a change. Older backends answer an unknown frame type with
  an error naming the request; the web app shows it.
- Backends check incoming frames with Zod and keep unknown extra fields, so a newer client may add optional
  fields. The browser tests run every frame the web app sends through the same check, so the two cannot drift
  apart unnoticed.
- The relay speaks to old backends too: it tolerates the German field names from before the English protocol
  (`relay/src/migrate.ts`, `wake-schedule.ts`) and a backend ignores relay messages it does not know.

See [web-app.md](./web-app.md) for the web app's structure and [push.md](./push.md) for notifications.
