/* OpenFolk web app: entry module. The modules import each other (connection.js alone pulls in most of them), so the
   import graph, not this list, decides when each one is evaluated; the list only makes sure all of them are loaded and
   that start.js, which nothing imports, runs last. Hence: code that runs at load time (wiring events, creating the
   first pane, starting) belongs in start.js only; the other modules declare and export. A module that reads another
   module's binding while loading fails with a TDZ error, and every browser test fails on a page error. */
import './i18n.js';
import '../i18n/en.js';
import '../i18n/de.js';
import './platform.js';
import './core.js';
import './panes.js';
import './e2e.js';
import './welcome.js';
import './connection.js';
import './list.js';
import './chat.js';
import './machines.js';
import './chat-features.js';
import './queue.js';
import './voice.js';
import './menus.js';
import './vscode.js';
import './editors.js';
import './push.js';
import './settings.js';
import './accounts.js';
import './qr-login.js';
import './others.js';
import './start.js';
