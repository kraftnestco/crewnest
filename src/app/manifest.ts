import type { MetadataRoute } from 'next';

/**
 * PWA manifest (docs/19, Phase U2) — lets tenants install ClerkNest to their
 * phone's home screen and run it standalone, which is the "manage the business
 * from my phone" daily-driver experience. No service worker/offline in this
 * pass — the app is realtime-dependent, so a stale cache would mislead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ClerkNest — AI employees for every channel',
    short_name: 'ClerkNest',
    description:
      'Run your business chats, orders, and AI employee from one place: WhatsApp, Instagram, Messenger, and website chat.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#faf8f3',
    theme_color: '#D91B5B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
