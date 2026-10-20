/* OpenFolk web app: wire up events, devices and keys, light/dark, language, start. */
import { applyI18n, t } from './i18n.js';
import { $, ACCOUNTS_KEY, AVATAR_EDGE, DEVICE_KEY, deviceAccounts, loadedAccount, FOOTER_OPEN_KEY, TEMPLATES, THEME_KEY, el, node, state, storage, templateValues, closest, control, toast } from './core.js';
import { adoptKey, adoptPairingLink, askForKey, bot, e2eStart, fillAvatar, forgetKey, group, isGroup, responsibleMachine, send } from './e2e.js';
import { allChats, checkConnection, checkTotp, connect, credentials, renderAccount, setAgentStatus, showLogin } from './connection.js';
import { isNative, onNotificationOpen, parsePairingLink, relayAddress, requestPushPermission, setRelayAddress } from './platform.js';
import { CHAT_DRAG, activePane, closeSettings, createPane, layoutPanes, paneOf, panes, setActivePane, visibleChats } from './panes.js';
import { closeChatSearch, listTap, onChatSearchInput, onSearchInput, renderChatList, renderUsage, setupListLongPress, setupListSwipe, setupSearchBox, stepChatSearch } from './list.js';
import { addEmptyPane, closeChat, dropChat, openChat, paneActivated, renderChatHeader, setupSwipeBack, swipeBack } from './chat.js';
import { renderMachines, showFooter, toggleFooter, wake } from './machines.js';
import { checkMention, closeMention, markSeen, mentionKey, renderHistory, renderPinned, scroll, setReply, setupMessageMenu, tapPinned, unpinShown } from './chat-features.js';
import { renderQueue, sendMessage, setupQueueSwipe, textHeight } from './queue.js';
import { addFiles, pauseRecording, shrinkImage, startRecording, stopRecording } from './voice.js';
import {
    chatMenuAction, chatMenuButtons, closeAllMenus, closeDialog, closeGitPage, infoAction, menuButton, openGitPage,
    renderGitTotal, submitText, toggleHeaderSwitch,
} from './menus.js';
import { adoptVscodeSession, renderVscodeAdoptButton, renderVscodeSub, showInVscode, showVscodeList, vs } from './vscode.js';
import {
    canMessageChanged, editorValues, folderChanged, folderTyped, knowledgeSection, machineChanged, openEditor, openGroupEditor,
    openInfo, openKnowledgeEditor, openRoutineEditor, renderEditorAvatar, renderKnowledge, renderRoutines,
    repoChanged, repoTyped, requestSuggestion, routineCron, routineFields, submitEditor,
} from './editors.js';
import { checkPush, renderPushSettings, subscribePush } from './push.js';
import { askMachineJoin, chooseAllAccounts, chooseLanguage, chooseShared, openSettings, renderAvatarKeys, renderSettings, showE2eStatus } from './settings.js';
import { addAccount, cancelAddAccount, createAccount, openAccountMenu, openAccounts, saveOwnAccount, showAccountField, switchAccount } from './accounts.js';
import { renewQrLogin, scanToApprove, scanToSignIn, showScanButtons, startQrLogin, stopQrLogin } from './qr-login.js';

// The first pane exists from the start; on phones and laptops it stays the only one
createPane();

// ================================================================ Events

/** The address typed into the app's start page; a device key and its accounts belong to one relay. */
function useRelayAddress(text) {
    const before = relayAddress();
    const address = setRelayAddress(text);
    if (address && before && before !== address) {
        storage.remove(DEVICE_KEY);
        storage.remove(ACCOUNTS_KEY);
    }
    return address;
}

el.loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (isNative) {
        // The field takes the relay's address or a whole pairing link (address, one-time sign-in, end-to-end key)
        const link = parsePairingLink(el.loginRelay.value);
        const address = link ? useRelayAddress(link.address) : '';
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
el.loginScan.addEventListener('click', () => void scanToSignIn());
el.loginQrRenew.addEventListener('click', renewQrLogin);
el.devicesScan.addEventListener('click', () => void scanToApprove());
el.loginRelay.addEventListener('change', () => {
    if (!isNative) return;
    void checkTotp(true);
    const link = parsePairingLink(el.loginRelay.value);
    if (!link || link.params.get('pair')) return;
    const before = relayAddress();
    if (!useRelayAddress(link.address)) return;
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
    const b = closest(ev, '[data-account], [data-account-action]');
    if (!b) return;
    el.accountMenu.hidden = true;
    if (b.dataset.account) switchAccount(b.dataset.account);
    else if (b.dataset.accountAction === 'add') addAccount();
    else openAccounts();
});
el.accountsOwnSave.addEventListener('click', saveOwnAccount);
el.accountsAdd.addEventListener('click', addAccount);
el.accountsCreate.addEventListener('click', createAccount);
el.loginCancel.addEventListener('click', cancelAddAccount);
el.loginOtherAccount.addEventListener('click', showAccountField);
el.settingsAllAccounts.addEventListener('change', chooseAllAccounts);
el.e2eDelete.addEventListener('click', async () => {
    if (!confirm(t('e2e.deleteConfirm'))) return;
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

// "+" menu: entries like the other menus, icon before the label
const NEW_ENTRIES = [['conversation', 'conversation', 'conversation.new'], ['bot', 'bot', 'editor.newBot'], ['group', 'group', 'group.new']];
let newEntries = [];

function buildNewMenu() {
    newEntries = NEW_ENTRIES.map(([kind, icon, key]) => {
        const b = menuButton(icon, t(key));
        b.dataset.new = kind;
        return b;
    });
    el.newMenu.replaceChildren(...newEntries);
}

el.btnNew.addEventListener('click', (ev) => {
    ev.stopPropagation();
    el.newMenu.replaceChildren(...newEntries);
    el.newMenu.hidden = !el.newMenu.hidden;
});

/** "New conversation": the "+" menu shows the bots; sleeping ones (no responsible machine awake) are disabled. */
function chooseNewConversation() {
    const info = node('div', 'menu-info');
    info.append(node('strong', '', t('conversation.new')), node('span', '', t('newMenu.whichBot')));
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
    el.newMenu.hidden = true;
    if (kind === 'conversation_with') {
        const b = bot(k.dataset.bot);
        // The machine answers with conversation_created; then the new conversation opens
        if (b && responsibleMachine(b)) send({ type: 'conversation_new', botId: b.id }, responsibleMachine(b));
    }
    if (kind === 'bot') openEditor(null);
    if (kind === 'group') {
        if (state.bots.length < 2) { alert(t('group.needTwoBots')); return; }
        openGroupEditor(null);
    }
});
el.search.addEventListener('input', onSearchInput);
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
setupQueueSwipe();
setupSearchBox();
setupMessageMenu();
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
el.footerHandle.addEventListener('click', toggleFooter);
// without stopPropagation the click catcher of the menu would close the list right away
el.gitTotal.addEventListener('click', (ev) => { ev.stopPropagation(); openGitPage(); });
el.gitBack.addEventListener('click', closeGitPage);
showFooter(storage.get(FOOTER_OPEN_KEY) === '1');
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

/** @type {Record<string, (p: import('./panes.js').Pane, ev: MouseEvent) => void>} */
const PANE_CLICKS = {
    'btn-back': (p) => closeChat(p),
    'btn-close': (p) => closeChat(p),
    // the header leads to the bot's page, which also holds what the chat's menu did (a group: its editor)
    'chat-title': (p) => {
        if (isGroup(p.chatId)) openGroupEditor(group(p.chatId));
        else openInfo(p.chatId);
    },
    'chat-model': (p, ev) => { ev.stopPropagation(); toggleHeaderSwitch(p, 'model'); },
    'chat-machine': (p, ev) => { ev.stopPropagation(); toggleHeaderSwitch(p, 'machine'); },
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
    'rec-send': () => { stopRecording(true); },
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
    // the innermost element with a handler: a tap on the name in the title means the title button
    const target = control(ev, PANE_CLICK_TARGETS);
    const handler = target && PANE_CLICKS[target.dataset.el];
    if (handler) handler(p, /** @type {MouseEvent} */ (ev));
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
    if (ev.target === p.el.text) { textHeight(p); checkMention(p); }
    if (ev.target === p.el.csText) onChatSearchInput(p);
});
el.panes.addEventListener('click', (ev) => {
    const p = paneOf(ev);
    if (p && ev.target === p.el.text) checkMention(p);
});
// blur does not bubble
el.panes.addEventListener('focusout', (ev) => {
    const p = paneOf(ev);
    if (p && ev.target === p.el.text) closeMention(p);
});
el.panes.addEventListener('keydown', (ev) => {
    const p = paneOf(ev);
    if (!p) return;
    if (ev.target === p.el.text) {
        if (mentionKey(p, ev)) return;
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
// More or fewer panes fit after resizing; at most once per frame
let layoutFrame = 0;
window.addEventListener('resize', () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        paneActivated();
    });
});

// Dialogs: "Cancel"/"×", Escape and a click on the backdrop close them. The backdrop only counts if the pointer
// was also pressed there – otherwise selecting text that ends outside would close it.
for (const o of [el.editor, el.gEditor, el.info, el.rEditor, el.kEditor, el.keyDialog, el.vscode, el.textDialog, el.settings]) {
    let pressedOnBackdrop = false;
    o.addEventListener('pointerdown', (ev) => { pressedOnBackdrop = ev.target === o; });
    o.addEventListener('click', (ev) => {
        const backdrop = ev.target === o && pressedOnBackdrop;
        pressedOnBackdrop = false;
        if (backdrop || control(ev, '[data-close]')) closeDialog(o);
    });
}
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const large = document.getElementById('image-view');
    if (large && !large.hidden) { large.hidden = true; return; }
    // the docked info panel is a column, not a dialog: Escape closes it only from inside
    const docked = el.app.classList.contains('info-docked') && !el.info.contains(document.activeElement);
    for (const o of [el.textDialog, el.keyDialog, el.settings, el.rEditor, el.kEditor, el.editor, el.gEditor, el.info, el.vscode]) {
        if (o.hidden || (o === el.info && docked)) continue;
        closeDialog(o);
        return;
    }
});
// Phone: the detail dialogs are pages; back (arrow or swipe to the right) leaves the VS Code history for its list first
for (const o of document.querySelectorAll('.overlay.page')) {
    const back = () => {
        if (o === el.vscode && !el.vsBack.hidden) showVscodeList();
        else closeDialog(o);
    };
    o.querySelector('[data-page-back]').addEventListener('click', back);
    swipeBack(/** @type {HTMLElement} */ (o), {
        allowed: (ev) => !closest(ev, 'textarea, input, select, pre, table'),
        moved: () => /** @type {HTMLElement} */ (o.querySelector('.dialog')),
        close: back,
    });
}
// Entries of the chat's menu on the bot's page and in the group editor; closest: the tap can land on the icon or the label
el.infoActions.addEventListener('click', (ev) => {
    const k = closest(ev, '[data-action]');
    if (k) infoAction(k.dataset.action);
});
el.gActions.addEventListener('click', (ev) => {
    const k = closest(ev, '[data-action]');
    const g = state.groupEditorGroup;
    if (!k || !g) return;
    if (!chatMenuAction('g:' + g.id, k.dataset.action, el.gActions)) return;
    if (k.dataset.action === 'favorite') el.gActions.replaceChildren(...chatMenuButtons('g:' + g.id, true));
    else closeDialog(el.gEditor);
});
el.textForm.addEventListener('submit', (ev) => { ev.preventDefault(); submitText(); });
// a click in the dialog must not close a menu below it: the git list waits there for the commit
el.textDialog.addEventListener('click', (ev) => ev.stopPropagation());
el.vsBack.addEventListener('click', showVscodeList);
el.vsAdopt.addEventListener('click', adoptVscodeSession);
el.vsShow.addEventListener('click', () => { if (showInVscode(vs.chatId, 'ide')) closeDialog(el.vscode); });
el.vsTerminal.addEventListener('click', () => { if (showInVscode(vs.chatId, 'terminal')) closeDialog(el.vscode); });

// Bot editor
function fillTemplateOptions() {
    const chosen = el.editorTemplate.value;
    el.editorTemplate.innerHTML = '';
    for (const tpl of TEMPLATES) {
        const o = document.createElement('option');
        o.value = tpl.id;
        o.textContent = tpl.id ? `${t(tpl.name)} – ${t(tpl.role)}` : t('editor.noTemplate');
        el.editorTemplate.appendChild(o);
    }
    el.editorTemplate.value = chosen;
}
el.editorTemplate.addEventListener('change', () => {
    const tpl = TEMPLATES.find((x) => x.id === el.editorTemplate.value);
    // keep a folder that is already filled in: templates do not bring one
    if (tpl) { const folder = el.editorFolder.value; editorValues(templateValues(tpl)); el.editorFolder.value = folder; renderEditorAvatar(); }
});
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
el.editorAvatarAi.addEventListener('click', () => requestSuggestion('avatar'));
el.editorForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitEditor();
});
el.editorMachine.addEventListener('change', machineChanged);
el.editorFolder.addEventListener('input', folderTyped);
el.editorFolder.addEventListener('change', folderChanged);
el.editorRepo.addEventListener('input', repoTyped);
el.editorRepo.addEventListener('change', repoChanged);

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
    send({ type: 'group_save', group: { id: state.groupEditorGroup ? state.groupEditorGroup.id : '', name: el.gName.value.trim(), avatar: state.groupAvatarData, members } });
    closeDialog(el.gEditor);
});

// Info panel
el.infoKnowledgeNew.addEventListener('click', () => openKnowledgeEditor(knowledgeSection(), null));
el.infoRoutineNew.addEventListener('click', () => openRoutineEditor(null));
el.infoEdit.addEventListener('click', () => { const b = bot(state.infoBot); if (closeDialog(el.info) && b) openEditor(b); });

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
el.rDelete.addEventListener('click', () => {
    if (state.routineEdit && confirm(t('routine.deleteConfirm', { name: state.routineEdit.name }))) {
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
el.kDelete.addEventListener('click', () => {
    if (state.knowledgeFact && confirm(t('knowledge.forgetConfirm', { name: state.knowledgeFact.name }))) sendKnowledge({ type: 'knowledge_delete', name: state.knowledgeFact.name });
});

// Settings, with the blocks for notifications, devices and accounts
el.btnSettings.addEventListener('click', openSettings);
el.machineAdd.addEventListener('click', askMachineJoin);
el.settingsTheme.addEventListener('change', () => {
    if (el.settingsTheme.value === 'auto') storage.remove(THEME_KEY);
    else storage.set(THEME_KEY, el.settingsTheme.value);
    applyTheme(el.settingsTheme.value);
    toast(t('settings.saved'));
});
el.settingsLanguage.addEventListener('change', () => chooseLanguage(el.settingsLanguage.value));
el.settingsAvatarModel.addEventListener('change', () => {
    chooseShared('avatarModel', el.settingsAvatarModel.value);
    renderAvatarKeys();
});
el.settingsVoiceLanguage.addEventListener('change', () => chooseShared('voiceLanguage', el.settingsVoiceLanguage.value));
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
        alert(t('push.enableFailed', { error: e.message }));
    }
});
onNotificationOpen((url) => {
    const params = new URL(url, location.href).searchParams;
    // From another account this device is signed in to: load the page in that one (core.js picks it)
    const account = params.get('account') || 'main';
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
    fillTemplateOptions();
    showFooter(!el.footer.classList.contains('closed'));
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
    send({ type: 'presence', visible: !document.hidden });
    if (!document.hidden && state.signedIn) send({ type: 'wake_status' });
    if (!document.hidden && !state.ws && !state.rejected && credentials()) connect();
    // back in the app with open chats: they count as seen now
    if (!document.hidden && visibleChats().length) {
        for (const id of visibleChats()) markSeen(id);
        renderChatList();
    }
});

applyI18n();
applyTheme(storage.get(THEME_KEY) || 'auto');
showScanButtons();
// not paneActivated(): that would drop ?chat= from the address before the panes are restored
layoutPanes();
buildNewMenu();
fillTemplateOptions();
el.agentStatus.querySelector('span').textContent = t('status.connecting');
e2eStart().finally(connect);
