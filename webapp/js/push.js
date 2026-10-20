/* OpenFolk web app: push notifications. */
import { locale, t } from './i18n.js';
import { el, node, state } from './core.js';
import { bot, fillAvatar, group, isGroup, send } from './e2e.js';
import { baseChats, toggleMuted } from './connection.js';
import { pushChannel, pushPermission, pushSubscription } from './platform.js';

// ================================================================ Push

/** Last known permission of this device; in the apps asking is asynchronous, so it is kept here for rendering. */
let permission = /** @type {'granted' | 'denied' | 'default' | 'impossible'} */ ('default');

export async function subscribePush() {
    const subscription = await pushSubscription(pushKey());
    if (subscription) send({ type: 'push_subscribe', subscription });
}

/**
 * The backends can deliver to this device: Web Push needs their VAPID key, the apps need a backend with APNs (iOS)
 * or FCM (Android) set up.
 */
function pushReady() {
    const channel = pushChannel();
    if (channel === 'web') return !!pushKey();
    return !!channel && Object.values(state.pushChannels).some((list) => list.includes(channel));
}

/** All machines should have the same key (PUSH_VAPID_* in .env); otherwise the one of the first awake applies. */
function pushKey() {
    const r = [...state.online].sort()[0];
    return (r && state.pushKeys[r]) || Object.values(state.pushKeys)[0] || '';
}

export function checkPush() {
    pushPermission().then((p) => {
        permission = p;
        if (p === 'granted' && pushReady()) subscribePush().catch((e) => console.warn('Push:', e));
        if (!el.settings.hidden) renderPushSettings();
    }, (e) => console.warn('Push:', e));
}

const PUSH_KINDS = [
    ['done', 'push.kind.done'], ['routine', 'push.kind.routine'], ['approval', 'push.kind.approval'],
    ['awake', 'push.kind.awake'], ['limit', 'push.kind.limit'],
];
const PUSH_PRIORITIES = [['off', 'push.priority.off'], ['quiet', 'push.priority.quiet'], ['normal', 'push.priority.normal'], ['high', 'push.priority.high']];
const PUSH_STATUS = {
    granted: 'push.status.granted',
    denied: 'push.status.denied',
    default: 'push.status.default',
    impossible: 'push.status.impossible',
    noBackend: 'push.status.noBackend',
};

export function renderPushSettings() {
    const status = permission !== 'impossible' && pushChannel() !== 'web' && Object.keys(state.pushChannels).length && !pushReady()
        ? 'noBackend' : permission;
    el.pushStatus.textContent = PUSH_STATUS[status] ? t(PUSH_STATUS[status]) : '';
    el.pushEnable.hidden = permission !== 'default' || !pushReady();

    const kinds = (state.pushSettings && state.pushSettings.kinds) || {};
    el.pushKinds.innerHTML = '';
    for (const [kind, label] of PUSH_KINDS) {
        const l = node('label', '', t(label));
        const select = document.createElement('select');
        select.id = 'push-kind-' + kind;
        l.htmlFor = select.id;
        for (const [value, name] of PUSH_PRIORITIES) {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = t(name);
            select.appendChild(o);
        }
        select.value = kinds[kind] || 'normal';
        select.disabled = !state.pushSettings || !state.agentOnline;
        select.addEventListener('change', () => {
            if (state.pushSettings) state.pushSettings.kinds[kind] = select.value;
            send({ type: 'push_settings', kinds: { [kind]: select.value } });
        });
        el.pushKinds.append(l, select);
    }

    el.pushChats.innerHTML = '';
    const chats = baseChats().map((id) => [id, isGroup(id) ? group(id) : bot(id)]).filter(([, o]) => o)
        .sort((a, b) => a[1].name.localeCompare(b[1].name, locale()));
    if (!chats.length) el.pushChats.appendChild(node('li', 'empty-small', t('push.noBots')));
    for (const [id, o] of chats) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!o.muted;
        box.disabled = !state.agentOnline;
        const badge = node('span', 'muted-badge', '🔕');
        badge.hidden = !o.muted;
        box.addEventListener('change', () => {
            if (!!o.muted !== box.checked) toggleMuted(id);
            badge.hidden = !box.checked;
        });
        const av = node('div', 'avatar' + (isGroup(id) ? ' group' : ''));
        fillAvatar(av, o, id);
        label.append(box, av, node('span', 'name', o.name), badge);
        li.appendChild(label);
        el.pushChats.appendChild(li);
    }
}

export function loadPushSettings() {
    renderPushSettings();
    // The permission may have changed in the system settings meanwhile
    pushPermission().then((p) => {
        permission = p;
        if (!el.settings.hidden) renderPushSettings();
    }, () => undefined);
}
