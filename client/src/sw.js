/* global self, clients */
// Service worker: built by vite-plugin-pwa (injectManifest), which fills in
// self.__WB_MANIFEST with the hashed app-shell files at build time.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// ---- App shell caching -------------------------------------------------------
// Precache the built JS/CSS/HTML/icons so the app opens offline. API responses
// are never cached: data always comes live from the server.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Client-side routes (/garden, /savings, …) load the cached index.html.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// A new version takes over as soon as it's installed; the page reloads itself
// (see registerSW in main.jsx) so it never runs old code against a new server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

// ---- Web push -----------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const { title = 'Garden Manager', body = '', data = {} } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      // Same tag replaces the previous notification of that kind instead of stacking.
      tag: data.tag,
      renotify: Boolean(data.tag),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  // Only ever open pages of this app.
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        // Let the app route in-place (keeps state); fall back to a full navigation.
        existing.postMessage({ type: 'navigate', url: target.pathname + target.search });
        return;
      }
      await clients.openWindow(target.href);
    })(),
  );
});
