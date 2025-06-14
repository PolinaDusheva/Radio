// RadioWave PWA Service Worker - GitHub Pages Compatible
const CACHE_NAME = 'radiowave-v1.2.0';
const STATIC_CACHE = 'radiowave-static-v1.2.0';
const DYNAMIC_CACHE = 'radiowave-dynamic-v1.2.0';

const STATIC_FILES = [
    './',
    './index.html',
    './styles.css',
    './css/index.css',
    './css/ios-fixes.css',
    './css/fallback/fontawesome.min.css',
    './app.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('Service Worker: Caching static files');
                return cache.addAll(STATIC_FILES.map(url => url.startsWith('http') ? url : new URL(url, self.location).href));
            })
            .then(() => self.skipWaiting())
            .catch((error) => {
                console.error('Service Worker: Cache failed:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
                            console.log('Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - serve files from cache or network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method === 'GET') {
        event.respondWith(
            caches.match(request)
                .then((response) => {
                    if (response) {
                        return response;
                    }
                    if (url.origin === location.origin) {
                        return handleStaticFiles(request);
                    } else if (url.hostname.includes('api.radio-browser.info')) {
                        return handleAPIRequests(request);
                    } else if (url.hostname.includes('cdnjs.cloudflare.com')) {
                        return handleCDNRequests(request);
                    } else {
                        return fetch(request);
                    }
                })
                .catch(() => {
                    return handleOfflineResponse(request);
                })
        );
    }
});

// Handle static files (HTML, CSS, JS)
function handleStaticFiles(request) {
    return fetch(request)
        .then((response) => {
            if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(STATIC_CACHE)
                    .then((cache) => {
                        cache.put(request, responseClone);
                    });
            }
            return response;
        })
        .catch(() => {
            if (request.mode === 'navigate') {
                return caches.match('./index.html') || caches.match('/index.html');
            }
            throw new Error('Network failed and no cache available');
        });
}

// Handle Radio Browser API requests
function handleAPIRequests(request) {
    return fetch(request)
        .then((response) => {
            if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(DYNAMIC_CACHE)
                    .then((cache) => {
                        cache.put(request, responseClone);
                        setTimeout(() => {
                            cache.delete(request);
                        }, 5 * 60 * 1000); // 5 minutes
                    });
            }
            return response;
        })
        .catch(() => {
            return caches.match(request);
        });
}

// Handle CDN requests (fonts, icons, etc.)
function handleCDNRequests(request) {
    return fetch(request)
        .then((response) => {
            if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(STATIC_CACHE)
                    .then((cache) => {
                        cache.put(request, responseClone);
                    });
            }
            return response;
        });
}

// Handle offline responses
function handleOfflineResponse(request) {
    if (request.mode === 'navigate') {
        return caches.match('./index.html') || caches.match('/index.html');
    }
    
    // For API requests, return a proper offline response
    if (request.url.includes('api.radio-browser.info')) {
        return new Response(
            JSON.stringify({
                error: 'Offline',
                message: 'You are currently offline'
            }),
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
    }
    
    // For font-awesome and other CDN resources, try fallback
    if (request.url.includes('cdnjs.cloudflare.com')) {
        return caches.match('./index.html')
            .then(response => {
                if (response) return response;
                return new Response('/* Offline fallback */', {
                    headers: { 'Content-Type': 'text/css' }
                });
            });
    }
    
    // Default fallback
    return new Response(
        JSON.stringify({
            error: 'Offline',
            message: 'You are currently offline'
        }),
        {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );
}

// Handle background sync (for future features)
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Background sync:', event.tag);
    if (event.tag === 'sync-favorites') {
        event.waitUntil(syncFavorites());
    }
});

// Handle push notifications (for future features)
self.addEventListener('push', (event) => {
    console.log('Service Worker: Push received');
    const options = {
        body: 'New stations available!',
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Explore',
                icon: './icons/icon-72x72.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: './icons/icon-72x72.png'
            }
        ]
    };
    event.waitUntil(
        self.registration.showNotification('RadioWave', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('Service Worker: Notification clicked');
    event.notification.close();
    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('./')
        );
    }
});

// Sync favorites (placeholder for future server sync)
async function syncFavorites() {
    console.log('Service Worker: Syncing favorites...');
    return Promise.resolve();
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    console.log('Service Worker: Message received:', event.data);
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CACHE_AUDIO') {
        const audioUrl = event.data.url;
        caches.open(DYNAMIC_CACHE)
            .then((cache) => {
                return cache.add(audioUrl);
            })
            .catch((error) => {
                console.error('Service Worker: Failed to cache audio:', error);
            });
    }
});

// Periodic background sync (experimental)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-stations') {
        event.waitUntil(updateStationsInBackground());
    }
});

// Update stations in background (placeholder)
async function updateStationsInBackground() {
    console.log('Service Worker: Updating stations in background...');
    return Promise.resolve();
}

// Clean up old cache entries periodically
function cleanupOldCaches() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    caches.open(DYNAMIC_CACHE)
        .then((cache) => {
            return cache.keys();
        })
        .then((requests) => {
            return Promise.all(
                requests.map((request) => {
                    return caches.match(request).then((response) => {
                        if (response) {
                            const dateHeader = response.headers.get('date');
                            const cacheDate = dateHeader ? new Date(dateHeader).getTime() : 0;
                            if (now - cacheDate > maxAge) {
                                return caches.open(DYNAMIC_CACHE).then((cache) => cache.delete(request));
                            }
                        }
                    });
                })
            );
        });
}

setInterval(cleanupOldCaches, 60 * 60 * 1000); // Every hour 