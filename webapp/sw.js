/* Service worker: shows the bots' push notifications and opens the chat when tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
    // Priority from the settings: high stays until you react; quiet comes without sound and vibration
    // (iOS ignores both, there only the urgency of the delivery matters). Backends from before 2026-10-12 send
    // `prio` with the German values leise/hoch.
    const priority = d.priority || d.prio || 'normal';
    const quiet = priority === 'quiet' || priority === 'leise';
    const high = priority === 'high' || priority === 'hoch';
    e.waitUntil(self.registration.showNotification(d.title || 'OpenFolk', {
        body: d.body || '',
        tag: d.tag,
        renotify: !!d.tag && !quiet,
        requireInteraction: high,
        silent: quiet,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        data: { url: d.url || '/' },
    }));
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const target = new URL(e.notification.data && e.notification.data.url ? e.notification.data.url : '/', self.location.origin).href;
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
        for (const w of windows) {
            if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
                w.postMessage({ type: 'open', url: target });
                return w.focus();
            }
        }
        return self.clients.openWindow(target);
    }));
});
