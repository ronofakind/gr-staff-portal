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
