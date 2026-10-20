// Apply the chosen appearance before the first paint (no flash); without a choice the system decides.
// A file of its own instead of an inline script, so the Content Security Policy works without 'unsafe-inline'.
try {
    const t = localStorage.getItem('openfolk-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* private mode */ }
