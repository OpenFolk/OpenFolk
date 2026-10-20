# The web app

One `webapp/` for the browser, the desktop apps and the mobile apps. No framework, no build: ES modules with JSDoc
types, checked by `tsc -p webapp` (`npm run typecheck`). This keeps the barrier for contributors at `npm install`
and lets the relay serve the files as they are.

## Load-time code lives in start.js

The modules import each other, and `connection.js` alone pulls in most of them, so the import graph decides when a
module is evaluated; the list in `js/main.js` only loads everything and puts `start.js`, which nothing imports, last.
Nobody can tell from one file in which order the others ran. Hence:

- Code that acts at load time (wiring events, creating the first pane, starting the connection) belongs in
  `start.js`. The other modules declare and export; `core.js` looking up DOM elements and configuring marked and
  DOMPurify, and the dictionaries registering, are the exceptions, because they read nothing from other modules.
  Reading another module's `const` or `let` while loading fails with a TDZ error, and every browser test fails on a
  page error, so such a slip shows at once.
- Nothing imports from `start.js`. A module that did would pull `start.js` forward in the evaluation and run its
  wiring before the modules it needs exist. Shared code that `start.js` and others need lives in the module that
  owns the feature; `start.js` only wires.
- Cross-module `let` bindings are not reassigned from outside. ES module bindings are read-only for importers, so a
  module exposes a function (`activePane()`, `setActivePane()`) and tests read such values through functions.

The browser tests expose every module's exports on `window` in the test page only (`harness.mjs`,
`exposeModules`), so a test can call `openEditor(null)` or read `activePane().chatId` the way the old classic scripts
allowed. Production pages have no globals besides the two vendored libraries.

## Panes

Every open chat lives in a pane: a clone of `#pane-template` in `index.html` whose elements are found by
`data-el`, never by id, because the template is cloned once per pane. On wide screens several panes stand side by
side (`js/panes.js`: one per 640 px next to the sidebar); below that there is exactly one, and the phone layout is the
one-pane case, not a separate mode.

- **A chat is open in at most one pane.** Frames carry a chat id and go to `paneFor(chatId)`; opening a chat that is
  already open focuses its pane. Two panes on the same chat would fight over the running answer's DOM in
  `state.live`.
- **What belongs to one chat on screen lives on the pane,** not in `state`: follow, queue open, uploads, reply,
  chat search, mention list, what was rendered. `state` keeps what is true per chat regardless of the screen
  (history, live answers, approvals).
- **Events are delegated on `#panes`** (`start.js`), because panes are created after `start.js` ran and nothing may
  import it. A handler finds its pane with `paneOf(event)`. Only the scroll observers are attached per pane, in
  `createPane()`.
- **Singletons record their pane.** One microphone: the recording belongs to the pane and chat it was started in and
  is discarded when that pane switches chats. The message menu and the dialogs are global and close over the pane
  they were opened from. Messages without a chat (errors, file saving) go to the active pane.
- **Visible means read.** Chats in visible panes count as seen; panes parked because the window got narrower keep
  their draft and scroll position but not the read state. Push is unaffected; the backend only knows whether the
  app is visible.

## The platform layer

Everything that differs between browser, desktop and mobile goes through `js/platform.js`: the relay address (the
page's origin, or the address the app stores), push (Web Push, or APNs and FCM through Capacitor), opening a chat
from a notification, the end-to-end key's storage (IndexedDB as a non-extractable key, or Keychain and Keystore),
saving a file (download, or the share sheet) and the number on the app icon. Feature code asks the platform layer
and does not test `navigator` itself. A new native capability gets a function there first and a stand-in in the
browser tests (`native-app.test.mjs`), which is how the app paths are tested without a device.

## Texts

Every text a user reads is a key in `webapp/i18n/en.js` and `de.js`, with the same keys and the same
placeholders; `tests/browser/i18n-keys.test.mjs` fails on a key that exists in one language only or is used in
the code but missing. Texts produced by a backend come as keys too (`local/src/i18n.ts`) or as a `MessageCode`
the web app translates, so a backend never has to know the device's language.
