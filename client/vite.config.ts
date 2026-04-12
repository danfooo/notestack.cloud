import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'brains',
        short_name: 'brains',
        description: 'Personal knowledge system powered by AI',
        theme_color: '#f59e0b',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache' },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'assets-cache' },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_SERVER_PORT || 3000}`,
        changeOrigin: true,
      },
      '/mcp': {
        target: `http://localhost:${process.env.VITE_SERVER_PORT || 3000}`,
        changeOrigin: true,
      },
      '/avatars': {
        target: `http://localhost:${process.env.VITE_SERVER_PORT || 3000}`,
        changeOrigin: true,
      },
      '/attachments': {
        target: `http://localhost:${process.env.VITE_SERVER_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
});
