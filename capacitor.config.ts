import type { CapacitorConfig } from '@capacitor/cli';

// G&R staff app · private native app (App Store unlisted + Google Play).
// The app ships the built web app (dist/) so it works on its own; Supabase is reached as on the web.
const config: CapacitorConfig = {
  appId: 'ca.gravotreservice.staff',
  appName: 'G&R',
  webDir: 'dist',
  backgroundColor: '#F6F2EC',
  ios: { contentInset: 'automatic', scheme: 'G&R' },
  android: { allowMixedContent: false },
};

export default config;
