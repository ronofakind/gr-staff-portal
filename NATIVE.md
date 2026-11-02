# G&R staff app · native app (Capacitor) · branch `native-app`

Private app: App Store **unlisted** + Google Play. Published under **Ronald Ladores (individual accounts)**, paid with the company card (Ronnie, Nov 2, 2026). Same React app, packed into iOS + Android shells.

- App id: `ca.gravotreservice.staff` · name **G&R** · `capacitor.config.ts`
- Icons / splash: `assets/` → `npx @capacitor/assets generate --iconBackgroundColor '#FFFFFF' --splashBackgroundColor '#F6F2EC' --splashBackgroundColorDark '#F6F2EC'` (only the `ios/` + `android/` outputs are kept; delete the generated `icons/` folder and `public/manifest.webmanifest`). Icon source is the 512 px web icon upscaled: replace `assets/icon-only.png` with a 1024 px original when Ronnie has one.
- Service worker is off inside the native app (`src/main.tsx`).

## Every update
`npm run build && npx cap sync` → iOS: open `ios/App/App.xcodeproj` in Xcode on the Mac mini → Product → Archive → Distribute → App Store Connect. Android: `npx cap open android` (or Gradle `bundleRelease`) → upload the .aab to Play Console.

## Still to build (before the first upload)
- Invite links open the app: Universal Links (iOS, `apple-app-site-association` on gr-staff-portal.vercel.app) + App Links (Android, `assetlinks.json`), needs the Apple Team ID and the Android signing key fingerprint.
- Native notifications (`@capacitor/push-notifications`, APNs key + Firebase project) → check-up step 6 "Turn on notifications".
- Face ID / fingerprint option after the code.
- Store listing text + screenshots; privacy page `/privacy` exists.

## Done in the app code (Nov 2)
- `src/lib/native.ts`: inside the app, `/api/*` calls go to https://gr-staff-portal.vercel.app; links we hand out (invite text, calendar feed, email redirect) use the live site; `appUrlOpen` routes opened links (/go/…) inside the app.
- `api/*`: CORS + OPTIONS preflight so the app (capacitor://localhost, https://localhost) can call them. **These api changes must be on main / live before the app ships.**
- Check-up: the app counts as installed (no Home Screen step); Android WebView is not treated as an in-app browser.

## Waiting / later
- Universal Links: `public/.well-known/apple-app-site-association` needs the Apple **Team ID** (enrollment pending). Android App Links: `public/.well-known/assetlinks.json` needs the Play App Signing SHA-256 (after the first upload).
- Notifications: `@capacitor/push-notifications` + Firebase project (google-services.json) + APNs key; sending side = push 24.
- Face ID: after first release (sessions already stay signed in; Face ID would unlock instead of the code).
- Builds can't run in the cloud container (no Android SDK / Xcode): Ronnie builds on the Mac mini (Xcode + Android Studio) with the steps above.
