# Changelog

All notable changes to OpenFolk are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/) once it leaves 0.x.

## [Unreleased]

### Added
- Release notes in German too: "What's new?" shows the notes in the app's language; the German ones come from the new
  `docs/CHANGELOG.de.md`, which holds every version, and a version without them shows the English ones with a hint.
- The desktop app's setup is a wizard in three steps (setup method, this computer, AI provider; the third, right
  below the second on the same page, is the choice of one provider: Claude with the subscription or with an API key,
  Codex, GitHub Copilot, or none with OpenCode's free models; skipped when an engine is ready already): after every sign-in at a relay (invitation link, URL and
  password, QR code) "Set up this computer" follows, which asks for the folders and starts the backend on this
  computer for the signed-in account, so a person invited with a plain link no longer ends with "no machine
  reachable". For that every account may bring its own computer in: a signed-in device asks the relay for an
  invitation (new request `machine_own`; the main account gets a machine of the relay, every other account a machine
  bound to it, valid 15 minutes). "Not now" leaves the app a window. The setup method "On this computer" is now
  "Without setup" and goes to the second step at once; a machine's invitation and a setup link ask for the folders
  there before they join.
- Folders of the chat list keep an order of their own: with a mouse a folder is dragged onto another, on the phone its
  menu has "Move up" and "Move down" (new frame `category_order`, optional `order` on the folder, synced with it).
  A bot or group dragged onto a folder's heading goes into it, onto "In no folder" out of it.
- The open changes of a bot's repos show in its chat's header as in the list (the git symbol with the number of
  repos); a tap opens them, and back from there leads to the chat.
- Bots sort the chat list into folders on request: the new tools `set_folder` (bots and groups by id or name into a
  folder, created when new; an empty folder takes them out; an unknown name changes nothing) and `list_folders`, on
  every engine, with a line in the chat.
- Pictures and videos in the chat: a picture a bot sends with `send_file` (no preview) loads from its machine into
  the message once it scrolls into view and opens large without a second fetch; videos (MP4, WebM, MOV) play in a
  player over the page instead of downloading, fetched once per page.
- Which IDE "Open this chat in the IDE" opens is chosen in the settings of the machine: VS Code (as before), Cursor,
  Windsurf, VS Code Insiders or VSCodium (new machine setting `handoverIdeApp`); the button, the question and the
  line in the chat name it. An own `HANDOVER_IDE` in the `.env` still wins and locks the choice with the reason
  (`offers.ideFromEnv` in `machine_settings`, `ide` in `backend_status`).
- Profile pictures for accounts: everyone sets their own under "Edit" in the accounts list, an admin sets one for every
  account in its "Edit" dialog. The picture is cropped square and shrunk to 256 px on the device; the relay keeps it
  with the account (new optional `avatar` in `account_update`, `RelayAccount` and `Person`, a PNG, JPEG or WebP data
  URL of at most 150,000 characters, `null` removes it) and hands it to the backends with the people, so person chats
  and the accounts list show it instead of the initials.

### Changed
- An invited account lists everyone it may write to in its chat list from the start, not only once a message was
  exchanged (the main account, which reaches every account, keeps listing only the people it writes with).
- Right after the app starts, an empty list of machines shows the loading bar for up to 45 seconds instead of "No
  machine reachable yet": the desktop app's own backend connects some seconds after its setup.
- The provider chosen in the desktop setup's third step becomes the only one switched on; one left on from before
  started new bots without a sign-in ("Not logged in").
- With Claude switched off on a machine, a chat set to Claude (a new bot's "default" model) runs on the first engine
  that is on instead of answering "Not logged in · Please run /login"; the editor preselects that engine for a new bot,
  and the model switch shows it instead of "Default".
- The editor's suggestions (name, role, profile picture) and a bot's own picture no longer need Claude: with Claude
  switched off on the machine, an engine that is on answers them.
- Signing in on the desktop setup page (an invitation link, URL and password) no longer shows the web app in between:
  it signs in out of sight and the page goes on to step 2, with all steps in sight.
- A sign-in refused on the desktop setup page (a used or expired invitation link, a wrong password) goes back to step 1
  with the reason under the field, instead of to the web app's own sign-in page; a TOTP code is still asked there.
- Step 2 of the desktop setup after a sign-in has no "Not now" any more: this computer joins the relay, or step 1 goes
  another way.
- A machine that runs bots and lost its sign-in is named on the status page, with its bots and how to sign in there,
  and the status tab carries a "!" meanwhile; the chat list keeps only the first steps of a new installation.
- A machine that runs bots and lost its sign-in (an expired Claude login) is named at the top of the phone's list
  ("Sign in on OFFICE-PC again", with its bots and the way to sign in there), also while another machine is signed
  in. Before, the card only came while no machine at all was ready, and then as the first steps.
- A bot's menu and page show the switches (context, model, machine) first; "New conversation" and "Move to a
  conversation" (in a conversation "Rename") lead the entries below them instead of standing above the switches.
- The sign-in and the desktop app's setup page drop their explanations (the intro line, the hints under the password,
  the QR code and the folders, the links for newcomers, the warning on the password way, which the question before
  connecting repeats) and keep only fields, buttons, short separators, the question and errors. The fields read
  "Password" and "URL" (no example address in it) instead of "Relay password" and "Server URL".
- The sign-in (browser, apps) and the desktop app's setup page are a small wizard: first "Choose a setup method",
  then only the fields of that method. In the sign-in: invitation link, URL and password (in the browser just the
  password), show a QR code, scan a QR code (where there is a camera), and the device sign-in code from the backend
  log while the main account has no device. On the setup page: invitation link, URL and password (the password
  typed there signs in, the relay's page no longer asks for it), QR code (shown at once when the URL is known; the
  apps' sign-in does the same), and on this computer, with the folders the bots may work in no longer folded away and without the sentence about the
  default folder (the list names it).
- The four first steps (machine, AI provider, first bot, devices) left the list. The sign-in to an AI provider is the
  one left: while a machine is connected and none of its providers is ready, it stands in the start view next to the
  list, on a phone at the top of the list. A new bot comes from "+", the phone from the settings' devices, the move
  to a relay on a server from there too.
- The desktop app's setup page and its folder window use the web app's colors: orange instead of green for the main
  button, the same background, card and fields, so the window no longer changes color after the sign-in.
- The choice of accounts after signing out no longer offers "Create a new account": a new account comes from the
  account menu or the settings of an admin who is signed in.
- A tap on a favorite at the top of the list opens the chat that waits for you: one with an open question, else the
  newest finished chat with something unread, which may be one of the bot's conversations; otherwise the main chat.
- The speech model for voice messages stays loaded while "Keep the model loaded" (formerly "Load the model when the
  backend starts", on by default) is on in the settings of the machine: it is no longer stopped after 30 idle minutes,
  so a voice message after a pause no longer waits for Whisper's cold start. Switched off, the model loads on demand
  and stops after 30 idle minutes as before.
- Models are named without their version everywhere: in the chat header, the list, the model switch (no version in
  its tooltip either), the chat's line after a switch, the plan's weekly bars per model and the image and speech
  models in the settings ("Opus" instead of "Opus 5.5", "GPT Sol (Codex)" instead of "GPT-6.1 Sol (Codex)"). A model id
  pinned in the bot's settings that would read like a family's chip says "(pinned)".
- One link for a person set up on their own computer: "Create invitation link" in the row of an account with a stored
  setup makes its setup link, shown with "Revoke link" like an invitation; "Make setup link" and "Delete setup" left
  the account's "Edit" dialog. Delete and remove sit at the bottom of that dialog; it has no "Close" and no "Save
  name" any more, names and passwords are saved as their field is left. In the list of accounts on a phone the buttons
  of a row with two go below its text.
- The invitation of a person into an account is valid for 7 days instead of 15 minutes and survives a restart of the
  relay, so the person can install an app first. It still works once; a new invitation replaces the account's last,
  and deleting the account ends it. Pairing links for one's own further devices stay at 15 minutes.
- One way in: the sign-in of the web app and the desktop app's setup page are the same card. Both start with the field
  "Invitation link", which takes any link someone sent (an invitation into an account, a pairing link, a setup link,
  on the desktop also a machine's invitation) and tells them apart; below follow the QR code and the password. The
  desktop app adds only "Start on this computer" for someone without an invitation; its ways A to C and the glossary
  are gone. In the apps the address field of the sign-in is the server URL again.
- An admin can invite by QR code: "Scan QR code" in the row of an account that is not signed in here scans the code on
  that person's sign-in and, after a confirmation naming device and account, sends the account's invitation sealed to
  that device. The code on the setup page of the person's desktop app gets the account's setup link, so the computer
  is set up without a link; an account without a stored setup says so. No new frame.

### Fixed
- A redeployed backend container was away for five minutes: the relay rejected its sign-in while the old container
  was still connected, and it waited five minutes for the next try. Right after a start it now tries again every
  20 seconds (up to nine times); once it was in, a rejection still means a second backend and the long wait.
- Cards and hints in the chat list (sign-in, loading, first steps) no longer take the grid of a chat row, which put
  their text into the 48 px picture column; only the rows of chats have it now.
- Phone: the card "Sign in to an AI provider" at the top of the chat list squeezed its text into a column of 48 px,
  a word a line; it took the grid of a chat row. Seen when only a machine without a sign-in was awake.
- The first voice message after a machine woke up was often not transcribed: loading Whisper (Python, the CUDA
  libraries, 1.6 GB of model from a cold disk) took longer than the three minutes allowed, the start was given up and
  not tried again. It may now take ten minutes, and with "Keep the model loaded" a failed start is tried again three
  times, 90 seconds apart, with the reason in the backend's log.
- "Open this chat in the IDE" opens the chat's session again instead of an empty one: Claude Code's extension leaves
  sessions started by a program out of its list and then starts a new one, so the backend marks the transcript as one
  to show before it opens the IDE.
- A long press on a link in a message no longer opens the system's link preview, which loaded the target page and
  could take the iOS app and home screen app down (a card scanner link, for one); the message's ⋯ menu has "Copy
  link" instead. The iOS app turns the preview off as well (`allowsLinkPreview: false`).
- A setup link pasted where an invitation goes ("Add" under accounts, the address field of the sign-in, the scanner)
  was cut down to the relay's address and ended at the password form. The desktop app now takes it over and asks
  whether to set this computer up, a browser shows the link's page, and a phone says the link belongs on the computer.
- A person's profile picture no longer disappears when a backend from before profile pictures answers last: the app
  keeps the picture any backend of the account knows, and drops it once none does.

### Security
- "Status" of an account other than the owner's lists only the machines that serve it (its own computer, the relay's
  machines it runs on), no longer all of the owner's, and such an account can wake only those: waking another machine
  is answered as an unknown one. The owner's account sees and wakes every machine as before.

## [0.6.0] - 2026-11-15

### Added
- "Sign in to Claude" in the first steps signs Claude Code in with the subscription without a terminal: the backend
  runs `claude auth login`, the browser on that machine shows Anthropic's sign-in, and the CLI takes the answer
  itself, so OpenFolk never sees a code or a token. A second tap starts over (a tab closed too early). A backend
  without a desktop (a Windows task in session 0, Linux without a display) opens the terminal as before. The answer
  `claude_sign_in` carries the new optional field `via: 'browser'`.
- "Duplicate bot" on a bot's page and in its menu: a copy under a new name on the bot's machine with its profile,
  model, approval level, folder and picture, and copies of its routines, paused so nothing runs twice; history,
  knowledge, conversations, favorite, mute and the tools allowed for good stay with the original. New frames
  `bot_duplicate` and `bot_duplicated`; bots of an admin's setup cannot be copied.
- Fewer steps for newcomers: a new installation whose computer has Claude Code signed in already starts with Claude
  on and skips the choice of AI providers (the backend asks the CLI on its first start, for at most 20 seconds). "Try
  it without signing in" in the first steps switches on OpenCode's free models, which need no subscription or key,
  and says that their providers may train on the data; a new bot then starts on OpenCode while Claude is not ready.
- An Anthropic API key is checked before it is stored (`GET /v1/models`, no tokens): a key Anthropic does not know
  (401) or refuses access (403) is not stored, and the machine says why; without a clear answer (no network, 429,
  5xx) it is stored as before. The first steps link to the Console page for keys and say how the key is billed.
- Forwarding a message: "Forward" in the ⋯ menu of a message opens a page with the other chats (search included); the
  chosen chat opens with the message above the input, where you add words of your own or send it as it is. The quote
  carries the new optional fields `forwarded`, `origin` and `originChat` and keeps up to 20,000 characters (a reply
  keeps 300); the bot reads the forwarded text whole, with its line breaks. Into a person chat it goes without the
  origin. In the chat a forward shows four lines; a tap opens the whole text in place (also in the bar above the
  input), the line "from …" opens the chat it came from.
- The phone stays quiet while a desktop is in use: the desktop app and browsers on a wide screen report whether
  they are visible with input in the last two minutes (`presence` with the new optional fields `desktop` and
  `active`, now sent to every machine awake). Meanwhile the phone gets no answers, routine results or person
  messages, and approvals, questions and hand-overs only after three minutes, unless answered or the chat was opened
  by then; machine awake and usage limits are unchanged. A visible desktop without input no longer keeps the phone
  silent. "Always notify on this device" in a phone's notification settings opts out; it travels with the
  subscription (`push_subscribe` with the new optional fields `form` and `always`) and syncs between machines.
- Routines on the bot's page: a row each with when it runs in words ("weekdays 8:00", "every 2 hours"), the next run
  and a switch active/paused; opened, the instruction, "Run now", "Edit", "Edit in chat" and the last 20 runs with
  start, duration, status (ok, error, running), the reason of a failure and a jump to the answer in the chat. The
  backend keeps the runs in the routine (new optional `runs`, synced to the other machines with it) and sends the next
  due time from the cron expression (new optional `nextRun`, never stored); a turn's result names the recorded answer
  (optional `entryId`). "Edit in chat" puts "Change the routine “…”: " into the composer, and the bot changes or creates
  its own routines with the new tools `set_routine` and `list_routines` on every engine, with a line in the chat;
  waking the machine stays with the user.
- Command palette and keyboard shortcuts on desktop and in the browser: Ctrl+K (Cmd+K on a Mac) searches bots,
  groups, people, conversations, routines, the settings' sections and actions (new bot, new group, settings, status,
  waking a machine), plus messages of the last four weeks with "Search older messages" and attached files by name; a
  hit opens the chat at the message. Shortcuts: Ctrl+N, Ctrl+Shift+N, Ctrl+F, Ctrl+1 to 9, Alt+Up/Down,
  Ctrl+[ and Ctrl+], Ctrl+I, Ctrl+Enter, Ctrl+B, Ctrl+, and Ctrl+/ for an overview. The desktop app lists them in a
  new menu "Go". The frame `search` takes the new optional fields `since` and `files` (echoed in `search_result`).
  On the phone the search above the list gets chips instead: messages, bots, files, routines.
- Dictation as a setting of the device ("Microphone: dictate into the input field instead of sending a voice
  message", off by default): while recording, the text field, attaching and pasting stay usable, X discards (also
  Escape in the field) and a checkmark next to it asks the bot's machine for the text, which goes where the cursor
  was; the microphone dictates more, and the message leaves as text with the send button, without the recording and
  without reading the answer aloud. New frames `transcribe` and `transcribed`; an older backend says it is too old
  for it. Whisper gets the bot's name, folder and repository (in a group its members') as `initial_prompt` for a
  dictation; voice messages stay as they were (#59).
- The status page names each machine's backend version first in the line below it; a backend before 0.2.1 sends none
  and shows none (#64).
- Desktop app for Intel Macs: CI builds it on an Intel runner, signs and notarizes it like the Apple Silicon one and
  attaches `OpenFolk-X.Y.Z-x64.dmg` and `-mac.zip` to the release. One `latest-mac.yml` names the files of both, so each
  Mac updates with its own build. Both READMEs open with a download table that links each system's package
  through openfolk.app and stays the same across versions.

### Changed
- A new message in a bot's chat closes its open approval and question cards: the bot is told nothing it asked about
  happens and to end its turn, the message follows as the next instruction. Groups keep their cards, since the message
  may be meant for another member.
- An approval nobody answers within 30 minutes stays in the chat as an expired card without buttons ("nothing
  happened") instead of vanishing (`approval_done` with the new optional field `expired`).
- The phone's search above the list looks through the messages of the last four weeks first, like the palette, with
  "Search older messages" below; hits show newest first, and the answers of several machines add up instead of the
  last one replacing the others.
- An admin chooses the machines an account runs on: in the form for a new account and under "Edit" in its row, "All my
  machines, new ones too" (as before) or one by one. A machine not ticked does not serve the account and its devices do
  not see it; it keeps the account's data and takes it up again when ticked. An account with a setup link is no longer
  a kind of its own: its first link unticks the relay's machines, and the admin can tick some again, next to the
  person's own computer. The relay keeps the choice (`machines` in `RelayAccount`, new optional fields in
  `account_create`, `account_update` and, for an admin, the relay's machines in `accounts`) and tells the backends with
  `account_added` and `account_released`; the backends need no change.
- The model switch names the Claude models by family only (Fable, Opus, Sonnet, Haiku), without a version: each
  chip is the alias that always runs the newest version the CLI offers; the version behind it is in the tooltip. A
  model id pinned in the editor keeps its version. Header and chat list still show the version that runs.
- "Add machine" shows the link for the desktop app's setup first, with "Copy link" copying only the link, and the
  `npm run join` command below it with "Copy command". The desktop app's setup and `npm run join` also take the whole
  command pasted, quotation marks included (#61).
- A machine's settings list its allowed folders (changed at that computer: the desktop app's tray or `ALLOWED_ROOTS`)
  and call the folder below them "Default folder for new bots", chosen with the bot editor's folder picker ("Choose …")
  or typed as before (#62).
- The page "New bot" asks for role, name, folder and repository only, the role first; the templates stand under the
  role as chips (a tap takes the role and, unseen, the template's working instructions and approval level, dropped
  again when the role is typed over), three first names alliterating with the role come without the model ("Others"
  for three more), the machine shows only when there is a choice, and the button says "Create". Everything else
  (picture, field of work, model, approval level, tone, voice, list folder, whom it may message) waits in the bot's
  settings, and the bot asks what is still open in its chat. The template select, "Set up in the chat" and "no
  template" are gone.
- The Windows installer installs with one click: it asks for administrator rights once, installs for all users into
  `C:\Program Files\OpenFolk` as before and starts the app, without the pages for language, folder and finish. An
  update keeps the folder an earlier version was installed to.

### Fixed
- An account other than the main one, while none of its machines is awake (right after an invitation, say), no
  longer sees the first steps of a new installation with "npm start", but a note that no machine is reachable yet and
  that its bots and people appear once one runs.
- Bot editor, "New bot", the model switch and the model in the chat header take the engines and models of the bot's
  machine (in the editor: the machine chosen there). Each backend's `models` replaced the list of every other one, so
  with two machines Cursor of one could go missing for its bots (#63).
- iPhone, home screen app: iOS 27 blurred the top of the page, header included. A fixed strip in the header's color
  now lies at the very top, which is what makes iOS leave the blur out and color the status bar like the header; the
  status bar style is `default` instead of the deprecated `black-translucent`, so the page starts below the status
  bar. The app has to be removed from the home screen and added again (#65).
- Desktop app: the tray menu is complete right after the first setup ("Allowed folders …", "Sign this window in
  again", "Disconnect from …", "Run without signing in"); it was built once at start and came complete only after a
  restart (#60).

### Security
- The web app shows a profile picture only from a data URL of an image or an object URL; anything else in `avatar`
  shows the initials (CodeQL js/xss, js/client-side-unvalidated-url-redirection).
- hono 4.13.18 and @hono/node-server 2.1.8, which the Agent SDK's MCP server pulls in (CSRF, middleware bypasses with
  `mount()` and the RegExpRouter, `validator('form')`, a backslash in the path, a crash on `ECONNRESET` during a
  WebSocket upgrade).

## [0.5.0] - 2026-11-10

### Added
- Setting a person up on their own computer with one link: an admin chooses in settings → Accounts → "Set up" the
  bots of an account (each with a repository, a token of its own and its approval level), whom the person can write
  to and whom the bots hand over to, and makes a setup link (7 days, once, revocable). The person installs the desktop
  app, signs in to Claude and opens the link ("Open in OpenFolk", the app registers `openfolk://`); the app joins the
  relay as a machine bound to that account (`/setup-invite`, `/setup`), clones each repository with its token behind a
  credential helper and makes the bots, which the person cannot change or delete (`Bot.managed`). A bound machine
  serves its account only, and the account runs only on such machines; person chats and the setup cross between the
  machines through the relay's new person route (`person` with the sender's `id`, `person_result`), kept in an outbox
  until delivered and taken once by the receiver (`person-seen.json`), however often it is sent again. The
  account owns the machine (its own Claude sign-in, its settings). "Disconnect from …" in the desktop app's menu is the
  way back. New frames `setups`, `setup_save`, `setup_delete`, `setup_link`; new peer data `person_message`, `setup`,
  `setup_request`.
- Approval level "only reads" (`read`): a bot that reads and answers, and is refused writing, commands and foreign
  services without a card. A support bot of a setup fetches and fast-forwards its clone before answering, at most
  every five minutes.
- Reach "chosen contacts" (`listed`, with `contacts` in `account_update`): an account reaches exactly the accounts it
  names.
- A new bot sets itself up in its chat: the template "Set up in the chat" (the default) needs only a name and a folder;
  once saved, the bot looks at the folder, asks a few questions with options and fills in field of work, role and
  working instructions itself with the new tool `set_profile` (also for the user's later wishes), with a line in the
  chat and everything editable in its settings (optional `setup` in `bot_save`). Last it offers a profile picture:
  `make_avatar` runs the editor's generator for the bot itself (a 512-pixel photo with the image model's key, from
  Nano Banana 2 on; otherwise the drawn SVG, kept as it is), with a wish for the picture (`wish` in the suggestion).
  Every new bot does this, also one from another template (it skips what the template set), and its chat opens
  right after saving.
- Jobs between bots come back by themselves: `message_bot` returns at once, and the result arrives in the conversation
  that gave the job as a new message the bot there carries on with, with a notification, however long the job takes;
  `wait_for_reply=true` still waits up to 20 minutes. A bar above the input names whom the chat waits for since when,
  opens that chat, and stops waiting or cancels the job. Open jobs survive a restart, a job to a sleeping machine goes
  out once it wakes, and a result for a sleeping machine waits on the target until it is confirmed (new peer data
  `job_feedback`, `job_ack`, `job_cancel`; an older target's `job_done` counts as well). `list_conversations` and
  `message_bot`'s `conversation` give a specific conversation a job, also another one of the same bot; loops are told
  by the chats along the chain (#43).
- "Machine sessions" in the "+" menu (VS Code and terminal): the sessions of every folder on each awake machine, newest first, to read,
  follow live and continue with the bot whose folder holds them. The list on a bot's page keeps to its folder.
  `vscode_sessions` and `vscode_open` work without `botId` for this; an older backend answers with an error, which the
  list shows for that machine.
- Codex sessions from its VS Code extension and CLI in both lists, marked "Codex": read and follow them live, and
  continue one as a branch in a conversation on Codex (the app-server lists, reads and forks them; optional `engine`
  in `vscode_open`, `vscode_adopt` and the list entries).
- "Open changes" says since when a repo has something open: the newest change of its files, for one with only
  unpushed commits the last commit (`since` in `GitRepo`, optional; older backends send none) (#46).
- A clone that git refuses for want of credentials (a private repository) says where the git token goes, with a
  button to the settings of the bot's machine at "Pushing with git" (`credentials` in `folder_cloned`) (#38).
- Deleting a bot can delete its working folder too: the delete dialog asks the bot's machine first and offers
  "Also delete the working folder" when no other bot of any account there works in it, inside it or around it, it is
  no allowed folder or folder for bots itself and holds no work that is not on a git server; otherwise the box stays
  off with the reason (`folder_delete_check`, `deleteFolder` in `bot_delete`; an older backend keeps the folder) (#36).
- `set_avatar`: asked to, a bot sets its own profile picture from a PNG, JPEG, WebP or GIF of its folder (up to 300 KB,
  told apart by its bytes, no SVG); its chat says so (#44).
- Screenshots and a short demo GIF in both READMEs, drawn from demo data by `npm run screenshots` (#12).
- Desktop app on Linux: "Run without signing in" runs the backend as the systemd user service `openfolk-backend`
  with lingering, so a woken machine reports without a sign-in (the .deb package; the AppImage cannot). `docs/running.md`
  shows the same service for a checkout and why a Mac needs a sign-in (#11).
- A wake agent for a relay on a server: `WAKE_METHOD=agent` with `WAKE_AGENT_TOKEN`, and `wake-agent/wake-agent.mjs` on
  a small device in the home network (a Raspberry Pi, a NAS) that connects to the relay by itself and sends the
  Wake-on-LAN packet there, without a port opened on the router. It only ever gets "wake <MAC>" for the machines in
  `WAKE_MACHINES`; one file, Node 22, no npm packages, setup in `wake-agent/README.md`. The Compose files pass the wake
  settings to the relay (#45).

### Changed
- The settings page without its explanatory texts below the fields; notices of a state stay (all machines asleep,
  no provider switched on, no shutdown in this setup, the iPhone's home screen app). "About" without the emoji, and
  its release notes use the width of a wide screen.
- Signing out leads to a choice of the accounts on this device: a tap signs in again without a password, "Sign in with
  another account" opens the form. An account not used as the active one for 30 days loses its key on the device and
  asks for its password again; the "⋮" menu of a row forgets the account. "Sign out" sits at the very bottom of the
  settings, below the account signed in to. The account menu of the sidebar is now shown on every relay with accounts; an
  admin creates a new account from that menu or the choice, and the device is signed in to it at once.
- The list of accounts looks like the list of devices, with at most two buttons on the right: "Switch" or "Create
  invitation link", and "Set up". "Set up" holds the account itself (its name, now changeable by an admin, admin
  rights, "Only admins", delete) and, for an account that is no admin, its bots on the person's own computer, each
  closed to a line with its repository and level. "Add an account or relay" asks for the new person's name first, and
  creating an account no longer opens its invitation at once. Dialogs use more of a wide screen.
- Desktop app: Ctrl and + or - zooms with every keyboard layout (the + key of a German keyboard did nothing), on the
  number pad and with Ctrl and the mouse wheel; Ctrl+0 resets. The level stays across starts and pages.
- Moving a bot to another machine asks nothing any more: a tap on the machine moves it, a sleeping machine is woken
  for it, and work not on the git server yet comes along by itself (put aside on the previous machine with git stash);
  the toast says what happened. The app no longer sends `bot_move` with `dryRun`.

### Fixed
- Deleting an account could end the backend of a machine that served it: traffic of the account still on its way (its
  browsers closing) made the backend serve it again, whose data was gone. Such traffic now finds nobody.
- A test run of the desktop app (`scripts/desktop-smoke.mjs`) no longer registers itself for `openfolk://` links in
  place of the installed app.
- Opening the web app sometimes left only an empty page with a bare search field: when one of its modules did not
  load (a network gap as the phone wakes, the relay restarting during a deploy), nothing started. `boot.js` now loads
  the page again, up to three times within two minutes, and then says so with a "Reload" button.
- Desktop app: the "Update ready" dialog opens once per version; the six-hourly checks and "Check for updates" no
  longer stack one on top of the other (#58).
- Desktop app on Windows: the "Update ready" dialog says that the install asks for administrator rights, also when it
  runs on quit (#58).
- Desktop app: a failed "Check for updates" says in two short lines why each source failed (openfolk.app and GitHub)
  instead of electron-updater's whole message with response headers and the feed (#57, #58).

### Security
- The desktop apps are built with minimatch 11 where electron-builder pulled 9.x and 10.x (GHSA-g3hv-75wg-m249, a
  denial of service through a crafted pattern); it only ever ran at build time, not in the app.

## [0.4.0] - 2026-11-08

### Added
- Folders in the chat list: "+" → "New folder"; a bot or group goes into one from its menu ("Folder") or its settings.
  A tap on the heading folds the folder, a long press renames or deletes it. Running bots and unread answers sit at the
  top meanwhile; folders sync between the machines like bots.
- A set of 24 ready-made profile pictures: "AI avatar" in the bot editor opens it first, the image model is the last
  entry. Drawn by `npm run avatar-set` into `webapp/avatars/`.
- `FIRST_DEVICE_CODE` for a backend in a container: the code for the main account's first device can be set
  beforehand and handed to someone who starts with nothing but a phone. It stays out of the log; the first steps in a
  container now lead with the API key and the device codes, which need no computer.
- A bar above code blocks in answers with the language, "Copy" and line wrap (#55, by @SvenvanB).
- A gear in the chat header opens the bot's page or the group's editor, like a tap on the title (#50, by @SvenvanB).
- Bots without a project folder: with folder and repository left empty, the bot gets a folder named after it in its
  machine's folder for bots (#37). The folder picker creates a new folder below the one it shows (#35). Both go
  through the new frame `folder_create`; an older backend says to enter a folder.
- The backend image with voice messages: every tag of `ghcr.io/openfolk/openfolk-local` also as `-voice`, with Python
  and faster-whisper on the CPU (`local/Dockerfile.voice`, #41).
- `docs/running.md` says in what order to update relay, backends and apps, and how a desktop window in the mode
  "relay address" signs in again after the move to `openfolk://app` (#40).
- Voice conversation: the button next to the microphone opens a page where you talk with a bot hands-free. The
  recording goes out after a pause, the answer is read aloud (what the bot says before a tool runs right away) and
  the microphone opens again; a tap on the picture sends at once or stops the voice. The bot is asked to answer
  briefly.
- With "OpenAI Realtime" in the settings and an OpenAI key, the voice conversation runs over `gpt-realtime-2.1` (or
  mini) like ChatGPT's: interrupting works, OpenAI speaks the bot's answer. The backend opens the connection with the
  stored key; this needs backends of this version.
- Reading aloud on the bot's machine: "The bot's machine" as the voice in the settings reads with Piper, free and
  offline, a male and a female voice per language; "Automatic" takes it when no key is stored. It needs voice
  messages set up on the machine, whose setup now installs `piper-tts` and loads the voices; an environment of
  one's own needs `pip install piper-tts`, which the machine's row in the settings says.
- A voice of its own per bot: the editor lists the voices of the provider reading right now (OpenAI's 13, Gemini's 30,
  Piper's per language) with "Listen" for a sample; it is kept per provider, another provider reads with the kind
  (male or female). The voice conversation over OpenAI Realtime takes it too where the Realtime models have it.
- Reading aloud with the device's voice picks one of the bot's kind (male or female) by the names of the system's
  voices; without one of that kind another reads with a changed pitch, and a hint says how to load one.

### Changed
- The code for a first device works once only: after a device of the main account has talked to the backend it opens
  nothing more, even while no device is signed in at the relay.
- Questions and notices are HTML dialogs of the app instead of the browser's `confirm()` and `alert()` (#48, by @SvenvanB).
- Deleting a bot or a group asks for its name in a "danger zone" that lists what goes and what stays (#49, by @SvenvanB).
- From the bot's page, the editor opens in the side panel in place of the page, which is drawn again after saving
  (#56, by @SvenvanB).
- Answers of a bot fill the width of their column (#54, by @SvenvanB).
- The switch for reading answers aloud sits next to the voice it belongs to (#53, by @SvenvanB).
- The sign-in and the pairing name their secrets apart: relay password, key and pairing link (#52, by @SvenvanB).

### Fixed
- The "Key needed" dialog takes the full pairing link, as its text says, not only the key (#47 by @SvenvanB, fixes #42).
- The top of the sign-in page stays reachable in a low window (#51, by @SvenvanB).

## [0.3.0] - 2026-11-06

### Added
- Chats with people: "+" → "Person" writes to another account on the same relay, a team member or a customer, with
  files, voice messages, notifications, unread, favorite, mute and search. Each side keeps its own copy. Person
  chats and customer accounts need the relay of this version; update it together with the apps.
- Customer accounts: "Customer: chats with the admins only" when creating an account, or "Admins only" and "Reaches
  everyone" in the list, so a customer reaches their team and no other customer.
- Hand-over from a bot to a person: "Hand over to" in the bot's settings gives it the tool `hand_over`; the person gets
  the bot's summary and a notification, the user a "Continue with …" button in the bot's chat.
- Push kinds "Message from a person" and "A bot hands a chat over to you".
- Slash commands: "/" at the start of a message in a bot's chat lists Claude Code's commands for its folder (your own,
  the project's, plugins', a few built-in ones). A message starting with `/name` reaches the bot without a quote,
  delegation or group note in front, so Claude Code runs it, also in groups and routines.
- Desktop app: "Also connect this computer to my relay server" works by QR code too. The setup page shows a code for
  the relay's address, a signed-in phone scans it and confirms, and the computer joins without copying a link.
- Moving a bot to another machine needs no folder or repository any more: a tap on the machine and one confirmation.
  Each machine has a "Folder for bots" in its settings, a bot's machine remembers where the bot lives below it and its
  repository, and the new machine puts the bot at the same place below its own folder for bots, cloning the
  repository or creating the folder. The dialog with both fields stays for a place that is taken there. The bot
  editor's clones go into the folder for bots too.

### Fixed
- VS Code sessions of a bot whose folder sits behind a junction or symlink, or has a very long path, are listed and
  followed again: OpenFolk names the transcript folder the way Claude Code does (resolved path, cut at 200 characters
  plus a hash, `CLAUDE_CODE_PROJECT_DIR_NAME`).

### Security
- Moving to a relay of one's own: the page follows the link from the backend only if it leads to the relay typed into
  the form (http or https), never elsewhere.

## [0.2.1] - 2026-11-04

### Added
- Desktop app: "Allowed folders …" in the tray and app menu chooses the folders bots may work in (`ALLOWED_ROOTS` in
  the profile's `.env`), also on the setup page for "start on this computer"; saving restarts the backend once no bot
  is working. A new installation without a choice gets a folder of its own (`<user folder>/OpenFolk`) instead of the
  whole user folder; an installation that ran before keeps the user folder, written down, and the window warns that
  it is wide (by @SvenvanB).
- A bot whose folder is refused names the folder and the allowed ones apart and says how to allow more, in the
  desktop app with its menu (by @SvenvanB).
- "About" at the end of the settings names the version of OpenFolk in every app (browser, desktop, phone); a click
  shows what is new in it, the earlier versions folded below. Below it the desktop app's version, the web app's
  protocol version and, per connected backend, its protocol version and start (by @SvenvanB).
- The version stands next to the name at the top of the sidebar; a click shows what is new in it.
- After moving to a relay on a server, the app says once "Moved to <relay>" when it is signed in there
  (by @SvenvanB).
- `docs/running.md` explains which steps the desktop app does without the `npm run …` commands of a checkout, the
  allowed folders of a machine (`ALLOWED_ROOTS`) and how git pushes without anyone to answer a prompt (a token in the
  machine settings, SSH keys from an agent or the macOS keychain); the German README has a five-step guide for a relay
  of your own. Both READMEs say in what order to invite a person into a new account, that the account name in the
  sidebar is the active account, and that OpenFolk is a companion to the IDE, not a replacement.
- Desktop app: "Check for updates automatically" right below "Check for updates" switches the automatic checks and
  downloads off and on, without a restart; a check from the menu works either way (by @SvenvanB).
- The color of your own messages can be chosen under "Appearance" among eight, per device; green stays the default
  (by @SvenvanB).
- On an iPhone or iPad in a Safari tab the settings say that only the home screen app gets notifications and that
  the device has to be paired there again (by @SvenvanB).
- The status lines say whether the connection is local or via which relay (by @SvenvanB).
- A pencil in the head of a bot's page opens its editor (by @SvenvanB).

### Changed
- A second backend sign-in under a connected name from the same address is a restart (a container being redeployed,
  the backend started twice): still rejected, but no longer pushed as a security notice; the notice for another
  address names the address as the reason.
- The desktop setup page letters its three ways A to C (start on this computer, also connect this computer to my
  relay server, display only), explains bot, backend and relay server, and asks before "display only", because
  the app then runs no bots on this computer (by @SvenvanB).
- The desktop apps run on Electron 44.10.2 (from 44.7.0).
- The head of a bot's page stays in view while the page scrolls (by @SvenvanB).
- "New conversation" says what it is for: a fresh session of the same bot without the history of the other chats, in
  the "+" menu, its tooltip and in the empty conversation (by @SvenvanB).
- The bot editor marks its required fields: name, and a folder or a repository (by @SvenvanB).
- The account name next to the title in the sidebar says in its tooltip that it is the active account and switches
  on a tap; the list of a device with several accounts was hard to read without it.
- "Set up voice messages" loads the speech model as a step of its own, with its size, so the first voice message no
  longer waits for a download of up to 1.6 GB; it installs the CUDA libraries also where `nvidia-smi` is not on the
  path, and a Python of the machine that has faster-whisper already is used as it is.
- A container's log names the code for a first device only until a device of the main account has connected, and an
  engine that is merely not signed in (Copilot on a machine that does not use it) no longer logs a line at every start.
- "About" in the settings names the version of OpenFolk each connected backend runs (`version` in `backend_status`,
  optional; older backends show their protocol version as before).
- A refused bot folder comes with the folder and the allowed ones as fields of the answer (`refused` in
  `folder_checked` and `folder_cloned`), so the app no longer reads them out of an English or German message.

### Fixed
- Desktop app: closing "Change setup" without a choice brought the setup page back on the next click on the tray
  or Dock icon instead of the chat (by @SvenvanB).
- Desktop app: after the update to 0.2.0 the window showed the sign-in page instead of the chat, because the web app's
  storage moved with its new address; "on this computer" now notices the missing sign-in and pairs the window again.
  A relay before 0.2.0 refuses the app's new address altogether: with such a relay the window shows the web app the
  relay serves, as before, signed in as before, until the relay is updated. "Sign this window in again" did nothing
  while the window showed the app.
- Claude Code signed in with `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) counts as signed in; the first
  steps asked for a sign-in.
- A voice message on a machine without voice messages set up says so at once instead of ending after three minutes
  with "Whisper does not start"; a speech model still to be downloaded gets half an hour, and with the CUDA libraries
  missing, "automatic" runs on the CPU instead of failing.
- The git host under "Pushing with git" takes an address (`https://git.example.com/…`) and keeps its host name; it was
  refused with "Invalid string". Changed git credentials reach the bots' running sessions on their next turn instead
  of after a restart of the backend.
- Saving a bot with a repository and a folder that exists but holds no clone of it (empty after a clone that failed)
  clones into the folder or says why it cannot, instead of saving the bot without its repository.
- A wrong `E2E_KEY` names the expected format and what it got; a byte order mark, quotes or invisible characters
  around a copied key no longer count.
- The log line about a missing Claude sign-in of another account names the account and its command.

## [0.2.0] - 2026-11-04

### Added
- `docker-compose.coolify.yml` runs relay and backend in Coolify from the prebuilt images, without a host port and
  with a setup code that Coolify generates; `docker-compose.server.yml` built both images on the server there.
- "Always for this bot" on the approval card of an external MCP tool: the tool no longer asks for that bot, on
  every machine. The bot editor lists these tools; unticking one makes it ask again.
- The desktop apps let you drag the chat list's right edge to change its width (260 to 640 px); the width is kept,
  a double click restores it.

### Changed
- Muting a bot or group moved from the push settings to its page and the list's menu ("Mute", next to the favorite).
- One block "Accounts" in the settings for everything that is a sign-in: one list grouped by relay with the accounts
  of this device (switch, remove) and, for an admin, everyone else on the relay (invitation, admin, delete); one "Add"
  takes an invitation, a pairing link of another relay, an address or, for an admin, a new person; the switch for the
  shared list sits below it. The blocks "Relays" and "All accounts" and "Sign in to another account" in the sidebar
  menu are gone; the main account has nothing of its own to edit; signing out stays under "Devices and security". The
  settings are a page like the repos page (a head with the title, the content over the whole width), without icons
  in the headings; the back arrows of the pages show on the phone only. Adding something there (an AI key, a person
  or link, a machine, a device) opens a small dialog like the bot editor instead of a form inside the page.
- The desktop apps take their update feed from openfolk.app, straight from GitHub when that does not answer. The first
  check of a day counts the installation anonymously (daily totals per system and version, no IP, no identifier,
  public at `openfolk.app/update/stats.json`); "Count this installation anonymously" in the menu switches it off.
- Moving a bot to a sleeping machine asks before waking it; declined, nothing is woken and the move is not started.
- The accounts settings explain themselves: signing this device in to another account has its own section, the list
  and the form for new accounts say what an invitation link and the admin right do, and the buttons name what they make.

### Fixed
- "Add machine" and the second factor in the settings stayed empty once the device had the end-to-end key: the web
  app dropped the relay's own answers as unencrypted (#17).
- A bot's row in the chat list no longer grows when it shows open git changes, further conversations, a queue or a
  mute mark; these marks share one line.

### Security
- The connectors of the claude.ai account Claude Code is signed in with (Gmail, Google Drive and others) no longer
  reach the bots' sessions. They came with the login, so a bot that read a prepared page or file could have been
  talked into reading mail or a server's variables. "Connectors" in the settings of a machine lets them in again.
- In *risky*, every call of an external MCP tool asks, also those named get, list, search or read: the name says
  nothing about what comes back. The MCP resource tools (`ListMcpResourcesTool`, `ReadMcpResourceTool`) and allow
  rules in the user's Claude Code settings no longer skip the approval.
- `docs/running.md` explains that a container reaches the host's ports through the Docker gateway, past the hosting
  provider's firewall.

## [0.1.2] - 2026-10-20

### Fixed
- Quitting the desktop app no longer asks whether to wait for working bots while an idle backend is still shutting
  down.

### Security
- The relay keeps passwords (`USER_PASSWORD`, the claimed password, the passwords of further accounts) as salted
  scrypt hashes instead of SHA-256. A relay that gets `USER_PASSWORD` from its environment needs nothing. A relay
  claimed with `npm run claim` stays claimed and keeps its backends, but its old password no longer signs in: pair
  devices with a link (`npm run pair`), or set `USER_PASSWORD` and `AGENT_TOKEN`, or delete `owner.json` and claim it
  again; the relay's start log says so. An admin sets the password of a further account again.
- The web app no longer lets a chat or machine id like `__proto__` from a frame reach `Object.prototype`, and answers
  to name suggestions only call the suggestion buttons it knows.

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

[Unreleased]: https://github.com/OpenFolk/OpenFolk/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/OpenFolk/OpenFolk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/OpenFolk/OpenFolk/releases/tag/v0.1.0
