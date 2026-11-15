# Push notifications

Backends send push directly; the relay is not in the path for browsers. There are three channels, and they do not
share a trust model:

| Channel | Receiver | Who sees the contents | Credentials |
| --- | --- | --- | --- |
| Web Push (VAPID) | browsers, installed PWA | nobody: the payload is encrypted for the subscription | the VAPID key pair, the same on every machine |
| APNs | iOS app | Apple | `.p8` key of the Apple developer account |
| FCM | Android app | Google | Firebase service account |

Web Push is end-to-end encrypted by the standard itself, so a notification may carry the bot's answer. APNs and
FCM are not: Apple and Google read every notification they deliver. That is why the shared setting `pushPreview` exists
and defaults to `title` (the bot's name, no text); `full` and `none` are the user's choice. The backend reduces the
text before it sends or hands it to the relay, which sends it as it gets it: the setting belongs to the user, not to
whoever hosts the relay. The link that opens the
chat is always included, and it only names a chat id.

## Who holds the Apple and Google credentials

A backend with `APNS_*` and `FCM_*` in its `.env` sends to the apps itself, like Web Push. Since the credentials
belong to whoever built the app (the bundle id and the Firebase project are theirs), a self-hoster who installs
the app from a store has none. For that case the relay can hold them: a relay with `APNS_*` or `FCM_*` set tells
every backend on connect which channels it delivers (`relay_hello`), and a backend hands notifications for those
channels to the relay (`push` in `AgentOutbound`) with the text already reduced to the preview. The relay forwards
them without storing anything and reports device tokens the push services no longer know (`push_result`), so the
backend can drop them.

This is the single exception to "the relay sees no contents", and it is bounded: only app push, only when the
backend has no credentials of its own, and only the preview. Own credentials always win, channel by channel.

## Subscriptions

Browsers register a Web Push subscription, apps a device token (`push_subscribe` with `channel`, `token` and the
app id). Both are stored in the account's `push.json` (`local/data/accounts/<id>/`) on every machine, synced like other configuration, so each
machine can deliver on its own. Tokens the services reject (410, `Unregistered`, `UNREGISTERED`) are dropped.
APNs development builds use the sandbox host; a token that production rejects with `BadDeviceToken` is retried
there once and then remembered as `sandbox`.

Push is suppressed for muted chats and while a client is watching; approvals and hand-overs always go out.

## Who is looking

A page sends `presence` to every machine awake, not to one: a bot's push is decided on the bot's machine, and only
that machine knows its clients. Neither the sync nor the relay carries it. Presence belongs to one connection and
ends with it (`client_close`), which the sync's newest-wins records cannot express, and state in the relay would
break "the relay stays dumb" for something each page can say itself. A machine that wakes gets it once the page sees
it in `agents`; a backend counts a connection as not watching until it hears from it.

A phone, or a client too old to say what it is, is watching while visible, as always. A desktop (the desktop app,
or a browser with a fine pointer on a screen over 1000 px, `deviceForm()` in `platform.js`) only while it is in use:
visible with input in the last two minutes. It reports the change and at most once a minute while it lasts, and
nothing while idle, so input only records a time; a backend forgets a report after three minutes, so a socket that
died quietly does not keep the phone silent.

While a desktop is in use, answers, routine results and person messages stay away from the other devices, and a
phone gets approvals and hand-overs three minutes later unless the approval was answered or a device opened the chat
meanwhile (the shared `seen` state; the web app marks a chat seen when a request appears in it on screen). The timer
is in memory: a restart of the backend in those minutes drops the notification, which is cheaper than a store that
must expire, and the desktop has already shown the request. Whether a subscription is a phone travels with it
(`push_subscribe` with `form`); app tokens are phones whatever app version sent them. "Always notify" (`always`) is
per device, so it lives with the subscription too and syncs with it, newer traits winning (`traitsAt`). Old clients
send neither and keep getting their notifications at once.

The link of an app notification carries `account=` for an account other than main and `relay=` with the web app's
address (`APP_URL`, otherwise the relay's own), because one app can be signed in to several accounts and relays; the
tag gets both in front, so the same chat id elsewhere does not replace the notification. A browser's push stays
relative: its service worker belongs to one origin anyway.
