# OpenFolk for the desktop

OpenFolk as a program of its own for Windows, Linux and macOS, around the web app from `../webapp/`, which the app
brings along and shows under its own address `openfolk://app` (like the mobile apps; the browser gets it from the
relay). One project builds all three: the Windows installer, the Linux AppImage and .deb, the Mac's .dmg. On Windows
and Linux the app lives in the tray, on the Mac in the Dock and the menu bar; everything else is the same.

- **First start:** the setup page (`setup.html`) is a wizard in three steps, on the card of the web app's sign-in.
  Step 1, "Setup method", signs in: the choice "Choose a setup method", then only the
  fields of that method. Step 2, "Set up this computer", asks for the folders the bots may work in and starts the
  backend here; it follows every sign-in as long as this computer runs no backend at that relay (below, "This
  computer after a sign-in"). Step 3, "Sign in to an AI provider", opens right below step 2 as soon as that worked,
  on the same page and while the backend starts: first the choice of one provider, then only its button or field:
  Claude with the subscription (the browser opens the sign-in), Claude with an API key (checked with Anthropic first),
  Codex or GitHub Copilot with a device code (the page shows the link and the code), or no provider (OpenCode's free
  models), without texts that explain them. Cursor and Antigravity sign in in the settings. The main process runs `../local/tools/ai-setup.mjs` for it with the backend's data folder, writes the
  machine settings only after the backend's own first start (`backend.pid`), then restarts the backend, which reads
  them at its start, and shows the web app. An engine ready already (Claude signed in on this computer before) skips the step. It has no
  "Not now": whoever wants no sign-in chooses "No provider". Steps 1 and 2 stay open
  meanwhile: another method closes step 3 (`ai-cancel` ends a sign-in under way), other folders and "Set up this
  computer" again open it anew; after a sign-in step 2 is done, its invitation redeemed. "Invitation link" takes any link someone
  sent; "URL and password" asks for the relay's URL and the password (the main process keeps the password in memory
  for two minutes and hands it once to the app's own page for that relay, `take-password`, which signs in with it);
  "QR code" shows a code for the known URL at once, which a signed-in phone scans (the URL field only while none is
  known or after a failure); and, only here, "Without setup" for
  someone without an invitation, which goes to step 2 at once. The URL way is chosen beforehand when the app is connected to a relay or a relay did
  not answer, "Without setup" when its backend did not start. Which link it was the main process
  decides (`join-server` in `main.js`): a setup link (this computer bound to an account) and a machine's invitation
  go on to step 2, which joins with them; an invitation into an account (a pairing link) shows that relay's page
  signed in, as the password way does, and step 2 follows from there.
  - **Without setup** (step 2 "Set up this computer" right away): the app runs the backend (`../local/`) itself, with the relay embedded on 127.0.0.1, and
    signs its window in with a pairing link. Nothing to host; the only step left is signing in to Claude Code
    (the app's start view shows how; none when Claude Code is signed in on this computer already, and "Try it
    without signing in" starts on OpenCode's free models instead). Data, keys and the backend's log (`local.log`) live in `data` in the
    profile folder (below); settings that `.env.sample` describes go into `.env` there. Quitting the app ends the
    backend once no bot is working, after asking if that takes a while. "Sign this window in again" (tray menu,
    on the Mac "Window") helps after logging the device out. This is the single-computer setup: your phone, or
    the browser on another device, needs a relay on a server (`../docs/running.md`, linked from the setup page).
  - **The relay server and a password:** the app points its web app at that relay; an invitation into an account in
    the field above ends the same way. To test against a local relay, `OPENFOLK_URL=http://localhost:8787` presets it for one start. Before
    that the setup page asks once whether this computer should turn to that relay ("Yes, connect"), unless the app
    already uses this way; so does the invitation field while bots run here.
  - **This computer after a sign-in:** a window signed in at a relay runs no bots. An invitation into an account or the
    address with a password signs in out of sight (`signInAway` in `main.js`): the web app runs in a hidden window of
    the same session while the setup page stays ("Signing in …"), so no web app shows in between; the window shows it
    only when there is nothing to set up, a TOTP code is needed or nothing came within 45 seconds. A refused sign-in (a
    used or expired link, a wrong password) goes back to step 1 with the reason under the field (`signInRefused`). Page changes decided before an await are dropped when a newer page came meanwhile (`shown`), and a
    stopped backend ends before a new one starts (`stopBackend`). The web app, once signed in,
    asks the app whether this computer still runs no backend at that relay (`machine-wanted`) and then the relay for
    this computer's invitation (the request `machine_own`: for the main account a machine of the relay, for every
    other account a machine bound to it, valid 15 minutes). The app shows step 2 with it; "Set up this computer"
    writes the folders, redeems the invitation (`../local/tools/join.mjs`) and starts the backend against the relay.
    The backend needs the end-to-end key the account's devices use: the app takes it from the invitation link, or
    from the web app when the page takes one over (`machine-key`), and keeps it in memory only. Without a key the
    invitation is asked for only while nothing at the relay is encrypted for this account yet (no key in the page,
    no machine awake); the backend then makes a key and signs the window in anew with a pairing link. A window signed
    in before this existed holds a key the app cannot read: it stays a window until someone signs in again with an
    invitation link, or pastes the link from "Add machine". Step 2 has no "Not now": signed in at a relay, this
    computer joins it, or step 1 goes another way.
  - **Several relays:** like the mobile apps, the desktop app can be signed in to further relays, for example one per
    customer (settings → Accounts → "Add" with a pairing link from there; switch at the top of the sidebar, the
    chat list shows the bots of all of them).
  - **Joining this computer to a relay:** the link from "Add machine" (settings of the app on a device that is
    signed in), pasted into the invitation field, joins this computer to that relay: `../local/tools/join.mjs` writes the relay, a token of this
    computer's own and the end-to-end key into the profile's `.env`, and the app runs the backend as "on this
    computer", only with the relay on the server. The window comes from there and signs itself in with a pairing link.
    Instead of the link, the page shows a QR code for the relay's address (`qr-join.js`): a signed-in phone scans it,
    the user confirms there, a backend mints the invitation and the phone sends it back sealed for the app's key, as in
    the QR sign-in of a device (`webapp/js/qr-login.js`, `kind=machine` in the code). The relay only passes the box on.
    An admin who scans the code from the row of an account ("Scan QR code") sends that account's setup link instead.
  - **A setup link** (`https://relay/#setup=…`, the invitation of an account an admin set up) joins the same way, but bound
    to one account: the relay's page for it opens `openfolk://setup?link=…`, which the app registers with the system
    (`setAsDefaultProtocolClient`, `protocols` in `package.json` for the macOS bundle; Windows and Linux hand it over
    through `second-instance`, macOS through `open-url`). The app asks once, naming the relay, and refuses with the
    reason when the profile has bots of its own or is joined to a relay already. Pasted into the invitation field, or
    into the web app's "Add" or sign-in, it works as well.
- **Disconnecting:** "Disconnect from …" (File menu, tray, macOS app menu) is offered while the backend talks to a
  relay it joined. It stops the backend, takes `RELAY_URL`, `AGENT_TOKEN`, `E2E_KEY` and `MACHINE_NAME` out of the
  profile's `.env` and starts "on this computer" again; the data folder stays as it is.
- **Moving to a relay on a server:** "on this computer" can move later. The settings claim a
  relay with the setup code from its log; the backend moves over at once and writes `RELAY_URL` into the profile's
  `.env`. The window takes the pairing link of the new relay and is signed in there from then on (`backend.js` reads
  `RELAY_URL` from the profile; `config.json` remembers the address the window is signed in at).
- **Run without signing in (Windows, Linux):** a checkbox in the tray menu and under "File", offered once the backend talks
  to a relay on a server. It asks for administrator rights (UAC) and creates the scheduled task "OpenFolk backend
  <user>" (`task.ps1`, which lies next to the app where only administrators can change it): at system start, without
  sign-in, it runs the app's backend with the profile's `.env` and data folder, so a machine woken for a routine
  reports by itself. While it is on the app never starts a backend of its own, so two never run against the same
  data; quitting the app leaves the task's backend running, and switching it off takes the backend back into the app.
  On Linux it is the systemd user service `openfolk-backend` (`~/.config/systemd/user/`, log in
  `journalctl --user -u openfolk-backend`) with lingering (`loginctl enable-linger`), so it starts at boot without a
  sign-in; no administrator rights unless the system refuses lingering, then the app names the command. Offered with
  the .deb package, not the AppImage, which mounts its files at another path on every start. macOS has no such switch.
- **Profile folder:** `%APPDATA%\OpenFolk` (Windows), `~/.config/OpenFolk` (Linux),
  `~/Library/Application Support/OpenFolk` (macOS). The choice and the address are stored in its `config.json`;
  change them via the tray menu, "File → Change setup" or, on the Mac, "OpenFolk → Change setup".
- **Allowed folders:** bots only work in the folders of `ALLOWED_ROOTS`. The app never leaves it empty (the backend's
  own default would be the whole user folder): without a choice it creates `OpenFolk` in the user folder and writes
  only that. Choosing the user folder or a drive root is allowed, with a warning. "Allowed
  folders …" (tray menu, "File"; on the Mac under "OpenFolk") opens a small window to add and remove them; saving
  writes `ALLOWED_ROOTS` into the profile's `.env` and restarts the backend as soon as no bot is working. The setup
  page offers the same list for "start on this computer". An environment variable `ALLOWED_ROOTS` on the computer
  takes precedence over the `.env` (the backend inherits the app's environment and `dotenv` does not override); the
  window says so when it is set.
- **Closing** only hides the window, the chat stays connected. It comes back through the tray icon, the Dock icon
  or a second start; quit via the tray menu, Ctrl+Q or Cmd+Q.
- **Start at login:** checkbox in the tray menu ("Start with Windows") or, on the Mac, in the "OpenFolk" menu. On
  Linux it writes `~/.config/autostart/openfolk.desktop`.
- **Tray on Linux:** KDE, Ubuntu's GNOME and most other desktops show the icon; plain GNOME needs the
  AppIndicator extension. Without a tray, starting OpenFolk again brings the hidden window back.
- Login, device key (E2E) and display settings live in the app's profile under the origin `openfolk://app`, separate
  from the browser. The page's security policy is the relay's, with connections to any relay allowed. Microphone
  (voice messages) and notifications are allowed without a prompt; macOS itself asks once on the first microphone
  access. External links open in the default browser.
- **Handing chats over:** a backend on the same machine that runs without a desktop (a Windows task in session 0, a
  Linux service) leaves "open this chat in the IDE / in a terminal" as a job in `~/.openfolk/handover`; the app runs
  it in the signed-in session, in either mode (`handover.js`).
- **Language:** menus, tray and setup page follow the system language (German for German, English otherwise). The
  web app itself has its own language setting.
- **Push:** Electron does not support the Web Push API; the notification settings in the app apply to phones and
  browsers as before. While the window is open, the web app shows new answers itself.
- **Zoom:** Ctrl and + or - (Cmd on the Mac), also on the number pad and with the mouse wheel; Ctrl+0 returns to
  the normal size. The level applies to every page of the app and stays across starts (`zoom` in `config.json`).
- **Keyboard shortcuts:** the menu "Go" lists the web app's shortcuts (command palette Ctrl+K, new bot, back and
  forward, …; Cmd on the Mac, where the settings sit under "OpenFolk" with Cmd+,). The entries only show the keys:
  the keys themselves go to the page, so nothing runs twice, and none of them is a zoom key.
- On Windows and Linux the menu bar is hidden; Alt shows it (reload, zoom, go, full screen, developer tools).

## Develop and build

```sh
cd openfolk/desktop
npm install
npm start                # starts the app from source (the backend runs from this checkout)
npm run smoke            # the app with a profile of its own: "on this computer" end to end
npm run build            # Windows: dist/OpenFolk-Setup-0.1.0.exe (NSIS one-click, English/German, asks for
                         # admin rights once and installs for all users in C:\Program Files\OpenFolk, then starts)
npm run build:portable   # Windows: a single EXE without installation
npm run desktop:install  # Windows, from the repository root: build and install over the installed app, to try
                         # the current state before a release (--no-build installs the last build again)
npm run build:linux      # Linux: dist/OpenFolk-0.1.0-x86_64.AppImage and dist/OpenFolk-0.1.0-amd64.deb
npm run build:mac        # macOS: dist/OpenFolk-0.1.0-arm64.dmg and .zip on Apple Silicon, -x64.dmg on an Intel Mac
```

Every build first runs `npm run bundle` (`../scripts/desktop-bundle.mjs`): backend, relay and web app as sources
plus their production dependencies go to `build/openfolk` (about 300 MB, most of it the Claude Code binary) and from
there to `resources/openfolk` in the app. Codex and Copilot stay out. npm installs the Claude Code binary of the
system it runs on, so each app is built on its own system: Windows on Windows, Linux on Linux (or WSL with WSLg),
the Mac app on a Mac. Electron's own Node runs the backend; `backend.js` starts it, restarts it after a restart
request and stops it on quit. A built app is checked with `node ../scripts/desktop-smoke.mjs --exe <app>`, e.g.
`dist/win-unpacked/OpenFolk.exe`, `dist/linux-unpacked/openfolk` or `dist/mac-arm64/OpenFolk.app/Contents/MacOS/OpenFolk`.

**Releases:** `.github/workflows/desktop.yml` does all of this in CI, each app on a runner of its own system (Windows,
macOS on Apple Silicon, macOS on Intel, Linux): build, smoke test against the built app, packages as workflow artifacts.
When a release is published on GitHub it attaches the installer, the DMG and ZIP of each Mac, the AppImage and the .deb,
the update feeds (`latest.yml`, `latest-mac.yml`, `latest-linux.yml` and the blockmaps), then a `SHA256SUMS` over the
packages. Each Mac build writes a `latest-mac.yml` of its own; the job `mac-feed` merges the two into one, from which
electron-updater picks the files of the Mac's architecture ("arm64" in the name or not). Nothing
is uploaded by hand; openfolk.app always links to the latest release. File names carry no spaces, because the update
feeds name the files as GitHub stores them.

**Updates:** the installed app updates itself from the GitHub releases (`updater.js`, electron-updater): a check half a
minute after start and every six hours, the download in the background, then a question "Restart now" or "Later".
"Later" installs on the next quit. Either way the app quits as it always does, so a working bot finishes first; only
then the new version is installed and, after "Restart now", started. "Check for updates …" sits in the tray menu, in
"Help" and, on the Mac, in the "OpenFolk" menu; a check from there says what it found, the automatic ones stay quiet.
"Check for updates automatically" right below it switches the automatic checks and downloads off and on at once,
without a restart, stored as `autoUpdate` in `config.json`; a check from the menu works either way.
The settings of the app's own page have the same under "About" (`update-*` in `main.js`, `desktopUpdates` in
`webapp/js/platform.js`): where the update stands (checking, up to date, downloading, ready, failed with the reasons),
"Check for updates" or, once a version is downloaded, "Restart now", and the switch for the automatic checks.
Not updated: a build started from source, the portable EXE, a Mac app without a Developer ID signature (Squirrel.Mac
installs only signed apps), and the smoke test (`OPENFOLK_NO_UPDATE=1`); there the entry is shown off and disabled.

**Update feed and counting:** the app asks `https://openfolk.app/update` for the feed (`update.php` of the landing page,
repo `openfolk.app`); it hands out the feed files of the latest release and redirects every package to GitHub. When
openfolk.app does not answer, the same check goes straight to GitHub. The first check of a day (UTC) sends the header
`X-OpenFolk-Active: <version>`; openfolk.app adds one to a daily total per system and version, without IP address or
any identifier. These totals are public at `https://openfolk.app/update/stats.json`. The menu entry "Count this
installation anonymously" (next to "Check for updates …") switches the header off; the setting lives in
`update-count.json` in the profile.

**Signing:** CI signs each system as soon as its secrets exist in the repository's settings (Settings, Secrets and
variables, Actions); without them that system builds unsigned, as before.

| System | Secrets | Variables |
| --- | --- | --- |
| macOS | `MAC_CERTIFICATE_P12` (Developer ID Application certificate as base64 .p12), `MAC_CERTIFICATE_PASSWORD`; for notarization `APPLE_API_KEY_P8` (content of the App Store Connect API key), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | – |
| Windows | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` of an app registration with the role "Trusted Signing Certificate Profile Signer" and a federated credential for the environment `release` of this repository (OIDC, no client secret) | `AZURE_SIGNING_ENDPOINT` (the region of the signing account, e.g. `https://neu.codesigning.azure.net/`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `AZURE_SIGNING_PUBLISHER` (the name on the certificate) |

Windows is signed only in the build of a published release: only that job runs in the environment `release`
(limited to tags `v*`), which the federated credential trusts. Builds of `main` and pull requests stay unsigned.

The Mac app runs with the hardened runtime and the entitlements in `build/entitlements.mac.plist` (JIT for V8 and the
Claude Code binary, microphone, camera); the job log says which system was signed.

- **Windows:** release builds are signed with Azure Trusted Signing (publisher "Flowdesk GmbH", timestamped); builds of
  `main` stay unsigned. SmartScreen may still ask while the publisher builds up download reputation.
- **Linux:** the AppImage runs after `chmod +x` and needs `libfuse2` (`APPIMAGE_EXTRACT_AND_RUN=1` works without
  it). The .deb installs to `/opt/OpenFolk` with an entry in the application menu
  (`sudo apt install ./OpenFolk-0.1.0-amd64.deb`).
- **macOS:** release builds are signed with a Developer ID and notarized, so they open without a warning. A build without
  the secrets (e.g. from a fork) needs right-click → "Open" on first open, or allowing it in System Settings under
  "Privacy & Security". It is built and checked on a Mac, locally or by CI; what is Mac-specific (menu bar,
  Dock, no tray) sits behind `MAC` in `main.js`.

`dist/`, `build/openfolk/` and `node_modules/` are not versioned. Icons: `build/icon.png` (installers, window; the
Mac's `.icns` is made from it) and `build/tray.png` (tray), both copies from `../webapp/icons/`.
