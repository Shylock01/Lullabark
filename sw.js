const CACHE_NAME = 'lullabark-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './Graphics/Lullibark_Logo_Color.png',
  './Sounds/03-White-Noise-10min.mp3',
  './Sounds/clock_sound_soft.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Suppress errors for missing files just in case
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url => {
            return fetch(url).then(response => {
              if (response.ok) {
                return cache.put(url, response);
              }
            }).catch(e => console.warn('Failed to cache:', url, e));
          })
        );
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
