const CACHE_VERSION = 'volley-static-v13';
const CORE_ASSETS = [
  './',
  './index.html',
  './player-card.html',
  './manifest.webmanifest',
  './icon.svg',
  './assets/app.css',
  './assets/js/main.js',
  './assets/js/utils/logger.js',
  './assets/js/utils/validators.js',
  './assets/js/state/app-state.js',
  './assets/js/domain/players.js',
  './assets/js/domain/tournaments.js',
  './assets/js/domain/timers.js',
  './assets/js/integrations/config.js',
  './assets/js/ui/stats-recalc.js',
  './assets/js/ui/players-controls.js',
  './assets/js/ui/roster-db-ui.js',
  './assets/js/ui/results-form.js',
  './assets/js/ui/tournament-form.js',
  './assets/js/ui/participants-modal.js',
  './assets/js/ui/tournament-details.js',
  './assets/js/ui/ipt-format.js',
  './assets/js/screens/ipt.js',
  './assets/js/registration.js',
  './assets/js/screens/core.js',
  './assets/js/screens/roster.js',
  './assets/js/screens/courts.js',
  './assets/js/screens/components.js',
  './assets/js/screens/svod.js',
  './assets/js/screens/players.js',
  './assets/js/screens/home.js',
  './assets/js/screens/stats.js',
  './assets/js/integrations/supabase.js',
  './assets/js/integrations/admin.js',
  './assets/js/integrations/google-sheets.js',
  './assets/js/integrations/export.js',
  './assets/js/ui/roster-auth.js',
  './assets/js/runtime.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
