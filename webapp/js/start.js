/* OpenFolk web app: wire up events, devices and keys, light/dark, language, start. */
import { applyI18n, t } from './i18n.js';
import { $, AVATAR_EDGE, deviceAccounts, deviceRelays, loadedAccount, relayEntry, relayScope, SIDEBAR_WIDTH_KEY, THEME_KEY, el, node, state, storage, closest, control, toast } from './core.js';
import { adoptKey, adoptPairingLink, askForKey, bot, e2eStart, fillAvatar, forgetKey, group, isGroup, isPerson, responsibleMachine, send } from './e2e.js';
import { allChats, checkConnection, checkTotp, connect, credentials, renderAccount, setAgentStatus, showLogin } from './connection.js';
import { bundled, fitToKeyboard, platformKind, onNotificationOpen, parsePairingLink, relayAddress, requestPushPermission, setRelayAddress } from './platform.js';
import { CHAT_DRAG, SIDEBAR_PX, activePane, closeSettings, createPane, layoutPanes, paneOf, panes, setActivePane, setSidebarWidth, visibleChats } from './panes.js';
import { chooseSearchFilter, closeChatSearch, listTap, onChatSearchInput, onSearchInput, openRowMenu, renderChatList, renderUsage, setupFolderDrop, setupListLongPress, setupListSwipe, setupSearchBox, stepChatSearch } from './list.js';
import { addEmptyPane, closeChat, dropChat, openChat, paneActivated, renderChatHeader, setupSwipeBack, swipeBack } from './chat.js';
import { renderMachines, wake } from './machines.js';
import { checkMention, closeMention, markSeen, mentionKey, renderForwardList, renderHistory, renderPinned, scroll, setReply, setupMessageMenu, setupReport, tapPinned, unpinShown } from './chat-features.js';
import { composerButtons, renderQueue, saveDraft, sendMessage, setupQueueSwipe, textHeight } from './queue.js';
import { autoReadOn, setAutoRead, primeReadAloud, readWaitingAnswer, setupSpeechBar } from './read-aloud.js';
import { addFiles, dictationOn, finishDictation, pauseRecording, rec, setDictation, shrinkImage, startRecording, stopRecording } from './voice.js';
import { endTalk, startTalk, talkVisibility, tapTalk, toggleTalkMic } from './talk.js';
import {
    chatMenuAction, chatMenuButtons, closeAllMenus, closeDialog, closeGitPage, infoAction, menuButton, newCategory, openGitPage, openMachinesPage, openMissionsPage,
    renameConversation, renderGitTotal, renderPageTitle, submitText, toggleHeaderSwitch,
} from './menus.js';
import { adoptVscodeSession, openVscode, renderVscodeAdoptButton, renderVscodeSub, showInVscode, showVscodeList, vs } from './vscode.js';
import {
    canMessageChanged, chooseFolder, createPickerFolder, folderChanged, folderTyped, knowledgeSection, machineChanged, newGroup, openEditor, openFolderPicker, openGroupEditor,
    openAvatarPicker, openBotChanges, openInfo, openKnowledgeEditor, openRoutineEditor, renderEditorAvatar, renderKnowledge, renderRoutines,
    repoChanged, repoTyped, requestSuggestion, roleChanged, routineCron, routineFields, submitEditor, renderVoiceChoice, chooseVoiceName, listenToVoice,
} from './editors.js';
import { checkPush, renderPushSettings, setPushAlways, subscribePush } from './push.js';
import { noteInput, reportPresence } from './activity.js';
import { askMachineJoin, chooseAllAccounts, chooseBubble, chooseLanguage, chooseShared, closeAiForm, openAiForm, openReleaseNotes, openSettings, renderAiServices, renderSettings, saveAiKey, showE2eStatus } from './settings.js';
import {
    backToChooser, cancelAddAccount, deleteOwnAccount, closeChooserMenus, createAccount, joinAny, newAccount, openAccountMenu, openAccounts, redeemLink, saveOwnAccount, scanAny, showAccountField, showLoginForm,
    showNewAccountForm, signOut, switchAccount,
} from './accounts.js';
import { openRelay, switchRelay } from './relays.js';
import { renewQrLogin, scanToApprove, scanToSignIn, showScanButtons, signInWithLink, startQrLogin, stopQrLogin } from './qr-login.js';
import { VERSION } from './release.js';
import { alertDialog, confirmDialog } from './dialogs.js';
import { showSetupLanding, takeSetupLink } from './setups.js';
import { closeVaultForm, openVaultForm, renderVault, saveVaultEntry, vaultBotsChanged } from './vault.js';
import { applyMethod, focusMethod } from './login-method.js';
import { onShortcutKey, runCommand, setupPalette } from './palette.js';
import { closeVideo } from './media.js';
import { missionsBack } from './missions.js';
// iOS: the app above the keyboard instead of a window that jumps
fitToKeyboard();

// The first pane exists from the start; on phones and laptops it stays the only one
createPane();

// ================================================================ Events

/**
 * The address typed into the app's start page. Another relay than the page was loaded for keeps what this device
 * stored for the previous one (relays.js) and loads the page for the new one, with the rest of a pairing link in
 * `params`; then null.
 * @param {string} text
 * @param {URLSearchParams} [params]
 */
function useRelayAddress(text, params) {
    const address = setRelayAddress(text);
    if (address && relayEntry(address).scope !== relayScope) {
        openRelay(params);
        return null;
    }
    return address;
}

el.loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // Enter in the field "Invitation link" (the form's own button is for the password)
    if (el.loginMethod.value === 'invite' && el.loginInvite.value.trim()) {
        await signInWithLink(el.loginInvite.value);
        return;
    }
    if (bundled) {
        // A setup link is no sign-in: it sets this computer up (setups.js)
        if (takeSetupLink(el.loginRelay.value)) return;
        // The field takes the relay's address or a whole pairing link (address, one-time sign-in, end-to-end key)
        const link = parsePairingLink(el.loginRelay.value);
        const address = link ? useRelayAddress(link.address, link.params) : '';
        if (address === null) return;
        if (!address) {
            showLogin(t('login.relayInvalid'));
            el.loginRelay.focus();
            return;
        }
        el.loginRelay.value = address;
        await adoptPairingLink(link.params);
    }
    const token = el.loginToken.value.trim();
    // The password, unless a pairing link (address field of the app, or the page's address) signs the device in
    if (!token && !state.pairToken) {
        el.loginToken.focus();
        return;
    }
    // Only in memory for this one attempt; afterwards the device key is stored
    state.loginAttempt = token ? { token, totp: el.loginTotp.value.trim(), name: el.loginName.value.trim(), account: el.loginAccount.value.trim() } : null;
    state.loginName = el.loginName.value.trim();
    el.loginError.hidden = true;
    el.login.hidden = true;
    if (state.ws) state.ws.close();
    connect();
});

el.pairCreate.addEventListener('click', () => {
    el.pairCreate.disabled = true;
    send({ type: 'pair_link' });
});
el.e2eEnter.addEventListener('click', () => { closeSettings(); askForKey(''); });

// QR codes: the app scans them itself; with a server address the start page shows its own code
el.loginMethod.addEventListener('change', () => {
    el.loginError.hidden = true;
    applyMethod();
    focusMethod();
});
el.loginScan.addEventListener('click', () => void scanToSignIn());
el.loginQrRenew.addEventListener('click', renewQrLogin);
el.loginInviteGo.addEventListener('click', () => void signInWithLink(el.loginInvite.value));
el.devicesScan.addEventListener('click', () => void scanToApprove());
el.loginRelay.addEventListener('change', () => {
    if (!bundled) return;
    void checkTotp(true);
    const link = parsePairingLink(el.loginRelay.value);
    if (!link || link.params.get('pair') || link.params.get('setup')) return;
    const before = relayAddress();
    if (!useRelayAddress(link.address, link.params)) return;
    if (relayAddress() !== before) stopQrLogin();
    void startQrLogin();
});

// Accounts: switching in the sidebar, managing them in the settings
el.accountSwitch.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = !el.accountMenu.hidden;
    closeAllMenus();
    if (!open) openAccountMenu();
});
el.accountMenu.addEventListener('click', (ev) => {
    const b = closest(ev, '[data-account], [data-relay], [data-account-action]');
    if (!b) return;
    el.accountMenu.hidden = true;
    if (b.dataset.account) switchAccount(b.dataset.account);
    else if (b.dataset.relay) switchRelay(b.dataset.relay);
    else if (b.dataset.accountAction === 'new') newAccount();
    else openAccounts();
});
el.accountsSignOut.addEventListener('click', signOut);
// The start page's choice of accounts
el.loginChooseOther.addEventListener('click', showLoginForm);
el.loginChooseBack.addEventListener('click', backToChooser);
el.login.addEventListener('click', closeChooserMenus);
el.accountsJoin.addEventListener('click', joinAny);
el.accountsScan.addEventListener('click', () => void scanAny());
// The own account saves as a field is left; Enter leaves it
for (const field of [el.accountsOwnName, el.accountsPassword]) {
    field.addEventListener('change', saveOwnAccount);
    field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') field.blur(); });
}
el.accountsDeleteOwn.addEventListener('click', () => void deleteOwnAccount());
el.accountsCreate.addEventListener('click', createAccount);
el.accountsLinkGo.addEventListener('click', redeemLink);
el.accountsLink.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); redeemLink(); } });
el.accountsNewCancel.addEventListener('click', () => showNewAccountForm(false));
el.loginCancel.addEventListener('click', cancelAddAccount);
el.loginOtherAccount.addEventListener('click', showAccountField);
el.settingsAllAccounts.addEventListener('change', chooseAllAccounts);
el.e2eDelete.addEventListener('click', async () => {
    if (!(await confirmDialog(t('e2e.deleteConfirm')))) return;
    await forgetKey();
    showE2eStatus();
    if (state.ws) state.ws.close();
});
el.keyForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
        await adoptKey(el.keyInput.value);
    } catch (e) {
        el.keyError.textContent = t('e2e.invalid', { error: e.message });
        el.keyError.hidden = false;
        return;
    }
    el.keyInput.value = '';
    el.keyDialog.hidden = true;
    // reconnect so the backends send everything again (encrypted)
    if (state.ws) state.ws.close();
    else connect();
});

// "+" menu: entries like the other menus, icon before the label; last the VS Code sessions of every folder
const NEW_ENTRIES = [['conversation', 'conversation', 'conversation.new'], ['bot', 'bot', 'editor.newBot'], ['group', 'group', 'group.new'], ['category', 'folder', 'category.new'], ['vscode', 'monitor', 'newMenu.vscode']];
let newEntries = [];

function buildNewMenu() {
    newEntries = NEW_ENTRIES.map(([kind, icon, key]) => {
        const b = menuButton(icon, t(key));
        b.dataset.new = kind;
        return b;
    });
    el.newMenu.replaceChildren(...newEntries);
}

/** "Person" only when there is someone on the relay this account may write to. */
function personEntry() {
    if (!state.people.length) return [];
    const b = menuButton('person', t('people.new'));
    b.dataset.new = 'person';
    return [b];
}

el.btnNew.addEventListener('click', (ev) => {
    ev.stopPropagation();
    el.newMenu.replaceChildren(...newEntries, ...personEntry());
    el.newMenu.hidden = !el.newMenu.hidden;
});

/** "Person": the "+" menu lists whom this account can chat with. */
function choosePerson() {
    const info = node('div', 'menu-info');
    info.append(node('strong', '', t('people.new')), node('span', '', t('people.explain')));
    const buttons = state.people.map((p) => {
        const k = menuButton('person', p.name);
        k.dataset.new = 'person_with';
        k.dataset.person = p.id;
        return k;
    });
    el.newMenu.replaceChildren(info, ...buttons);
}

/** "New conversation": the "+" menu shows the bots; sleeping ones (no responsible machine awake) are disabled. */
function chooseNewConversation() {
    const info = node('div', 'menu-info');
    info.append(node('strong', '', t('conversation.new')), node('span', '', t('newMenu.explain')), node('span', '', t('newMenu.whichBot')));
    const buttons = state.bots.map((b) => {
        const awake = Boolean(responsibleMachine(b));
        const k = menuButton('bot', awake ? b.name : `${b.name} · ${t('machine.asleep')}`);
        k.dataset.new = 'conversation_with';
        k.dataset.bot = b.id;
        k.disabled = !awake;
        return k;
    });
    el.newMenu.replaceChildren(info, ...(buttons.length ? buttons : [node('div', 'menu-info', t('newMenu.noBot'))]));
}

el.newMenu.addEventListener('click', (ev) => {
    const k = closest(ev, '[data-new]');
    const kind = k && k.dataset.new;
    if (!kind) return;
    if (kind === 'conversation') {
        // the menu stays open; the click must not close it via the document
        ev.stopPropagation();
        chooseNewConversation();
        return;
    }
    if (kind === 'person') {
        ev.stopPropagation();
        choosePerson();
        return;
    }
    el.newMenu.hidden = true;
    if (kind === 'category') newCategory();
    if (kind === 'vscode') openVscode(null);
    if (kind === 'person_with') openChat('p:' + k.dataset.person);
    if (kind === 'conversation_with') {
        const b = bot(k.dataset.bot);
        // The machine answers with conversation_created; then the new conversation opens
        if (b && responsibleMachine(b)) send({ type: 'conversation_new', botId: b.id }, responsibleMachine(b));
    }
    if (kind === 'bot') openEditor(null);
    if (kind === 'group') newGroup();
});
el.search.addEventListener('input', onSearchInput);
// The phone's search: what it looks for
el.searchFilters.addEventListener('click', (ev) => {
    const chip = closest(ev, '[data-filter]');
    if (chip) chooseSearchFilter(chip.dataset.filter);
});
// The command palette and the keyboard shortcuts (palette.js); the desktop app's menu sends the same commands
setupPalette();
document.addEventListener('keydown', onShortcutKey);
document.addEventListener('openfolk:command', (ev) => {
    const command = /** @type {CustomEvent} */ (ev).detail;
    if (state.signedIn && typeof command === 'string') runCommand(command);
});
el.forwardSearch.addEventListener('input', renderForwardList);
// Enter in the forward search takes the first chat found
el.forwardSearch.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const first = /** @type {HTMLButtonElement | null} */ (el.forwardList.querySelector('button'));
    if (first) first.click();
});
// × in a search field (sidebar or chat search of a pane): clear the text, the field stays open and focused
document.addEventListener('pointerdown', (ev) => { if (closest(ev, '.field-clear')) ev.preventDefault(); });
document.addEventListener('click', (ev) => {
    const button = closest(ev, '.field-clear');
    if (!button) return;
    const field = /** @type {HTMLInputElement} */ (button.previousElementSibling);
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
});
setupListSwipe();
setupListLongPress();
setupFolderDrop();
setupQueueSwipe();
setupSearchBox();
setupMessageMenu();
setupReport();
setupSpeechBar();
const releaseList = (ms) => {
    clearTimeout(listTap.timer);
    listTap.timer = setTimeout(() => {
        listTap.active = false;
        if (listTap.pending) {
            listTap.pending = false;
            renderChatList();
        }
    }, ms);
};
el.chatList.addEventListener('pointerdown', () => {
    listTap.active = true;
    releaseList(5000); // if pointerup does not come, the list does not freeze
});
// only after the click that follows pointerup
for (const kind of ['pointerup', 'pointercancel']) el.chatList.addEventListener(kind, () => releaseList(350));
// Tabs: the list, the repos of all bots, the machines, the settings. Without stopPropagation the click catcher of the
// menus would close the long-press menu's git list right away.
el.tabBar.addEventListener('click', (ev) => {
    const tab = closest(ev, '.tab')?.dataset.tab;
    if (!tab) return;
    ev.stopPropagation();
    closeAllMenus();
    if (tab === 'repos') return openGitPage();
    if (tab === 'machines') return openMachinesPage();
    if (tab === 'missions') return openMissionsPage();
    // On wide screens the settings are a pane, and the panes hide behind the page
    if (!el.gitPage.hidden) closeGitPage();
    if (tab === 'settings') openSettings();
    else if (!el.settings.hidden) closeSettings();
});
// In Mission Control "back" goes from a mission or the builder to the overview first
el.gitBack.addEventListener('click', () => { if (!missionsBack()) closeGitPage(); });
setupSwipeBack();
document.addEventListener('click', closeAllMenus);
// No zooming with a two-finger gesture: Safari on iPhone/iPad ignores user-scalable=no in the viewport
for (const kind of ['gesturestart', 'gesturechange']) document.addEventListener(kind, (ev) => ev.preventDefault(), { passive: false });

// ---------------------------------------------------------------- Panes
// Panes are cloned later than this code runs, so their events are delegated on the container: every handler
// finds its pane from the event target. The element a click means is found by its data-el name.

/** Clicking or typing in a pane makes it the active one (keyboard target, address, mark in the list). */
for (const kind of ['pointerdown', 'focusin']) {
    el.panes.addEventListener(kind, (ev) => {
        const p = paneOf(ev);
        if (p && p !== activePane()) {
            setActivePane(p);
            paneActivated();
        }
    });
}

/** The header and its gear: a group's editor, a person's menu (no page of its own), otherwise the bot's page. */
function openChatSettings(p, ev) {
    if (isGroup(p.chatId)) openGroupEditor(group(p.chatId));
    else if (isPerson(p.chatId)) openRowMenu(p.chatId, ev.clientX, ev.clientY);
    else openInfo(p.chatId);
}

/** @type {Record<string, (p: import('./panes.js').Pane, ev: MouseEvent) => void>} */
const PANE_CLICKS = {
    'btn-back': (p) => closeChat(p),
    'btn-close': (p) => closeChat(p),
    // the header leads to the bot's page, which also holds what the chat's menu did (a group: its editor)
    'chat-title': (p, ev) => openChatSettings(p, ev),
    'chat-settings': (p, ev) => openChatSettings(p, ev),
    'chat-model': (p, ev) => { ev.stopPropagation(); toggleHeaderSwitch(p, 'model'); },
    'chat-machine': (p, ev) => { ev.stopPropagation(); toggleHeaderSwitch(p, 'machine'); },
    'chat-git': (p, ev) => { ev.stopPropagation(); openBotChanges(p.chatId, true); },
    'rb-cancel': (p) => setReply(p, null),
    'cs-older': (p) => stepChatSearch(p, 1),
    'cs-newer': (p) => stepChatSearch(p, -1),
    'cs-close': (p) => closeChatSearch(p),
    'fx-text': (p) => tapPinned(p),
    'fx-unpin': (p) => unpinShown(p),
    'queue-head': (p) => { p.queueOpen = !p.queueOpen; renderQueue(p); },
    'btn-mic': (p) => { startRecording(p); },
    'rec-discard': () => { stopRecording(false); },
    'rec-pause': () => pauseRecording(),
    // unlocking the sound needs this tap; the answer may come minutes later
    'rec-autoread': () => setAutoRead(!autoReadOn()),
    'rec-send': () => { primeReadAloud(); stopRecording(true); },
    'rec-done': () => { void finishDictation(); },
    'btn-talk': (p) => startTalk(p),
    'btn-later': (p) => { p.later = !p.later; composerButtons(p); },
    'btn-stop': (p) => { if (p.chatId) send({ type: 'interrupt', chatId: p.chatId }); },
    'btn-attach': (p) => p.el.fileInput.click(),
    'to-bottom': (p) => scroll(p, true),
    'sleep-wake': (p) => wake(p.el.sleepWake.dataset.host),
};

const PANE_CLICK_TARGETS = Object.keys(PANE_CLICKS).map((k) => `[data-el="${k}"]`).join(', ');

el.panes.addEventListener('click', (ev) => {
    const p = paneOf(ev);
    if (!p) return;
    if (closest(ev, '.pane-empty-close')) { closeChat(p); return; }
    // A tab above a bot's chat: that chat in this pane, "+" a new conversation (it opens once the machine made it)
    const tab = /** @type {HTMLButtonElement | null} */ (closest(ev, '.conv-tab'));
    if (tab) {
        // the tap that ended a long press (renaming) opens nothing
        if (tabHeld) { tabHeld = false; return; }
        if (tab.dataset.new) { const b = bot(tab.dataset.new); if (b) send({ type: 'conversation_new', botId: b.id }, responsibleMachine(b) || undefined); }
        else if (tab.dataset.chat && tab.dataset.chat !== p.chatId) openChat(tab.dataset.chat, undefined, undefined, p);
        return;
    }
    // the innermost element with a handler: a tap on the name in the title means the title button
    const target = control(ev, PANE_CLICK_TARGETS);
    const handler = target && PANE_CLICKS[target.dataset.el];
    if (handler) handler(p, /** @type {MouseEvent} */ (ev));
});
// A long press (or a right click) on a conversation's tab renames it, as its menu does
const conversationTab = (ev) => {
    const k = /** @type {HTMLElement | null} */ (closest(ev, '.conv-tab[data-chat]'));
    return k && /** @type {string} */ (k.dataset.chat).includes('~') ? k : null;
};
let tabHeld = false;
let tabPress = null;
let tabPointer = 'mouse';
el.panes.addEventListener('pointerdown', (ev) => { tabPointer = ev.pointerType; }, true);
el.panes.addEventListener('touchstart', (ev) => {
    clearTimeout(tabPress?.timer);
    tabPress = null;
    tabHeld = false;
    const k = conversationTab(ev);
    if (!k || ev.touches.length !== 1) return;
    const touch = ev.touches[0];
    // the timer only notes the long press; the dialog opens as the finger lifts, so iOS lets its field take the focus
    // and opens the keyboard (a focus from a timer is refused)
    tabPress = { x: touch.clientX, y: touch.clientY, chat: /** @type {string} */ (k.dataset.chat), timer: setTimeout(() => { tabHeld = true; if (navigator.vibrate) navigator.vibrate(15); }, 500) };
}, { passive: true });
el.panes.addEventListener('touchmove', (ev) => {
    const touch = ev.touches[0];
    if (tabPress && (Math.abs(touch.clientX - tabPress.x) > 10 || Math.abs(touch.clientY - tabPress.y) > 10)) { clearTimeout(tabPress.timer); tabPress = null; }
}, { passive: true });
el.panes.addEventListener('touchend', (ev) => {
    clearTimeout(tabPress?.timer);
    if (tabPress && tabHeld) {
        // no click follows (prevented), so the mark goes here
        if (ev.cancelable) { ev.preventDefault(); tabHeld = false; }
        renameConversation(tabPress.chat);
    }
    setTimeout(() => { tabPress = null; }, 0);
});
// iOS may still cancel the touch of a long press: then the dialog opens all the same, the field a tap away
el.panes.addEventListener('touchcancel', () => {
    clearTimeout(tabPress?.timer);
    if (tabPress && tabHeld) renameConversation(tabPress.chat);
    tabPress = null;
    tabHeld = false;
});
el.panes.addEventListener('contextmenu', (ev) => {
    const k = conversationTab(ev);
    if (!k) return;
    ev.preventDefault();
    // a finger on it: lifting it renames (touchend above), where iOS lets the field take the focus; the long press
    // reported as contextmenu (Android, iPadOS) would open the dialog without a keyboard
    if (!tabPress && !tabHeld && tabPointer !== 'touch') renameConversation(/** @type {string} */ (k.dataset.chat));
});
el.panes.addEventListener('submit', (ev) => {
    const p = paneOf(ev);
    if (!p || ev.target !== p.el.composer) return;
    ev.preventDefault();
    sendMessage(p);
});
el.panes.addEventListener('input', (ev) => {
    const p = paneOf(ev);
    if (!p) return;
    if (ev.target === p.el.text) { textHeight(p); checkMention(p); saveDraft(p); }
    if (ev.target === p.el.csText) onChatSearchInput(p);
});
el.panes.addEventListener('click', (ev) => {
    const p = paneOf(ev);
    if (p && ev.target === p.el.text) checkMention(p);
});
// blur does not bubble
el.panes.addEventListener('focusout', (ev) => {
    const p = paneOf(ev);
    if (!p || ev.target !== p.el.text) return;
    closeMention(p);
    // Dictated text goes where the cursor was, also after a tap on the checkmark took the focus
    p.caret = { start: p.el.text.selectionStart, end: p.el.text.selectionEnd, value: p.el.text.value };
});
el.panes.addEventListener('keydown', (ev) => {
    const p = paneOf(ev);
    if (!p) return;
    if (ev.target === p.el.text) {
        if (mentionKey(p, ev)) return;
        // Escape in the field ends a dictation without text, as in Claude Code
        if (ev.key === 'Escape' && rec.pane === p && rec.recorder && dictationOn()) { ev.preventDefault(); ev.stopPropagation(); void stopRecording(false); return; }
        if (ev.key === 'Enter' && !ev.shiftKey && window.innerWidth > 760) { ev.preventDefault(); sendMessage(p); }
    }
    if (ev.target === p.el.csText) {
        if (ev.key === 'Enter') { ev.preventDefault(); stepChatSearch(p, 1); }
        if (ev.key === 'Escape') closeChatSearch(p);
    }
});
el.panes.addEventListener('paste', (ev) => {
    const p = paneOf(ev);
    if (!p || ev.target !== p.el.text) return;
    const files = [...(ev.clipboardData ? ev.clipboardData.files : [])];
    if (files.length) { ev.preventDefault(); addFiles(p, files); }
});
el.panes.addEventListener('change', (ev) => {
    const p = paneOf(ev);
    if (!p || ev.target !== p.el.fileInput) return;
    addFiles(p, [...p.el.fileInput.files]);
    p.el.fileInput.value = '';
});
// scroll does not bubble: catch it on the way down
el.panes.addEventListener('scroll', (ev) => {
    const p = paneOf(ev);
    if (!p || ev.target !== p.el.messages) return;
    const n = p.el.messages;
    p.follow = n.scrollHeight - n.scrollTop - n.clientHeight < 60;
    p.el.toBottom.hidden = p.follow;
}, { capture: true, passive: true });
// Dropping: files go to the chat of the pane, a chat from the list opens in the pane (or a new one on the + strip)
const draggingChat = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes(CHAT_DRAG);
const dropTarget = (node) => {
    for (const x of document.querySelectorAll('.drop-target')) if (x !== node) x.classList.remove('drop-target');
    if (node) node.classList.add('drop-target');
};
el.panes.addEventListener('dragover', (ev) => {
    const p = paneOf(ev);
    if (!p) return;
    ev.preventDefault();
    if (draggingChat(ev)) dropTarget(p.root);
});
el.paneAdd.addEventListener('dragover', (ev) => {
    if (!draggingChat(ev)) return;
    ev.preventDefault();
    dropTarget(el.paneAdd);
});
for (const area of [el.panes, el.paneAdd]) {
    area.addEventListener('dragleave', (ev) => {
        // only when the pointer leaves the area, not when it moves between its children
        if (!(ev.relatedTarget instanceof Node) || !area.contains(ev.relatedTarget)) dropTarget(null);
    });
}
document.addEventListener('dragend', () => dropTarget(null));
el.panes.addEventListener('drop', (ev) => {
    const p = paneOf(ev);
    dropTarget(null);
    if (!p) return;
    ev.preventDefault();
    if (draggingChat(ev)) dropChat(ev.dataTransfer.getData(CHAT_DRAG), p);
    else if (p.chatId) addFiles(p, [...ev.dataTransfer.files]);
});
el.paneAdd.addEventListener('drop', (ev) => {
    dropTarget(null);
    if (!draggingChat(ev)) return;
    ev.preventDefault();
    dropChat(ev.dataTransfer.getData(CHAT_DRAG), null);
});
el.paneAdd.addEventListener('click', addEmptyPane);
// More or fewer panes fit after resizing the window or the sidebar; at most once per frame
let layoutFrame = 0;
function relayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        paneActivated();
    });
}
window.addEventListener('resize', relayout);

// The desktop apps: the sidebar's right edge changes its width (CSS shows the handle only there)
function resizeSidebar(px) {
    const width = setSidebarWidth(px);
    if (width === SIDEBAR_PX) storage.remove(SIDEBAR_WIDTH_KEY);
    else storage.set(SIDEBAR_WIDTH_KEY, String(width));
    relayout();
}
el.sidebarResize.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const handle = el.sidebarResize;
    const left = el.app.getBoundingClientRect().left;
    handle.setPointerCapture(ev.pointerId);
    handle.classList.add('dragging');
    el.app.classList.add('sidebar-resizing');
    const move = (/** @type {PointerEvent} */ e) => resizeSidebar(e.clientX - left);
    const end = () => {
        handle.classList.remove('dragging');
        el.app.classList.remove('sidebar-resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
});
el.sidebarResize.addEventListener('dblclick', () => resizeSidebar(SIDEBAR_PX));
el.sidebarResize.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowLeft' ? -20 : ev.key === 'ArrowRight' ? 20 : 0;
    if (!step) return;
    ev.preventDefault();
    resizeSidebar(el.sidebarResize.parentElement.getBoundingClientRect().width + step);
});

// Dialogs: "Cancel"/"×", Escape and a click on the backdrop close them. The backdrop only counts if the pointer
// was also pressed there – otherwise selecting text that ends outside would close it.
for (const o of [el.editor, el.folderPicker, el.avatarPicker, el.gEditor, el.info, el.rEditor, el.kEditor, el.keyDialog, el.vscode, el.archive, el.forward, el.report, el.textDialog, el.settingsDialog, el.settings, el.palette, el.shortcuts, el.docView]) {
    let pressedOnBackdrop = false;
    o.addEventListener('pointerdown', (ev) => { pressedOnBackdrop = ev.target === o; });
    o.addEventListener('click', (ev) => {
        const backdrop = ev.target === o && pressedOnBackdrop;
        pressedOnBackdrop = false;
        if (backdrop || control(ev, '[data-close]')) closeDialog(o);
        // The editor in the side panel lets clicks through to the bot page below: a click beside both closes both
        if (backdrop && o === el.info && !el.editor.hidden && el.editor.classList.contains('side-edit')) closeDialog(el.editor);
    });
}
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!el.talk.hidden) { endTalk(); return; }
    const large = document.getElementById('image-view');
    if (large && !large.hidden) { large.hidden = true; return; }
    if (closeVideo()) return;
    // the docked info panel is a column, not a dialog: Escape closes it only from inside
    const docked = el.app.classList.contains('info-docked') && !el.info.contains(document.activeElement);
    for (const o of [el.docView, el.palette, el.shortcuts, el.textDialog, el.keyDialog, el.settingsDialog, el.settings, el.rEditor, el.kEditor, el.folderPicker, el.avatarPicker, el.editor, el.gEditor, el.info, el.vscode, el.archive, el.forward, el.report]) {
        if (o.hidden || (o === el.info && docked)) continue;
        closeDialog(o);
        return;
    }
});
// Phone: the detail dialogs are pages; back (arrow or swipe to the right) leaves the VS Code history for its list first.
// The settings are a tab like the repos and the status: the arrow leads back, a swipe does not.
for (const o of document.querySelectorAll('.overlay.page')) {
    const back = () => {
        if (o === el.talk) endTalk();
        else if (o === el.vscode && !el.vsBack.hidden) showVscodeList();
        else closeDialog(o);
    };
    o.querySelector('[data-page-back]').addEventListener('click', back);
    if (o === el.settings) continue;
    swipeBack(/** @type {HTMLElement} */ (o), {
        allowed: (ev) => !closest(ev, 'textarea, input, select, pre, table'),
        // the pages lie on a backdrop, only their card moves
        moved: () => /** @type {HTMLElement} */ (o.querySelector('.dialog')),
        close: back,
    });
}
// Entries of the chat's menu on the bot's page and in the group editor; closest: the tap can land on the icon or the label
el.infoActions.addEventListener('click', (ev) => {
    const k = closest(ev, '[data-action]');
    if (k) infoAction(k.dataset.action);
});
// "New conversation", "Move to a conversation" and "Rename conversation" stand above the switches (the switches handle
// their own taps)
el.infoSwitches.addEventListener('click', (ev) => {
    const k = closest(ev, '[data-action="conversation_new"], [data-action="main_to_conversation"], [data-action="rename"], [data-action="restart"]');
    if (k) infoAction(k.dataset.action);
});
el.gActions.addEventListener('click', async (ev) => {
    const k = closest(ev, '[data-action]');
    const g = state.groupEditorGroup;
    if (!k || !g) return;
    if (!(await chatMenuAction('g:' + g.id, k.dataset.action, el.gActions))) return;
    if (k.dataset.action === 'favorite' || k.dataset.action === 'mute') el.gActions.replaceChildren(...chatMenuButtons('g:' + g.id, true));
    else closeDialog(el.gEditor);
});
el.textForm.addEventListener('submit', (ev) => { ev.preventDefault(); submitText(); });
// a click in the dialog must not close a menu below it: the git list waits there for the commit
el.textDialog.addEventListener('click', (ev) => ev.stopPropagation());
el.vsBack.addEventListener('click', showVscodeList);
el.vsAdopt.addEventListener('click', adoptVscodeSession);
el.vsShow.addEventListener('click', async () => { if (await showInVscode(vs.chatId, 'ide')) closeDialog(el.vscode); });
el.vsTerminal.addEventListener('click', async () => { if (await showInVscode(vs.chatId, 'terminal')) closeDialog(el.vscode); });

// Bot editor
el.editorRole.addEventListener('input', roleChanged);
el.editorCanMessage.addEventListener('change', canMessageChanged);
el.editorModel.addEventListener('change', () => { el.editorModelCustom.hidden = el.editorModel.value !== 'custom'; if (!el.editorModelCustom.hidden) el.editorModelCustom.focus(); });
el.editorName.addEventListener('input', renderEditorAvatar);
el.editorImage.addEventListener('change', async () => {
    const d = el.editorImage.files && el.editorImage.files[0];
    if (!d) return;
    try { state.editorAvatar = await shrinkImage(d, AVATAR_EDGE, true); renderEditorAvatar(); } catch (e) { el.editorError.textContent = e.message; el.editorError.hidden = false; }
    el.editorImage.value = '';
});
el.editorImageRemove.addEventListener('click', () => { state.editorAvatar = ''; renderEditorAvatar(); });
el.editorNameSuggest.addEventListener('click', () => requestSuggestion('name'));
el.editorRoleSuggest.addEventListener('click', () => requestSuggestion('role'));
el.editorAvatarAi.addEventListener('click', () => openAvatarPicker());
el.avatarGenerate.addEventListener('click', () => { closeDialog(el.avatarPicker); requestSuggestion('avatar'); });
el.editorForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitEditor();
});
el.editorMachine.addEventListener('change', () => { machineChanged(); renderVoiceChoice(); });
// The voice: the list follows the provider reading for the machine; the kind shows in its first entry
el.editorVoice.addEventListener('change', renderVoiceChoice);
el.editorVoiceName.addEventListener('change', chooseVoiceName);
el.editorVoiceListen.addEventListener('click', listenToVoice);
el.editorFolder.addEventListener('input', folderTyped);
el.editorFolder.addEventListener('change', folderChanged);
el.editorRepo.addEventListener('input', repoTyped);
el.editorRepo.addEventListener('change', repoChanged);
el.editorFolderBrowse.addEventListener('click', openFolderPicker);
el.pickerChoose.addEventListener('click', chooseFolder);
el.pickerCreate.addEventListener('click', createPickerFolder);
el.pickerNewName.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); createPickerFolder(); } });

// Group editor
el.gImage.addEventListener('change', async () => {
    const d = el.gImage.files && el.gImage.files[0];
    if (!d) return;
    try { state.groupAvatarData = await shrinkImage(d, AVATAR_EDGE, true); } catch { /* ignore */ }
    fillAvatar(el.gAvatar, { name: el.gName.value || 'G', avatar: state.groupAvatarData }, 'group');
    el.gImage.value = '';
});
el.gForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const members = [.../** @type {NodeListOf<HTMLInputElement>} */ (el.gMembers.querySelectorAll('input:checked'))].map((c) => c.value);
    if (members.length < 2) { el.gError.textContent = t('group.chooseTwoBots'); el.gError.hidden = false; return; }
    send({ type: 'group_save', group: { id: state.groupEditorGroup ? state.groupEditorGroup.id : '', name: el.gName.value.trim(), avatar: state.groupAvatarData, members, category: el.gCategory.value } });
    closeDialog(el.gEditor);
});

// Info panel
el.infoKnowledgeNew.addEventListener('click', () => openKnowledgeEditor(knowledgeSection(), null));
el.infoRoutineNew.addEventListener('click', () => openRoutineEditor(null));
el.infoEditTop.addEventListener('click', () => infoAction('edit'));

// The version next to the name in the sidebar: what is new in it
el.brandVersion.textContent = VERSION;
el.brandVersion.addEventListener('click', openReleaseNotes);

// Routine editor
el.rKind.addEventListener('change', routineFields);
el.rForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const cron = routineCron();
    if (cron.split(/\s+/).length !== 5) { el.rError.textContent = t('routine.cronFields'); el.rError.hidden = false; return; }
    send({
        type: 'routine_save',
        routine: { id: state.routineEdit ? state.routineEdit.id : '', botId: state.infoBot, name: el.rName.value.trim(), cron, prompt: el.rPrompt.value.trim(), enabled: el.rEnabled.checked, wake: el.rWake.checked },
    });
    closeDialog(el.rEditor);
});
el.rDelete.addEventListener('click', async () => {
    if (state.routineEdit && await confirmDialog(t('routine.deleteConfirm', { name: state.routineEdit.name }))) {
        send({ type: 'routine_delete', id: state.routineEdit.id });
        closeDialog(el.rEditor);
    }
});

// Knowledge: the dialog only closes when the backend answers with the new state; it shows errors itself
function sendKnowledge(frame) {
    const b = bot(state.infoBot);
    if (!b || !state.knowledgeSection) return;
    el.kError.hidden = true;
    state.knowledgeWaiting = true;
    send({ ...frame, botId: b.id, location: state.knowledgeSection.location }, responsibleMachine(b) || undefined);
}
el.kName.addEventListener('input', () => {
    // slug a-z0-9-; German umlauts are spelled out as usual (ä → ae)
    const s = el.kName.value.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9-]+/g, '-');
    if (s !== el.kName.value) el.kName.value = s;
});
el.kForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = el.kName.value.replace(/^-+|-+$/g, '');
    sendKnowledge({
        type: 'knowledge_save',
        fact: { name, type: el.kType.value, description: el.kDescription.value.trim(), text: el.kText.value.trim() },
        oldName: state.knowledgeFact ? state.knowledgeFact.name : undefined,
    });
});
el.kDelete.addEventListener('click', async () => {
    if (state.knowledgeFact && await confirmDialog(t('knowledge.forgetConfirm', { name: state.knowledgeFact.name }))) sendKnowledge({ type: 'knowledge_delete', name: state.knowledgeFact.name });
});

// Settings, with the blocks for notifications, devices and accounts
el.machineAdd.addEventListener('click', askMachineJoin);
el.settingsAutoRead.addEventListener('change', () => setAutoRead(el.settingsAutoRead.checked));
el.settingsDictation.addEventListener('change', () => setDictation(el.settingsDictation.checked));
el.speechBarAuto.addEventListener('click', () => setAutoRead(!autoReadOn()));
el.pushAlways.addEventListener('change', () => setPushAlways(el.pushAlways.checked));
el.settingsTheme.addEventListener('change', () => {
    if (el.settingsTheme.value === 'auto') storage.remove(THEME_KEY);
    else storage.set(THEME_KEY, el.settingsTheme.value);
    applyTheme(el.settingsTheme.value);
    toast(t('settings.saved'));
});
el.settingsBubble.addEventListener('click', (ev) => { const k = closest(ev, '.swatch'); if (k) chooseBubble(k.dataset.bubble); });
el.settingsLanguage.addEventListener('change', () => chooseLanguage(el.settingsLanguage.value));
el.settingsAvatarModel.addEventListener('change', () => {
    chooseShared('avatarModel', el.settingsAvatarModel.value);
    renderAiServices();
});
el.settingsReadAloud.addEventListener('change', () => {
    chooseShared('readAloud', el.settingsReadAloud.value);
    renderAiServices();
});
el.settingsTalkMode.addEventListener('change', () => {
    chooseShared('talkMode', el.settingsTalkMode.value);
    renderAiServices();
});
// The voice conversation: the picture sends or stops, the microphone button holds, the end button ends
el.talkAvatarButton.addEventListener('click', tapTalk);
el.talkMic.addEventListener('click', toggleTalkMic);
el.talkEnd.addEventListener('click', () => endTalk());
el.aiAdd.addEventListener('click', () => openAiForm());
el.aiCancel.addEventListener('click', closeAiForm);
el.aiSave.addEventListener('click', saveAiKey);
el.aiKey.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveAiKey(); } });
// The vault: a form per entry, Enter in the value field saves
el.vaultAdd.addEventListener('click', () => openVaultForm());
el.vaultCancel.addEventListener('click', closeVaultForm);
el.vaultSave.addEventListener('click', saveVaultEntry);
el.vaultBots.addEventListener('change', vaultBotsChanged);
el.vaultValue.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveVaultEntry(); } });
el.settingsVoiceLanguage.addEventListener('change', () => chooseShared('voiceLanguage', el.settingsVoiceLanguage.value));
el.settingsBotApproval.addEventListener('change', () => chooseShared('botApproval', el.settingsBotApproval.value));
el.settingsPushPreview.addEventListener('change', () => chooseShared('pushPreview', el.settingsPushPreview.value));
el.settingsGitPull.addEventListener('change', () => chooseShared('gitAutoPull', el.settingsGitPull.checked));

// Push
el.pushEnable.addEventListener('click', async () => {
    try {
        const permission = await requestPushPermission();
        if (permission === 'granted') await subscribePush();
        checkPush();
        renderPushSettings();
    } catch (e) {
        void alertDialog(t('push.enableFailed', { error: e.message }));
    }
});
onNotificationOpen((url) => {
    const params = new URL(url, location.href).searchParams;
    // From another relay or account this device is signed in to: load the page in that one (core.js picks both)
    const relay = params.get('relay');
    const account = params.get('account') || 'main';
    if (relay && relay !== relayAddress() && deviceRelays().some((r) => r.url === relay)) {
        location.href = url;
        return;
    }
    if (account !== loadedAccount && deviceAccounts().some((a) => a.id === account)) {
        location.href = url;
        return;
    }
    const chat = params.get('chat');
    if (!chat) return;
    // App started by tapping the notification: the bots are not there yet, the chat opens once they are
    if (allChats().includes(chat)) openChat(chat);
    else state.openAfterBots = chat;
});


// ================================================================ Light / dark

const THEMES = [
    { value: 'auto', title: 'theme.auto', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>' },
    { value: 'light', title: 'theme.light', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
    { value: 'dark', title: 'theme.dark', icon: '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z"/>' },
];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(value) {
    const theme = THEMES.find((x) => x.value === value) || THEMES[0];
    if (theme.value === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme.value;
    const btn = $('btn-theme');
    $('theme-icon').innerHTML = theme.icon;
    btn.title = t('theme.button', { theme: t(theme.title) });
    btn.setAttribute('aria-label', t('theme.buttonLabel', { theme: t(theme.title) }));
    // color of the browser/status bar matching the actual appearance
    const dark = theme.value === 'dark' || (theme.value === 'auto' && systemDark.matches);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#111b21' : '#f6f8fa');
}

$('btn-theme').addEventListener('click', () => {
    const now = storage.get(THEME_KEY) || 'auto';
    const next = THEMES[(THEMES.findIndex((x) => x.value === now) + 1) % THEMES.length].value;
    if (next === 'auto') storage.remove(THEME_KEY);
    else storage.set(THEME_KEY, next);
    applyTheme(next);
});
systemDark.addEventListener('change', () => applyTheme(storage.get(THEME_KEY) || 'auto'));

// ================================================================ Language

// ================================================================ Language

/** Everything with text again in the new language: static HTML, menus, lists, the open chat and open dialogs. */
function rerenderLanguage() {
    applyI18n();
    applyTheme(storage.get(THEME_KEY) || 'auto');
    buildNewMenu();
    renderPageTitle();
    if (state.onlineKnown) setAgentStatus(state.online.length > 0);
    else el.agentStatus.querySelector('span').textContent = t(state.ws ? 'status.connecting' : 'status.disconnected');
    renderChatList();
    renderMachines();
    renderUsage();
    renderAccount();
    renderGitTotal();
    for (const p of panes) {
        if (!p.chatId) continue;
        renderChatHeader(p);
        renderPinned(p);
        if (state.history[p.chatId]) renderHistory(p, []);
    }
    if (!el.settings.hidden) {
        renderSettings();
        renderPushSettings();
        renderVault();
        showE2eStatus();
    }
    showScanButtons();
    if (!el.info.hidden && state.infoBot) { renderRoutines(); renderKnowledge(); }
    if (!el.vscode.hidden) { if (vs.session) { renderVscodeSub(); renderVscodeAdoptButton(); } else showVscodeList(); }
}
document.addEventListener('openfolk:language', rerenderLanguage);

// ================================================================ Start

/** After this time in the background, coming back checks whether the connection is still alive. */
const HIDDEN_CHECK_MS = 20000;
let hiddenSince = document.hidden ? Date.now() : 0;
window.addEventListener('online', checkConnection);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenSince = Date.now();
    else if (hiddenSince && Date.now() - hiddenSince >= HIDDEN_CHECK_MS) checkConnection();
    if (!document.hidden) hiddenSince = 0;
    reportPresence();
    if (!document.hidden) readWaitingAnswer();
    talkVisibility(document.hidden);
    if (!document.hidden && state.signedIn) send({ type: 'wake_status' });
    if (!document.hidden && !state.ws && !state.rejected && credentials()) connect();
    // back in the app with open chats: they count as seen now
    if (!document.hidden && visibleChats().length) {
        for (const id of visibleChats()) markSeen(id);
        renderChatList();
    }
});

// Whether a desktop is in use (activity.js); passive and cheap, most events only record a time
for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(type, noteInput, { capture: true, passive: true });

applyI18n();
// the app is up: boot.js no longer reloads the page
window.openfolkStarted = true;
applyTheme(storage.get(THEME_KEY) || 'auto');
showScanButtons();
if (platformKind === 'desktop') setSidebarWidth(Number(storage.get(SIDEBAR_WIDTH_KEY)) || SIDEBAR_PX);
// not paneActivated(): that would drop ?chat= from the address before the panes are restored
layoutPanes();
buildNewMenu();
el.agentStatus.querySelector('span').textContent = t('status.connecting');
// Until the machines and their bots are there: the list says it is loading
renderChatList();
// A setup link is for the desktop app: its page hands the link over instead of signing in
if (!showSetupLanding()) e2eStart().finally(connect);
