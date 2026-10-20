# Changelog

All notable changes to OpenFolk are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/) once it leaves 0.x.

## [Unreleased]

### Security
- The relay keeps passwords (`USER_PASSWORD`, the claimed password, the passwords of further accounts) as salted
  scrypt hashes instead of SHA-256. Existing hashes keep working and are replaced on the next sign-in with the password.

## [0.1.1] - 2026-10-20

### Fixed
- macOS: the desktop app is signed and notarized; 0.1.0 shipped without a Mac package. electron-builder 26.17.0
  unlocks its temporary keychain with the right password, and the licence moved into the app's resources.
- A machine whose host name is longer than 32 characters (common on Macs) was refused by the relay and never
  connected; the name is cut to fit.
- Windows: a bot whose folder lies behind a short (8.3) name, a junction or a link was not recognised as working
  inside its repo, so pulling all repos could pull under it.
- The settings of a machine closed again when a message from the backend arrived right after opening them.

## [0.1.0] - 2026-10-20

First public release. The backend is developed and tested on Windows 11; the relay runs wherever Node 22 or
Docker runs.

### Added
- Messenger-style web app (phone first, installable as PWA) for bots, each with picture, name, role, tone, model,
  approval level and one working folder on one machine. English and German.
- Engines: Claude Code (Claude Agent SDK) by default, OpenAI Codex, and Cursor, GitHub Copilot, Google Antigravity
  and OpenCode through the Agent Client Protocol. "AI providers" in the settings of a machine switch each engine on
  or off and choose subscription or API key. Claude can run on "subscription and API key, by rules": when the
  subscription reports its limit the sessions go on with the key until it resets, up to a daily cap in US dollars.
- The first steps include the sign-in to an AI provider: each machine reports which engines are ready, the web app
  shows the command for Claude Code and starts the device-code sign-in of Codex and Copilot, so a backend in a
  container needs no terminal for them.
- Approvals and multiple-choice questions as cards in the chat, push notifications to browsers (Web Push) and the
  apps (APNs, FCM), usage of the subscription windows.
- Group chats, bot-to-bot jobs with `message_bot` (per bot: "Can give jobs to" all bots, selected bots or none),
  routines with optional wake-up and shutdown of the machine, knowledge scoped to a bot, folder, group or everyone,
  files in both directions, voice messages transcribed on the machine ("Set up voice messages" installs
  faster-whisper).
- Bots search the history of all chats on their machine with `search_history` and read a hit in context with
  `read_history`; the web app's search finds entries with all words of a query.
- The bot editor has a folder and a repository field; each fills the other, and saving clones the repository into
  the folder. A bot moved to another machine takes its sessions along. "Open changes" warns when a machine has no
  credentials to push to one of its bots' repositories.
- Several chats side by side on wide screens, each in a column of its own; the settings open as a pane next to them.
- "Open this chat in the IDE" and "… in a terminal" on the machine (by default VS Code with Claude Code for VS Code
  and `claude --resume`).
- `npm start` without any `.env`: the backend runs the relay inside its own process on 127.0.0.1, generates every
  key on its first start and opens the web app with a pairing link. `npm run pair` makes a link for one more device,
  `npm run env` writes the generated values into the `.env` for further machines.
- A relay of one's own: started without tokens it waits for its owner and prints a setup code to its log;
  `npm run claim` (or `RELAY_SETUP_CODE` in the backend's environment) claims it. Prebuilt image
  `ghcr.io/openfolk/openfolk` for amd64 and arm64, and a template for Unraid (`deploy/unraid/openfolk-relay.xml`).
- The backend as a Linux container: the image `ghcr.io/openfolk/openfolk-local` with `docker-compose.local.yml`,
  and `docker-compose.server.yml` for relay and backend on one server, claimed automatically. The bots' folders
  live in a folder of the host (`WORK_DIR`), so they can be opened over SSH or with VS Code Remote.
- Further machines join by invitation: "Add machine" in the settings, then `npm run join -- "<link>"`; each gets an
  agent token of its own, and "Log out" disconnects it again.
- Desktop apps for Windows, macOS and Linux (AppImage, .deb) that run the bots "on this computer" or connect to a
  relay, and update themselves from the GitHub releases after the bots have finished. Apps for iOS and Android
  (Capacitor) around the same web app.
- Sign-in by QR code: a signed-in device scans the code on the sign-in page of a new one; the mobile apps, the
  browser and the desktop app scan with the device's camera.
- Releases carry the desktop packages, their update feeds and a `SHA256SUMS`, built and smoke-tested by CI on each
  system.
- `npm install --omit=optional` leaves out Codex and Copilot (about 600 MB).
- `PROTOCOL_VERSION`: web app and backends report what they speak and say which side needs an update.
- The sign-in step of the first steps opens a terminal with Claude Code on the machine (the desktop apps bring Claude
  Code without a `claude` on the PATH) and takes an Anthropic API key instead of a subscription.
- Moving to a relay on a server from the app: the first steps and the settings claim it with the setup code from its
  log; the backend moves over without a restart and the page follows, signed in there.
- Desktop app: "Connect this computer to my server" on the setup page joins the computer with the link from "Add
  machine"; on Windows, "Run without signing in" runs its backend from system start through a scheduled task.
- A backend in a container prints a code for the main account's first device to its log; the sign-in page takes it
  ("Code from the server log") while there is no device, so the first device needs no `docker exec`.

### Changed
- A new installation starts with no AI provider switched on: the first steps ask which ones you use, and only those
  start. Existing machines keep all of them. A machine may now have every provider switched off.
- Notifications, devices and security, and accounts are blocks of the settings page instead of pages of their own.
- Reaching the phone through Tailscale Serve without a server is no longer offered; the phone needs a relay on a
  server. Tailscale still keeps the backend's connection to such a relay off the internet (`docs/tailscale.md`).

### Security
- The relay stores no messages and holds no model credentials. End-to-end encryption between devices and backends
  is on by default (the key is generated on the first start, `E2E_KEY=off` switches it off); every encrypted frame
  carries a counter and its sending time, and frames delivered twice or more than ten minutes off are dropped. With
  the key on a device, the web app ignores unencrypted frames from backends.
- The relay keeps the password and the agent token only as SHA-256 hashes, at least 16 characters when claimed.
  Pairing links, TOTP as second factor (set up in the app, each code accepted once), device keys that expire after
  90 days unused, optional Tailscale restriction. The pairing link with the end-to-end key goes to an interactive
  terminal only, never into a log file.
- Relay limits: 16 KB before sign-in, ten unsigned connections per address, a client that stops reading is dropped
  once 96 MB wait for it. `/ws/client` refuses foreign web pages (Origin). `X-Forwarded-For` counts only from a proxy
  at a private or loopback address unless `TRUST_PROXY` says otherwise.
- Files go to the app only from the bots' folders and the uploads, never from the dot folders under home; links and
  junctions are resolved before every check, and a bot's folder is checked against the machine's `ALLOWED_ROOTS`
  before every job.
- Reading tools are refused for `.env` files, keys and credentials in every approval level; templates such as
  `.env.sample` stay readable. In "risky", a shell command is split into the commands it runs, and each one asks
  when it writes outside the bot folder, reads a secret, runs code from the internet, installs packages or runs with
  elevated rights. ACP calls of unknown kind ask instead of passing.
- Peer data between backends is checked against a schema before use; bot text is sanitized without classes, ids,
  styles and `data-` attributes; only the desktop app's bundled setup page can change its relay address; the mobile
  apps refuse a plain `http://` relay address.
- Files in the backend's data folder are written with mode 0600 (Linux and macOS). Recursive deletes go through
  `removeTree`, because `fs.rmSync` on Windows under Node 24 follows directory junctions.

[Unreleased]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/OpenFolk/OpenFolk/releases/tag/v0.1.0
