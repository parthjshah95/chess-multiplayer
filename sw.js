// Minimal service worker. It exists for two reasons only: Android has no
// Notification constructor (notifications there must come from a registration),
// and a notification click needs somewhere to run so it can refocus the game.
// Deliberately no fetch handler — nothing here caches the app.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Prefer the tab holding this exact game — a browser may have several open.
    const target = (url && windows.find((w) => w.url === url)) || windows[0];
    if (target) return target.focus();
    if (url) return self.clients.openWindow(url);
  })());
});
