/* OpenFolk web app: queue, running answers, approvals and questions, sending and attachments. */
import { t, tn } from './i18n.js';
import { el, md, node, state, closest } from './core.js';
import { activePane, paneFor, paneOf } from './panes.js';
import { bot, botIdOf, clockTime, colorOf, duration, fileSize, fillAvatar, isGroup, openApprovals, responsibleMachine, send, senderName, showImageLarge, upper } from './e2e.js';
import { setLast } from './connection.js';
import { chatStatus, renderChatList } from './list.js';
import { machineToWake } from './chat.js';
import { isRead, renderEntry, scroll, setReply } from './chat-features.js';

/** @typedef {import('./panes.js').Pane} Pane */
import { canRecord, imageRequested, rec, renderUploads } from './voice.js';

// ---------------------------------------------------------- Queue
// Own messages that arrive while the bot is still working are not in the history, but collapsed above the
// input field. They move into the history as soon as the bot starts on them (read) or nothing runs any more
// (e.g. after stopping, then with a grey tick). Open or not is per pane (`queueOpen`).

function ownUnread(e) {
    return e.role === 'user' && (!e.from || e.from === 'me') && !isRead(e) && !e.movedTo && !e.discardedAt;
}

/** The queue runs in order: if the bot has already read a later own message, this one no longer waits, even if it was
 *  never marked as read or discarded (stopped before the mark, restart of the backend). */
function overtaken(e, chatId) {
    return (state.history[chatId] || []).some((x) => x.ts > e.ts && x.role === 'user' && (!x.from || x.from === 'me') && x.readAt && !x.deletedAt);
}

export function isQueued(e, chatId) {
    if (!ownUnread(e) || overtaken(e, chatId)) return false;
    const s = chatStatus(chatId).state;
    return s === 'thinking' || s === 'waiting' || Object.keys(state.live[chatId] || {}).length > 0;
}

/** Position in the history: a message stands where the bot read it, not where it was sent. */
export function displayTime(e) {
    return e.role === 'user' && e.readAt ? e.readAt : e.ts;
}

/** Re-render the bar and append messages that no longer wait to the end of the history. @param {Pane} p */
export function renderQueue(p, settled = false) {
    if (!p) return;
    const id = p.chatId;
    const entries = id ? state.history[id] || [] : [];
    const waiting = [];
    let later = false;
    for (const e of entries) {
        if (e.deletedAt) continue;
        if (isQueued(e, id)) {
            waiting.push(e);
        } else if (e.role === 'user' && e.id && (!e.from || e.from === 'me') && !p.el.messages.querySelector(`[data-id="${CSS.escape(e.id)}"]`)) {
            // Unread and the bot is free right now: between two jobs it is "idle" for a moment, right after that
            // the next one comes. Only move it up once it really does nothing for a second (e.g. after stopping).
            // Moved ones stand in the history as a hint right away.
            if (isRead(e) || e.movedTo || e.discardedAt || settled || overtaken(e, id)) appendEntry(p, e);
            else { waiting.push(e); later = true; }
        }
    }
    clearTimeout(p.queueSettle);
    p.queueSettle = later ? setTimeout(() => { if (p.chatId === id) renderQueue(p, true); }, 1000) : null;
    p.el.queue.hidden = waiting.length === 0;
    if (waiting.length === 0) p.queueOpen = false;
    p.el.queueHead.textContent = '⏳ ' + tn('queue.waiting', waiting.length);
    p.el.queueHead.setAttribute('aria-expanded', String(p.queueOpen));
    p.el.queueList.hidden = !p.queueOpen;
    p.el.queueList.innerHTML = '';
    for (const e of waiting) {
        const li = node('li');
        li.appendChild(node('div', 'queue-text', (e.voice ? '🎤 ' : '') + (e.text || (e.attachments && e.attachments.length ? '📎 ' + e.attachments.map((a) => a.name).join(', ') : ''))));
        const footer = node('div', 'queue-footer');
        // Work in parallel: from the queue into a new conversation with the bot (not in groups);
        // on the phone swipe to the right, the button only on the PC
        if (!isGroup(id) && e.id) {
            const k = node('button', 'queue-parallel', '↗ ' + t('queue.toConversation'));
            k.type = 'button';
            k.title = t('queue.toConversationTitle');
            k.addEventListener('click', () => moveToConversation(id, e));
            footer.appendChild(k);
            li.dataset.parallel = '1';
        }
        if (e.id) {
            const remove = node('button', 'queue-delete', t('common.delete'));
            remove.type = 'button';
            remove.title = t('queue.deleteTitle');
            remove.addEventListener('click', () => deleteFromQueue(id, e));
            footer.appendChild(remove);
            li.dataset.id = e.id;
        }
        footer.appendChild(node('span', 'time', clockTime(e.ts)));
        li.appendChild(footer);
        p.el.queueList.appendChild(li);
    }
}

// Swipe a waiting message: to the left "Delete" appears underneath, to the right "To new conversation";
// from 90 px releasing does it
const SWIPE_DELETE_PX = 90;

export function setupQueueSwipe() {
    let g = null;
    el.panes.addEventListener('touchstart', (ev) => {
        const li = closest(ev, '.queue-list li[data-id]');
        const p = li && paneOf(li);
        g = p && ev.touches.length === 1 ? { p, li, x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, horizontal: null, strip: null } : null;
    }, { passive: true });
    el.panes.addEventListener('touchmove', (ev) => {
        if (!g) return;
        const dx = ev.touches[0].clientX - g.x;
        const dy = ev.touches[0].clientY - g.y;
        if (g.horizontal === null) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            g.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5 && (dx < 0 || !!g.li.dataset.parallel);
            if (!g.horizontal) { g = null; return; }
            g.right = dx > 0;
            // strip behind the row, same height and position
            g.strip = g.right ? node('div', 'swipe-delete swipe-parallel', '↗ ' + t('queue.toConversation')) : node('div', 'swipe-delete', t('common.delete'));
            g.strip.style.top = g.li.offsetTop + 'px';
            g.strip.style.height = g.li.offsetHeight + 'px';
            g.p.el.queueList.appendChild(g.strip);
            g.li.classList.add('swiped');
            g.li.style.transition = 'none';
        }
        g.dx = g.right ? Math.max(0, Math.min(200, dx)) : Math.max(-200, Math.min(0, dx));
        g.li.style.transform = `translateX(${g.dx}px)`;
        g.strip.classList.toggle('ready', Math.abs(g.dx) >= SWIPE_DELETE_PX);
    }, { passive: true });
    const end = () => {
        if (!g || !g.horizontal) { g = null; return; }
        const { p, li, strip, dx, right } = g;
        g = null;
        if (Math.abs(dx) >= SWIPE_DELETE_PX) {
            const id = p.chatId;
            const e = (state.history[id] || []).find((x) => x.id === li.dataset.id);
            if (e) {
                strip.remove();
                if (right) moveToConversation(id, e);
                else deleteFromQueue(id, e);
                return;
            }
        }
        li.style.transition = 'transform .18s ease-out';
        li.style.transform = '';
        setTimeout(() => { li.classList.remove('swiped'); li.style.transition = ''; strip.remove(); }, 180);
    };
    el.panes.addEventListener('touchend', end);
    el.panes.addEventListener('touchcancel', end);
}

function deleteFromQueue(chatId, e) {
    e.deletedAt = 'pending';
    renderQueue(paneFor(chatId));
    const b = isGroup(chatId) ? null : bot(botIdOf(chatId));
    send({ type: 'queue_delete', chatId, entryId: e.id }, (b && responsibleMachine(b)) || undefined);
    // If the bot started on it meanwhile, the backend refuses: then show it again
    setTimeout(() => {
        if (e.deletedAt !== 'pending') return;
        delete e.deletedAt;
        renderQueue(paneFor(chatId));
    }, 6000);
}

export function setDeleted(f) {
    const list = state.history[f.chatId];
    if (!list) return;
    const i = list.findIndex((x) => x.id === f.entryId);
    if (i >= 0) list.splice(i, 1);
    const last = list[list.length - 1];
    setLast(f.chatId, last);
    renderQueue(paneFor(f.chatId));
    renderChatList();
}

/** The backend emptied the queue (stop, new session): the messages move into the history with a grey tick. */
export function setDiscarded(f) {
    for (const e of state.history[f.chatId] || []) if (f.entryIds.includes(e.id)) e.discardedAt = f.ts;
    renderQueue(paneFor(f.chatId));
}

function moveToConversation(chatId, e) {
    const b = bot(chatId);
    if (!b) return;
    e.movedTo = 'pending';
    renderQueue(paneFor(chatId));
    send({ type: 'queue_to_conversation', chatId, entryId: e.id }, responsibleMachine(b) || undefined);
    // If the bot started on it meanwhile, the backend refuses (error message): then back into the queue
    setTimeout(() => {
        if (e.movedTo !== 'pending') return;
        delete e.movedTo;
        const p = paneFor(chatId);
        if (!p) return;
        const h = p.el.messages.querySelector(`.event[data-id="${CSS.escape(e.id)}"]`);
        if (h) h.remove();
        renderQueue(p);
    }, 6000);
}

export function setMoved(f) {
    const e = (state.history[f.chatId] || []).find((x) => x.id === f.entryId);
    if (e) e.movedTo = f.to;
    const p = paneFor(f.chatId);
    if (!p) return;
    const h = p.el.messages.querySelector(`[data-id="${CSS.escape(f.entryId)}"]`);
    if (h) h.remove();
    renderQueue(p);
}

/** Short title as in the backend: first line, cut at a word boundary. */
export function titleFrom(text) {
    // Same rule as titleFrom in local/src/agent.ts (tests/browser/shared-rules.test.mjs); a voice message's first line
    // is the recording's label, not its content
    const line = (String(text || '').replace(/^🎤[^\n]*\n/, '').split('\n').find((z) => z.trim()) || '').trim();
    if (line.length <= 40) return line;
    const short = line.slice(0, 40);
    const word = short.lastIndexOf(' ');
    return (word > 20 ? short.slice(0, word) : short).replace(/[\s,.;:–-]+$/, '') + ' …';
}

/** @param {Pane} p */
function appendEntry(p, e) {
    const messages = p.el.messages;
    renderEntry(p, e);
    // before running answers, so the message stands above the answer it triggers
    const bubble = messages.lastElementChild;
    const live = messages.querySelector('.answer.live');
    if (live && bubble !== live) messages.insertBefore(bubble, live);
    approvalsToBottom(p);
    scroll(p, true);
}

export function speaker(botId) {
    const s = node('div', 'speaker');
    const av = node('div', 'avatar mini');
    fillAvatar(av, bot(botId), botId, true);
    const n = node('span', '', senderName(botId));
    n.style.color = colorOf(botId);
    s.append(av, n);
    return s;
}

/** entry: { chatId, entryId } for tools from the history; their output only comes from the machine when expanded. */
export function toolRow(tool, finished = false, entry = null) {
    const running = tool.ok === undefined && !finished;
    const d = node('details', 'tool' + (tool.ok === false ? ' failed' : running ? ' running' : ''));
    const s = node('summary');
    const name = tool.name.startsWith('mcp__') ? tool.name.split('__').slice(1).join(' › ') : tool.name;
    s.append(node('b', '', name), node('span', 'what', tool.summary));
    if (tool.durationMs !== undefined && tool.ok !== undefined) s.append(node('span', 'duration', duration(tool.durationMs)));
    d.appendChild(s);
    // Insert the output only when expanded: long histories have hundreds of tools, almost all stay closed
    let filled = false;
    d.addEventListener('toggle', () => {
        if (!d.open || filled) return;
        filled = true;
        if (tool.result) d.appendChild(node('pre', '', tool.result));
        else if (tool.deferred && entry) d.appendChild(fetchToolOutput(entry, tool));
        else if (running) d.appendChild(node('pre', '', t('tools.running')));
    });
    return d;
}

/**
 * Tools of a finished answer: from two on as one collapsed row ("⚙ 5 tools · Grep, Read …"),
 * the single rows only appear when expanded. During the answer they stand one by one.
 */
export function renderTools(target, tools, entry = null) {
    if (tools.length < 2) {
        for (const tool of tools) target.appendChild(toolRow(tool, true, entry));
        return;
    }
    const failed = tools.filter((tool) => tool.ok === false).length;
    const d = node('details', 'tool tools' + (failed ? ' with-errors' : ''));
    const s = node('summary');
    const names = [...new Set(tools.map((tool) => (tool.name.startsWith('mcp__') ? tool.name.split('__').pop() : tool.name)))];
    s.append(node('b', '', tn('tools.count', tools.length)),
        node('span', 'what', names.slice(0, 4).join(', ') + (names.length > 4 ? ' …' : '') + (failed ? ` · ${t('tools.failed', { n: failed })}` : '')));
    const ms = tools.reduce((n, tool) => n + (tool.durationMs || 0), 0);
    if (ms) s.append(node('span', 'duration', duration(ms)));
    d.appendChild(s);
    const list = node('div', 'tool-list');
    d.appendChild(list);
    d.addEventListener('toggle', () => {
        if (d.open && !list.childElementCount) for (const tool of tools) list.appendChild(toolRow(tool, true, entry));
    });
    target.appendChild(d);
}

const toolRequests = new Map();

function fetchToolOutput({ chatId, entryId }, tool) {
    const pre = node('pre', 'loading', t('common.loading'));
    const key = `${chatId}|${entryId}|${tool.id}`;
    const open = toolRequests.get(key);
    if (open) open.pres.push(pre);
    else {
        toolRequests.set(key, { tool, pres: [pre] });
        const r = state.historyFrom[chatId];
        send({ type: 'tool_output', chatId, entryId, toolId: tool.id }, r && state.online.includes(r) ? r : undefined);
    }
    return pre;
}

export function receiveToolOutput(f) {
    const key = `${f.chatId}|${f.entryId}|${f.toolId}`;
    const open = toolRequests.get(key);
    if (!open) return;
    toolRequests.delete(key);
    if (typeof f.result === 'string') {
        open.tool.result = f.result;
        delete open.tool.deferred;
    }
    for (const pre of open.pres) {
        pre.classList.remove('loading');
        pre.textContent = f.result ?? t('tools.outputNotFound');
    }
}

export function attachmentBar(list) {
    const bar = node('div', 'attachment-bar');
    for (const a of list) {
        const k = node('button', 'attachment');
        k.type = 'button';
        const isImage = (a.type || '').startsWith('image/') || Boolean(a.thumb);
        k.title = t(isImage ? 'attachment.view' : 'attachment.download', { name: a.name });
        if (a.thumb) {
            const img = document.createElement('img');
            img.src = a.thumb;
            img.alt = a.name;
            k.classList.add('image');
            k.appendChild(img);
        } else {
            k.append(node('span', 'symbol', '📄'), node('span', 'name', a.name), node('span', 'size', fileSize(a.size)));
        }
        k.addEventListener('click', () => {
            // Show images large instead of downloading (iOS ignores downloads in the home screen app);
            // first the preview, the original follows from the machine
            const reachable = !a.machine || state.online.includes(a.machine);
            if (isImage && (a.thumb || reachable)) showImageLarge(a.thumb || '', a.name, reachable ? a.path : '');
            if (!reachable) {
                if (!isImage || !a.thumb) showEvent(t('attachment.machineOff', { name: a.name, machine: upper(a.machine) }), true);
                return;
            }
            if (isImage) imageRequested.add(a.path);
            send({ type: 'file_get', path: a.path }, a.machine);
        });
        bar.appendChild(k);
    }
    return bar;
}

/** A line in the history of the pane showing `chatId` (none open: nothing); without chat id in the active pane. */
export function showEvent(text, error = false, chatId = null) {
    const p = chatId ? paneFor(chatId) : activePane();
    if (!p || !p.chatId) return;
    p.el.messages.appendChild(node('div', 'event' + (error ? ' error' : ''), text));
    approvalsToBottom(p);
    scroll(p);
}

// ---------------------------------------------------------------- Running answers

export function getLive(chatId, botId) {
    const chat = (state.live[chatId] = state.live[chatId] || {});
    if (!chat[botId]) chat[botId] = { wrap: null, bubble: null, content: null, text: '', tools: new Map(), rows: new Map(), timer: null };
    return chat[botId];
}

export function liveWrap(chatId, botId) {
    const l = getLive(chatId, botId);
    if (!l.wrap || !l.wrap.isConnected) {
        l.wrap = node('div', 'answer live');
        if (isGroup(chatId)) l.wrap.appendChild(speaker(botId));
        const p = paneFor(chatId);
        if (p) {
            p.el.messages.appendChild(l.wrap);
            approvalsToBottom(p);
        }
    }
    return l.wrap;
}

/**
 * Render the text of the running answer; throttled so Markdown does not render again on every character. Every
 * render parses the whole text, so the pause grows with it (10 000 characters: about 0.2 s, at most 1 s): otherwise a
 * long answer costs more with every chunk.
 */
export function renderLiveText(chatId, botId, now = false) {
    const l = getLive(chatId, botId);
    if (!l.bubble || !l.bubble.isConnected) {
        l.bubble = node('div', 'bubble bot streaming');
        l.content = node('div', 'content');
        l.bubble.appendChild(l.content);
        liveWrap(chatId, botId).appendChild(l.bubble);
    }
    const render = () => {
        l.timer = null;
        if (l.content) l.content.innerHTML = md(l.text);
        scroll(paneFor(chatId));
    };
    if (now) render();
    else if (!l.timer) l.timer = setTimeout(render, Math.min(1000, 90 + l.text.length / 100));
}

export function finishLiveText(l) {
    if (l.timer) {
        clearTimeout(l.timer);
        l.timer = null;
        if (l.content) l.content.innerHTML = md(l.text);
    }
    if (l.bubble) l.bubble.classList.remove('streaming');
}

// ---------------------------------------------------------------- Approvals and questions

/** @param {Pane} p */
export function renderApprovals(p) {
    if (!p) return;
    const messages = p.el.messages;
    messages.querySelectorAll('.approval').forEach((k) => k.remove());
    for (const a of openApprovals(p.chatId)) messages.appendChild(approvalCard(a));
    scroll(p);
}

/** @param {Pane} p */
export function approvalsToBottom(p) {
    if (!p) return;
    const messages = p.el.messages;
    messages.querySelectorAll('.approval').forEach((k) => messages.appendChild(k));
}

function approvalCard(a) {
    const k = node('div', 'approval');
    k.dataset.approval = a.id;
    const head = node('div', 'approval-head');
    const av = node('div', 'avatar mini');
    fillAvatar(av, bot(a.botId), a.botId);
    head.append(av, node('strong', '', t(a.kind === 'question' ? 'approval.asks' : 'approval.wants', { name: senderName(a.botId) })));
    k.appendChild(head);

    if (a.kind === 'question') {
        const choice = {};
        for (const q of a.questions || []) {
            const block = node('div', 'question');
            block.appendChild(node('p', 'question-text', q.question));
            const options = node('div', 'options');
            choice[q.question] = new Set();
            for (const o of q.options) {
                const b = node('button', 'option');
                b.type = 'button';
                b.append(node('strong', '', o.label));
                if (o.description) b.append(node('span', '', o.description));
                b.addEventListener('click', () => {
                    const set = choice[q.question];
                    if (q.multiSelect) {
                        if (set.has(o.label)) set.delete(o.label); else set.add(o.label);
                    } else {
                        set.clear();
                        set.add(o.label);
                        options.querySelectorAll('.option').forEach((x) => x.classList.remove('selected'));
                    }
                    b.classList.toggle('selected', set.has(o.label));
                    // single question with single choice: send right away
                    if (!q.multiSelect && (a.questions || []).length === 1) submit();
                });
                options.appendChild(b);
            }
            block.appendChild(options);
            const free = node('input', 'free');
            free.placeholder = t('approval.ownAnswer');
            free.dataset.question = q.question;
            block.appendChild(free);
            k.appendChild(block);
        }
        const submit = () => {
            const answers = {};
            for (const q of a.questions || []) {
                const free = k.querySelector(`input[data-question="${CSS.escape(q.question)}"]`);
                const text = free && free.value.trim();
                answers[q.question] = text || [...choice[q.question]].join(', ');
            }
            send({ type: 'approval_reply', id: a.id, allow: true, answers }, a.machine);
            k.classList.add('sent');
        };
        const actions = node('div', 'actions');
        const cancel = node('button', 'btn', t('common.cancel'));
        cancel.type = 'button';
        cancel.addEventListener('click', () => send({ type: 'approval_reply', id: a.id, allow: false, message: t('approval.declineQuestion') }, a.machine));
        const ok = node('button', 'primary', t('approval.answer'));
        ok.type = 'button';
        ok.addEventListener('click', submit);
        actions.append(cancel, ok);
        k.appendChild(actions);
        return k;
    }

    k.appendChild(node('p', 'approval-what', a.summary));
    if (a.detail) k.appendChild(node('pre', '', a.detail));
    const reason = node('input', 'free');
    reason.placeholder = t('approval.reason');
    k.appendChild(reason);
    const actions = node('div', 'actions');
    const button = (text, cls, frame) => {
        const b = node('button', cls, text);
        b.type = 'button';
        b.addEventListener('click', () => {
            send(Object.assign({ type: 'approval_reply', id: a.id, message: reason.value.trim() || undefined }, frame), a.machine);
            k.classList.add('sent');
        });
        return b;
    };
    actions.append(
        button(t('approval.deny'), 'btn danger', { allow: false }),
        button(t('approval.alwaysAllow'), 'btn', { allow: true, always: true }),
        button(t('approval.allow'), 'primary', { allow: true }),
    );
    k.appendChild(actions);
    return k;
}

// ---------------------------------------------------------------- Sending, attachments

/** @param {Pane} p */
export function sendMessage(p) {
    const text = p.el.text.value.trim();
    const chatId = p.chatId;
    if ((!text && p.uploads.length === 0) || !chatId || !state.agentOnline || machineToWake(chatId)) return;
    // Single chat directly to the bot's machine (the attachments land there too); groups to the first one awake
    const b = bot(chatId);
    send({
        type: 'send', chatId, text,
        attachments: p.uploads.length ? p.uploads.map((u) => ({ name: u.name, type: u.type, data: u.data, thumb: u.thumb })) : undefined,
        replyTo: p.replyTo || undefined,
    }, b ? responsibleMachine(b) : undefined);
    setReply(p, null);
    p.el.text.value = '';
    p.uploads = [];
    renderUploads(p);
    textHeight(p);
}

/** @param {Pane} p */
export function textHeight(p) {
    const text = p.el.text;
    text.style.height = 'auto';
    text.style.height = Math.min(text.scrollHeight, window.innerHeight * 0.4) + 'px';
    composerButtons(p);
}

/** As in a messenger: an empty input shows the microphone, text the send button; with an attachment and no text
 *  both (the voice message takes the attachments along). There is one microphone: while a pane records, the others
 *  keep their microphone, but disabled. @param {Pane} p */
export function composerButtons(p) {
    const e = p.el;
    const noText = !e.text.value.trim();
    const empty = noText && p.uploads.length === 0;
    const recording = !!rec.recorder && rec.pane === p;
    e.btnMic.hidden = !noText || recording || !canRecord();
    e.btnSend.hidden = (empty && canRecord()) || recording;
    e.recording.hidden = !recording;
    e.text.hidden = recording;
    e.btnAttach.hidden = recording;
    e.btnMic.disabled = e.btnSend.disabled || (!!rec.recorder && !recording);
}
