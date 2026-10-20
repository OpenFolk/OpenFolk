# OpenFolk

OpenFolk is a messenger for the coding agents on your own machines. A Node backend on each machine wraps the
agent runtimes (Claude Code, Codex, Cursor, Copilot, Antigravity) and talks through a small relay to the web app,
the desktop apps and the mobile apps. This file is for agents and people changing OpenFolk; it is the first thing to
read, before any code. `README.md` is for people who run OpenFolk.

## What we do not compromise on

1. **The relay stays dumb.** It stores no messages, holds no model credentials and, with end-to-end encryption,
   sees only routing. Whoever hosts the relay must never be able to read a chat. The one exception is push to the
   mobile apps for backends without their own Apple and Google credentials; then the relay sees exactly what Apple
   and Google see, reduced by the user's setting `pushPreview`. Do not add a second exception without a reason this strong.
2. **Everything else happens on the user's machine.** Sessions, history, knowledge, uploads, git and approvals
   belong to the backend. A client never substitutes its own view of files or state for the backend's.
3. **One web app, every surface.** Browser (PWA), Windows, Linux and macOS (Electron) and iOS and Android (Capacitor) run
   the same `webapp/`. Platform differences go through `webapp/js/platform.js`, not into feature code.
4. **No build step for development.** Node runs the TypeScript itself (type stripping, Node 22.18 or newer; the
   code keeps to erasable syntax), the web app is plain ES modules with JSDoc types.
   Keep it that way; a contributor should be productive after `npm install`.
5. **English code, two languages for people.** Code, comments, commit messages and these docs are English.
   Everything a user reads lives in the i18n dictionaries in English and German, with the same keys.

## Glossary

- **user**: the person who runs OpenFolk and talks to the bots.
- **bot**: a configured colleague: name, picture, role, tone, model, approval level, one working folder.
- **chat**: a bot's main chat, a further conversation with a bot, or a group chat. A chat id names it.
- **session**: the agent runtime's conversation behind a chat; one per chat, resumed by id.
- **engine**: the runtime a session runs on (`claude`, `codex`, `cursor`, `copilot`, `antigravity`).
- **machine**: a computer running a backend; bots exist once, each lives on one machine and works in a folder there.
- **backend**: `local/`, the process on a machine. **relay**: `relay/`, the server in between. **web app**:
  `webapp/`. **apps**: `desktop/`, `mobile/`.
- **frame**: one JSON message of the protocol in `shared/protocol.ts`.
- **approval**: a bot's request to do something risky; the user allows or denies it in the chat.
- **routine**: a scheduled prompt for a bot.
- **knowledge**: facts bots remember, scoped to a bot, a folder, a group or everyone.

## Ways to hurt the person you work for

- **Their backend may be the one running you.** A session of OpenFolk often changes OpenFolk. Never kill node
  processes by name or pattern, never delete `local/data/`, and never start a second backend against the same data
  folder. Restart with `npm run restart -w local -- <reason>`, which waits until no bot is working.
- **Secrets stay out of the chat.** `.env`, keys and `local/data/` are never read into a conversation or handed
  out by a tool. `.env.sample` (backend) and `relay/.env.sample` (relay) show the variables and may be read.
- **The relay is deployed from `main`.** A push to `main` can reach the production relay. Do not push broken
  protocol changes; run the tests first.
- **Deleting a folder can delete more.** On Windows under Node 24 (the desktop app's Node) `fs.rmSync` with
  `recursive` follows directory junctions and empties their target. Delete folders with `removeTree`
  (`local/src/remove-tree.ts`), and never link `node_modules` or a user's folder into a test folder.

## Hit every surface

The most common defect is a change that works where you tested it and is missing elsewhere. Before calling a
change done, walk this list and say which entries applied:

- **Clients.** Browser, desktop (loads the web app from the relay, or runs the backend itself "on this computer")
  and mobile (brings the web app along, needs the relay address, has native push and a Keychain). Anything
  platform-specific belongs in `webapp/js/platform.js`.
- **Setups.** The relay inside the backend (no `RELAY_URL`, also the desktop app), a relay of one's own (claimed or
  with tokens), relay and backend in containers. Does your change need a value the user has to set, and does each
  setup get it?
- **Engines.** Claude, Codex and the ACP engines each have their own adapter (`session.ts`, `codex.ts`, `acp.ts`).
  An engine-shaped feature needs a decision per adapter, even if it is "not supported here".
- **Machines.** Bots move between machines with their sessions; state is synced between backends (`sync.ts`).
  Does your change survive a bot switching machines, or two backends being awake?
- **Protocol.** Everything crossing the wire is typed in `shared/protocol.ts` and checked in
  `local/src/frames.ts`. A new required field or a changed meaning raises `PROTOCOL_VERSION`; a new optional field
  or frame type does not. Web app and backends are updated at different times, the apps through the stores.
- **Reverse states.** If you add a way in, add the way out and the way to see it. Mute needs unmute, archive needs
  unarchive, a pairing link needs a way to sign the device out again.
- **Both languages.** Every new text in `webapp/i18n/en.js` and `de.js` (and `local/src/i18n.ts` for backend
  texts). The browser tests fail on a missing key.
- **Docs.** Does the change make `README.md`, `docs/README.de.md`, `docs/running.md`, `mobile/README.md` or a page
  in `docs/internals/` wrong? Fix it in the same change.

## Where code lives

- `shared/protocol.ts`: the frames between web app, relay and backends; `shared/push-native.ts`: APNs and FCM.
- `local/src/agent.ts`: bot management, frames, groups, approvals, routines, push. `bot-tools.ts`: the bots' own
  tools (list_bots, message_bot, send_file, knowledge, history) for every engine.
  `session.ts`: one Claude session per chat. `codex.ts`, `acp.ts`: the other engines. `frames.ts`: the check
  of incoming frames. `push.ts`: delivery to browsers and apps. `relay-client.ts`: the connection to the relay.
  `tokens.ts`: the tokens generated on the first start. `relay-switch.ts`: claiming a relay on a server from the app
  and moving over. `first-device.ts`: the first device with the code from a container's log. `engine-login.ts`: the
  device-code sign-in of the first steps; which engines are ready comes from `queryModels` in `session.ts`. `history-index.ts`: the search over the
  history (web app and the bots' `search_history`), `history-tools.ts`: what the bots' history tools answer.
- `relay/src/relay.ts`: `startRelay()`, HTTP, WebSocket upgrade, sign-in, pairing, claim; `server.ts` runs it on its
  own, `local/src/index.ts` inside the backend. `owner.ts`: the relay's tokens as hashes, the setup code.
  `bridge.ts`: routing between browsers and backends. `devices.ts`: device keys, pairing tokens, TOTP.
- `desktop/`: the desktop app for Windows, Linux and macOS, one `main.js` with the Mac's menu bar and Dock behind
  `MAC`; `backend.js` runs the backend for "on this computer", `task.js` and `task.ps1` the scheduled task of "Run
  without signing in".
- `webapp/js/`: ES modules without a build; load-time code only in `start.js`, which runs last because nothing
  imports it (`docs/internals/web-app.md`). `platform.js`: browser, desktop and mobile differences. `connection.js`:
  the frames from the relay. `core.js`: DOM elements, state, Markdown.
- `tests/browser/`: Playwright tests of the real web app with a scripted relay and backend (`harness.mjs`). The
  runner also checks every frame the web app sends against `local/src/frames.ts`.
- `mobile/`: Capacitor project, `mobile/plugin/`: OpenFolk's own native code (Keychain, Keystore, badge).

## Verifying

- The smallest proof that the change works: the test file you touched, the type check of the part you changed.
  `npm run typecheck` covers backend, relay and web app; `npm run lint` is oxlint.
- Backend tests are plain scripts (`node local/src/<name>.test.ts`), each prints `ok` or `FAILED` per check;
  `npm test -w local` runs them all (`scripts/test.mjs`, no registration of new files needed).
  Browser tests: `node tests/browser/run.mjs <name>`. The full `npm test` takes about four minutes.
- Test observable behavior: what a frame contains, what the page shows, what ends up in a file. Do not mirror the
  implementation.
- Nothing is done until the check that proves it has run and its output has been read. "Should work" is not a
  result.

## Taste

- The smallest model that makes the correct behavior unsurprising. Do not keep complexity because it exists, do
  not add machinery because it looks like architecture.
- Comments say what the code cannot: a constraint, a reason, a trap. Not what the next line does.
- Code reads like the code around it: same naming, same comment density, same idioms.
- The user drives bots all day on a phone and notices a dropped frame and a stale label. No animation that
  repaints continuously while nothing happens; the existing pulses stop when the work stops.
- Fewer dependencies over more. The backend has what the agent SDKs need and little else; the relay has `ws`, plus
  marked and DOMPurify, which it only serves to browsers: as dependencies they are updated with the rest, and the
  Dependabot alerts report a vulnerable sanitizer.

## Documentation

- `README.md` is the manual for people who run OpenFolk; `docs/README.de.md` is its German counterpart and may be
  shorter. `mobile/README.md` and `desktop/README.md` cover their apps.
- `docs/internals/` holds decisions and their reasons, constraints that span components, and traps that are hard
  to see in the source. Before adding a paragraph, ask what someone would get wrong without it. If the code
  answers the question, leave it out. Do not catalogue files, fields or features there.
- When a documented decision changes, rewrite the text. Do not append a second account.
- Implementation plans, research notes and scratch files are not committed; `.claude/` is ignored.
