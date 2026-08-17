/* ClerkNest service worker — docs/21-WEB-PUSH-NOTIFICATIONS.md §1.
 *
 * DELIBERATELY MINIMAL. This handles `push` and `notificationclick` and NOTHING
 * else. In particular it registers NO `fetch` handler, so it cannot serve
 * cached/stale responses — preserving the reasoning already written into
 * src/app/manifest.ts: "the app is realtime-dependent, so a stale cache would
 * mislead." If you are ever tempted to add offline caching here, that is a
 * separate product decision, not a drive-by change.
 */

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for existing tabs to close —
  // a freshly-enabled subscription should work without a manual reload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push we can't parse is not worth a mystery notification with no context.
    return;
  }

  const title = payload.title || 'ClerkNest';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192-maskable.png',
      // Collapses repeats of the same event instead of stacking buzzes.
      tag: payload.tag || undefined,
      data: { link: payload.link || '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/dashboard';
  const target = new URL(link, self.location.origin).href;

  // Focus an already-open ClerkNest tab and navigate it, rather than piling up
  // duplicate tabs every time a notification is tapped.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
