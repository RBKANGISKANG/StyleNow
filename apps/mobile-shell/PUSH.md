# Push notifications in the store apps

The web app already sends **web push** (browsers, and the "Add to Home Screen"
app on Android and iPhone) with no setup: the server makes its own keys on
first use. The App Store / Google Play apps use the native push services
instead. Everything in the code is ready; these accounts and keys are the
only missing pieces.

## 0. Point the app at the live server

Push is sent by the server, so the app must open the server version:

```bash
STYLENOW_APP_URL=https://your-domain.de npx cap sync
```

## 1. Android — Firebase Cloud Messaging (free)

1. https://console.firebase.google.com → **Add project** → add an **Android app**
   with package name `com.stylenow.app`.
2. Download `google-services.json` → put it in `apps/mobile-shell/android/app/`.
   The build picks it up automatically.
3. Firebase → Project settings → **Service accounts** → *Generate new private key*.
4. On the server, set the whole JSON file as one environment variable:
   `FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",…}'`

## 2. iPhone — Apple Push Notification service

Needs the Apple Developer Program (99 €/year).

1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → `+` →
   tick **Apple Push Notifications service (APNs)** → download the `.p8` file
   (only downloadable once) and note the **Key ID**.
2. Note your **Team ID** (top right of the developer site).
3. In Xcode (`npm run open:ios`): target **App** → *Signing & Capabilities* →
   `+ Capability` → **Push Notifications** and **Background Modes → Remote notifications**.
4. On the server set:
   ```
   APNS_KEY_P8="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
   APNS_KEY_ID=ABC123XYZ
   APNS_TEAM_ID=TEAM123456
   APNS_BUNDLE_ID=com.stylenow.app
   APNS_PRODUCTION=1        # leave out for test builds from Xcode
   ```

## 3. Check

Open the app → Account (customers) or Dashboard → Shop (businesses) →
**Turn on notifications** → **Send a test**.

Without these keys nothing breaks: native devices are just skipped, and email
(and SMS, if configured) still go out.

## Optional: fixed web-push keys

The server creates its VAPID keys once and stores them in the database. To
manage them yourself instead, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
(from `npx web-push generate-vapid-keys`) and optionally `VAPID_SUBJECT=mailto:you@domain`.
Changing them later makes every browser re-subscribe.
