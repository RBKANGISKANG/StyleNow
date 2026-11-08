import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The shells bundle the web app's static export (built with no base path),
 * so the full product — including the Supabase backend and the offline
 * localStorage fallback — runs inside the native WebView.
 *
 * The real long-term mobile app is the React Native client specified in
 * apps/mobile/OFFLINE.md; these shells are the pragmatic store-distribution
 * path until it ships.
 */
const config: CapacitorConfig = {
  appId: 'com.stylenow.app',
  appName: 'StyleNow',
  webDir: '../web/out',
  backgroundColor: '#fff9f3',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
  // Push needs the live server (it sends the notifications and stores who
  // wants them). Set STYLENOW_APP_URL=https://your-domain before `cap sync`
  // and the app opens the server version instead of the bundled demo.
  ...(process.env.STYLENOW_APP_URL ? { server: { url: process.env.STYLENOW_APP_URL, cleartext: false } } : {}),
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
