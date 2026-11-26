# Store consoles: answer sheet for OpenFolk Mobile

As of 2026-11-26, app version 0.8.0, app id `io.openfolk.app`. One sheet for App Store Connect and the Google Play
Console: every answer names the place in the code that backs it. All of this is a technical assessment, not legal
advice. Values that must not be public (reviewer credentials, the reviewers' relay address, contact person and phone
number) are placeholders here and are entered by the publisher in the consoles only.

Markers: **Recommendation** (fill in like this), **Decision** (the publisher chooses), **Check** (read the store's
current definition before saving, they change), **Unverified** (could not be proven from the repository).

Paths are relative to the repository root.

## 0. What the app does with data

OpenFolk has no service of its own that users sign up to. The app connects to a relay the user names on the first
start (their own, their team's), and through it to backends on the user's own machines. The publisher of the store
apps operates exactly one thing that every installation may touch: the push service.

| Data | Goes to | Kept there? | Evidence |
| --- | --- | --- | --- |
| Chats, files, voice recordings, history | the user's own backends, through the relay the user chose | relay: no, it routes ciphertext; backends: yes, on the user's machines | `webapp/js/e2e.js` (AES-GCM over every frame except the relay's own request types in `RELAY_TYPES`), `relay/src/bridge.ts` (routing only), `AGENTS.md` rule 1 |
| Account name, password hash, optional profile picture | the relay the user chose | yes, `accounts.json` on that relay (scrypt hash) | `relay/src/accounts.ts` (`StoredAccount`), `shared/protocol.ts` (`RelayAccount`) |
| Device entry: name, created, last seen, IP address, hash of the device key | the relay the user chose | yes, `devices.json`; an unused device expires after 90 days | `relay/src/devices.ts` (`DEVICE_IDLE_MS`), `shared/protocol.ts` (`DeviceInfo`) |
| Push device token (APNs or FCM) and app id | the user's backends (`push.json` per account); for delivery the publisher's push service, then Apple or Google | backends: yes; push service: not on disk, in memory as the key of a rate limit for up to 24 hours | `webapp/js/platform.js` (`register()`, listener `registration`), `docs/internals/push.md` ("Subscriptions"), `relay/src/push-service.ts` (`DEVICE_WINDOWS`, `Limiter`) |
| Notification preview: title, optional text, link with chat id, account id and relay address | the publisher's push service, then Apple or Google | no; reduced on the backend by the user's setting before it leaves (`title` by default, `full`, `none`) | `local/src/push.ts` (`visibleText(…, pushPreview())`), `relay/src/push-service.ts` (`cleanPush`), `webapp/i18n/en.js` (`settings.pushPreview*`) |
| IP address of the sending backend | the publisher's push service | in memory for the rate limit (1 hour); written to the log only when a limit is hit | `relay/src/relay.ts` (handler of `POST /push`), `relay/src/push-service.ts` (`SENDER_WINDOWS`) |
| End-to-end key | stays on the device | iOS Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), Android Keystore | `mobile/plugin/ios/Sources/OpenFolkPlugin/OpenFolkPlugin.swift`, `mobile/plugin/android/src/main/java/io/openfolk/nativeplugin/OpenFolkPlugin.java`, `webapp/js/platform.js` (`secureGet`/`secureSet`) |
| Report of a message: reason, note, the reported message, whether a bot or a person wrote it, the model's name, the backend's version | with another admin on the user's relay: those admins, inside the encrypted chat with them. Without one: the publisher (`POST /report` on the push service). Second way in both cases: an e-mail the user sends from their own mail app | publisher: yes, `reports.jsonl` on the push service, without address, account, device, or names of bots, chats and people; the sender's address only counts in memory for a rate limit (24 hours) and reaches the log when a report is refused | `webapp/js/chat-features.js` ("Reporting"), `local/src/agent.ts` (`report`: "no names of bots, chats or people, no account"), `relay/src/push-service.ts` (`PublisherReport`, `handleReportRequest`, `REPORT_WINDOWS`), `relay/src/relay.ts` (handler of `POST /report`) |
| Voice conversation with an OpenAI key (optional, off by default) | OpenAI, over WebRTC from the device, with the user's own key held on their machine | not by the publisher | `webapp/js/talk-realtime.js` (header, `realtimeOn`) |
| Analytics, advertising, crash and error reports | nobody | none: the app has no report endpoint and no installation pseudonym | no such dependency in `mobile/package.json`; the only fixed hosts in `webapp/js` are the push service, the releases page on GitHub, openfolk.app and the page for API keys of one AI provider |
| Usage metrics of the barcode library (Android only) | nobody | none | the scan is pinned to ZXing: `android: { scanningLibrary: 'zxing' }` in `scanBarcode`, `webapp/js/platform.js`. ML Kit (`com.google.mlkit:barcode-scanning:17.3.0`) is still linked by `@capacitor/barcode-scanner` but never called. **Unverified:** that the linked library sends nothing at app start; look at the network traffic of the first build once |
| A deleted account | stays on the user's own systems for a limited time | backend: the account's folder is moved to `deleted-accounts/` and removed for good after 30 days; relay: account id and time of deletion remain as a tombstone, so the id is never given out again | `local/src/accounts.ts` (`DELETED_KEEP_DAYS`, `purgeDeletedAccounts`), `relay/src/accounts.ts` (`deleted`), hint text `accounts.deleteOwnHint` in `webapp/i18n/en.js` |

Consequences for both forms:

- A relay is the user's or their organisation's server, not the publisher's. What it stores is not collected by the
  publisher. **Check** this reading against the stores' definitions of "collect" before saving.
- The push token is one of two items the publisher's infrastructure keeps beyond a single request (24 hours in
  memory). **Recommendation:** declare it in both stores as a device identifier, not linked to the user's identity (the
  service knows no account), purpose app functionality.
- The report is the other one, and the only thing the publisher stores on disk. On a relay without another admin the
  reported message and the user's note reach the publisher and are kept for review. That is user content the
  publisher can read, so neither the end-to-end exemption nor "transient processing" applies, and it is more than an
  e-mail the user sends themselves. **Recommendation:** declare it in both stores (1.3, 2.4): optional (only when the
  user sends a report, and the page says where it goes: `report.toSupport` in `webapp/i18n/en.js`), not linked to
  the user (no account, no device, no stored address), purpose app functionality, not shared, no tracking. Apple's
  rule for optional disclosure (infrequent, optional, not part of the primary function, shown to the user) would
  allow leaving it out there; this sheet declares it anyway, because a label that says more than required cannot be
  objected to and the two stores then say the same. **Open:** `reports.jsonl` has no retention period in the code;
  the privacy policy needs one, or the publisher empties the file by a fixed routine.
- The notification preview passes through the push service without being stored. **Decision:** leave it undeclared
  (transient processing) or declare it conservatively as "other user content"; this sheet recommends undeclared and says
  so in the privacy policy.
- The barcode scan uses ZXing, which runs on the device and reports nothing. ML Kit is only linked, so nothing is
  declared for it; a library that is never called collects nothing under Play's definition (**Check** once with the
  first build, see the table).
- Deleting an account takes it out of use at once; the copy on the user's backend goes after 30 days, the tombstone
  on the relay (id and time) stays. The deletion page and the privacy policy must say the same.
- The reviewers' demo relay runs with end-to-end encryption off (`mobile/README.md`, "Review"). It holds no real
  people and no real data, so it does not change the declarations.

## 1. App Store Connect

### 1.1 App record

| Field | Answer | Evidence or reason |
| --- | --- | --- |
| Platforms | iOS | `mobile/ios/` |
| Name | `OpenFolk` | `CFBundleDisplayName` in `mobile/ios/App/App/Info.plist`, `appName` in `mobile/capacitor.config.json` |
| Primary language | English (U.S.) (**Decision**; German is added as a localisation) | `CFBundleDevelopmentRegion` = `en`, `CFBundleLocalizations` = `en`, `de` in `Info.plist`; the project's documentation is English first |
| Bundle ID | `io.openfolk.app` | `PRODUCT_BUNDLE_IDENTIFIER` in `mobile/ios/App/App.xcodeproj/project.pbxproj`; registered with the push capability |
| SKU | `openfolk` | free choice, fixed after creation |
| User access | Full access | |
| Primary category | Developer Tools (**Decision**) | the app drives coding agents: `README.md`, first paragraph |
| Secondary category | Productivity | |
| Content rights | Does not contain, show or access third-party content (**Check**) | the app shows the user's own chats and the answers of AI models the user connected themselves |
| Price | Free, no in-app purchases | no purchase code or price in `webapp/js`; `docs/features.md` §46 |
| Availability | **Decision.** With `ITSAppUsesNonExemptEncryption` = `false` France may need a separate declaration for encryption; China requires a licence for chat apps | see 1.4 |
| Devices | iPhone and iPad; do not offer on Mac (Apple silicon) and Vision Pro (untested) | `TARGETED_DEVICE_FAMILY = "1,2"` in `project.pbxproj`, iPad orientations in `Info.plist` |
| Minimum iOS | 15.0 | `IPHONEOS_DEPLOYMENT_TARGET = 15.0` |
| Version | 0.8.0 | `MARKETING_VERSION` in `project.pbxproj`, `version` in `mobile/package.json` |
| Copyright | year and legal name of the publisher | entered by the publisher |
| Privacy policy URL | `https://openfolk.app/en/privacy` (German localisation: `https://openfolk.app/de/privacy`) | must answer 200 before saving; `/privacy` only redirects |
| Support URL | `https://openfolk.app/en/support` (German: `https://openfolk.app/de/support`); must answer 200 before saving | support address in the app: `SUPPORT_MAIL` in `webapp/js/core.js`, shown under Settings, About (`webapp/js/settings.js`) |
| Marketing URL | `https://openfolk.app` | optional |

### 1.2 Age rating

Apple's questionnaire asks about built-in content and about capabilities. OpenFolk ships no content of its own; what
appears on screen is what the user writes and what general-purpose AI models answer to free text. The honest answer is
therefore not "none" across the board.

| Question | Answer | Evidence or reason |
| --- | --- | --- |
| Parental controls | No | none in `webapp/js` |
| Age assurance | No | none in `webapp/js` |
| Unrestricted web access | No | no in-app browser; the web view only shows the bundled app (`webDir` in `mobile/capacitor.config.json`) |
| User-generated content | Yes | chats between people on the same relay: `docs/features.md` §35 |
| Messaging and chat | Yes | same |
| Advertising | No | no ad SDK in `mobile/package.json` |
| Profanity or crude humour | Infrequent or mild (**Decision**) | AI answers to free text, not filtered by the app |
| Mature or suggestive themes | Infrequent or mild (**Decision**) | same |
| Violence (cartoon, realistic, prolonged graphic), horror or fear themes | None | no such content built in; a coding agent is not aimed at it |
| Sexual content or nudity, graphic sexual content | None | same; reportable, see 1.6 |
| Alcohol, tobacco, drugs; medical or treatment information | None | same |
| Simulated gambling, gambling, contests, loot boxes | None | none in the app |
| Health or wellness topics | No | |

Expected result: 13+ in most regions (**Unverified**, the console computes it). **Decision:** the publisher may set a
higher rating by hand; Google Play is answered with an adult audience (2.5), and both can stand side by side because
Apple rates content while Google asks for the intended audience.

### 1.3 App Privacy

| Question | Answer | Evidence |
| --- | --- | --- |
| Do you or your third-party partners collect data from this app? | Yes | the push token, see section 0 |
| Data type 1 | Identifiers → Device ID | APNs device token: `webapp/js/platform.js` (`registration` listener), `relay/src/push-service.ts` |
| Data type 2 | User Content → Other User Content (**Decision**, reasoning in section 0) | a report without another admin: `relay/src/push-service.ts` (`PublisherReport`) |
| Used for (both types) | App Functionality only | delivery of notifications; review of reported content. No analytics, no advertising |
| Linked to the user's identity (both types) | No | the push service receives tokens and a preview, no account (`cleanPush`); a report is stored without address, account or device (`PublisherReport`) |
| Used for tracking (both types) | No | `NSPrivacyTracking` = `false`, empty `NSPrivacyTrackingDomains` in `mobile/ios/App/App/PrivacyInfo.xcprivacy` |

Not declared, with the reason (**Check** each against Apple's definitions):

- Chats, files, audio: end-to-end encrypted to the user's own machines, the publisher receives none of it.
- Name, password, device list: stored on the relay the user chose, which the publisher does not operate.
- Notification preview: passed on in real time, not stored (**Decision**, see section 0).
- Report by e-mail: sent by the user from their own mail app, which shows exactly what is sent. Covered by the
  declared "Other User Content"; "Customer Support" would be the alternative label for both ways of reporting.
- Diagnostics: the app sends no crash, error or usage reports; there is no endpoint for them in `relay/src` or
  `local/src`.

The privacy manifest matches the first type: `NSPrivacyCollectedDataTypes` in `PrivacyInfo.xcprivacy` declares
`NSPrivacyCollectedDataTypeDeviceID` (not linked, no tracking, app functionality). Follow-up in the code if the second
type is declared as recommended: add `NSPrivacyCollectedDataTypeOtherUserContent` with the same three values, so
manifest and label say the same.

### 1.4 Export compliance

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the app use encryption? | Yes, but only exempt encryption; the build answers it itself | `ITSAppUsesNonExemptEncryption` = `false` in `mobile/ios/App/App/Info.plist` |
| Which algorithms | AES-GCM, ECDH P-256, HKDF-SHA-256, PBKDF2 through the system's WebCrypto, plus TLS | `webapp/js/e2e.js`, `webapp/js/qr-login.js` |
| Proprietary or non-standard algorithms | No | same files: only `crypto.subtle` |

With the key in the Info.plist, App Store Connect does not ask per build. Whether a yearly self-classification report
or a declaration for France is due is the publisher's decision (**Decision**).

### 1.5 Review information

| Field | Answer |
| --- | --- |
| Sign-in required | Yes |
| User name | `<demo account name for Apple>` |
| Password | `<demo password>` |
| Contact first name, last name, phone, e-mail | entered by the publisher |
| Attachment | none |

The real values are kept in the publisher's password manager only. The reviewers' accounts are separate per store, are
recreated at once when a reviewer deletes one and are never locked by failed sign-ins: `relay/src/accounts.ts`
(`ensureDemo`), `relay/src/relay.ts` (`case 'account_delete'`), `mobile/README.md` ("Review").

Notes for the reviewer (one text, used unchanged; placeholders filled in the console):

```
OpenFolk is a messenger for the AI coding agents ("bots") that run on a user's own computers. The app is a client:
it connects to a relay server the user operates. We run a demo relay with a demo bot for this review.

HOW TO SIGN IN
1. Start the app and choose "URL and password".
2. Server URL: <demo relay address>
3. Tap "Sign in to another account than the main one?" and enter
   Name: <demo account name for Apple>
   Password: <demo password>
No pairing link, QR code or second factor is needed for this account.

WHAT TO TRY
- Open the chat of the demo bot and send a message; the bot answers.
- Hold the microphone button to send a voice message (asks for the microphone once).
- Allow notifications when the app asks, send a message and leave the app: the answer arrives as a push
  notification, and the app icon shows the number of unread chats.
- A file the bot sends opens the system share sheet.

NATIVE FUNCTIONS (GUIDELINE 4.2)
The interface is a web view, the following is native:
- Push notifications through APNs; tapping one opens the chat.
- The end-to-end encryption key is kept in the iOS Keychain (this device only).
- The camera scans a QR code to pair a device: on the sign-in page "Scan QR code", and signed in under
  Settings > Devices and security > Scan QR code.
- Files from the bots go to the system share sheet (save to Files, open in another app).
- Badge on the app icon for unread chats.
- Voice messages recorded with the microphone.
The demo relay runs without end-to-end encryption so that you can sign in with a password; with a pairing link or QR
code the key is handed over and stored in the Keychain.

USER-GENERATED AND AI-GENERATED CONTENT (GUIDELINE 1.2)
- Bot answers come from the AI model providers the user connected, with those providers' own safety systems.
- Chats with people exist only between accounts that an admin invited to the same relay; there is no public
  content, no feed and no search for strangers.
- Terms: before the first message to a person the app asks once to accept the terms of use (no objectionable
  content, no harassment, no abuse), with a link to https://openfolk.app/en/terms.
- Report: long-press a bot's answer or a person's message > "Report", choose a reason, add a note. The report
  goes to the admins of the relay; if there is no other admin, it goes to us from inside the app and we review it.
- Block: the menu of a chat with a person has "Block"; messages stop in both directions, and it can be undone.
- Contact: support@openfolk.app, also under Settings > About, next to the privacy policy.

ACCOUNT DELETION (GUIDELINE 5.1.1(v))
Settings > Accounts > "Delete my account", confirmed twice. The data is removed for good after 30 days. The demo
account is recreated automatically afterwards, so it is safe to try. Settings > About links the page that
explains deletion.

PERMISSIONS
Camera (QR code, taking a photo to attach), microphone (voice messages) and notifications are each requested when
the function is first used, never at launch.

PURCHASES
The app is free, has no in-app purchases and sells nothing. The AI models are the user's own subscriptions on their
own computers; the app neither sells them nor links to a place to buy them.

ENCRYPTION
Standard algorithms of the operating system only (AES-GCM, ECDH P-256, HKDF, PBKDF2, TLS).
```

Evidence for the notes: sign-in path in `mobile/README.md` ("Review"); push and badge in `webapp/js/platform.js`
(`pushPlugin`, `setBadge`); Keychain in `OpenFolkPlugin.swift`; scanner `@capacitor/barcode-scanner` in
`mobile/package.json` and `scannerPlugin` in `platform.js`; share sheet through the `Filesystem` and `Share` plugins in
`platform.js`; voice in `webapp/js/voice.js`; terms in `webapp/js/chat-features.js` (`termsNeeded`, `termsAccepted`,
only when `isNative`) and `terms.ask` in `webapp/i18n/en.js`; report in `webapp/js/chat-features.js` and
`local/src/agent.ts` (`report`); block in `webapp/js/menus.js` (`person_block`) and `local/src/agent.ts`; deletion in
`webapp/js/accounts.js` (`deleteOwnAccount`), `relay/src/relay.ts` and `local/src/accounts.ts` (`DELETED_KEEP_DAYS`);
links to privacy policy and deletion page in `webapp/js/settings.js` (`renderAbout`); no link to a provider's key page
in the store apps: `webapp/js/welcome.js` (`isNative` branch).

**Unverified**, to be checked on a device with the demo account before the notes are sent: the exact wording of the
menu entries, that the demo account sees a person to chat with (it is created with reach "admins", `ensureDemo`), that
the long-press menu offers "Report" on iOS, and where "Delete my account" sits in the settings.

### 1.6 Guideline 1.2 checklist

| Requirement | State | Evidence |
| --- | --- | --- |
| Report objectionable content | present, inside the app in every setup | `webapp/js/chat-features.js` ("Reporting"), reasons in `shared/protocol.ts` (`REPORT_REASONS`), `POST /report` in `relay/src/relay.ts` |
| Block abusive users | present for chats with people | `person_block` in `shared/protocol.ts`, `local/src/agent.ts` |
| Published contact | present | `SUPPORT_MAIL` in `webapp/js/core.js`, Settings, About |
| Filter for objectionable material | no filter of the app's own. Bot answers come from the model providers with their safety systems; person chats exist only between accounts an admin invited to the same relay | no filter in `webapp/js` or `local/src`; invitations in `relay/src/devices.ts`, reach of an account in `relay/src/accounts.ts` |
| Terms the user accepts (no tolerance for objectionable content) | present in the store apps: asked once per device before the first message to a person, with a link to `https://openfolk.app/{en,de}/terms` | `termsNeeded`, `termsAccepted` in `webapp/js/chat-features.js`, `terms.ask` in `webapp/i18n/en.js` |

## 2. Google Play Console

### 2.1 App record

| Field | Answer | Evidence or reason |
| --- | --- | --- |
| App name | `OpenFolk` | `mobile/android/app/src/main/res/values/strings.xml` (`app_name`), `mobile/capacitor.config.json` |
| Default language | English (United States), en-US (**Decision**); translation de-DE | as in 1.1 |
| App or game | App | |
| Free or paid | Free | cannot be changed to paid later |
| Package name | `io.openfolk.app` | `applicationId` in `mobile/android/app/build.gradle`; set by the first upload |
| Category | Productivity (**Decision**; Play has no developer tools category, "Tools" is the alternative) | |
| Tags | productivity, developer tools if offered (**Unverified:** the list is only visible in the console) | |
| Contact e-mail (public) | `support@openfolk.app` | `SUPPORT_MAIL` in `webapp/js/core.js` |
| Website | `https://openfolk.app` | |
| Minimum Android | 8.0 (API 26), target API 36 | `mobile/android/variables.gradle` |

### 2.2 App content: short forms

| Form | Answer | Evidence |
| --- | --- | --- |
| Privacy policy | `https://openfolk.app/en/privacy` | must answer 200 before saving; German page: `https://openfolk.app/de/privacy` |
| App access | All or some functionality is restricted; instructions as in the reviewer notes of 1.5 with the account `<demo account name for Google>` | separate account per store: `relay/.env.sample` (`DEMO_ACCOUNTS`) |
| Ads | No, the app contains no ads | no ad SDK in `mobile/package.json` |
| News app | No | |
| Government app, financial features, health | No, none | |
| Advertising ID | No (**Unverified** until the merged manifest of the release bundle is read: it must not contain `com.google.android.gms.permission.AD_ID`) | the app's own manifest does not declare it: `mobile/android/app/src/main/AndroidManifest.xml` |
| Foreground services | none | no `FOREGROUND_SERVICE*` in the app's manifest; merged manifest **Unverified** |

### 2.3 Permissions

The app's own manifest, `mobile/android/app/src/main/AndroidManifest.xml`, declares five permissions. None of them
belongs to the groups Play wants a declaration form for (SMS, call log, location in the background, all files access,
photo and video access, exact alarms, foreground services); camera, microphone and notifications are asked at runtime.

| Permission | Why | Asked when |
| --- | --- | --- |
| `INTERNET` | connection to the relay | not asked |
| `POST_NOTIFICATIONS` | notifications from the bots (Android 13 and later) | when the user switches notifications on (`requestPermissions` in `webapp/js/platform.js`) |
| `RECORD_AUDIO` | voice messages, dictation, voice conversation | on the first recording (`webapp/js/voice.js`) |
| `MODIFY_AUDIO_SETTINGS` | audio routing while recording in the web view | not asked |
| `CAMERA` | scanning a QR code to pair a device, taking a photo to attach | on the first scan; `android.hardware.camera` is declared as not required |

**Unverified:** what the libraries add in the merge (Firebase Cloud Messaging usually brings `WAKE_LOCK`,
`ACCESS_NETWORK_STATE` and `com.google.android.c2dm.permission.RECEIVE`, which need no declaration). The manifest has
no `tools:node="remove"` entries and the CI has no check of the merged manifest yet; read the manifest of the first
signed bundle before the forms are sent.

### 2.4 Data safety

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the app collect or share any of the required user data types? | Yes | push token, section 0 |
| Is all of the user data collected by the app encrypted in transit? | Yes | the app accepts `https:` addresses only (`webapp/js/platform.js`, the check with `!isNative`), `allowMixedContent: false` in `mobile/capacitor.config.json`; the push service is called over HTTPS (`local/src/push.ts`) |
| Account creation | **Decision.** Accounts exist, but on a relay the user or their team operates, by invitation; recommended answer: user name and password | `relay/src/accounts.ts`, invitation in `relay/src/devices.ts` (`INVITATION_TTL_MS`) |
| Account deletion URL | `https://openfolk.app/en/delete-account` (German: `https://openfolk.app/de/delete-account`); must answer 200 before saving | in the app: `accounts.deleteOwn` in `webapp/i18n/en.js`, `deleteOwnAccount` in `webapp/js/accounts.js` |
| Can users ask for data to be deleted without deleting the account? | **Decision.** In the app: deleting single chats and signing devices out; recommended answer No unless the page offers it | `person_chat_delete` in `shared/protocol.ts`, `device_logout` in `webapp/js/e2e.js` |

Data types:

| Type | Collected | Shared | Processed ephemerally | Required or optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Device or other IDs (FCM registration token) | Yes | No (Google as the delivery service is a service provider) | No (rate limit keeps it up to 24 hours in memory) | Optional: only after the user switches notifications on (**Check** against the first run on a device: the Firebase SDK may create its installation id at start) | App functionality |
| Messages → Other in-app messages (a report without another admin: the reported message and the user's note; **Decision**, reasoning in section 0) | Yes | No | No (kept in `reports.jsonl` for review) | Optional: only when the user sends a report | App functionality (**Check:** the console also offers "Fraud prevention, security and compliance", which fits the review of reports) |

The reported message can be a bot's answer or another person's message; if the console's wording fits better, "App
activity → Other user-generated content" is the alternative type for the same row. Declare one of the two, not both.

Not declared, with the reason (**Check** against Play's definitions): messages, files and audio in general (end-to-end
encrypted to the user's own machines, the publisher cannot read them); name and device list (on the user's relay);
notification preview (ephemeral, **Decision** as in section 0); crash logs and diagnostics (the app sends none; the
barcode scan runs on ZXing, ML Kit is linked but not called); audio of the optional voice conversation over OpenAI
(from the device to the provider whose key the user stored on their own machine, a transfer the user starts:
`webapp/js/talk-realtime.js`, `local/src/realtime.ts`; **Check** against Play's definition of "sharing").

Backup: `android:allowBackup="false"` in `mobile/android/app/src/main/AndroidManifest.xml`, so the device's sign-in
does not reach a Google backup.

### 2.5 Content rating, audience, AI

| Form | Answer | Evidence or reason |
| --- | --- | --- |
| Rating questionnaire, category | Utility, productivity, communication or other (**Check** the wording in the console) | |
| Violence, sexuality, language, controlled substances, gambling | No, none built in | the app ships no content |
| Users can interact or exchange content | Yes | chats with people, `docs/features.md` §35 |
| Users can share user-generated content with others | Yes (text, files, voice) | same |
| Reporting and blocking available | Yes | 1.6 |
| Shares the user's location | No | no location permission in the manifest |
| Digital purchases | No | |
| Unrestricted internet access | No | |
| Target audience | 18 and over only (**Decision**); not directed at children | a tool for software developers; keeps the families policy out |
| Appeals to children | No | |
| Generative AI | The app shows text generated by AI models the user connects on their own machines; the answers come from those providers with their safety systems. Reporting an AI answer works inside the app in every setup and reaches the relay's admins or the publisher. The app generates no images of people and offers no content aimed at the restricted categories | `webapp/js/chat-features.js` ("Reporting"), `local/src/agent.ts` (`report`), `docs/features.md` §43 |

**Unverified:** whether the console shows a form of its own for generative AI for this category; if it does, answer
with the row above.

### 2.6 Release

| Step | Answer |
| --- | --- |
| Play App Signing | on; upload key as configured in `mobile/android/app/build.gradle` (`signingConfigs.release`) |
| First track | Internal testing, with a tester list |
| First bundle | uploaded by hand by the publisher; later ones by the workflow `.github/workflows/mobile.yml` |
| Version | 0.8.0, version code from the workflow's run number (`OPENFOLK_BUILD_NUMBER`) |
| Mapping file | upload with every bundle (R8 is on: `minifyEnabled true` in `build.gradle`) |
| Countries | **Decision** |

## 3. Store listing

Length limits: App Store name 30, subtitle 30, promotional text 170, keywords 100, description 4000; Google Play
title 30, short description 80, full description 4000, release notes 500. The App Store metadata must not name other
mobile platforms, so the App Store description leaves Android out; the Play description leaves iOS out. Both use the
same body otherwise. Texts are based on `docs/features.md`, `docs/features.de.md` and `README.md`.

**Decision:** the descriptions name the agent runtimes (Claude Code, Codex, Cursor, GitHub Copilot) because the app is
useless without one of them; they are third-party marks and stay out of name, subtitle and keywords.

### 3.1 English

| Field | Text |
| --- | --- |
| Name / title | `OpenFolk` |
| Subtitle (App Store) | `Chat with your coding agents` |
| Short description (Play) | `A messenger for the AI coding agents running on your own computers.` |
| Promotional text (App Store) | `Your coding agents as bots in a messenger: see who is working, approve risky steps with one tap and get a notification when a bot is done.` |
| Keywords (App Store) | `ai,coding,agent,bot,developer,chat,messenger,self-hosted,git,approval,remote,terminal,devops` |
| What's new (0.8.0) | `First release of OpenFolk for this store.` |

Full description:

```
OpenFolk is a messenger for the AI coding agents that run on your own computers.

Running one coding agent in a terminal is easy. Running five of them across several projects, and knowing which one
is waiting for you, is not. OpenFolk turns every agent into a bot: a colleague with a picture, a name, a role and a
tone, who works in one fixed folder, for example one bot per repository.

WHAT YOU NEED
This app is the client. Your bots run on an OpenFolk backend on your own computer or server. OpenFolk is free and
open source (MIT); the desktop app sets it up without a terminal. On the first start the app asks for the address of
your relay, or you scan a QR code from a device that is already signed in.

YOUR BOTS IN ONE LIST
- See at a glance who is working, on what, and who has an answer you have not read yet.
- Bots keep working when you close the app.
- A notification tells you when a bot is done, needs an approval or has a question.

YOU STAY IN CONTROL
- Before a bot does something risky, it asks. You allow or deny it with one tap, in the chat.
- Open changes of all your bots in one place.
- You decide how much a notification shows: the bot's name, the text, or nothing but "OpenFolk".

TALK INSTEAD OF TYPE
- Hold the microphone and say what you want. The recording is transcribed on the machine that runs the bot.
- Answers can be read aloud.

MORE THAN ONE CHAT
- Group chats with several bots, routines that run on a schedule, knowledge the bots remember.
- Several machines: bots move between them, and sleeping machines can be woken.
- Chats with people on the same relay, with files and voice messages.

PRIVATE BY DESIGN
- Everything between your devices and your machines is end-to-end encrypted. The relay in between passes on what it
  cannot read and stores no messages.
- The sign-ins of your AI providers never leave your machines.
- No account with us, no subscription to us, no ads, no tracking.
- The key is kept in the secure storage of your phone.

SAFETY
- Report a bot's answer or a person's message from its menu.
- Block a person; it works in both directions and can be undone.
- Delete your account in the settings.

WORKS WITH
Bots run on Claude Code by default. A bot can also use OpenAI Codex, Cursor or GitHub Copilot. You bring your own
subscription or API key, on your own machine. OpenFolk is an independent open-source project and is not affiliated
with these providers.

The interface is available in English and German.
Source code and documentation: https://github.com/OpenFolk/OpenFolk
```

### 3.2 German

| Field | Text |
| --- | --- |
| Name / Titel | `OpenFolk` |
| Untertitel (App Store) | `Chatte mit deinen Coding-Bots` |
| Kurzbeschreibung (Play) | `Ein Messenger für die KI-Coding-Agenten auf deinen eigenen Rechnern.` |
| Werbetext (App Store) | `Deine Coding-Agenten als Bots in einem Messenger: sehen, wer arbeitet, heikle Schritte mit einem Tipp freigeben und erfahren, wenn ein Bot fertig ist.` |
| Keywords (App Store) | `ki,coding,agent,bot,entwickler,chat,messenger,git,freigabe,terminal,programmieren,devops` |
| Neue Funktionen (0.8.0) | `Erste Version von OpenFolk in diesem Store.` |

Beschreibung:

```
OpenFolk ist ein Messenger für die KI-Coding-Agenten, die auf deinen eigenen Rechnern laufen.

Einen Coding-Agenten im Terminal zu betreiben ist leicht. Fünf davon über mehrere Projekte, und zu wissen, welcher
gerade auf dich wartet, ist es nicht. OpenFolk macht aus jedem Agenten einen Bot: einen Kollegen mit Bild, Name, Rolle
und Ton, der in einem festen Ordner arbeitet, zum Beispiel ein Bot je Repository.

WAS DU BRAUCHST
Diese App ist der Client. Deine Bots laufen auf einem OpenFolk-Backend auf deinem eigenen Computer oder Server.
OpenFolk ist kostenlos und Open Source (MIT); die Desktop-App richtet es ohne Terminal ein. Beim ersten Start fragt die
App nach der Adresse deines Relays, oder du scannst einen QR-Code von einem schon angemeldeten Gerät.

DEINE BOTS IN EINER LISTE
- Auf einen Blick sehen, wer arbeitet, woran, und wer eine Antwort hat, die du noch nicht gelesen hast.
- Bots arbeiten weiter, wenn du die App schließt.
- Eine Benachrichtigung meldet, wenn ein Bot fertig ist, eine Freigabe braucht oder eine Rückfrage hat.

DU BEHÄLTST DIE KONTROLLE
- Bevor ein Bot etwas Heikles tut, fragt er. Du erlaubst oder verweigerst es mit einem Tipp, im Chat.
- Die offenen Änderungen aller Bots an einer Stelle.
- Du bestimmst, wie viel eine Benachrichtigung zeigt: den Namen des Bots, den Text oder nichts als „OpenFolk“.

SPRECHEN STATT TIPPEN
- Mikrofon halten und sagen, was du willst. Die Aufnahme wird auf dem Rechner transkribiert, auf dem der Bot läuft.
- Antworten lassen sich vorlesen.

MEHR ALS EIN CHAT
- Gruppenchats mit mehreren Bots, Routinen nach Zeitplan, Wissen, das sich die Bots merken.
- Mehrere Rechner: Bots ziehen zwischen ihnen um, schlafende Rechner lassen sich wecken.
- Chats mit Personen auf demselben Relay, mit Dateien und Sprachnachrichten.

PRIVAT GEBAUT
- Alles zwischen deinen Geräten und deinen Rechnern ist Ende-zu-Ende-verschlüsselt. Das Relay dazwischen reicht nur
  weiter, was es nicht lesen kann, und speichert keine Nachrichten.
- Die Anmeldungen deiner KI-Anbieter verlassen deine Rechner nie.
- Kein Konto bei uns, kein Abo bei uns, keine Werbung, kein Tracking.
- Der Schlüssel liegt im sicheren Speicher deines Handys.

SICHERHEIT
- Die Antwort eines Bots oder die Nachricht einer Person über ihr Menü melden.
- Eine Person blockieren; das gilt in beide Richtungen und lässt sich zurücknehmen.
- Dein Konto in den Einstellungen löschen.

LÄUFT MIT
Bots laufen standardmäßig mit Claude Code. Ein Bot kann auch OpenAI Codex, Cursor oder GitHub Copilot nutzen. Du
bringst dein eigenes Abo oder deinen API-Schlüssel mit, auf deinem eigenen Rechner. OpenFolk ist ein unabhängiges
Open-Source-Projekt und steht in keiner Verbindung zu diesen Anbietern.

Die Oberfläche gibt es auf Deutsch und Englisch.
Quellcode und Dokumentation: https://github.com/OpenFolk/OpenFolk
```

## 4. Still missing for the listing

| Item | State |
| --- | --- |
| Screenshots iPhone 6.3" (1206×2622), English and German | missing; from the web app with the demo account, no sign-in page, no real data |
| Screenshots iPad 13" (2064×2752), English and German | missing; required because the app supports iPad (`TARGETED_DEVICE_FAMILY = "1,2"`) |
| Screenshots Android phone (2 to 8, 9:16), English and German | missing |
| Screenshots Android tablet 7" and 10" | optional; recommended because the app is not restricted to phones |
| Feature graphic 1024×500 | present: `mobile/store/graphics/feature-graphic-1024x500.png` |
| Play icon 512×512 | present: `mobile/store/graphics/play-icon-512.png` |
| App Store icon 1024×1024 | part of the build (`mobile/ios/App/App/Assets.xcassets`) |
| Privacy policy in English and German | written, not live yet: `https://openfolk.app/en/privacy`, `/de/privacy` |
| Account deletion page | written, not live yet: `https://openfolk.app/en/delete-account`, `/de/delete-account` |
| Support page | written, not live yet: `https://openfolk.app/en/support`, `/de/support` |
| Terms of use | being written: `https://openfolk.app/en/terms`, `/de/terms`; the app links them before the first message to a person, so they must be live before the review |
| Support address | `support@openfolk.app`; send a test mail on the day of submission |
| Reviewer accounts | exist on the demo relay; sign in once from a foreign network on the day of submission |

## 5. Open points that the stores may object to

Closed since the first version of this sheet (2026-11-26): links to the privacy policy and the deletion page in the
app, terms before chats with people, reports that stay inside the app, the purge of deleted accounts after 30 days,
the device id in the privacy manifest, `allowBackup`, the barcode scan pinned to ZXing, and no link to a provider's
key page in the store apps. What remains:

| Point | Where | Why it matters |
| --- | --- | --- |
| The owner account `main` cannot delete itself in the app | `webapp/js/accounts.js` (row hidden for `main`), `relay/src/relay.ts` (`case 'account_delete'`) | Apple 5.1.1(v) asks for deletion of every account the app can create; `main` is the relay owner's own installation and goes with the relay. The reviewers use other accounts; say so if asked, and the deletion page should explain it |
| The privacy manifest lacks the second data type | `mobile/ios/App/App/PrivacyInfo.xcprivacy` | add `NSPrivacyCollectedDataTypeOtherUserContent` if reports are declared as recommended (1.3) |
| Reports are kept without a retention period | `relay/src/push-service.ts` (`REPORT_FILE`, only a size limit) | the privacy policy has to name how long reports are kept |
| `aps-environment` is `development` | `mobile/ios/App/App/App.entitlements` | the App Store export signs with the distribution profile, which sets `production`; **Unverified** until a TestFlight build has received a push |
| Merged Android manifest not checked | no check in `.github/workflows/mobile.yml` | the answers on advertising id and foreground services (2.2) depend on it |
| ML Kit is linked though unused | `@capacitor/barcode-scanner` | **Unverified** that it stays silent at app start (section 0) |
| Terms page not live yet | `https://openfolk.app/{en,de}/terms` | the app links it; a dead link in the consent dialog fails the review |
