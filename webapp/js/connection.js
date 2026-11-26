/* OpenFolk web app: connection to the relay and handling of incoming frames. */
import { t, tn } from './i18n.js';
import { COLLAPSED_KEY, DEVICE_KEY, SIGNED_OUT_KEY, TOKEN_KEY, el, peopleWithPictures, state, storage, toast } from './core.js';
import { activePane, capacity, createPane, isWide, paneFor, panes, rememberedPanes, visibleChats } from './panes.js';
import { askForKey, bot, botIdOf, decrypt, e2e, group, imageOriginal, isGroup, isPerson, mergeStates, plain, send, senderName, upper } from './e2e.js';
import { jumpToEntry, listTap, renderChatList, renderSearchResult, renderUsage, setSearchMarks } from './list.js';
import { BRIEFLY_GONE_MS, closeChat, loadingBar, openChat, renderChatHeader, renderHeaders, updateSendAllowed } from './chat.js';
import { BACKEND_GONE_MS, refreshMachinesPage, renderMachines, scheduleWakePoll } from './machines.js';
import { historyUnchanged, markSeen, receiveCommands, noteIncoming, receiveSeen, renderEntry, renderHistory, renderPinned, reportFailed, reportSent, scroll, setLike, setRead } from './chat-features.js';
import { approvalsToBottom, attachmentBar, composerButtons, dropStaleLive, expireApprovalCard, finishLiveText, getLive, isQueued, liveWrap, receiveToolOutput, renderApprovals, renderJobs, renderLiveText, renderQueue, setDeleted, setDiscarded, setMoved, showEvent, toolRow } from './queue.js';
import { dictationDone, dictationRefused, imageRequested, playback, removeVoicePending, startPlayback } from './voice.js';
import { mediaArrived } from './media.js';
import { bundled, connectionVia, desktopMachine, needsRelayAddress, relayAddress, saveFile, socketUrl } from './platform.js';
import { answerFolderAsk, closeDialog, gitError, receiveDuplicated, receiveGitChanges, receiveGitCommit, receiveGitStatus, renderGitTotal, renderInfoChat } from './menus.js';
import { receiveVscodeHistory, receiveVscodeSessions, vs, vscodeError, vscodeReconnected, vscodeShown } from './vscode.js';
import {
    continueMove, fillInfo, folderRequestUnknown, knowledgeError, moveRequestFailed, openInfo, pickerFailed, receiveCloned, receiveFolderChecked, receiveFolderCreated, receiveFolderListed, receiveFolderProposed, receiveMoved, refreshInfo,
    receiveSuggestion, renderRoutines, suggestButton,
} from './editors.js';
import { checkPush, renderPushSettings } from './push.js';
import { focusMethod, renderMethods, takeDesktopPassword } from './login-method.js';
import { presenceToNewMachines, presenceUnknown } from './activity.js';
import {
    autologonReported, machineJoinError, settingsSaveFailed, settingsSaved, receiveMachineTokens, receiveSettings, renderDevices, renderMachineJoin, renderAbout, renderPairLink, renderSettings, renderTotp,
    renderTotpSetup, totpError,
} from './settings.js';
import { accountError, dropCurrentAccount, newAccountFailed, receiveAccountCreated, receiveInvite, rememberAccount, renderAccountList, renderAccounts, renderChooser } from './accounts.js';
import { receiveSetupLink, receiveSetups, setRelayMachines } from './setups.js';
import { receiveVault, renderVault, vaultError } from './vault.js';
import { connectOthers } from './others.js';
import { signInTerminalAnswer } from './welcome.js';
import { announceMove, relayClaimed, relayClaimFailed } from './relay-claim.js';
import { approvalError, approvalLink, approvalWaiting, receivePairApproved, receivePairRequest, startApproval, startQrLogin, stopQrLogin } from './qr-login.js';
import { answerDone, speechAudio } from './read-aloud.js';
import { alertDialog } from './dialogs.js';
import { talkAnswer, talkDelta, talkError, talkHeard, talkInterim, talkStarted } from './talk.js';
import { talkAnswerSdp, talkRefused } from './talk-realtime.js';
import { missionError, missionSaved, receiveMissionDetail, receiveMissions, receiveProposal, refreshMissionsPage } from './missions.js';
import { refused, resendWaiting, stored } from './outbox.js';

// ================================================================ Connection

// Whether the relay wants the code from the authenticator app: from its /health, or from a refused sign-in (relays
// from before /health said so)
let totpActive = false;

/**
 * Asks the relay at the address in the form whether it wants a code, and shows the field accordingly. `other`: the
 * app's address changed, what the previous relay said no longer counts.
 */
export async function checkTotp(other = false) {
    if (other) totpActive = false;
    el.loginTotpField.hidden = !totpActive;
    let base;
    try {
        base = new URL('/health', bundled ? el.loginRelay.value.trim() : location.origin);
    } catch {
        return;
    }
    try {
        const health = await (await fetch(base, { cache: 'no-store' })).json();
        if (health && health.totp) totpActive = true;
    } catch { /* no answer: the field appears if the relay asks for a code */ }
    el.loginTotpField.hidden = !totpActive;
}

export function showLogin(message, code = '') {
    // Signed in out of sight by the desktop app: a refusal goes back to its setup page, a question (a TOTP code) to
    // the user in the window
    if (message && desktopMachine) desktopMachine.needed(message, code);
    el.login.hidden = false;
    el.loginError.textContent = message || '';
    el.loginError.hidden = !message;
    // The apps bring the web app along and need the relay's address; the browser's page is served by the relay, so
    // there the field only shows where this page comes from
    el.loginIntro.textContent = '';
    const relayLabel = /** @type {HTMLElement} */ (el.loginRelay.previousElementSibling);
    relayLabel.dataset.i18n = bundled ? 'login.relay' : 'login.server';
    relayLabel.textContent = t(relayLabel.dataset.i18n);
    el.loginRelay.readOnly = !bundled;
    el.loginRelay.tabIndex = bundled ? 0 : -1;
    if (!bundled || !el.loginRelay.value) el.loginRelay.value = relayAddress();
    renderMethods();
    focusMethod();
    void takeDesktopPassword();
    void checkTotp();
    // A scanned QR code of a new device: this one has to be signed in before it can approve it
    if (!message && approvalWaiting()) {
        el.loginError.textContent = t('qr.signInFirst');
        el.loginError.hidden = false;
    }
    void startQrLogin();
    renderChooser();
}

/** Asked once per page: the desktop app sets up the computer it runs on. */
let machineAsked = false;

/**
 * The desktop app signed in at a relay and this computer runs no backend there yet: ask the relay for this computer's
 * invitation ("machine_own"), which the app redeems in its step "Set up this computer". Only when the backend can get
 * the right end-to-end key: the app knows it, or nothing here is encrypted yet (no key, no machine awake).
 */
function offerOwnMachine() {
    if (!desktopMachine || machineAsked) return;
    machineAsked = true;
    // The machines awake and a first encrypted frame arrive right after the sign-in
    setTimeout(async () => {
        const { wanted, key } = await desktopMachine.wanted(relayAddress());
        const fresh = !e2e.key && !e2e.seenActive && state.online.length === 0;
        if (wanted && state.signedIn && (key || fresh)) send({ type: 'machine_own' });
        else desktopMachine.none();
    }, 1500);
}

/** Sign-in: a pairing link once, otherwise the device key, otherwise once the password (from the form or stored). */
export function credentials() {
    // One-time token of a pairing link: signs this device in without the password; on a device already signed in
    // it adds the account of the link, the one so far stays in the list (accounts.js)
    if (state.pairToken) return { type: 'auth', pair: state.pairToken, name: state.loginName || undefined };
    const device = storage.get(DEVICE_KEY);
    // While another account is being added, the current one's key waits; signed out, every key waits (accounts.js)
    if (device && !state.stashedDevice && !storage.get(SIGNED_OUT_KEY)) return { type: 'auth', device };
    const v = state.loginAttempt;
    if (v) return { type: 'auth', token: v.token, totp: v.totp || undefined, name: v.name || undefined, account: v.account || undefined };
    const old = storage.get(TOKEN_KEY);
    if (old && !storage.get(SIGNED_OUT_KEY)) return { type: 'auth', token: old };
    return null;
}

/** Texts the relay or a backend produce with a MessageCode, in the user's language; otherwise their English message. */
const MESSAGE_CODES = {
    device_logged_out: 'code.deviceLoggedOut',
    pairing_invalid: 'code.pairingInvalid',
    too_many_attempts: 'code.tooManyAttempts',
    totp_required: 'code.totpRequired',
    totp_wrong_code: 'code.totpWrongCode',
    wake_not_configured: 'code.wakeNotConfigured',
    unknown_machine: 'code.unknownMachine',
    machine_not_connected: 'code.machineNotConnected',
    no_machine_connected: 'code.noMachineConnected',
    machine_outdated: 'code.machineOutdated',
    not_allowed: 'code.notAllowed',
    account_name_taken: 'code.accountNameTaken',
};

function messageText(f) {
    if (f.code === 'wrong_password') return t(f.totp ? 'code.wrongPasswordOrCode' : 'code.wrongPassword');
    const key = MESSAGE_CODES[f.code];
    return key ? t(key, { machine: upper(f.machine || '') }) : f.message || '';
}

// Only one connection may live: two in parallel (back from the background during a planned retry,
// new sign-in) show every message twice and mix streamed text.
let retryTimer = null;

export function connect() {
    clearTimeout(retryTimer);
    retryTimer = null;
    const auth = credentials();
    if (!auth || needsRelayAddress()) {
        showLogin();
        return;
    }
    state.rejected = false;
    const old = state.ws;
    state.ws = null;
    if (old && old.readyState <= WebSocket.OPEN) old.close();
    const ws = new WebSocket(socketUrl('/ws/client'));
    state.ws = ws;
    let inbox = Promise.resolve();
    ws.onopen = () => ws.send(JSON.stringify(auth));
    ws.onmessage = (ev) => {
        if (state.ws !== ws) return;
        state.lastReceived = Date.now();
        let frame;
        try { frame = JSON.parse(ev.data); } catch { return; }
        // one after the other, because decrypting is asynchronous and the order matters
        inbox = inbox.then(() => handleIncoming(frame)).catch((e) => console.warn('Receive:', e));
    };
    ws.onclose = (ev) => {
        if (state.ws !== ws) return;
        state.ws = null;
        state.signedIn = false;
        state.onlineKnown = false;
        renderHeaders();
        setAgentStatus(false, t('status.disconnected'));
        if (ev.code === 4004) {
            if (dropCurrentAccount()) return;
            showLogin(t('login.loggedOut'));
            return;
        }
        if (state.rejected || !credentials()) return;
        // 1012: the relay restarts (deploy); the new container is there in a moment
        if (ev.code === 1012) {
            state.retryDelay = 1000;
            setAgentStatus(false, t('status.relayRestarting'));
        }
        retryTimer = setTimeout(connect, state.retryDelay);
        state.retryDelay = Math.min(state.retryDelay * 2, 15000);
    };
}

/**
 * After a longer pause (phone locked, laptop asleep) the browser often still thinks the connection is open,
 * although the relay dropped it long ago; then nothing would arrive. If a ping gets no answer, reconnect.
 */
const ALIVE_TIMEOUT_MS = 6000;
export function checkConnection() {
    const ws = state.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !state.signedIn) return;
    const since = Date.now();
    // the relay answers wake_status itself, the backends answer ping; any answer counts
    send({ type: 'wake_status' });
    send({ type: 'ping' });
    setTimeout(() => {
        if (state.ws !== ws || (state.lastReceived || 0) >= since) return;
        console.warn('Connection does not answer, reconnecting');
        connect();
    }, ALIVE_TIMEOUT_MS);
}

/**
 * Frames that arrive unencrypted even with end-to-end encryption: the relay's own (RelayFrame) and errors. pair_wait and
 * pair_first are RelayFrames too, but they only reach the sign-in page (qr-login.js), which has its own socket.
 */
const PLAIN_TYPES = new Set(['agents', 'auth', 'devices', 'accounts', 'account_created', 'account_invite', 'pair_request', 'pair_approved', 'machine_status', 'wake_result', 'machine_tokens', 'machine_own', 'totp', 'totp_setup', 'error']);
let plainWarned = false;

async function handleIncoming(f) {
    if (f.type === 'e2e') {
        e2e.seenActive = true;
        if (!e2e.key) {
            askForKey();
            return;
        }
        let inner;
        try {
            inner = await decrypt(f);
        } catch {
            askForKey(t('e2e.keyMismatch'));
            return;
        }
        if (!inner) return;
        if (f.machine) inner.machine = f.machine;
        receive(inner);
        return;
    }
    if (f.type === 'e2e_required') {
        e2e.seenActive = true;
        askForKey(e2e.key ? t('e2e.keyMismatch') : '');
        return;
    }
    // With a key, backend frames only count when encrypted: the relay could otherwise inject bots, history or
    // approvals. What the relay produces itself, and the backends' plain errors about the key, stay readable.
    if (e2e.key && !PLAIN_TYPES.has(f.type)) {
        console.warn(`E2E: unencrypted ${f.type} from ${f.machine || 'the relay'} ignored`);
        // Once per page load: that machine's bots stay invisible until it has the key; more would let a relay nag
        if (f.machine && !plainWarned) {
            plainWarned = true;
            void alertDialog(t('e2e.plainDropped', { machine: String(f.machine).toUpperCase() }));
        }
        return;
    }
    receive(f);
}

export function setAgentStatus(online, text) {
    state.agentOnline = online;
    el.agentStatus.className = 'status ' + (online ? 'online' : 'offline');
    el.agentStatus.querySelector('span').textContent = text || (online ? t('status.connected', { machines: state.online.map(upper).join(', ') }) + connectionVia() : t('status.allOff'));
    updateSendAllowed();
}

function receive(f) {
    switch (f.type) {
        case 'auth':
            if (f.ok) {
                if (f.device) {
                    // From now on only the device key; the password is stored nowhere
                    storage.set(DEVICE_KEY, f.device.token);
                    storage.remove(TOKEN_KEY);
                }
                state.pairToken = '';
                if (rememberAccount(f.account)) {
                    location.reload();
                    break;
                }
                connectOthers();
                state.loginAttempt = null;
                state.pairToken = '';
                el.loginToken.value = '';
                el.loginTotp.value = '';
                state.signedIn = true;
                announceMove();
                state.catchUp = true;
                state.retryDelay = 1000;
                el.login.hidden = true;
                stopQrLogin();
                // The machines awake follow ('agents') and get the presence then
                presenceUnknown();
                send({ type: 'wake_status' });
                scheduleWakePoll();
                startApproval();
                offerOwnMachine();
            } else {
                const paired = !!state.pairToken;
                state.rejected = true;
                storage.remove(TOKEN_KEY);
                state.loginAttempt = null;
                // A pairing token works once; after a refusal the password is the way in
                state.pairToken = '';
                // A link that no longer works on a device already signed in: say so and stay in the account
                if (paired && storage.get(DEVICE_KEY)) {
                    state.rejected = false;
                    void alertDialog(messageText(f) || t('login.failed'));
                    connect();
                    break;
                }
                if (f.loggedOut && dropCurrentAccount()) break;
                if (f.totp) totpActive = true;
                showLogin(messageText(f) || t('login.failed'), f.code || '');
            }
            break;
        case 'devices':
            renderDevices(f.list, f.current);
            break;
        case 'totp':
            renderTotp(f);
            break;
        case 'machine_tokens':
            receiveMachineTokens(f.list);
            break;
        case 'setups':
            receiveSetups(f.list);
            renderAccountList();
            break;
        case 'talk_started':
            talkStarted(f);
            break;
        case 'vault':
            receiveVault(f.entries);
            break;
        case 'setup_link':
            receiveSetupLink(f);
            break;
        case 'machine_join_link':
            if (!approvalLink(f)) renderMachineJoin(f);
            break;
        case 'totp_setup':
            renderTotpSetup(f);
            break;
        case 'accounts':
            setRelayMachines(f.machines);
            renderAccounts(f.list, f.current);
            break;
        case 'machine_own':
            if (desktopMachine && /^(join|setup)$/.test(f.kind) && typeof f.token === 'string') desktopMachine.offer({ relay: relayAddress(), kind: f.kind, token: f.token });
            break;
        case 'account_created':
        case 'account_invite':
            receiveAccountCreated(f);
            break;
        case 'pair_link':
            if (!receiveInvite(f) && !approvalLink(f)) renderPairLink(f);
            break;
        case 'pair_request':
            receivePairRequest(f);
            break;
        case 'pair_approved':
            receivePairApproved();
            break;
        case 'agents': {
            const before = state.online;
            state.online = f.online;
            resendWaiting();
            state.onlineKnown = true;
            presenceToNewMachines();
            startApproval();
            for (const r of before) if (!f.online.includes(r)) state.goneSince[r] = Date.now();
            for (const r of f.online) delete state.goneSince[r];
            // The relay knows even after a reload of the app since when a backend is gone
            for (const [r, ts] of Object.entries(f.gone || {})) if (!f.online.includes(r) && Date.parse(ts)) state.goneSince[r] = Date.parse(ts);
            // after the grace period check whether the machine is really gone
            if (before.some((r) => !f.online.includes(r))) setTimeout(renderHeaders, BRIEFLY_GONE_MS + 500);
            // drop states and approvals of machines that left
            for (const r of Object.keys(state.perMachine)) if (!f.online.includes(r)) delete state.perMachine[r];
            for (const r of Object.keys(state.gitPerMachine)) if (!f.online.includes(r)) delete state.gitPerMachine[r];
            for (const r of Object.keys(state.backendPerMachine)) if (!f.online.includes(r)) delete state.backendPerMachine[r];
            renderGitTotal();
            continueMove();
            if (!el.settings.hidden) renderVault();
            // The first steps (empty list) show which machines are connected
            if (!allChats().length) renderChatList();
            // A backend that never sends its bots must not leave the list loading for good
            if (f.online.length && !state.botsKnown) setTimeout(() => { if (!state.botsKnown) { state.botsKnown = true; renderChatList(); } }, 5000);
            for (const [id, a] of Object.entries(state.approvals)) if (a.machine && !f.online.includes(a.machine)) delete state.approvals[id];
            mergeStates();
            for (const r of Object.keys(state.shuttingDown)) {
                if (f.online.includes(r)) continue;
                // a restarting machine comes back by itself; if it does not, "backend gone" is the right text
                if (!state.restarting[r]) state.shutdownPlanned[r] = true;
                delete state.shuttingDown[r];
                delete state.restarting[r];
            }
            for (const r of f.online) delete state.shutdownPlanned[r];
            // If a backend does not come back although the machine runs, point it out after the waiting time
            if (before.some((r) => !f.online.includes(r))) setTimeout(renderMachines, BACKEND_GONE_MS + 500);
            for (const r of f.online) {
                if (!before.includes(r) && state.waking[r]) {
                    delete state.waking[r];
                    showEvent(t('machine.awake', { machine: upper(r) }));
                }
            }
            setAgentStatus(f.online.length > 0);
            const open = openChats();
            if (f.online.length && open.length && !before.length) for (const id of open) send({ type: 'history', chatId: id });
            // Reconnected while machines stayed awake: what happened in the pause is missing otherwise in the open chats
            // and in the previews (unread) of the others
            else if (f.online.length && state.catchUp) {
                for (const id of open) send({ type: 'history', chatId: id });
                for (const id of allChats()) if (!open.includes(id)) send({ type: 'history', chatId: id, limit: 1 });
            }
            if (f.online.length) state.catchUp = false;
            vscodeReconnected(f.online);
            renderChatList();
            renderMachines();
            renderHeaders();
            checkPush();
            break;
        }
        case 'machine_status':
            state.machineStatus = f;
            renderMachines();
            renderHeaders();
            break;
        case 'machine_shutdown_result': {
            const r = f.machine || '?';
            if (!f.ok) void alertDialog(t(f.cancel ? 'machine.cancelFailed' : f.restart ? 'machine.restartFailed' : 'machine.shutdownFailed', { machine: upper(r), error: f.message || t('error.unknown') }));
            else if (f.cancel) { delete state.shuttingDown[r]; delete state.restarting[r]; }
            else {
                state.shuttingDown[r] = Date.parse(f.at) || Date.now() + 60000;
                if (f.restart) state.restarting[r] = true;
                else delete state.restarting[r];
            }
            renderMachines();
            break;
        }
        case 'machine_capabilities': {
            const r = f.machine || '?';
            state.capabilities[r] = { shutdown: f.shutdown, shutdownSeconds: f.shutdownSeconds, cancelShutdown: f.cancelShutdown, autologon: f.autologon, restart: f.restart };
            renderMachines();
            break;
        }
        case 'machine_settings': {
            const r = f.machine || '?';
            state.machineSettings[r] = {
                settings: f.settings, anthropicKey: f.anthropicKey, gitPushToken: f.gitPushToken, engineKeys: f.engineKeys, keyFallback: f.keyFallback, offers: f.offers, shutdownMethod: f.shutdownMethod, voice: f.voice,
                roots: f.roots,
            };
            settingsSaved(r);
            if (!el.settings.hidden) renderSettings();
            // The first steps offer the choice of engines only to whoever receives the machine settings
            if (!state.bots.length) renderChatList();
            break;
        }
        case 'machine_autologon_status': {
            const r = f.machine || '?';
            if (!f.ok) void alertDialog(t('machine.autologonFailed', { machine: upper(r), error: f.message || t('error.unknown') }));
            else state.autologon[r] = { on: f.on, password: f.password };
            autologonReported(r, f.ok);
            renderMachines();
            break;
        }
        case 'wake_result':
            if (f.ok) state.waking[f.host] = Date.now();
            else void alertDialog(t('machine.wakeFailed', { machine: upper(f.host), error: messageText(f) || t('error.unknown') }));
            renderMachines();
            renderHeaders();
            scheduleWakePoll();
            break;
        case 'bots':
            state.botsKnown = true;
            state.bots = f.bots;
            state.groups = f.groups;
            // "Keep its bots in the folder" just set, and the machine's answer does not carry it: its backend predates it
            const stayAsked = state.categoryStayPending;
            if (stayAsked && Date.now() < stayAsked.until) {
                const back = (f.categories || []).find((c) => c.id === stayAsked.id);
                if (back && Boolean(back.stay) !== stayAsked.stay) toast(t('category.stayNeedsBackend', { machine: upper(f.machine || '') }), 6000);
                if (back) state.categoryStayPending = null;
            }
            state.categories = f.categories || [];
            Object.assign(state.context, f.context || {});
            if (f.machine) state.backgroundPerMachine[f.machine] = f.background || {};
            if (f.machine) {
                state.perMachine[f.machine] = { states: f.states || {}, activity: f.activity || {}, activeChats: f.activeChats || {}, queues: f.queues || {} };
                for (const [id, a] of Object.entries(state.approvals)) if (a.machine === f.machine) delete state.approvals[id];
            }
            mergeStates();
            for (const a of f.approvals || []) state.approvals[a.id] = Object.assign({ machine: f.machine }, a);
            for (const id of allChats()) if (!(id in state.last)) send({ type: 'history', chatId: id, limit: 1 });
            renderChatList();
            renderGitTotal();
            refreshInfo();
            if (state.openNewBot) {
                // A bot just created in the editor: its chat, where it asks its setup questions
                const created = state.openNewBot.until > Date.now() ? f.bots.find((x) => !state.openNewBot.known.includes(x.id)) : null;
                if (created || state.openNewBot.until <= Date.now()) state.openNewBot = null;
                if (created) state.openAfterBots = created.id;
            }
            if (state.openAfterBots && allChats().includes(state.openAfterBots)) {
                openChat(state.openAfterBots);
                state.openAfterBots = null;
            } else if (!openChats().length && !state.panesRestored) {
                restorePanes();
            } else {
                // chats that disappeared (bot or group deleted, conversation archived on another device)
                for (const p of panes.filter((x) => x.chatId && !allChats().includes(x.chatId))) closeChat(p);
                for (const p of panes) {
                    if (!p.chatId) continue;
                    renderChatHeader(p);
                    renderApprovals(p);
                }
            }
            break;
        case 'report_sent':
            reportSent(f);
            break;
        case 'people': {
            state.people = peopleWithPictures(state.peopleByMachine, f);
            state.personChats = f.chats || [];
            for (const id of personChatIds()) if (!(id in state.last)) send({ type: 'history', chatId: id, limit: 1 });
            renderChatList();
            for (const p of panes) if (p.chatId && isPerson(p.chatId)) renderChatHeader(p);
            if (state.openAfterBots && allChats().includes(state.openAfterBots)) {
                openChat(state.openAfterBots);
                state.openAfterBots = null;
            }
            break;
        }
        case 'history': {
            const last = f.entries[f.entries.length - 1];
            setLast(f.chatId, last);
            noteIncoming(f.chatId, f.entries);
            dropStaleLive(f.chatId, f.live, f.machine);
            // a preview (limit 1) must not replace the full history of an open chat
            const p = paneFor(f.chatId);
            if (p && (f.entries.length > 1 || f.live.length || !state.history[f.chatId] || f.entries.length === 0)) {
                if (f.machine) state.historyFrom[f.chatId] = f.machine;
                if (!historyUnchanged(p, f.chatId, f.entries, f.live)) {
                    state.history[f.chatId] = f.entries;
                    renderHistory(p, f.live);
                }
                loadingBar(p, false);
                // History re-rendered: set the marks of the chat search or of the global search again
                if (!p.el.chatSearch.hidden || p.globalSearch) setSearchMarks(p);
                if (p.jumpTo) jumpToEntry(p);
            }
            renderChatList();
            break;
        }
        case 'user':
            stored(f.chatId, f.entry);
            // a message sent again after a dropped connection: the machine names the copy it has (outbox.js)
            if (f.entry.id && (state.history[f.chatId] || []).some((e) => e.id === f.entry.id)) break;
            if (f.entry.voice) {
                removeVoicePending(f.chatId);
                talkHeard(f.chatId, f.entry);
            }
            setLast(f.chatId, f.entry);
            noteIncoming(f.chatId, [f.entry]);
            if (!document.hidden && visibleChats().includes(f.chatId)) markSeen(f.chatId);
            (state.history[f.chatId] = state.history[f.chatId] || []).push(f.entry);
            const p = paneFor(f.chatId);
            if (p) {
                if (isQueued(f.entry, f.chatId)) {
                    renderQueue(p);
                } else {
                    renderEntry(p, f.entry);
                    approvalsToBottom(p);
                    scroll(p, true);
                }
            }
            renderChatList();
            break;
        case 'read':
            setRead(f.chatId, f.id, f.ts);
            break;
        case 'liked':
            setLike(f.chatId, f.entryId, f.on);
            break;
        case 'seen':
            receiveSeen(f);
            break;
        case 'pinned':
            if (f.all) state.pinned = f.all;
            else if (f.chatId) state.pinned[f.chatId] = f.entries || [];
            for (const p of panes) renderPinned(p);
            break;
        case 'moved':
            setMoved(f);
            break;
        case 'deleted':
            setDeleted(f);
            break;
        case 'discarded':
            setDiscarded(f);
            break;
        case 'search_result':
            renderSearchResult(f);
            break;
        case 'context':
            state.context[f.botId] = f.tokens;
            if (paneFor(f.botId)) renderChatHeader(paneFor(f.botId));
            renderInfoChat();
            break;
        case 'background': {
            const perSession = (state.backgroundPerMachine[f.machine || '?'] = state.backgroundPerMachine[f.machine || '?'] || {});
            if (f.tasks.length) perSession[f.botId] = f.tasks;
            else delete perSession[f.botId];
            renderChatList();
            renderHeaders();
            break;
        }
        case 'vscode_sessions':
            receiveVscodeSessions(f);
            break;
        case 'vscode_history':
            receiveVscodeHistory(f);
            break;
        case 'vscode_shown':
            vscodeShown(f);
            break;
        case 'commands':
            receiveCommands(f);
            break;
        case 'git_changes':
            receiveGitChanges(f);
            break;
        case 'git_commit':
        case 'git_pull':
            receiveGitCommit(f);
            break;
        case 'git_status':
            receiveGitStatus(f);
            break;
        case 'backend_status':
            state.backendPerMachine[f.machine || '?'] = f;
            if (!el.settings.hidden) renderAbout();
            renderGitTotal();
            refreshMachinesPage();
            break;
        case 'setup_status':
            state.setupPerMachine[f.machine || '?'] = f;
            renderChatList();
            // the engines' states in the machine settings
            if (!el.settings.hidden) renderSettings();
            renderGitTotal();
            refreshMachinesPage();
            break;
        case 'engine_login':
            state.engineLogin[`${f.machine || '?'}:${f.engine}`] = f;
            renderChatList();
            break;
        case 'claude_sign_in':
            signInTerminalAnswer(f.machine || '?', '', f.via);
            break;
        case 'relay_claimed':
            relayClaimed(f.machine || '?', f.url);
            break;
        case 'conversation_created':
            if (vs.adopting) {
                vs.adopting = false;
                closeDialog(el.vscode);
            }
            // The bot list with the new conversation comes first; to be safe only open it once it is known
            if (allChats().includes(f.chatId)) openChat(f.chatId);
            else state.openAfterBots = f.chatId;
            break;
        case 'settings':
            receiveSettings(f.settings, f.machine);
            settingsSaved('*');
            break;
        case 'delta': {
            const l = getLive(f.chatId, f.botId);
            l.text += f.text;
            if (paneFor(f.chatId)) renderLiveText(f.chatId, f.botId);
            talkDelta(f.chatId, f.botId, l.text);
            break;
        }
        case 'tool': {
            const l = getLive(f.chatId, f.botId);
            l.tools.set(f.tool.id, f.tool);
            const p = paneFor(f.chatId);
            if (p) {
                finishLiveText(l);
                talkInterim(f.chatId, f.botId, l.text);
                const row = toolRow(f.tool);
                l.rows.set(f.tool.id, row);
                liveWrap(f.chatId, f.botId).appendChild(row);
                l.bubble = null;
                l.text = '';
                scroll(p);
            }
            break;
        }
        case 'tool_result': {
            const l = getLive(f.chatId, f.botId);
            const tool = l.tools.get(f.id);
            if (tool) Object.assign(tool, { ok: f.ok, result: f.result, durationMs: f.durationMs });
            const row = l.rows.get(f.id);
            if (row && row.isConnected && tool) {
                const fresh = toolRow(tool);
                fresh.open = row.open;
                l.rows.set(f.id, fresh);
                row.replaceWith(fresh);
            }
            break;
        }
        case 'tool_output':
            receiveToolOutput(f);
            break;
        case 'attachment':
            if (paneFor(f.chatId)) {
                liveWrap(f.chatId, f.botId).appendChild(attachmentBar([f.attachment]));
                scroll(paneFor(f.chatId));
            }
            break;
        case 'done': {
            const chat = state.live[f.chatId];
            const l = chat && chat[f.botId];
            if (l) {
                if (l.timer) clearTimeout(l.timer);
                if (l.wrap) l.wrap.remove();
                delete chat[f.botId];
            }
            const e = f.entry;
            talkAnswer(f.chatId, e);
            if (e.text || (e.tools && e.tools.length) || (e.attachments && e.attachments.length)) {
                (state.history[f.chatId] = state.history[f.chatId] || []).push(e);
                setLast(f.chatId, e);
                noteIncoming(f.chatId, [e]);
                const p = paneFor(f.chatId);
                if (p) {
                    renderEntry(p, e);
                    approvalsToBottom(p);
                    scroll(p);
                }
            }
            renderQueue(paneFor(f.chatId));
            // open and visible: counts as seen
            if (!document.hidden && visibleChats().includes(f.chatId)) markSeen(f.chatId);
            renderChatList();
            answerDone(f.chatId, e);
            break;
        }
        case 'state':
            {
                const r = f.machine || '?';
                const j = (state.perMachine[r] = state.perMachine[r] || { states: {}, activity: {}, activeChats: {}, queues: {} });
                j.states[f.botId] = f.state;
                if (f.chatId && f.state !== 'idle' && f.state !== 'error') j.activeChats[f.botId] = f.chatId;
                else delete j.activeChats[f.botId];
                j.queues = j.queues || {};
                if (f.queue && Object.keys(f.queue).length) j.queues[f.botId] = f.queue;
                else delete j.queues[f.botId];
                if (f.activity) j.activity[f.botId] = f.activity;
                else delete j.activity[f.botId];
                mergeStates();
            }
            renderChatList();
            refreshMachinesPage();
            refreshMissionsPage();
            for (const p of panes) {
                if (!p.chatId) continue;
                renderChatHeader(p);
                renderQueue(p);
                composerButtons(p);
                // The queue shows as the bar above the input field, not as a message in the history
                if (f.detail && f.state !== 'waiting' && !/queue|Warteschlange/i.test(f.detail) && concerns(p.chatId, f.botId)) showEvent(f.detail, false, p.chatId);
            }
            break;
        case 'approval':
            state.approvals[f.approval.id] = Object.assign({ machine: f.machine }, f.approval);
            // Seen on screen: the backend need not remind a phone of it later
            if (!document.hidden && visibleChats().includes(f.approval.chatId)) markSeen(f.approval.chatId);
            renderChatList();
            renderApprovals(paneFor(f.approval.chatId));
            break;
        case 'approval_done': {
            delete state.approvals[f.id];
            const card = document.querySelector(`[data-approval="${f.id}"]`);
            // Expired: the card stays where the user would look for it, without its buttons, saying nothing happened
            if (card && f.expired) expireApprovalCard(card, f.result);
            else {
                if (card) card.remove();
                showEvent(`${f.result}`, false, f.chatId);
            }
            renderChatList();
            break;
        }
        case 'error': {
            const message = messageText(f);
            // the machine answered a message with an error: nothing to send again
            if (f.chatId && !f.request) refused(f.chatId);
            if (f.request === 'report' && reportFailed(message)) break;
            if (f.request === 'settings_save' || f.request === 'machine_settings_save') settingsSaveFailed();
            if (f.request === 'vault_save' || f.request === 'vault_delete') {
                vaultError(message);
                break;
            }
            if (f.request && /^missions?(_|$)/.test(f.request)) {
                missionError(message);
                break;
            }
            if (['pair_request', 'pair_approve', 'pair_link', 'machine_join_link'].includes(f.request) && approvalError(message)) break;
            if (f.request && f.request.startsWith('totp_')) {
                totpError(message);
                break;
            }
            // Another account, or a relay from before invitations: no "Add machine"
            if (f.request === 'machine_tokens') break;
            if (f.request === 'machine_join_link' || f.request === 'machine_token_remove') {
                machineJoinError(message);
                break;
            }
            if (f.request && f.request.startsWith('account_')) {
                el.accountsCreate.disabled = false;
                if (!newAccountFailed(message)) accountError(message);
                break;
            }
            // Warming up is only a speed-up; an older backend does not know it
            if (f.request === 'voice_warmup') break;
            if (f.request === 'transcribe') {
                dictationRefused(message);
                break;
            }
            // The command list is a help while typing: without one (older backend, folder missing) there is simply none
            if (f.request === 'commands') break;
            if (f.request === 'claude_sign_in') {
                signInTerminalAnswer(f.machine || '?', message);
                break;
            }
            if (f.request === 'relay_claim') {
                relayClaimFailed(f.machine || '?', message);
                break;
            }
            if (f.request && f.request.startsWith('vscode_')) {
                vscodeError(f, message);
                break;
            }
            if (f.request === 'folder_check' || f.request === 'folder_clone' || f.request === 'folder_propose' || f.request === 'folder_create') {
                folderRequestUnknown(f.request, message);
                break;
            }
            if (f.request === 'folder_list') {
                pickerFailed(message);
                break;
            }
            // A backend before the question: the dialog goes on without the box
            if (f.request === 'folder_delete_check') {
                answerFolderAsk(null, null);
                break;
            }
            // Deleting with the folder was refused at the last moment: nothing was deleted
            if (f.request === 'bot_delete') {
                void alertDialog(message);
                break;
            }
            if (f.request === 'bot_move') {
                moveRequestFailed();
                break;
            }
            if (f.request === 'backend_restart') {
                void alertDialog(message);
                break;
            }
            // git_pull: a backend from before the button does not know it
            if (f.request === 'git_changes' || f.request === 'git_pull') {
                gitError(message);
                break;
            }
            if (f.request === 'knowledge_save' || f.request === 'knowledge_delete') {
                state.knowledgeWaiting = false;
                knowledgeError(message);
                break;
            }
            if (f.request === 'bot_suggest') {
                for (const what of Object.keys(suggestButton)) if (suggestButton[what]().disabled) receiveSuggestion({ what, error: message });
                break;
            }
            // an old backend does not know the voice conversation over OpenAI
            if (f.request === 'talk_connect') {
                talkRefused(message);
                break;
            }
            if (f.chatId) {
                removeVoicePending(f.chatId);
                talkError(f.chatId, message);
            }
            showEvent(message, true, f.chatId || null);
            break;
        }
        case 'bot_suggestion':
            receiveSuggestion(f);
            break;
        case 'folder_checked':
            receiveFolderChecked(f);
            break;
        case 'folder_cloned':
            receiveCloned(f);
            break;
        case 'folder_proposed':
            receiveFolderProposed(f);
            break;
        case 'bot_moved':
            receiveMoved(f);
            break;
        case 'bot_duplicated':
            receiveDuplicated(f);
            break;
        case 'folder_listed':
            receiveFolderListed(f);
            break;
        case 'jobs':
            state.jobs[f.machine] = f.jobs || [];
            for (const p of panes) renderJobs(p);
            break;
        case 'folder_created':
            receiveFolderCreated(f);
            break;
        case 'folder_delete_checked':
            answerFolderAsk(f.botId, f);
            break;
        case 'folder_deleted':
            toast(t('danger.botFolderDeleted', { folder: f.folder }), 4000);
            break;
        case 'transcribed':
            dictationDone(f.id, f.ok, f.text || '', f.message || '');
            break;
        case 'models':
            state.models = f.models || [];
            if (f.machine) state.modelsPerMachine[f.machine] = state.models;
            renderHeaders();
            renderChatList();
            break;
        case 'account':
            // Every engine reports its account separately; Codex, Cursor, Copilot, Antigravity and OpenCode appear once a bot ran with them
            (state.accounts ||= {})[f.engine || 'claude'] = f;
            renderAccount();
            break;
        case 'usage':
            if (f.engine === 'codex') state.usageCodex = f.usage;
            else state.usage = f.usage;
            renderUsage();
            break;
        case 'routines':
            state.routines = f.routines;
            if (state.infoBot) renderRoutines();
            break;
        case 'missions':
            receiveMissions(f.missions);
            break;
        case 'mission_detail':
            receiveMissionDetail(f);
            break;
        case 'mission_proposal':
            receiveProposal(f.proposal, f.id);
            break;
        case 'mission_saved':
            missionSaved(f.id);
            break;
        case 'bot_info':
            if (state.infoBot !== f.botId) break;
            if (state.infoKnowledge && state.knowledgeWaiting) {
                state.knowledgeWaiting = false;
                closeDialog(el.kEditor);
            }
            fillInfo(f.info);
            break;
        case 'speech':
            speechAudio(f);
            break;
        case 'talk_answer':
            talkAnswerSdp(f);
            break;
        case 'file':
            if (mediaArrived(f)) break;
            if (playback.has(f.path)) startPlayback(f);
            else if (imageRequested.delete(f.path)) imageOriginal(f);
            else saveFile(f).catch((e) => showEvent(t('file.saveFailed', { error: e.message }), true));
            break;
        case 'push_key':
            if (f.machine) {
                state.pushKeys[f.machine] = f.publicKey;
                // Backends from before the apps only know Web Push
                state.pushChannels[f.machine] = f.channels || ['web'];
            }
            checkPush();
            break;
        case 'push_settings':
            // several machines report their settings; the newest wins
            if (!state.pushSettings || (f.settings.updatedAt || '') >= (state.pushSettings.updatedAt || '')) {
                state.pushSettings = f.settings;
                if (!el.settings.hidden) renderPushSettings();
            }
            break;
        default:
            break;
    }
}

/** Account line on the machines page: one part per engine that reported. */
export function renderAccount() {
    const a = state.accounts || {};
    el.account.textContent = [
        a.claude && `${a.claude.apiKeySource !== 'none' ? t('account.apiKey') : a.claude.subscription || t('account.unknownPlan')} · Claude Code ${a.claude.version}`,
        a.codex && `ChatGPT ${a.codex.subscription || ''} · Codex ${a.codex.version}`,
        a.cursor && `Cursor ${a.cursor.version}`,
        a.copilot && `Copilot ${a.copilot.version}`,
        a.antigravity && `Antigravity ${a.antigravity.version}`,
        a.opencode && `OpenCode ${a.opencode.version}`,
    ].filter(Boolean).join(' | ');
}

/** What carries favorite and mute of a chat: its bot, its group, or the record of a person chat (made on first use). */
function flagsOf(chatId) {
    if (isGroup(chatId)) return group(chatId);
    if (!isPerson(chatId)) return bot(chatId);
    const id = chatId.slice(2);
    let c = state.personChats.find((x) => x.id === id);
    if (!c) state.personChats.push(c = { id, updatedAt: '' });
    return c;
}

/** Whether this account blocked the person of a person chat. */
export function isBlocked(chatId) {
    return isPerson(chatId) && state.personChats.some((c) => 'p:' + c.id === chatId && c.blocked);
}

export function isFavorite(chatId) {
    const o = flagsOf(chatId);
    return !!(o && o.favorite);
}

/** Toggle the favorite in the list right away; the backend stores it and syncs it with the other machines. */
export function toggleFavorite(chatId) {
    const o = flagsOf(chatId);
    if (!o) return;
    o.favorite = !o.favorite;
    send({ type: 'favorite', chatId, on: o.favorite });
    renderChatList();
}

export function isMuted(chatId) {
    const o = flagsOf(chatId);
    return !!(o && o.muted);
}

export function toggleMuted(chatId) {
    const o = flagsOf(chatId);
    if (!o) return;
    o.muted = !o.muted;
    send({ type: 'mute', chatId, on: o.muted });
    renderChatList();
}

/** Person chats there can be: one per contact, and those with someone this account no longer reaches. */
export function personChatIds() {
    return [...new Set([...state.people.map((p) => p.id), ...state.personChats.filter((c) => !c.cleared || state.lastTs['p:' + c.id]).map((c) => c.id)])].map((id) => 'p:' + id);
}

/**
 * Main chats of the bots and groups (without further conversations), and the person chats with something in them. An
 * invited account lists everyone it may write to from the start (its invitation names them); the main account, which
 * reaches every account, only those it writes with.
 */
export function baseChats() {
    const contactsListed = state.account && state.account.id !== 'main';
    const people = new Set(state.people.map((p) => 'p:' + p.id));
    return [...state.bots.map((b) => b.id), ...state.groups.map((g) => 'g:' + g.id),
        ...personChatIds().filter((id) => state.lastTs[id] || isFavorite(id) || paneFor(id) || (contactsListed && people.has(id)))];
}

export function conversationsOf(b) {
    return (b.conversations || []).filter((c) => !c.archived).map((c) => `${b.id}~${c.id}`);
}

/** Archived conversations of a bot, most recently archived first. */
export function archivedOf(b) {
    return (b.conversations || []).filter((c) => c.archived)
        .sort((x, y) => y.archived.localeCompare(x.archived)).map((c) => `${b.id}~${c.id}`);
}

// Bots whose further conversations are collapsed in the overview (remembered per device)
export const collapsed = new Set((() => { try { return JSON.parse(storage.get(COLLAPSED_KEY) || '[]'); } catch { return []; } })());

export function toggleConversations(botId) {
    toggleCollapsed(botId);
}

/** Folds or unfolds an entry of the overview (a bot's conversations by its id, a folder by 'c:<id>'). */
export function toggleCollapsed(key) {
    if (!collapsed.delete(key)) collapsed.add(key);
    storage.set(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    listTap.active = false; // the tap is handled; render right away instead of after the tap lock
    renderChatList();
}

/** The folders of the chat list in the order shown: by name. */
/** The folders as the list shows them: by their place (moved by the user), the rest by name after them. */
export function sortedCategories() {
    return [...state.categories].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name));
}

/** Moves a folder to `index` among the folders (drag and drop, or up/down in its menu); shown at once. */
export function moveCategory(id, index) {
    const ids = sortedCategories().map((c) => c.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    ids.forEach((x, order) => { const c = state.categories.find((y) => y.id === x); if (c) c.order = order; });
    send({ type: 'category_order', ids });
}

/** The folder of a bot or group in the list ('' = none, or one that no longer exists). */
export function categoryOf(chatId) {
    const o = flagsOf(chatId);
    const id = o && o.category;
    return id && state.categories.some((c) => c.id === id) ? id : '';
}

/** Into a folder ('' = out of it) in the list right away; the backend stores it and syncs it with the other machines. */
export function setCategory(chatId, categoryId) {
    const o = flagsOf(chatId);
    if (!o) return;
    o.category = categoryId || undefined;
    send({ type: 'category_assign', chatId, categoryId });
    renderChatList();
}

export function allChats() {
    return [...state.bots.flatMap((b) => [b.id, ...conversationsOf(b)]), ...state.groups.map((g) => 'g:' + g.id), ...personChatIds()];
}

/** Whether a bot's status line belongs into a chat: its own chat, or a group it is answering in right now. */
function concerns(chatId, botId) {
    if (chatId === botId) return true;
    const g = group(chatId);
    return !!g && g.members.includes(botId) && !!(state.live[chatId] && state.live[chatId][botId]);
}

/** Chats shown in a pane (visible or parked). */
export function openChats() {
    return panes.map((p) => p.chatId).filter(Boolean);
}

/**
 * After the first bot list: the chat of the address (?chat=), on a wide screen also the panes of the last visit
 * on this device, as many as fit.
 */
function restorePanes() {
    state.panesRestored = true;
    const param = new URLSearchParams(location.search);
    const wanted = param.get('chat');
    const remembered = isWide() ? rememberedPanes().filter((id) => id && allChats().includes(id)) : [];
    const ids = remembered.length ? remembered : wanted && allChats().includes(wanted) ? [wanted] : [];
    // The people come in a frame of their own, maybe after the bots
    if (wanted && isPerson(wanted) && !allChats().includes(wanted)) state.openAfterBots = wanted;
    ids.slice(0, capacity()).forEach((id, i) => openChat(id, undefined, undefined, i === 0 ? activePane() : createPane()));
    if (wanted && allChats().includes(wanted)) {
        openChat(wanted);
        // Direct link ?chat=<id>&info=1 also opens the bot info
        if (param.get('info') === '1' && !isGroup(wanted)) openInfo(botIdOf(wanted));
    }
}

/** Preview and time of the last message of a chat for the overview (without entry: empty). */
export function setLast(chatId, e) {
    state.last[chatId] = e ? preview(chatId, e) : '';
    if (e && e.ts) state.lastTs[chatId] = e.ts;
    else if (!e) delete state.lastTs[chatId];
}

/** The line under a chat's name; `nameOf` names senders (another account's bots in others.js). */
export function preview(chatId, e, nameOf = senderName) {
    if (e.role === 'event') return e.text;
    if (e.voice) return '🎤 ' + (plain(e.text) || t('voice.message'));
    const att = e.attachments && e.attachments.length ? '📎 ' : '';
    const text = plain(e.text) || (e.attachments && e.attachments.length ? e.attachments.map((a) => a.name).join(', ') : (e.tools && e.tools.length ? `⚙ ${tn('tools.count', e.tools.length)}` : ''));
    if (e.role === 'user' && e.from && e.from !== 'me') return `${nameOf(e.from)}: ${att}${text}`;
    if (e.role === 'assistant' && e.botId && isGroup(chatId)) return `${nameOf(e.botId)}: ${att}${text}`;
    return att + text;
}
