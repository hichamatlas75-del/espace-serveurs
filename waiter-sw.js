/**
 * GREY CORNER — WAITER SERVICE WORKER (waiter-sw.js)
 * Offline Asset Caching, Native Push Notifications & Keep-Alive Daemon
 */

const CACHE_NAME = "grey-waiter-cache-v7";
const OFFLINE_ASSETS = [
  "/waiter.html",
  "/waiter.css",
  "/waiter.js",
  "/firebase-config.js",
  "/images/logo-gold.webp",
  "/images/logo-gold.png",
  "/images/favicon.ico"
];

// Installation : mise en cache des assets essentiels
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("👷 [SW] Pre-caching offline waiter assets...");
      return cache.addAll(OFFLINE_ASSETS).catch((err) => {
        console.warn("⚠️ [SW] Failed to pre-cache some assets:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("🧹 [SW] Clearing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && (event.data.type === "SKIP_WAITING" || event.data === "skipWaiting")) {
    self.skipWaiting();
  }
});

// Fetch : Network-first pour HTML et JS afin de garantir les mises à jour instantanées
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isHtmlOrJs = url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || event.request.mode === "navigate";

  if (isHtmlOrJs) {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  const isTargetAsset = OFFLINE_ASSETS.some((asset) => url.pathname.endsWith(asset));
  if (isTargetAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
  }
});

// Gestion des événements PUSH (FCM & Système)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Grey Corner — Alerte Serveur", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "🔔 Grey Corner — Appel Serveur";
  const options = {
    body: data.body || data.message || "Nouvelle demande client en salle !",
    icon: "/images/logo-gold.png",
    badge: "/images/logo-gold.png",
    vibrate: [400, 150, 400, 150, 800],
    data: { url: "/waiter.html", ...data },
    tag: data.tag || "waiter-call-" + Date.now(),
    renotify: true,
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Gestion du clic sur notification : focus ou ouverture de waiter.html
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/waiter.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("waiter.html") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Réponse aux messages KEEP_ALIVE
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "KEEP_ALIVE") {
    if (event.source && event.source.postMessage) {
      event.source.postMessage({
        type: "KEEP_ALIVE_ACK",
        status: "alive",
        timestamp: Date.now()
      });
    }
  }
});
