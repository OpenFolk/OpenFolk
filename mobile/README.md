# OpenFolk for iOS and Android

Capacitor shell around the web app from `../webapp/`. Unlike the desktop apps, the mobile apps bring the web app
along instead of loading it from the relay: app stores expect the code inside the app, the native bridge is only
open to OpenFolk's own pages, and the app starts without a connection. Backend (`../local/`) and relay
(`../relay/`) stay unchanged; the app only needs the relay's address.

- **First start:** the login form asks for the server URL, i.e. the relay's address (e.g. `relay.example.com`, `https://` is added), besides
  the password. Quicker: on a signed-in device open the settings, under "Devices and security" choose "Pair another device" and tap "Scan QR
  code" on the app's sign-in page (or paste the pairing link into the address field); it signs the app in without the
  password and brings the end-to-end key. Signed in, the app scans the QR code another device shows on its sign-in
  page (settings → "Devices and security" → "Scan QR code") and signs that device in. The scanner is `@capacitor/barcode-scanner`; it
  needs the camera permission (`NSCameraUsageDescription`, `android.permission.CAMERA`).
  Logging the device out brings the form back, where the address can be changed.
- **Push** comes through Apple Push Notification service (iOS) and Firebase Cloud Messaging (Android), sent
  directly by the backends like Web Push. Tapping a notification opens the chat. See "Push" below for the setup.
- **End-to-end key** (pairing link or typed in) is kept in the iOS Keychain or protected by the Android Keystore.
- **Files** the bots send open the share sheet (save to Files, send, open in another app).
- **Number on the app icon** (iOS): unread chats.
- **Voice messages** use the microphone; the app asks once.
- **Version check:** if app and a backend no longer fit (`PROTOCOL_VERSION` in `shared/protocol.ts`), the footer
  says which side needs an update.

Everything that differs between browser, desktop and mobile goes through `webapp/js/platform.js`. OpenFolk's own
native code is the small plugin in `plugin/` (Keychain/Keystore, icon badge); everything else uses official
Capacitor plugins (push notifications, filesystem, share, app).

## Build

Requirements: Node 22, `npm install` in the repository root once (the app takes `marked` and `DOMPurify` from
there). Android: Android Studio with an SDK. iOS: a Mac with Xcode.

```sh
cd openfolk/mobile
npm install
npm run sync        # copies ../webapp into www/ and from there into android/ and ios/
npm run android     # opens Android Studio (run or build an APK/AAB there)
npm run ios         # opens Xcode (choose your team under Signing & Capabilities, then run)
```

After every change to `webapp/` run `npm run sync` again. `android/` and `ios/` are regular native projects and
are versioned; `www/` and the copies inside the native projects are not.

The app id is `io.openfolk.app` (`capacitor.config.json`, Android `applicationId`, iOS bundle identifier). If you
publish your own build, change it in all three places and set `APNS_TOPIC` accordingly.

## Push

The backends send directly to Apple and Google, with credentials of whoever builds the app. Set them in the `.env`
of every machine that runs a backend (or at least of one that is usually awake), then restart the backends. Until
then the app's notification dialog says that no backend can send to it yet.

Alternatively the relay holds the credentials (the same variables on the relay, `FCM_SERVICE_ACCOUNT` with the
JSON itself for containers): it then delivers for every backend that has none of its own and sees what Apple and
Google see, the preview. Own credentials of a backend always win. See `docs/internals/push.md`.

**iOS (APNs):**

1. In Xcode, the target *App* already has the *Push Notifications* capability (`App/App.entitlements`); select
   your team so signing creates the matching profile.
2. In the Apple developer account: *Certificates, Identifiers & Profiles → Keys*, create a key with *Apple Push
   Notifications service (APNs)* and download the `.p8` file (only possible once).
3. In `.env`:

   ```
   APNS_KEY_FILE=C:/secure/AuthKey_ABC123DEFG.p8
   APNS_KEY_ID=ABC123DEFG
   APNS_TEAM_ID=TEAM123456
   ```

   `APNS_TOPIC` is only needed if the app does not report its bundle id. `APNS_ENV` is `auto` by default:
   production first, the sandbox for development builds from Xcode.

**Android (FCM):**

1. Create a Firebase project, add an Android app with the package name `io.openfolk.app`, download
   `google-services.json` into `android/app/` (it is git-ignored).
2. *Project settings → Service accounts → Generate new private key* and store the JSON file outside the repository.
3. In `.env`: `FCM_SERVICE_ACCOUNT_FILE=C:/secure/openfolk-firebase.json`

**What Apple and Google see:** Web Push is end-to-end encrypted, APNs and FCM are not. The setting "App notifications
show" decides what goes into a notification: `title` (default, e.g. the bot's name), `full` (title and text) or `none`
(only "OpenFolk"). The link that opens the chat is always included.

**Store releases:** a self-hosted backend can only send to an app whose push credentials it holds. For one app in
the stores that many people use with their own backends, the relay of the publisher holds the credentials and
delivers for all of them (see above); a self-hosted relay without them leaves the apps without push unless the
backends have credentials of their own.

## Tests

The browser tests start the web app with a stand-in for the Capacitor bridge (`tests/browser/native-app.test.mjs`):
relay address, push registration with an APNs token, opening a chat from a notification, the key in the Keychain
and the icon badge. Delivery to APNs and FCM is tested in `local/src/push-native.test.ts` with real keys and
intercepted requests. The native projects themselves are built in Android Studio and Xcode.
