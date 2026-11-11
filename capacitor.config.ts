import type { CapacitorConfig } from '@capacitor/cli';

// G&R staff app · private native app (App Store unlisted + Google Play).
// Nov 10 (Ronnie: "live site"): the app opens the live site, so every web push shows up in the store app with no new build.
// dist/ is still bundled for offline.html (shown when the phone has no connection).
const config: CapacitorConfig = {
  appId: 'ca.gravotreservice.staff',
  appName: 'G&R',
  webDir: 'dist',
  backgroundColor: '#F6F2EC',
  server: {
    url: 'https://gr-staff-portal.vercel.app',
    cleartext: false,
    allowNavigation: ['gr-staff-portal.vercel.app', '*.supabase.co'],
    errorPath: 'offline.html',
  },
  ios: { contentInset: 'automatic', scheme: 'G&R' },
  android: { allowMixedContent: false },
};

export default config;
