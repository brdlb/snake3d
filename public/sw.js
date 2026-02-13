const CACHE_NAME = 'snake3d-v1';
const STATIC_CACHE = [
  '/',
  '/index.html',
  // Fonts
  '/Jura-VariableFont_wght.woff2',
  '/Jura-VariableFont_wght.woff',
  '/Jura-VariableFont_wght.ttf',
  '/virtual-dj.eot',
  '/virtual-dj.svg',
  '/virtual-dj.ttf',
  '/virtual-dj.woff',
  // Images
  '/blue.png',
  '/pause.png',
  '/scr.png',
  '/sp.png',
  // Manifest
  '/manifest.json',
  // Audio files
  '/gameover.mp3',
  '/gameover.wav',
  '/gameover.mp4',
  '/hum1.mp3',
  '/hum1.wav',
  '/hum1.mp4',
  '/hum2.mp3',
  '/hum2.wav',
  '/hum2.mp4',
  '/hum3.mp3',
  '/hum3.wav',
  '/hum3.mp4',
  '/pick.mp3',
  '/pick.wav',
  '/pick.mp4',
  '/step.mp3',
  '/step.wav',
  '/step.mp4'
];

// Dynamic assets that should be cached on first request
const DYNAMIC_CACHE_PATTERNS = [
  /\.js$/,
  /\.css$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.png$/,
  /\.jpg$/,
  /\.svg$/,
  /\.mp3$/,
  /\.wav$/,
  /\.mp4$/
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching static resources');
        return cache.addAll(STATIC_CACHE);
      })
      .then(() => {
        console.log('[Service Worker] Installation complete');
        self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[Service Worker] Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Activation complete');
      return clients.claim(); // Take control of all clients
    })
  );
});

// Fetch event - implement cache-first strategy for static assets
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip non-http(s) requests (e.g., chrome-extension://)
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Check if the request is for a static asset we want to cache
  const url = new URL(event.request.url);
  const isStaticAsset = STATIC_CACHE.some(path => 
    url.pathname === path || url.pathname === path.slice(1)
  );
  
  // Check if URL matches dynamic cache patterns
  const isDynamicAsset = DYNAMIC_CACHE_PATTERNS.some(pattern => 
    pattern.test(url.pathname)
  );

  if (isStaticAsset || isDynamicAsset) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          // Return cached version if available
          if (response) {
            console.log('[Service Worker] Serving from cache:', event.request.url);
            return response;
          }
          
          // Otherwise fetch from network and cache for future use
          return fetch(event.request)
            .then((response) => {
              // Check if we received a valid response
              if (!response || response.status !== 200) {
                return response;
              }

              // Don't cache responses from other origins (like CDN)
              if (response.type === 'opaque') {
                return response;
              }

              // Clone the response to store in cache and return to browser
              const responseToCache = response.clone();

              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });

              return response;
            })
            .catch((error) => {
              console.error('[Service Worker] Fetch failed:', error);
              // Return offline fallback for navigation requests
              if (event.request.mode === 'navigate') {
                return caches.match('/index.html');
              }
              throw error;
            });
        })
    );
  } else {
    // For non-static assets, use network-first strategy with fallback to cache
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(event.request);
        })
    );
  }
});