// ============================================================================
// GREY CORNER — FIREBASE CLOUD MESSAGING SERVICE WORKER
// Reçoit les notifications Push en arrière-plan (application et écran fermés)
// ============================================================================

const SW_VERSION = "fcm-sw-v7.0";
const CACHE_NAME = "waiter-cache-v7";

// 1. Chargement des bibliothèques officielles Firebase compat
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js");

// 2. Configuration Firebase Grey Corner
const firebaseConfig = {
    apiKey: "AIzaSyAoINLpUCCic9Xz9_PnM3al9Iu69q1FQpY",
    authDomain: "grey-corner-restaurant.firebaseapp.com",
    projectId: "grey-corner-restaurant",
    storageBucket: "grey-corner-restaurant.firebasestorage.app",
    messagingSenderId: "251703175568",
    appId: "1:251703175568:web:8d693adc297eb869d12b15",
    measurementId: "G-3HVHB0EELC"
};

try {
    firebase.initializeApp(firebaseConfig);
    console.log(`[${SW_VERSION}] Firebase initialisé dans le Service Worker.`);
} catch (e) {
    console.warn(`[${SW_VERSION}] Firebase déjà initialisé ou avertissement:`, e);
}

let messaging = null;
try {
    if (firebase.messaging.isSupported()) {
        messaging = firebase.messaging();
    }
} catch (e) {
    console.warn(`[${SW_VERSION}] Firebase Messaging non supporté dans cet environnement:`, e);
}

// ── CACHE OFFLINE DES ASSETS SERVEUR ────────────────────────────────────────
const STATIC_ASSETS = [
    "/waiter.html",
    "/waiter.css",
    "/waiter.js",
    "/firebase-config.js",
    "/images/logo-gold.png",
    "/images/android-chrome-192x192.png",
    "/images/android-chrome-512x512.png"
];

self.addEventListener("install", (event) => {
    console.log(`[${SW_VERSION}] Installation du Service Worker FCM.`);
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(() => {});
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    console.log(`[${SW_VERSION}] Service Worker FCM activé.`);
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// Stratégie Network-First avec rafraîchissement prioritaire pour HTML et JS
self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.hostname !== self.location.hostname) return;

    const isHtmlOrJs = event.request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js");

    event.respondWith(
        fetch(event.request, isHtmlOrJs ? { cache: "no-cache" } : {})
            .then((res) => {
                if (res && res.status === 200) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(event.request))
    );
});

// ── RÉCEPTION DES NOTIFICATIONS FCM EN ARRIÈRE-PLAN ──────────────────────────
// S'exécute lorsque l'application ou l'écran du smartphone sont ÉTEINTS / FERMÉS
if (messaging) {
    messaging.onBackgroundMessage((payload) => {
        console.log(`[${SW_VERSION}] onBackgroundMessage FCM reçu:`, payload);

        // Si c'est une demande d'annulation d'alerte (un serveur a validé)
        if (payload.data && (payload.data.type === "CANCEL_ALERT" || payload.data.type === "DISMISS")) {
            const targetId = payload.data.docId || payload.data.callId || payload.data.orderId;
            return self.registration.getNotifications().then((notifications) => {
                notifications.forEach((n) => {
                    if (!targetId || n.tag === targetId || targetId === "all" || n.tag === "pending_reminder") {
                        n.close();
                    }
                });
            });
        }

        const title = (payload.notification && payload.notification.title)
            || (payload.data && payload.data.title)
            || "🔔 Grey Corner — Appel Serveur";

        const body = (payload.notification && payload.notification.body)
            || (payload.data && payload.data.body)
            || "Un client a besoin de votre attention.";

        const options = {
            body: body,
            icon: "/images/android-chrome-192x192.png",
            badge: "/images/android-chrome-192x192.png",
            vibrate: [500, 200, 500, 200, 1000],
            tag: (payload.data && (payload.data.callId || payload.data.tag)) || "waiter-fcm-alert",
            renotify: true,
            requireInteraction: true,
            actions: [
                { action: "open", title: "👀 Voir l'appel" }
            ],
            data: {
                url: "/waiter.html",
                ...payload.data
            }
        };

        return self.registration.showNotification(title, options);
    });
}

// ── RECOURS PUSH STANDARD (Web Push fallback) ──────────────────────────────
self.addEventListener("push", (event) => {
    if (!event.data) return;

    let payload = {};
    try {
        payload = event.data.json();
    } catch (e) {
        payload = { title: "🔔 Grey Corner", body: event.data.text() };
    }

    // Si onBackgroundMessage a déjà traité le message FCM standard, éviter le doublon
    if (payload.fcmOptions || payload.from) {
        // Géré par Firebase Messaging
        return;
    }

    // Si annulation d'alerte
    if (payload.type === "CANCEL_ALERT" || payload.type === "DISMISS") {
        const targetId = payload.docId || payload.callId || payload.orderId;
        return event.waitUntil(
            self.registration.getNotifications().then((notifications) => {
                notifications.forEach((n) => {
                    if (!targetId || n.tag === targetId || targetId === "all" || n.tag === "pending_reminder") {
                        n.close();
                    }
                });
            })
        );
    }

    const title = payload.title || "🔔 Grey Corner — Serveur";
    const body = payload.body || "Nouvelle notification client.";
    const options = {
        body: body,
        icon: "/images/android-chrome-192x192.png",
        badge: "/images/android-chrome-192x192.png",
        vibrate: [500, 200, 500, 200, 1000],
        tag: payload.tag || "waiter-push-alert",
        renotify: true,
        requireInteraction: true,
        data: {
            url: payload.url || "/waiter.html",
            ...payload
        }
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// ── CLIC SUR LA NOTIFICATION (Réveil de l'écran & Navigation) ───────────────
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || "/waiter.html";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes("waiter") && "focus" in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

// ── MESSAGES INTERNES DEPUIS LA PAGE ─────────────────────────────────────────
self.addEventListener("message", (event) => {
    if (!event.data) return;
    if (event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
    if (event.data.type === "KEEP_ALIVE" && event.source && event.source.postMessage) {
        event.source.postMessage({ type: "KEEP_ALIVE_ACK", timestamp: Date.now() });
    }
});
