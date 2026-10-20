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

Push is suppressed while a client is visibly watching (`presence`) and for muted chats; approvals always go out.
