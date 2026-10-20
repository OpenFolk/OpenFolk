# OpenFolk

[![CI](https://github.com/OpenFolk/OpenFolk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OpenFolk/OpenFolk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A messenger-style web app (phone first) for running several AI coding agents on your own computers.
Every **bot** is a colleague with its own picture, name, role, tone and model, and works in a fixed folder,
for example one bot per repository. Bots keep working when the app is closed and notify you by push when they
are done or need an approval.

Bots run on the **Claude Agent SDK** (Claude Code) by default. A bot or a single conversation can also use
**OpenAI Codex** or, through the Agent Client Protocol (ACP), **Cursor**, **GitHub Copilot**,
**Google Antigravity** or **OpenCode**. The UI is available in **English and German**.

Besides the browser (installable as PWA) there are desktop apps for Windows, Linux and macOS (Electron,
`desktop/`) and apps for iOS and Android (Capacitor, `mobile/`), all around the same web app.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.svg">
  <img src="docs/architecture.svg" alt="The three ways to run OpenFolk: relay and backend on your PC, a relay of your own on a server with the backend on your PC, or both on a server. Devices connect through the relay to the backend, which starts the AI engines with their own logins." width="940">
</picture>

The relay never sees model credentials and stores no messages. The backend connects outbound, so nothing has to
be opened on your router. End-to-end encryption is on from the first start, so the relay only sees routing
information. Optionally,
Tailscale restricts the backend connection further (`docs/tailscale.md`).

> **Status:** early open-source release. The backend is developed and tested on **Windows 11** and runs as a
> Linux container (`docs/running.md`). Machine control is configurable (same page, "Machine settings"): waking
> via Wake-on-LAN, a wake service or your own command, shutting down on Windows, macOS and Linux; the automatic
> sign-in is Windows-only. The relay runs anywhere Node 22 or Docker runs.

**Try it in two minutes:** install the desktop app from the [releases](https://github.com/OpenFolk/OpenFolk/releases)
(Windows, macOS, Linux) and choose "Start on this computer", or from source with Node 22:

```sh
git clone https://github.com/OpenFolk/OpenFolk.git openfolk && cd openfolk && npm install && npm start
```

The app opens in the browser, walks you through signing in to Claude Code and creating the first bot, and pairs your
phone with a QR code. Everything else is in [Getting started](#getting-started).

## Features

- **Bots and templates.** Create a bot with "+", optionally from a template. Per bot: folder, model (default,
  Opus, Sonnet, Haiku, Codex, Cursor, Copilot, Antigravity, OpenCode or a custom id), approval level and tone.
  "Suggest" proposes names (a first name with a field of work, kept in a field of its own), a role or a profile
  picture from the folder's README/CLAUDE.md; with
  a Gemini or OpenAI key in the settings the avatar is a generated photo, otherwise an SVG drawn by the model.
- **Approvals in the chat.** Per bot: *risky* (default) asks before deleting, pushing, deploying, SSH, service
  restarts, writing outside the folder or into secrets, reading secrets through the shell, installing packages,
  running code from the internet (`curl … | sh`), elevated rights and writing actions of external MCP services; it
  checks every part of a shell command (`a && b | c`) on its own. It is a careful filter, not a fence: whoever wants
  every command confirmed uses *write*, which asks before every change; *never* never asks. Reading tools never get
  `.env` files or keys, whatever the level. The card offers allow, always allow (for the session)
  and deny with a reason; unanswered requests are denied after 30 minutes. Rules: `local/src/policy.ts`.
- **Questions.** Multiple-choice questions of a bot (AskUserQuestion) appear as a card with buttons and free text.
- **Push notifications.** Per kind (bot done, routine done, approval/question, machine awake, usage limit) off,
  quiet, normal or high, for all devices. Single bots and groups can be muted in the push settings. Sent directly from your machine:
  Web Push/VAPID to browsers (on iPhone only from the installed PWA), APNs and FCM to the mobile apps
  (`mobile/README.md`).
- **Activity.** Tool calls as expandable rows with result and duration; the list shows what a bot is working on.
- **Usage.** Five-hour and weekly window of the subscription; Codex limits are shown separately.
- **Routines.** Scheduled prompts (daily, weekdays, weekly, hourly or cron) with "run now". A routine can wake
  its machine (`docs/running.md`, "Machine settings") and shut it down afterwards.
- **Group chats.** Several bots in one chat; `@id` addresses one bot, `@all` everyone. Bots can hand over to
  each other with @ (up to four hops per message).
- **Bot to bot.** Every bot has the tools `message_bot` and `list_bots`, can give other bots jobs and wait
  for the answer; cycles are detected. Which bots a bot can reach is set in its settings under "Can give jobs to"
  (all, selected or none); group chats are not limited by it.
- **Files.** Attach, paste or drop files; images and PDFs go straight to the model. Bots send files with
  `send_file`. Secrets (`.env`, keys) and the backend's data are never handed out.
- **Knowledge.** Bots build a memory of single facts with `remember_fact` and related tools, scoped to the bot,
  its folder, a group or everyone. Only an index goes into the system prompt; the bot reads the full text on demand.
  With `search_history` and `read_history` bots also search the earlier messages of all chats on their machine
  (never the tools' output), so "what did we decide about the deploy?" gets answered from the conversation where
  it was decided. Other knowledge (wiki, Notion, Confluence) comes in through the MCP servers you connect.
- **Voice messages.** Recorded in the browser, transcribed locally with faster-whisper on the machine that runs
  the bot (`local/tools/transcribe.py`; model and language in the settings). This is the only part in Python and optional:
  with Python 3.9 or newer on the machine, "Set up voice messages" in its settings installs the rest
  (`local/tools/requirements-voice.txt`, also by hand). The first voice message downloads the model, about
  1.6 GB for the default `large-v3-turbo` (without a graphics card `small`, about 0.5 GB).
- **Read state, favorites, pinned messages** are synced across all devices and machines.
- **Columns on wide screens.** Ctrl-click (or the middle button) opens a chat in a column of its own next to the
  others, as many as fit (one per 640 px); "+" at the right edge adds an empty one. With the mouse a chat can also
  be dragged from the list onto a column or onto "+". Every column has its own input,
  queue and search. The bot info docks as a column of its own. Phones and laptops keep one chat.
- **Open changes.** Uncommitted files and unpushed or unpulled commits of the git repos in a bot's folder, with
  commit-and-push or pull per repo. The backend also reports when it runs outdated code and offers a gentle restart.
- **Repos stay current.** On start, after waking, every quarter hour and when another machine pushes from the app,
  the backend fetches the repos of its bots and fast-forwards those without local changes or commits of their own.
  It never merges, rebases or resets, and leaves a repo alone while a bot works in it; what it cannot take over shows
  in "Open changes" with the reason. A switch in the settings turns it off.
- **VS Code and terminal.** Lists sessions you ran in VS Code or with `claude` in the terminal in the bot's
  folder, follows them live and branches them into a conversation. The other way round, "Open this chat in the IDE"
  and "… in a terminal" above that list hand a chat's session to its machine: by default VS Code with Claude Code for
  VS Code, or a terminal with `claude --resume`; `HANDOVER_IDE` and `HANDOVER_TERMINAL` set other commands, the
  settings of the machine turn either off. A backend
  without a desktop (a Windows task in session 0, a Linux service) cannot open windows; the desktop app, running in the
  signed-in session of that machine, opens them for it.
- **Several machines.** The same backend runs on every machine; bots exist once. Every bot lives on one machine
  and works in a folder there; while that machine sleeps, the bot sleeps and the app offers to wake it. Moving a bot
  to another machine takes its sessions along with full context, and the bot editor clones the project's repository
  there if it is not there yet. Work that is not on the git server yet (uncommitted changes, new files, unpushed
  commits) goes along on request, end-to-end encrypted through the relay, without a push; the new machine applies
  what fits cleanly and parks the rest in the repo's `.git/openfolk-work/`.
- **Settings.** Language, theme, notifications, devices and security. Shared by all machines: the image model and
  API keys for profile pictures, the language of voice messages, what app notifications show, keeping the repos
  current. Per machine (main account only): the AI providers that run there, each on its subscription or a key,
  shutting down with its countdown and
  what happens after wake routines, automatic sign-in, "Open in the IDE / in a terminal", the speech model. A browser
  only learns whether a key is stored; keys travel to the other machines only end-to-end encrypted. What runs
  commands or draws a security line (scripts, commands, allowed folders) stays in the `.env`.

## Layout

```
openfolk/
├── shared/protocol.ts   frames web app ↔ relay ↔ backend, PROTOCOL_VERSION
├── local/               backend on your machine (Node 22 runs the TypeScript itself)
│   ├── src/agent.ts     bot management: frames, groups, approvals, routines, push
│   ├── src/bot-tools.ts the bots' own tools: other bots, files, knowledge, history
│   ├── src/frames.ts    checks every frame of a web app or app before the backend acts on it
│   ├── src/push*.ts     Web Push, APNs (iOS) and FCM (Android)
│   ├── src/session.ts   one session per bot: queue, approval hook, tool results
│   ├── src/codex.ts     OpenAI Codex engine; src/acp.ts ACP engines (Cursor, Copilot, Antigravity, OpenCode)
│   ├── src/i18n.ts      backend texts in English and German
│   ├── src/migrate.ts   upgrades stored data on start
│   ├── tools/           commands for users: pairing, claim, engine sign-in, voice, the Windows task
│   └── data/            not versioned: bots, groups, routines, history, knowledge, uploads, keys
├── relay/               relay server and Dockerfile (compiled with tsc for the image)
├── webapp/              UI without build step (ES modules in js/, i18n/*.js, chat.css, PWA)
├── desktop/             desktop app (Electron) for Windows, Linux and macOS around the web app
├── mobile/              iOS and Android apps (Capacitor) with the web app inside
├── deploy/unraid/       Unraid template for the relay
├── tests/browser/       Playwright tests of the web app against a scripted relay and backend
├── scripts/             test runner, desktop bundle and smoke test, screenshots, a WebSocket test client
├── docs/                running.md, tailscale.md, README.de.md, architecture.svg, internals/ (architecture decisions)
└── AGENTS.md            read first when changing OpenFolk
```

The web app consists of ES modules in `webapp/js/` without a build step. `js/main.js` loads them all; `start.js`
(wiring events, start) runs last because no other module may import it, and code that runs at load time belongs
there only (`docs/internals/web-app.md`). Everything that
differs between browser, desktop and mobile apps (relay address, push, key storage, saving files, icon badge)
goes through `js/platform.js`. The modules are plain JavaScript with JSDoc types, checked by `npm run typecheck`
(`webapp/tsconfig.json`). UI texts live in `webapp/i18n/en.js` and `webapp/i18n/de.js` (same keys).

App, web app and backends update at different times, the mobile apps through the stores. `PROTOCOL_VERSION`
in `shared/protocol.ts` (with a copy in `webapp/js/core.js`) is raised with every change the other side cannot
ignore; the web app compares it with what the backends report and says which side needs an update. Backends
check incoming frames with Zod (`local/src/frames.ts`) and answer malformed ones with an error.

## Requirements

- Node 22.18 or newer and npm (not for the desktop apps, which bring their own).
- Claude Code CLI signed in with your subscription (run `claude` once), or an Anthropic API key in the settings of
  the machine. Please respect Anthropic's terms for subscription use; for automated or shared use the
  API key mode is the safe choice.
- Every provider signs in either with its subscription or with a key stored in the machine's settings under "AI
  providers": an OpenAI API key for Codex, a Cursor API key, a GitHub token with Copilot access, a Gemini API key for
  Antigravity. Keys from the environment (`OPENAI_API_KEY`, `GH_TOKEN`, `GEMINI_API_KEY`, …) are never passed to
  an engine. With its key Codex keeps a folder of its own in the data folder, so the ChatGPT login stays for
  switching back; Codex chats started before a switch begin a new thread. Providers switched off there are not
  started on that machine; a new installation starts with all of them off until you pick yours in the first steps.
- Claude can also run on both: "Subscription and API key, by rules" uses the subscription until it reports its limit
  (or already Anthropic's warning before it), then the API key until the limit resets, at most up to a daily cap in
  US dollars. The turn the limit stopped runs again on the key. The other engines do not report their limit before a
  turn fails (Codex would also lose the thread on every switch), so they choose one of the two.
- Optional: Codex (`npx codex login`, ChatGPT subscription), Cursor CLI (`agent login`), Copilot
  (`npx copilot login`), Antigravity (`node local/tools/acp-install.mjs antigravity-acp`), OpenCode (free models
  without login, the providers may train on the data; other providers via `npx opencode auth login`; API keys in the
  environment are never passed to it). An engine appears in the model list once its login is present; restart the
  backend afterwards. The Codex, Copilot and OpenCode CLIs come as optional npm dependencies (about 750 MB); `npm install --omit=optional` leaves them out for Claude-only use.
- Optional: a host for the relay with HTTPS (any Docker host, e.g. Coolify, Fly, a VPS behind a reverse proxy),
  for your phone from anywhere and for several machines. Without one the relay runs inside the backend.
- Optional for transcribing voice messages: Python 3.9 or newer; the app's settings set up the rest.
- Optional for the mobile apps: Android Studio and/or Xcode, see `mobile/README.md`.

## Getting started

The desktop apps for Windows, Linux (AppImage, .deb) and macOS bring the backend along: choose "Start on this computer" on
their first start, sign in to Claude Code when the app asks, and that is all (`desktop/README.md`). They come from
the [releases](https://github.com/OpenFolk/OpenFolk/releases) and update themselves from there. From source:

```sh
git clone https://github.com/OpenFolk/OpenFolk.git openfolk
cd openfolk
npm install
npm start
```

That is the whole setup on one computer. Without a `.env` the backend runs the relay inside its own process on
`http://127.0.0.1:8787`, generates every key on its first start (`local/data/`) and opens the web app in the browser
with a pairing link, which signs the browser in and hands it the end-to-end key. The app then walks you through the
first steps: whether a backend is connected, which AI providers it runs (a new installation starts with none, you
tick your own) and whether it is signed in to one (Claude Code in a terminal the app opens on that computer, or
with an Anthropic API key typed into the step; Codex and Copilot with a device code that you enter on any device),
the first bot and the pairing of your phone. Each step ticks itself off.
`?chat=<id>` opens a chat directly. The UI follows the device's language: German on German devices, English
everywhere else; change it in the settings.

```sh
npm run pair                               # pairing link and QR code for one more browser or phone (15 minutes, once)
node local/tools/e2e.mjs password          # the web app's password, only needed without a pairing link
npm run cli -- --new /path/to/project "Helper"   # create a bot in the terminal
npm run cli -- helper                            # chat in the terminal; /new, /stop, /exit
```

The pairing link carries the end-to-end key, so the backend shows it only in an interactive terminal, never in a
log file; started as a service or container it prints how to get one instead.

### Which setup fits

| You want | Setup | Section |
| --- | --- | --- |
| to try it, or work at this computer only | the desktop app ("Start on this computer") or `npm start` | above |
| your phone from anywhere, push, waking sleeping machines | a relay of your own on a server, the backend on your PC | `docs/running.md` |
| bots that run while your PCs are off | relay and backend together on a server (`docker-compose.server.yml`) | `docs/running.md` |

Every setup keeps the same rule: the relay only passes encrypted frames through. Sessions, history and the logins
of the AI providers stay on the machines that run the backend.

## Running it permanently

For your phone from anywhere, push and machines that wake for their routines, run a relay of your own on a server
(`ghcr.io/openfolk/openfolk`, Docker Compose, Coolify, Unraid) and claim it with the setup code from its log: in the
app (first steps, or settings → "Devices and security" → "Move to a relay on a server"), where the backend moves over
and the page follows it, signed in there; or in the terminal with `npm run claim`. The desktop app joins a computer to
that relay with the link from "Add machine" ("Connect this computer to my server") and, on Windows, runs its backend
without signing in ("Run without signing in" in the tray menu). Backends from a checkout start with their machine (a
scheduled task on Windows) or run as a container that never sleeps (`ghcr.io/openfolk/openfolk-local`);
`docker-compose.server.yml` puts relay and backend on one server, and its first device signs in with the code the
backend prints to its log. Waking (Wake-on-LAN, your own command, a wake service) is set on the relay, shutting down
and restarting on each backend.

All of it, step by step: [docs/running.md](docs/running.md).

## Accounts

One relay and its machines can serve several people or roles: you at work and at home, a colleague, one account
per customer. Each account has its own bots, chats, knowledge, devices and its own sign-ins to Claude and Codex, so
subscriptions, limits and usage stay apart, and it sees nothing of the others. Whoever set up the relay owns the
main account; nothing changes until a second one exists.

- **Creating:** settings → Accounts → "Create and invite". The invitation is a pairing link with a QR code, valid for
  15 minutes; whoever opens it is signed in to the new account. "New invitation" makes another one. An account may
  set a password of its own afterwards and then sign in with its name and that password. Admins may manage
  accounts; the main account always is one.
- **Switching:** a device can be signed in to several accounts. The name next to the title in the sidebar switches
  between them, "Sign in to another account" adds one, and an invitation link opened on a signed-in device adds its
  account too.
- **One list:** the chat list shows the bots of every account the device is signed in to, those of the other
  accounts with the account's name as a badge, with what they do, their last message and what is new. A tap opens
  the chat in its account; notifications of every account arrive. Settings → "Show the bots of all accounts on this
  device in the list" turns it off for this device.
- **AI sign-ins per account:** the main account uses the machine's own `~/.claude` and `~/.codex`. Any other account
  signs in once per machine into its own folder: Codex with a code from the setup checklist, Claude with the command
  the checklist shows (`CLAUDE_CONFIG_DIR=… claude`). Copilot, Cursor, Antigravity and OpenCode serve the main account only, as
  they cannot keep a second sign-in apart, and a machine's API key is the main account's key only.
- **What stays with the owner:** the settings of a machine, shutting machines down or restarting them, automatic sign-in and the VS Code
  sessions belong to the main account. Bots of every account work in the folders under `ALLOWED_ROOTS` of the
  machine they live on.
- **Deleting:** an admin deletes an account in the same list. Its devices are signed out at once; on every machine
  its data goes to `local/data/deleted-accounts/`, so a mistake can be undone there.

## Security

What the host of the relay can and cannot do, with end-to-end encryption on (the default):

| The relay host can | The relay host cannot |
| --- | --- |
| see which devices and machines are connected, when, from which IP address | read chats, files, history or knowledge |
| see the size and timing of encrypted frames | send a frame of its own to a backend, or deliver a recorded one again |
| refuse to pass frames on, or serve manipulated JavaScript to browsers (not to the mobile apps) | use your model subscriptions or API keys, which never leave your machines |
| see the preview of app notifications it delivers for backends without Apple or Google credentials | sign in a new device without the password, a pairing link or, if set, the TOTP code |

- **Transport and relay:** HTTPS/WSS. The relay stores no messages and serves the UI with a strict Content
  Security Policy, `X-Frame-Options`, `nosniff`, `no-referrer` and HSTS.
- **Sign-in per device:** the password (`USER_PASSWORD`) is entered once per device; afterwards the device uses its
  own key, the relay keeps only a hash. Devices can be logged out individually; every new sign-in triggers a push.
  Optional TOTP. Failed attempts are rate limited.
- **Pairing links:** a signed-in device creates a link for the next one (settings, "Devices and security", "Pair another device";
  or `npm run pair` in the terminal). It signs the device in once without the password, works for
  15 minutes and carries the end-to-end key behind `#`, which browsers never send to a server. Open it on the new
  device or scan the QR code: "Scan QR code" on the sign-in page reads it with the camera (the mobile app's native
  scanner, the browser and the desktop app through the camera of the device); the mobile app also takes it pasted
  into the address field.
- **QR sign-in the other way round:** the sign-in page of a device that is not signed in shows a QR code of its own.
  A signed-in device scans it (camera app, or settings → "Devices and security" → "Scan QR code"), shows the new
  device's name and address for confirmation and then hands it a pairing link sealed for a key that only travels in
  the QR code. Handy for laptops and desktops without a usable camera.
- **Backends:** `AGENT_TOKEN` plus machine name; a second connection under a name that is connected and responding
  is rejected and reported.
- **End-to-end encryption:** all frames between browser and backend and the sync between backends are encrypted
  with AES-256-GCM. Without `E2E_KEY` the backend generates the key on its first start (`local/data/e2e-key`);
  every further machine needs the same value as `E2E_KEY` ("Add machine" in the settings hands it over with the
  invitation), and each device gets it through a pairing link
  (`npm run pair`, link and QR code). Every frame carries a counter and its sending time, so a
  relay that records frames cannot deliver them a second time; with the key on a device, the app ignores unencrypted
  frames apart from the relay's own. `E2E_KEY=off` switches the encryption off, then the relay host can read every
  chat. Limitation: whoever controls the relay could serve manipulated JavaScript; the mobile apps bring the web app
  along and are not affected by that. They keep the key in the iOS Keychain or the Android Keystore.
- **Files:** the app downloads files only from the bots' folders and the uploads, never secrets (`.env`, keys), the
  backend's data or the dot folders under your home folder (the CLIs' logins). A bot's folder is checked against
  `ALLOWED_ROOTS` of the machine that runs it, before every job; links and junctions are resolved first.
- **Bot text** is rendered as Markdown and sanitized: no scripts, no styles, no classes, no `data-` attributes, so
  a bot cannot draw its text as one of your messages or as a button of the app.
- **Push to the mobile apps** is not end-to-end encrypted: Apple and Google see what a notification contains.
  The setting "App notifications show" limits it to the title (default; it names the bot, the group or the machine) or
  nothing but "OpenFolk". A relay with Apple and Google
  credentials delivers for backends that have none; it then sees that preview too and nothing else. That is the
  only case in which the relay sees any content (`docs/internals/push.md`).
- Report vulnerabilities privately, not in public issues.

## Development

```powershell
npm run typecheck     # tsc for local, relay and the web app (JSDoc, checkJs)
npm run lint          # oxlint over backend, relay, web app and tests
npm test              # backend, relay and browser tests (Playwright, no model calls)
npm run check         # all three in a row, what CI runs
npm run test:browser  # browser tests only; single file: node tests/browser/run.mjs <name>
npm test -w local -- push   # backend tests whose file name contains "push" (scripts/test.mjs)
npm run mobile        # copy the web app into the mobile apps (mobile/README.md)
```

No build step in development: Node 22.18 or newer runs the TypeScript itself (the code keeps to erasable syntax,
`erasableSyntaxOnly`), the web app is plain ES modules; the relay serves
`marked` and `DOMPurify` from `node_modules` under `/vendor/`. The browser tests also run every frame the web app
sends through the backend's check (`local/src/frames.ts`), so web app and backend cannot drift apart unnoticed.
Code, comments and commit messages are English; user-facing texts go into the i18n dictionaries in both languages.

`AGENTS.md` is the entry point for anyone (or any agent) changing OpenFolk: glossary, the rules that do not bend,
the surfaces every change has to cover. `docs/internals/` explains the decisions behind the architecture, the web
app and push.

## License

Copyright (C) 2026 Flowdesk GmbH.

OpenFolk is released under the [MIT License](LICENSE). You may use, copy, change and distribute it, also in closed
products and hosted services, as long as the copyright notice and the license text stay with it. It comes without
any warranty.

**Contributions** are licensed under the same MIT License; no separate agreement is needed. See
[CONTRIBUTING.md](CONTRIBUTING.md).
