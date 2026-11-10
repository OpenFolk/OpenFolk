// Watches the start of the app. The web app is some thirty ES modules (js/main.js); if a single one fails to load (a
// network gap while the phone wakes, the relay restarting during a deploy), none of them runs and only the bare page
// stays, an empty search field without texts. Then the page loads again, up to three times within two minutes, and
// after that says so with a button. js/start.js sets window.openfolkStarted once the app is up.
// A file of its own instead of an inline script, so the Content Security Policy works without 'unsafe-inline'.
(() => {
    const KEY = 'openfolk-boot-retries';
    const WINDOW_MS = 120000;
    const TRIES = 3;
    const WAIT_MS = 10000;
    let handled = false;

    const recent = () => {
        try {
            const now = Date.now();
            return (JSON.parse(sessionStorage.getItem(KEY) || '[]') || []).filter((t) => typeof t === 'number' && now - t < WINDOW_MS);
        } catch { return []; }
    };

    const giveUp = () => {
        const de = (navigator.language || '').toLowerCase().startsWith('de');
        const box = document.createElement('div');
        box.className = 'boot-failed';
        const text = document.createElement('p');
        text.textContent = de ? 'OpenFolk ließ sich nicht laden. Prüfe die Verbindung und lade neu.' : 'OpenFolk could not be loaded. Check the connection and reload.';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'primary';
        button.textContent = de ? 'Neu laden' : 'Reload';
        button.addEventListener('click', () => location.reload());
        box.append(text, button);
        document.body.appendChild(box);
    };

    const failed = () => {
        if (handled || window.openfolkStarted) return;
        handled = true;
        const tries = recent();
        if (tries.length >= TRIES) { giveUp(); return; }
        try { sessionStorage.setItem(KEY, JSON.stringify([...tries, Date.now()])); } catch { /* private mode */ }
        location.reload();
    };

    // A script that does not load (also a module of the app's graph) reports an error on its element, which does not bubble
    window.addEventListener('error', (ev) => {
        if (ev.target && ev.target.tagName === 'SCRIPT') failed();
    }, true);
    // Loaded but not started (an error while evaluating): checked once the page has been visible long enough; a
    // phone that suspends the page in the background counts only the time in front
    const check = () => {
        if (document.hidden) { document.addEventListener('visibilitychange', check, { once: true }); return; }
        setTimeout(() => { if (!document.hidden) failed(); else check(); }, WAIT_MS);
    };
    check();
})();
