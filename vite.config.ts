import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // push 60 · which build a phone is on (debrief_seen.build)
  define: { __BUILD__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      // push 42 · phone alerts: push + notificationclick handlers live in public/push-sw.js
      workbox: { clientsClaim: true, skipWaiting: true, navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//, /^\/mcp/, /^\/\.well-known\//], importScripts: ['push-sw.js'] },
      manifest: {
        name: 'G&R', short_name: 'G&R', lang: 'fr',
        theme_color: '#ffffff', background_color: '#ffffff', display: 'standalone', start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
});
