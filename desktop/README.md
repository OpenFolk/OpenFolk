# OpenFolk for the desktop

OpenFolk as a program of its own for Windows, Linux and macOS, around the web app from `../webapp/`. One project
builds all three: the Windows installer, the Linux AppImage and .deb, the Mac's .dmg. On Windows and Linux the app
lives in the tray, on the Mac in the Dock and the menu bar; everything else is the same.

- **First start:** the app asks whether there is an OpenFolk server already. The two ways sit side by side, the
  server first, because picking "on this computer" where a backend already runs would start a second one with
  separate bots and chats.
  - **Start on this computer** ("new to OpenFolk, without a server"): the app runs the backend (`../local/`) itself, with the relay embedded on 127.0.0.1, and
    signs its window in with a pairing link. Nothing to host; the only step left is signing in to Claude Code
    (the first steps in the app show how). Data, keys and the backend's log (`local.log`) live in `data` in the
    profile folder (below); settings that `.env.sample` describes go into `.env` there. Quitting the app ends the
    backend once no bot is working, after asking if that takes a while. "Sign this window in again" (tray menu,
    on the Mac "Window") helps after logging the device out. This is the single-computer setup: your phone, or
    the browser on another device, needs a relay on a server (`../docs/running.md`, linked from the setup page).
  - **I already have an OpenFolk server:** the app loads the web app from that relay, like the browser, and needs no
    backend of its own. To test against a local relay, `OPENFOLK_URL=http://localhost:8787` presets it for one
    start.
  - **Connect this computer to my server:** the link from "Add machine" (settings of the app on a device that is
    signed in) joins this computer to that relay: `../local/tools/join.mjs` writes the relay, a token of this
    computer's own and the end-to-end key into the profile's `.env`, and the app runs the backend as "on this
    computer", only with the relay on the server. The window comes from there and signs itself in with a pairing link.
- **Moving to a relay on a server:** "on this computer" can move later. The first steps or the settings claim a
  relay with the setup code from its log; the backend moves over at once and writes `RELAY_URL` into the profile's
  `.env`. The window follows the pairing link of the new relay, and from then on the app loads the web app from there
  (`backend.js` reads `RELAY_URL` from the profile; `config.json` remembers the address the window is signed in at).
- **Run without signing in (Windows):** a checkbox in the tray menu and under "File", offered once the backend talks
  to a relay on a server. It asks for administrator rights (UAC) and creates the scheduled task "OpenFolk backend
  <user>" (`task.ps1`, which lies next to the app where only administrators can change it): at system start, without
  sign-in, it runs the app's backend with the profile's `.env` and data folder, so a machine woken for a routine
  reports by itself. While it is on the app never starts a backend of its own, so two never run against the same
  data; quitting the app leaves the task's backend running, and switching it off takes the backend back into the app.
- **Profile folder:** `%APPDATA%\OpenFolk` (Windows), `~/.config/OpenFolk` (Linux),
  `~/Library/Application Support/OpenFolk` (macOS). The choice and the address are stored in its `config.json`;
  change them via the tray menu, "File → Change setup" or, on the Mac, "OpenFolk → Change setup".
- **Closing** only hides the window, the chat stays connected. It comes back through the tray icon, the Dock icon
  or a second start; quit via the tray menu, Ctrl+Q or Cmd+Q.
- **Start at login:** checkbox in the tray menu ("Start with Windows") or, on the Mac, in the "OpenFolk" menu. On
  Linux it writes `~/.config/autostart/openfolk.desktop`.
- **Tray on Linux:** KDE, Ubuntu's GNOME and most other desktops show the icon; plain GNOME needs the
  AppIndicator extension. Without a tray, starting OpenFolk again brings the hidden window back.
- Login, device key (E2E) and display settings live in the app's profile, separate from the browser. Microphone
  (voice messages) and notifications are allowed without a prompt; macOS itself asks once on the first microphone
  access. External links open in the default browser.
- **Handing chats over:** a backend on the same machine that runs without a desktop (a Windows task in session 0, a
  Linux service) leaves "open this chat in the IDE / in a terminal" as a job in `~/.openfolk/handover`; the app runs
  it in the signed-in session, in either mode (`handover.js`).
- **Language:** menus, tray and setup page follow the system language (German for German, English otherwise). The
  web app itself has its own language setting.
- **Push:** Electron does not support the Web Push API; the notification settings in the app apply to phones and
  browsers as before. While the window is open, the web app shows new answers itself.
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
Not updated: a build started from source, the portable EXE, a Mac app without a Developer ID signature (Squirrel.Mac
installs only signed apps), and the smoke test (`OPENFOLK_NO_UPDATE=1`).

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
