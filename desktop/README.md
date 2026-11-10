# OpenFolk for the desktop

OpenFolk as a program of its own for Windows, Linux and macOS, around the web app from `../webapp/`, which the app
brings along and shows under its own address `openfolk://app` (like the mobile apps; the browser gets it from the
relay). One project builds all three: the Windows installer, the Linux AppImage and .deb, the Mac's .dmg. On Windows
and Linux the app lives in the tray, on the Mac in the Dock and the menu bar; everything else is the same.

- **First start:** the app asks how to use OpenFolk and letters the three ways A to C, as alternatives rather than steps: start on this
  computer, also connect this computer to a relay server, and display only. They stand one below the other, each as
  wide as the page, with a folded explanation of bot, backend and relay server on top. Only A, the way for newcomers,
  has the filled button. Picking A where a backend already runs would start a second one with separate bots and
  chats, so A says to use C then.
  - **A. Start on this computer** ("new to OpenFolk, without a relay server"): the app runs the backend (`../local/`) itself, with the relay embedded on 127.0.0.1, and
    signs its window in with a pairing link. Nothing to host; the only step left is signing in to Claude Code
    (the first steps in the app show how). Data, keys and the backend's log (`local.log`) live in `data` in the
    profile folder (below); settings that `.env.sample` describes go into `.env` there. Quitting the app ends the
    backend once no bot is working, after asking if that takes a while. "Sign this window in again" (tray menu,
    on the Mac "Window") helps after logging the device out. This is the single-computer setup: your phone, or
    the browser on another device, needs a relay on a server (`../docs/running.md`, linked from the setup page).
  - **C. Display only, an existing relay server:** the app points its web app at that relay and needs no backend of
    its own. To test against a local relay, `OPENFOLK_URL=http://localhost:8787` presets it for one start. The setup
    page warns here that this app then starts no backend on this computer, and asks once more ("Yes, no bots run on
    this computer") unless the app already uses this way.
  - **Several relays:** like the mobile apps, the desktop app can be signed in to further relays, for example one per
    customer (settings → Accounts → "Add" with a pairing link from there; switch at the top of the sidebar, the
    chat list shows the bots of all of them).
  - **B. Also connect this computer to my relay server:** the link from "Add machine" (settings of the app on a device that is
    signed in) joins this computer to that relay: `../local/tools/join.mjs` writes the relay, a token of this
    computer's own and the end-to-end key into the profile's `.env`, and the app runs the backend as "on this
    computer", only with the relay on the server. The window comes from there and signs itself in with a pairing link.
    Instead of the link, the page shows a QR code for the relay's address (`qr-join.js`): a signed-in phone scans it,
    the user confirms there, a backend mints the invitation and the phone sends it back sealed for the app's key, as in
    the QR sign-in of a device (`webapp/js/qr-login.js`, `kind=machine` in the code). The relay only passes the box on.
  - **A setup link** (`https://relay/#setup=…`, from an admin's "Set up" in the accounts) joins the same way, but bound
    to one account: the relay's page for it opens `openfolk://setup?link=…`, which the app registers with the system
    (`setAsDefaultProtocolClient`, `protocols` in `package.json` for the macOS bundle; Windows and Linux hand it over
    through `second-instance`, macOS through `open-url`). The app asks once, naming the relay, and refuses with the
    reason when the profile has bots of its own or is joined to a relay already. Pasted into B it works as well.
- **Disconnecting:** "Disconnect from …" (File menu, tray, macOS app menu) is offered while the backend talks to a
  relay it joined. It stops the backend, takes `RELAY_URL`, `AGENT_TOKEN`, `E2E_KEY` and `MACHINE_NAME` out of the
  profile's `.env` and starts "on this computer" again; the data folder stays as it is.
- **Moving to a relay on a server:** "on this computer" can move later. The first steps or the settings claim a
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
- On Windows and Linux the menu bar is hidden; Alt shows it (reload, zoom, full screen, developer tools).

## Develop and build

```sh
cd openfolk/desktop
npm install
npm start                # starts the app from source (the backend runs from this checkout)
npm run smoke            # the app with a profile of its own: "on this computer" end to end
npm run build            # Windows: dist/OpenFolk-Setup-0.1.0.exe (NSIS, English/German, for all users in
                         # C:\Program Files\OpenFolk, folder selectable, asks for admin rights)
npm run build:portable   # Windows: a single EXE without installation
npm run build:linux      # Linux: dist/OpenFolk-0.1.0-x86_64.AppImage and dist/OpenFolk-0.1.0-amd64.deb
npm run build:mac        # macOS: dist/OpenFolk-0.1.0-arm64.dmg and .zip (on Apple Silicon)
```

Every build first runs `npm run bundle` (`../scripts/desktop-bundle.mjs`): backend, relay and web app as sources
plus their production dependencies go to `build/openfolk` (about 300 MB, most of it the Claude Code binary) and from
there to `resources/openfolk` in the app. Codex and Copilot stay out. npm installs the Claude Code binary of the
system it runs on, so each app is built on its own system: Windows on Windows, Linux on Linux (or WSL with WSLg),
the Mac app on a Mac. Electron's own Node runs the backend; `backend.js` starts it, restarts it after a restart
request and stops it on quit. A built app is checked with `node ../scripts/desktop-smoke.mjs --exe <app>`, e.g.
`dist/win-unpacked/OpenFolk.exe`, `dist/linux-unpacked/openfolk` or `dist/mac-arm64/OpenFolk.app/Contents/MacOS/OpenFolk`.

**Releases:** `.github/workflows/desktop.yml` does all of this in CI, each app on a runner of its own system (Windows,
macOS on Apple Silicon, Linux): build, smoke test against the built app, packages as workflow artifacts. When a release
is published on GitHub it attaches the installer, the DMG and ZIP, the AppImage and the .deb, the update feeds
(`latest.yml`, `latest-mac.yml`, `latest-linux.yml` and the blockmaps), then a `SHA256SUMS` over the packages. Nothing
is uploaded by hand; openfolk.app always links to the latest release. File names carry no spaces, because the update
feeds name the files as GitHub stores them.

**Updates:** the installed app updates itself from the GitHub releases (`updater.js`, electron-updater): a check half a
minute after start and every six hours, the download in the background, then a question "Restart now" or "Later".
"Later" installs on the next quit. Either way the app quits as it always does, so a working bot finishes first; only
then the new version is installed and, after "Restart now", started. "Check for updates …" sits in the tray menu, in
"Help" and, on the Mac, in the "OpenFolk" menu; a check from there says what it found, the automatic ones stay quiet.
"Check for updates automatically" right below it switches the automatic checks and downloads off and on at once,
without a restart, stored as `autoUpdate` in `config.json`; a check from the menu works either way.
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

- **Windows:** unsigned until Azure Trusted Signing is set up (above); SmartScreen asks on first start.
- **Linux:** the AppImage runs after `chmod +x` and needs `libfuse2` (`APPIMAGE_EXTRACT_AND_RUN=1` works without
  it). The .deb installs to `/opt/OpenFolk` with an entry in the application menu
  (`sudo apt install ./OpenFolk-0.1.0-amd64.deb`).
- **macOS:** until signing and notarization are set up (above), on first open right-click → "Open", or allow it in System
  Settings under "Privacy & Security". It is built and checked on a Mac, locally or by CI; what is Mac-specific (menu bar,
  Dock, no tray) sits behind `MAC` in `main.js`.

`dist/`, `build/openfolk/` and `node_modules/` are not versioned. Icons: `build/icon.png` (installers, window; the
Mac's `.icns` is made from it) and `build/tray.png` (tray), both copies from `../webapp/icons/`.
