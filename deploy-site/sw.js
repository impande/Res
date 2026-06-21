// Stub service worker — cleans up any previously cached content and unregisters itself.
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(names) { return Promise.all(names.map(function(n) { return caches.delete(n); })); })
      .then(function() {
        return self.registration.unregister();
      })
      .then(function() { return self.clients.claim(); })
  );
});
