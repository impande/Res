// Kill-switch service worker.
//
// A legacy version of this site registered a cache-first service worker. On
// browsers that still have it, that old worker serves a months-old copy of the
// page from its cache and never updates — the "stale version, no auto-refresh"
// symptom on production. Newer visitors (and UAT) never had that worker, so
// they always hit the network and look fine.
//
// This worker replaces the old one, wipes every cache it left behind,
// unregisters itself so future loads go straight to the network, and — crucially
// — forces the stale page that is currently on screen to reload ONCE so the
// visitor immediately sees the latest version instead of having to reload by hand.
self.addEventListener('install', function() { self.skipWaiting(); });

self.addEventListener('activate', function(event) {
  event.waitUntil((async function() {
    // 1. Delete every cache the old worker created.
    var names = await caches.keys();
    await Promise.all(names.map(function(n) { return caches.delete(n); }));

    // 2. Take control of pages the old worker was serving stale content to.
    await self.clients.claim();

    // 3. Unregister so subsequent navigations bypass the SW entirely.
    try { await self.registration.unregister(); } catch (e) {}

    // 4. Only force a reload when we actually cleared a legacy cache. On a clean
    //    browser there is nothing stale on screen, so skipping the reload here
    //    prevents any refresh loop if the page were to re-register this worker.
    if (names.length > 0) {
      var clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function(c) {
        if ('navigate' in c) { try { c.navigate(c.url); } catch (e) {} }
      });
    }
  })());
});
