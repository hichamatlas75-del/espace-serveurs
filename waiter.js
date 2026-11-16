// ============================================================================
// SERVICE WORKER & FCM PUSH NOTIFICATIONS
// ============================================================================

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAoINLpUCCic9Xz9_PnM3al9Iu69q1FQpY",
    authDomain: "grey-corner-restaurant.firebaseapp.com",
    projectId: "grey-corner-restaurant",
    storageBucket: "grey-corner-restaurant.firebasestorage.app",
    messagingSenderId: "251703175568",
    appId: "1:251703175568:web:8d693adc297eb869d12b15",
    measurementId: "G-3HVHB0EELC"
};

// Initialiser Firebase immédiatement si ce n'est pas déjà fait
if (typeof firebase !== "undefined" && !firebase.apps.length) {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
    } catch (e) {
        console.warn("Firebase déjà initialisé:", e);
    }
}

let waiterSwRegistration = null;
let currentFcmToken = null;

// ── UI HELPERS (Statut Connexion & Push) ──────────────────────────────────────

function setConnectionStatus(status) {
    const pill = document.getElementById("connectionPill");
    const label = document.getElementById("connectionLabel");
    if (!pill) return;
    if (status === "online") {
        pill.classList.remove("disconnected");
        pill.classList.add("connected");
        if (label) label.textContent = "En ligne";
        pill.title = "Connecté en temps réel à Firestore";
    } else {
        pill.classList.remove("connected");
        pill.classList.add("disconnected");
        if (label) label.textContent = "Connexion...";
        pill.title = "En attente de connexion...";
    }
}

function updatePushUI(state, customText) {
    const btn = document.getElementById("pushNotifBtn");
    const label = document.getElementById("pushNotifLabel");
    if (!btn || !label) return;
    btn.classList.remove("push-granted", "push-denied", "push-prompt");
    if (state === "granted") {
        btn.classList.add("push-granted");
        label.textContent = customText || "Push Actif";
        btn.title = "Notifications d'arrière-plan actives pour ce smartphone.";
    } else if (state === "denied") {
        btn.classList.add("push-denied");
        label.textContent = customText || "Push Bloqué";
        btn.title = "Notifications bloquées dans les paramètres du navigateur.";
    } else {
        btn.classList.add("push-prompt");
        label.textContent = customText || "Activer Push";
        btn.title = "Cliquez pour activer les notifications d'arrière-plan (écran éteint).";
    }
}

function isAndroidNativeApp() {
    return (typeof AndroidInterface !== "undefined")
        || (typeof window !== "undefined" && window.AndroidInterface)
        || (typeof window !== "undefined" && window.__isNativeAndroid)
        || (navigator.userAgent && navigator.userAgent.includes("GreyCornerWaiterApp"));
}

async function syncNativeFcmToken() {
    const ai = (typeof AndroidInterface !== "undefined")
        ? AndroidInterface
        : ((typeof window !== "undefined" && window.AndroidInterface) ? window.AndroidInterface : null);

    const token = (window.__nativeFcmToken) || (ai && typeof ai.getFcmToken === "function" ? ai.getFcmToken() : null);
    if (!token) {
        setTimeout(syncNativeFcmToken, 2000);
        return;
    }

    currentFcmToken = token;
    console.log("📲 Token FCM natif Android synchronisé:", token.substring(0, 15) + "...");

    const firestoreDb = (typeof db !== "undefined" && db) ? db : (typeof firebase !== "undefined" && firebase.firestore ? firebase.firestore() : null);
    if (firestoreDb) {
        try {
            await firestoreDb.collection("waiter_fcm_tokens").doc(myDeviceId).set({
                token: token,
                deviceId: myDeviceId,
                waiterId: activeWaiterId,
                waiterName: activeWaiterName,
                active: true,
                platform: "android_native",
                userAgent: navigator.userAgent,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log("☁️ Token natif Android enregistré dans Firestore.");
        } catch (e) {
            console.warn("Erreur enregistrement token natif:", e);
        }
    }
}

function checkImmediatePushAndConnection() {
    if (isAndroidNativeApp()) {
        updatePushUI("granted", "App Native (FCM OK)");
        const btn = document.getElementById("pushNotifBtn");
        if (btn) btn.title = "Application Android Native — FCM et Service de maintien en arrière-plan actifs.";
        syncNativeFcmToken();
    } else if ("Notification" in window) {
        if (Notification.permission === "granted") {
            updatePushUI("granted", "Push Actif");
        } else if (Notification.permission === "denied") {
            updatePushUI("denied", "Push Bloqué");
        } else {
            updatePushUI("prompt", "Activer Push");
        }
    } else {
        updatePushUI("denied", "Non supporté");
    }

    if (navigator.onLine) {
        setConnectionStatus("online");
    } else {
        setConnectionStatus("offline");
    }
}

// ── SERVICE WORKER & FCM INITIALISATION ───────────────────────────────────────

function setupServiceWorkerAndFcm() {
    if (!("serviceWorker" in navigator)) return;

    // Supprimer tout ancien Service Worker résiduel (ex: waiter-sw.js)
    navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
            if (reg.active && reg.active.scriptURL && reg.active.scriptURL.includes("waiter-sw.js")) {
                console.log("🧹 Révocation de l'ancien service worker:", reg.active.scriptURL);
                reg.unregister();
            }
        }
    }).catch(() => {});

    // Enregistrer le Service Worker FCM officiel
    navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" })
        .then((reg) => {
            waiterSwRegistration = reg;
            console.log("✅ Service Worker FCM enregistré:", reg.scope);

            // Mettre à jour immédiatement
            reg.update().catch(() => {});

            // Init FCM Push
            initWaiterFcmPush(reg);

            // Vérifier les nouvelles versions
            reg.addEventListener("updatefound", () => {
                const newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                            newWorker.postMessage({ type: "SKIP_WAITING" });
                        }
                    });
                }
            });
        })
        .catch((err) => {
            console.warn("⚠️ Échec enregistrement Service Worker FCM:", err);
            initWaiterFcmPush(null);
        });

    // Keep-alive régulier
    setInterval(() => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "KEEP_ALIVE" });
        }
    }, 25000);
}

// Démarrer SW dès que possible
if (document.readyState === "complete" || document.readyState === "interactive") {
    setupServiceWorkerAndFcm();
    checkImmediatePushAndConnection();
} else {
    window.addEventListener("DOMContentLoaded", () => {
        setupServiceWorkerAndFcm();
        checkImmediatePushAndConnection();
    });
}

// Listeners online / offline du navigateur
window.addEventListener("online", () => setConnectionStatus("online"));
window.addEventListener("offline", () => setConnectionStatus("offline"));

// ── GESTIONNAIRE PUSH FCM (Permissions & Tokens) ──────────────────────────────

async function initWaiterFcmPush(swReg) {
    if (isAndroidNativeApp()) {
        updatePushUI("granted", "App Native (FCM OK)");
        syncNativeFcmToken();
        return;
    }

    const btn = document.getElementById("pushNotifBtn");
    if (btn && !btn._hasClickListener) {
        btn._hasClickListener = true;
        btn.addEventListener("click", () => requestFcmPushPermission(swReg, true));
    }

    if (!("Notification" in window)) {
        updatePushUI("denied", "Non supporté");
        return;
    }

    if (Notification.permission === "granted") {
        updatePushUI("granted", "Push Actif");
        await registerFcmToken(swReg, false);
    } else if (Notification.permission === "denied") {
        updatePushUI("denied", "Push Bloqué");
    } else {
        updatePushUI("prompt", "Activer Push");
    }
}

async function requestFcmPushPermission(swReg, userInitiated = false) {
    if (!("Notification" in window)) {
        alert("Les notifications Web Push ne sont pas supportées par ce navigateur.");
        return;
    }

    if (Notification.permission === "denied") {
        alert("Les notifications sont bloquées dans votre navigateur.\n\nPour les activer :\n1. Cliquez sur l'icône de cadenas ou de réglages à gauche de l'adresse web\n2. Autorisez les 'Notifications'\n3. Rechargez la page.");
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            updatePushUI("granted", "Push Actif");
            await registerFcmToken(swReg, userInitiated);
        } else {
            updatePushUI("denied", "Push Refusé");
        }
    } catch (e) {
        console.error("❌ Erreur demande de permission:", e);
    }
}

async function registerFcmToken(swReg, showSuccessFeedback = false) {
    try {
        if (typeof firebase === "undefined" || !firebase.messaging || !firebase.messaging.isSupported()) {
            console.warn("⚠️ Firebase Messaging non supporté ou indisponible.");
            if (Notification.permission === "granted") {
                updatePushUI("granted", "Push Actif");
            }
            return;
        }

        const messaging = firebase.messaging();
        const DEFAULT_VAPID_KEY = "BO5FSWfM-nUZt6OZV4uGCbTmEi_dErg_FCVW52oxYi8Y__v0dBreH3KTY1Eo4NjzhZ83g09dESoSlegDI3vBH1I";
        let vapidKey = localStorage.getItem("fcm_vapid_key") || window.FIREBASE_VAPID_KEY || DEFAULT_VAPID_KEY;

        const reg = swReg || waiterSwRegistration || (navigator.serviceWorker ? await navigator.serviceWorker.ready.catch(() => null) : null);

        const tokenOptions = {
            serviceWorkerRegistration: reg,
            vapidKey: vapidKey
        };

        let token = null;
        try {
            token = await messaging.getToken(tokenOptions);
        } catch (tokenErr) {
            console.warn("⚠️ Erreur récupération token FCM:", tokenErr);
            if (tokenErr.code === "messaging/missing-vapid-key" || (tokenErr.message && tokenErr.message.includes("vapidKey"))) {
                const inputKey = prompt("🔑 Clé VAPID Firebase requise pour recevoir les pushs.\nCollez la clé VAPID :");
                if (inputKey && inputKey.trim()) {
                    vapidKey = inputKey.trim();
                    localStorage.setItem("fcm_vapid_key", vapidKey);
                    tokenOptions.vapidKey = vapidKey;
                    token = await messaging.getToken(tokenOptions);
                }
            } else {
                throw tokenErr;
            }
        }

        if (token) {
            currentFcmToken = token;
            console.log("📲 FCM Token actif:", token.substring(0, 15) + "...");

            const firestoreDb = (typeof db !== "undefined" && db) ? db : (typeof firebase !== "undefined" && firebase.firestore ? firebase.firestore() : null);

            if (firestoreDb) {
                await firestoreDb.collection("waiter_fcm_tokens").doc(myDeviceId).set({
                    token: token,
                    deviceId: myDeviceId,
                    waiterId: activeWaiterId,
                    waiterName: activeWaiterName,
                    active: true,
                    platform: "web",
                    userAgent: navigator.userAgent,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log("☁️ Token enregistré dans Firestore (collection waiter_fcm_tokens).");
            }

            updatePushUI("granted", "Push Actif");

            if (showSuccessFeedback) {
                alert("✅ Notifications Push activées avec succès !\n\nCe smartphone recevra désormais les alertes même avec l'écran éteint et l'application fermée.");
            }
        }
    } catch (err) {
        console.error("❌ Échec enregistrement token FCM:", err);
        if (Notification.permission === "granted") {
            updatePushUI("granted", "Push Actif");
        } else {
            updatePushUI("prompt", "Activer Push");
        }
    }
}

// ============================================================================
// DEVICE IDENTITY — ID anonyme persistant pour le verrouillage coopératif
// ============================================================================

const myDeviceId = (() => {
    let id = localStorage.getItem("waiter_device_id");
    if (!id) {
        id = "srv_" + Math.random().toString(36).substring(2, 9);
        localStorage.setItem("waiter_device_id", id);
    }
    return id;
})();

const activeWaiterId = myDeviceId;
const activeWaiterName = "Serveur";

// ============================================================================
// STATE — Listeners Firestore actifs
// ============================================================================

function parseSafeDate(input) {
    if (!input) return new Date();
    if (typeof input.toDate === "function") return input.toDate();
    const d = new Date(input);
    return isNaN(d.getTime()) ? new Date() : d;
}

function savePreOrdersCache(newOrders) {
    const todayStr = new Date().toDateString();
    let currentCache = [];
    try {
        const cached = localStorage.getItem("grey_preorders_cache");
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.date === todayStr) {
                currentCache = parsed.orders || [];
            }
        }
    } catch (e) {
        console.error("Error reading cache in savePreOrdersCache:", e);
    }

    newOrders.forEach(newO => {
        if (!newO || !newO.id) return;

        // Éviter de stocker les commandes des jours précédents dans le cache quotidien
        const orderDateStr = newO.createdAt ? parseSafeDate(newO.createdAt).toDateString() : todayStr;
        if (orderDateStr !== todayStr) return;

        const existingIdx = currentCache.findIndex(o => o.id === newO.id);
        if (existingIdx > -1) {
            currentCache[existingIdx] = { ...currentCache[existingIdx], ...newO };
        } else {
            currentCache.push(newO);
        }
    });

    // Éliminer les éventuels doublons par ID
    const uniqueOrders = [];
    const seenIds = new Set();
    currentCache.forEach(o => {
        if (o && o.id && !seenIds.has(o.id)) {
            seenIds.add(o.id);
            uniqueOrders.push(o);
        }
    });

    const cache = {
        date: todayStr,
        orders: uniqueOrders
    };
    localStorage.setItem("grey_preorders_cache", JSON.stringify(cache));
}

function loadPreOrdersCache() {
    try {
        const cached = localStorage.getItem("grey_preorders_cache");
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.date === new Date().toDateString()) {
                const uniqueOrders = [];
                const seenIds = new Set();
                (parsed.orders || []).forEach(o => {
                    if (o && o.id && !seenIds.has(o.id)) {
                        seenIds.add(o.id);
                        uniqueOrders.push(o);
                    }
                });
                return uniqueOrders;
            } else {
                localStorage.removeItem("grey_preorders_cache");
            }
        }
    } catch (e) {
        console.error("Error reading preorders cache:", e);
    }
    return [];
}

let unsubCalls = null;
let unsubOrders = null;

const knownCallIds = new Set();
const knownOrderIds = new Set();
let isCallsInitialLoad = true;
let isOrdersInitialLoad = true;

let activeCallsList = [];
let activePreOrdersList = loadPreOrdersCache();
let globalWaiters = [];

let isReconnecting = false;

// ============================================================================
// ============================================================================
// AUDIO & VIBRATION (Synthesizer + Audio element + Haptic)
// ============================================================================

const alertChime = new Audio("https://assets.mixkit.co/active_storage/sfx/911/911-200.wav");
alertChime.volume = 1.0;

let waiterAudioCtx = null;
function getWaiterAudioContext() {
    if (!waiterAudioCtx && typeof window !== "undefined") {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            waiterAudioCtx = new AudioContextClass();
        }
    }
    if (waiterAudioCtx && waiterAudioCtx.state === "suspended") {
        waiterAudioCtx.resume().catch(() => {});
    }
    return waiterAudioCtx;
}

function playSynthesizedChime() {
    try {
        const ctx = getWaiterAudioContext();
        if (!ctx) return false;

        const now = ctx.currentTime;
        // Bip 1 (880 Hz - La 5)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(1.0, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.35);

        // Bip 2 (1320 Hz - Mi 6)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1320, now + 0.18);
        gain2.gain.setValueAtTime(1.0, now + 0.18);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.18);
        osc2.stop(now + 0.65);

        return true;
    } catch (e) {
        console.warn("⚠️ Synthesizer audio error:", e);
        return false;
    }
}

let audioUnlocked = false;
function unlockWaiterAudio() {
    if (audioUnlocked) return;
    try {
        const ctx = getWaiterAudioContext();
        if (ctx && ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
    } catch (e) {}
    alertChime.play().then(() => {
        alertChime.pause();
        alertChime.currentTime = 0;
        audioUnlocked = true;
    }).catch(() => {});

    // Notification permission & Screen Wake Lock
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
    requestScreenWakeLock();

    const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
    if (ai && typeof ai.keepAlive === "function") {
        ai.keepAlive();
    }

    document.removeEventListener("touchstart", unlockWaiterAudio);
    document.removeEventListener("click", unlockWaiterAudio);
}

if (typeof window !== "undefined") {
    document.addEventListener("touchstart", unlockWaiterAudio, { once: true });
    document.addEventListener("click", unlockWaiterAudio, { once: true });
}

function triggerHapticVibrate() {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([400, 150, 400, 150, 800]);
    }
}

function playAlertSound() {
    const synthPlayed = playSynthesizedChime();
    alertChime.currentTime = 0;
    alertChime.play().catch((e) => {
        if (!synthPlayed) console.warn("🔊 Autoplay bloqué par le navigateur:", e);
    });
}

// ============================================================================
// SCREEN WAKE LOCK API (Maintien de l'écran allumé)
// ============================================================================

let screenWakeLock = null;
async function requestScreenWakeLock() {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
        try {
            screenWakeLock = await navigator.wakeLock.request("screen");
            console.log("💡 Screen Wake Lock acquis — l'écran restera allumé.");
            screenWakeLock.addEventListener("release", () => {
                screenWakeLock = null;
                console.log("💡 Screen Wake Lock relâché.");
            });
        } catch (err) {
            console.warn("⚠️ Wake Lock error:", err);
        }
    }
}

// ============================================================================
// ANDROID NATIVE BRIDGE — Helpers sécurisés & Keep-Alive continu
// ============================================================================

function triggerAndroidAlert(id, type, title, message) {
    const ai = (typeof AndroidInterface !== "undefined")
        ? AndroidInterface
        : ((typeof window !== "undefined" && window.AndroidInterface) ? window.AndroidInterface : null);

    if (ai) {
        try {
            if (typeof ai.triggerActionAlert === "function") {
                ai.triggerActionAlert(id, type, title, message);
            } else if (typeof ai.triggerNativeAlert === "function") {
                ai.triggerNativeAlert(title, message);
            }
            if (typeof ai.keepAlive === "function") {
                ai.keepAlive();
            }
            console.log("📲 AndroidInterface alert envoyée avec succès.");
        } catch (e) {
            console.error("❌ Android bridge error:", e);
        }
    }

    // Web Notification API fallback (si Chrome / PWA / standalone sans AndroidInterface)
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(title, {
                        body: message,
                        icon: "images/logo-gold.png",
                        badge: "images/logo-gold.png",
                        vibrate: [400, 150, 400, 150, 800],
                        tag: id,
                        renotify: true,
                        requireInteraction: true
                    });
                }).catch(() => {});
            } else {
                new Notification(title, {
                    body: message,
                    icon: "images/logo-gold.png",
                    vibrate: [400, 150, 400, 150, 800],
                    tag: id,
                    requireInteraction: true
                });
            }
        } catch (e) {
            console.warn("⚠️ Web Notification error:", e);
        }
    }
}

function startAndroidKeepAlive() {
    const ai = (typeof AndroidInterface !== "undefined")
        ? AndroidInterface
        : ((typeof window !== "undefined" && window.AndroidInterface) ? window.AndroidInterface : null);

    const ping = () => {
        if (!ai) return;
        try {
            if (typeof ai.keepAlive === "function") {
                ai.keepAlive();
                console.log("💓 Keep-alive envoyé au service Android.");
            }
        } catch (e) {
            console.warn("⚠️ Keep-alive bridge error:", e);
        }
    };

    // Ping initial immédiat
    ping();

    // Répéter toutes les 25 secondes pour maintenir le ForegroundService actif en Doze Mode
    setInterval(ping, 25000);
}

// ============================================================================
// HELPERS
// ============================================================================

function getTableZoneName(tableNum) {
    const num = parseInt(tableNum);
    if (num >= 101 && num <= 115) return "Salle";
    if (num >= 201 && num <= 219) return "Loge";
    if (num >= 301 && num <= 323) return "Terrasse";
    return "Table";
}

function getElapsedTimeMarkup(createdAtString) {
    if (!createdAtString) return "À l'instant";
    const created = new Date(createdAtString);
    if (isNaN(created.getTime())) return "À l'instant";
    const diffMins = Math.floor((Date.now() - created.getTime()) / 60000);
    if (diffMins < 1) return "À l'instant";
    return `Il y a ${diffMins} min`;
}

function getWaiterName(waiterId) {
    const waiter = globalWaiters.find(w => w.id === waiterId);
    return waiter ? waiter.name : "Un serveur";
}

// ============================================================================
// CONNEXION TEMPS RÉEL — Subscribe / Unsubscribe / Reconnect
// ============================================================================

function stopRealtimeHub() {
    if (unsubCalls) { unsubCalls(); unsubCalls = null; }
    if (unsubOrders) { unsubOrders(); unsubOrders = null; }
    console.log("🔌 Listeners Firestore arrêtés.");
}

function resetState() {
    knownCallIds.clear();
    knownOrderIds.clear();
    isCallsInitialLoad = true;
    isOrdersInitialLoad = true;
    activeCallsList = [];
    activePreOrdersList = loadPreOrdersCache();
    renderHistoryFeed();
}

function startRealtimeHub() {
    isCallsInitialLoad = true;
    isOrdersInitialLoad = true;

    // Load initial cached data to prevent empty screen or flash
    activePreOrdersList = loadPreOrdersCache();
    if (activePreOrdersList.length > 0) {
        processPreOrdersFeed(activePreOrdersList);
        renderHistoryFeed();
        updateMyTablesStats();
    }

    unsubCalls = dbService.onCallsChange((calls) => {
        const todayStr = new Date().toDateString();
        const todayCalls = calls.filter(c => {
            const dateStr = c.createdAt ? parseSafeDate(c.createdAt).toDateString() : todayStr;
            return dateStr === todayStr;
        });
        activeCallsList = todayCalls;
        processCallsFeed(todayCalls);
        updateMyTablesStats();
    });

    unsubOrders = dbService.onPreOrdersChange((orders) => {
        savePreOrdersCache(orders);
        activePreOrdersList = loadPreOrdersCache();
        processPreOrdersFeed(activePreOrdersList);
        renderHistoryFeed();
        updateMyTablesStats();
    });

    console.log("✅ Listeners Firestore démarrés.");
}

async function reconnectHub() {
    if (isReconnecting) return;
    isReconnecting = true;

    console.log("🔄 Reconnexion du hub temps réel...");
    stopRealtimeHub();
    resetState();

    await new Promise(r => setTimeout(r, 1500));

    try {
        if (typeof dbService !== "undefined" && dbService.isCloud()) {
            const user = firebase.auth().currentUser;
            if (!user) {
                await firebase.auth().signInAnonymously();
                console.log("🔒 Ré-authentification anonyme réussie.");
            }
        }
        startRealtimeHub();
    } catch (e) {
        console.error("❌ Reconnexion échouée, fallback sans auth:", e);
        startRealtimeHub();
    } finally {
        isReconnecting = false;
    }
}

function updateMyTablesStats() {
    const activeTables = new Set();
    activeCallsList.forEach(c => {
        if (c.status !== "completed") activeTables.add(c.table);
    });
    activePreOrdersList.forEach(o => {
        if (o.status !== "completed" && o.status !== "cancelled") activeTables.add(o.table);
    });
    const el = document.getElementById("statMyTables");
    if (el) el.textContent = activeTables.size;
}

// ============================================================================
// PIPELINE 1 — APPELS SERVEUR
// ============================================================================

function processCallsFeed(calls) {
    const feed = document.getElementById("callsFeed");
    if (!feed) return;

    feed.innerHTML = "";

    let myActiveCallsCount = 0;
    let newPendingDetected = false;

    calls.forEach(call => {
        if (call.status === "completed" || call.status === "ignored") return;

        const isAccepted = call.status === "accepted";
        const isAcceptedByMe = isAccepted && call.assignedTo === activeWaiterId;
        const isAcceptedByOther = isAccepted && call.assignedTo !== activeWaiterId;

        if (call.status === "pending") {
            myActiveCallsCount++;
            if (!knownCallIds.has(call.id)) {
                knownCallIds.add(call.id);
                const callAgeMs = call.createdAt ? (Date.now() - parseSafeDate(call.createdAt).getTime()) : 0;
                const isRecentPending = callAgeMs >= 0 && callAgeMs < 10 * 60 * 1000;
                if (!isCallsInitialLoad || isRecentPending) {
                    newPendingDetected = true;
                    const zoneName    = getTableZoneName(call.table);
                    const typeLabels  = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition" };
                    const typeLabel   = typeLabels[call.type] || "Appel";
                    const alertTitle  = `🔔 Nouveau Appel : ${zoneName} ${call.table}`;
                    const alertBody   = `Demande : ${typeLabel}`;
                    triggerAndroidAlert(call.id, "call", alertTitle, alertBody);
                }
            }
        } else {
            knownCallIds.add(call.id);
            if (isAcceptedByMe) myActiveCallsCount++;
            const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
            if (ai && typeof ai.cancelAlert === "function") ai.cancelAlert(call.id);
        }

        const card = document.createElement("div");
        card.className = `alert-card ${call.status === "pending" ? "call-pending" : "call-accepted"} ${isAcceptedByOther ? "unassigned-card" : ""}`;
        card.dataset.id = call.id;

        const typeLabels = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition", reward: "🎁 Consommation Gratuite (500 pts)" };
        const badgeClasses = { waiter: "badge-waiter", water: "badge-water", bill: "badge-bill", reward: "badge-reward" };

        const rewardClientInfo = (call.type === "reward" && call.loyaltyPhone) 
            ? `<div style="font-size:0.82rem; color:#2ecc71; margin-top:4px; font-weight:600;">👑 Client: ${call.loyaltyName || ""} (${call.loyaltyPhone})</div>` 
            : "";

        card.innerHTML = `
            <div class="card-top">
                <div class="card-title-wrap">
                    <div class="table-circle" style="width:auto;padding:0 10px;border-radius:12px;font-size:0.8rem;font-weight:700;height:32px;">
                        ${getTableZoneName(call.table)} ${call.table}
                    </div>
                    <span class="request-badge ${badgeClasses[call.type] || "badge-waiter"}">${typeLabels[call.type] || call.type}</span>
                </div>
                <span class="time-elapsed" data-created="${call.createdAt}">${getElapsedTimeMarkup(call.createdAt)}</span>
            </div>
            ${rewardClientInfo}
            <div class="card-actions">
                ${call.status === "pending"
                ? (call.type === "reward" && call.loyaltyPhone
                    ? `<button class="action-btn-complete redeem-call-btn" style="background:#27ae60; font-weight:700;" data-id="${call.id}" data-phone="${call.loyaltyPhone}">🎁 Valider Conso Offerte (-500 pts)</button>
                       <button class="action-btn-accept accept-call-btn" data-id="${call.id}">S'y Rendre</button>`
                    : `<button class="action-btn-accept accept-call-btn" data-id="${call.id}">S'y Rendre</button>`)
                : (isAcceptedByMe
                    ? `<div class="accepted-status-badge"><span class="mini-pulse"></span> En cours...</div>
                           ${call.type === "reward" && call.loyaltyPhone ? `<button class="action-btn-complete redeem-call-btn" style="background:#27ae60; font-weight:700;" data-id="${call.id}" data-phone="${call.loyaltyPhone}">🎁 Valider Conso Offerte (-500 pts)</button>` : ""}
                           <button class="action-btn-complete complete-call-btn" data-id="${call.id}">Terminer</button>`
                    : `<div class="accepted-status-badge" style="color:var(--muted);">
                             <span>👨‍🍳 Pris en charge</span>
                           </div>`
                )
            }
            </div>
        `;

        const btnAccept = card.querySelector(".accept-call-btn");
        const btnComplete = card.querySelector(".complete-call-btn");

        if (btnAccept) {
            btnAccept.addEventListener("click", () => {
                dbService.updateCallStatus(call.id, "accepted", activeWaiterId);
                const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
                if (ai && typeof ai.cancelAlert === "function") ai.cancelAlert(call.id);
            });
        }
        if (btnComplete) {
            btnComplete.addEventListener("click", () => {
                dbService.updateCallStatus(call.id, "completed");
                const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
                if (ai && typeof ai.cancelAlert === "function") ai.cancelAlert(call.id);
            });
        }

        const btnRedeemCall = card.querySelector(".redeem-call-btn");
        if (btnRedeemCall) {
            btnRedeemCall.addEventListener("click", () => {
                if (confirm(`Confirmer la déduction de 500 points pour ${call.loyaltyPhone} ?`)) {
                    btnRedeemCall.disabled = true;
                    dbService.redeemLoyaltyReward(call.loyaltyPhone, activeWaiterId, (ok, newTotal) => {
                        if (ok) {
                            playAlertSound();
                            triggerHapticVibrate();
                            alert(`🎉 Consommation offerte accordée ! Nouveau solde: ${newTotal} pts`);
                            dbService.updateCallStatus(call.id, "completed", activeWaiterId);
                        } else {
                            alert("❌ Erreur ou solde insuffisant (minimum 500 points requis).");
                            btnRedeemCall.disabled = false;
                        }
                    });
                }
            });
        }

        feed.appendChild(card);
    });

    if (feed.children.length === 0) {
        feed.innerHTML = '<div class="feed-empty-state">Aucun appel actif pour le moment.</div>';
    }

    const statCallEl = document.getElementById("statActiveCalls");
    const badgeTabEl = document.getElementById("badgeTabCalls");

    if (statCallEl) {
        statCallEl.textContent = myActiveCallsCount;
        const parentCard = statCallEl.closest(".stat-card");
        if (parentCard) {
            parentCard.classList.toggle("pulse-active", myActiveCallsCount > 0);
        }
    }
    if (badgeTabEl) {
        badgeTabEl.textContent = myActiveCallsCount;
        badgeTabEl.style.display = myActiveCallsCount > 0 ? "flex" : "none";
    }

    if (newPendingDetected) {
        triggerHapticVibrate();
        playAlertSound();
    }

    isCallsInitialLoad = false;
}

// ============================================================================
// PIPELINE 2 — PRÉCOMMANDES
// ============================================================================

function processPreOrdersFeed(orders) {
    const feed = document.getElementById("ordersFeed");
    if (!feed) return;

    feed.innerHTML = "";

    let myActiveOrdersCount = 0;
    let newOrderDetected = false;

    orders.forEach(order => {
        if (order.status === "completed" || order.status === "cancelled") return;

        const isAccepted = order.status === "accepted";
        const isAcceptedByMe = isAccepted && order.assignedTo === activeWaiterId;
        const isAcceptedByOther = isAccepted && order.assignedTo !== activeWaiterId;

        if (order.status === "pending") {
            myActiveOrdersCount++;
            if (!knownOrderIds.has(order.id)) {
                knownOrderIds.add(order.id);
                const orderAgeMs = order.createdAt ? (Date.now() - parseSafeDate(order.createdAt).getTime()) : 0;
                const isRecentPending = orderAgeMs >= 0 && orderAgeMs < 15 * 60 * 1000;
                if (!isOrdersInitialLoad || isRecentPending) {
                    newOrderDetected = true;
                    const zoneName   = getTableZoneName(order.table);
                    const alertTitle = `👨‍🍳 Nouvelle Précommande : ${zoneName} ${order.table}`;
                    const alertBody  = `Total : ${order.totalPrice} MAD`;
                    triggerAndroidAlert(order.id, "order", alertTitle, alertBody);
                }
            }
        } else {
            knownOrderIds.add(order.id);
            if (isAcceptedByMe) myActiveOrdersCount++;
            const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
            if (ai && typeof ai.cancelAlert === "function") ai.cancelAlert(order.id);
        }

        const card = document.createElement("div");
        card.className = `alert-card ${order.status === "pending" ? "call-pending" : "call-accepted"} ${isAcceptedByOther ? "unassigned-card" : ""}`;
        card.dataset.id = order.id;

        let itemsHtml = "";
        order.items.forEach(it => {
            const catBadge = it.category ? ` <span style="font-size: 0.72rem; color: var(--gold); margin-left: 6px; font-weight: 500;">(${it.category})</span>` : "";
            itemsHtml += `
                <div class="order-item-row">
                    <div>
                        <span class="item-qty-lbl">${it.qty}x</span>
                        <span class="item-name-lbl">${it.name_lang}${catBadge}</span>
                    </div>
                    <span class="item-price-lbl">${it.price} MAD</span>
                </div>
            `;
        });

        let loyaltySnippet = "";
        const ptsToAdd = Math.max(1, Math.round(order.totalPrice || 0));
        if (order.loyaltyPhone) {
            loyaltySnippet = `
                <div class="order-loyalty-banner" style="background:rgba(201,169,110,0.1); border:1px solid rgba(201,169,110,0.3); padding:8px 10px; border-radius:8px; margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-weight:700; color:var(--gold);">👑 ${order.loyaltyName || "Client Club"}</span>
                        <span style="font-size:0.75rem; color:var(--muted); margin-left:4px;">(${order.loyaltyPhone})</span>
                    </div>
                    <div id="loyaltyPointsBadge_${order.id}">
                        ${order.loyaltyCredited 
                            ? `<span style="color:#2ecc71; font-weight:700; font-size:0.84rem;">✓ Points validés (+${ptsToAdd} pts)</span>`
                            : `<button type="button" class="action-btn-credit-loyalty" data-order-id="${order.id}" data-phone="${order.loyaltyPhone}" data-amount="${order.totalPrice}" style="padding:6px 12px; cursor:pointer; background:#27ae60; color:#fff; border:none; border-radius:6px; font-weight:700; font-size:0.82rem;">✅ Valider Points (+${ptsToAdd} pts)</button>`
                        }
                    </div>
                </div>
            `;
        } else {
            loyaltySnippet = `
                <div class="order-loyalty-banner" style="background:rgba(255,255,255,0.03); border:1px dashed rgba(201,169,110,0.35); padding:8px 10px; border-radius:8px; margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:0.8rem; color:var(--muted);">👑 Fidélité non renseignée</div>
                    <div id="loyaltyPointsBadge_${order.id}">
                        ${order.loyaltyCredited 
                            ? `<span style="color:#2ecc71; font-weight:700; font-size:0.84rem;">✓ Points validés (+${ptsToAdd} pts)</span>`
                            : `<button type="button" class="action-btn-assign-loyalty" data-order-id="${order.id}" data-amount="${order.totalPrice}" data-table="${order.table}" style="padding:5px 10px; cursor:pointer; background:rgba(201,169,110,0.18); border:1px solid var(--gold); border-radius:6px; color:var(--gold); font-size:0.8rem; font-weight:700;">➕ Valider Points (+${ptsToAdd} pts)</button>`
                        }
                    </div>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="card-top">
                <div class="card-title-wrap">
                    <div class="table-circle" style="width:auto;padding:0 10px;border-radius:12px;font-size:0.8rem;font-weight:700;height:32px;">
                        ${getTableZoneName(order.table)} ${order.table}
                    </div>
                    <span class="request-badge badge-order">Précommande</span>
                </div>
                <span class="time-elapsed" data-created="${order.createdAt}">${getElapsedTimeMarkup(order.createdAt)}</span>
            </div>
            <div class="order-items-list">
                ${itemsHtml}
                ${order.note ? `<div class="order-comments"><strong>Note :</strong> ${order.note}</div>` : ""}
                <div class="order-total-bar">
                    <span>Total</span>
                    <span class="order-total-price">${order.totalPrice} MAD</span>
                </div>
            </div>
            ${loyaltySnippet}
            <div class="card-actions">
                ${order.status === "pending"
                ? `<button class="action-btn-accept accept-order-btn" data-id="${order.id}">Valider & POS</button>`
                : (isAcceptedByMe
                    ? `<div class="accepted-status-badge"><span class="mini-pulse"></span> Commande Validée</div>
                           <button class="action-btn-complete complete-order-btn" data-id="${order.id}">Servi</button>`
                    : `<div class="accepted-status-badge" style="color:var(--muted);">
                             <span>👨‍🍳 Commande Validée</span>
                           </div>`
                )
            }
            </div>
        `;

        const btnAccept = card.querySelector(".accept-order-btn");
        const btnComplete = card.querySelector(".complete-order-btn");

        if (btnAccept) {
            btnAccept.addEventListener("click", () => {
                dbService.updatePreOrderStatus(order.id, "accepted", activeWaiterId);
                const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
                if (ai && typeof ai.cancelAlert === "function") ai.cancelAlert(order.id);
            });
        }
        if (btnComplete) {
            btnComplete.addEventListener("click", () => {
                if (order.loyaltyPhone && !order.loyaltyCredited) {
                    if (confirm(`Valider également les ${ptsToAdd} points de fidélité pour ${order.loyaltyName || order.loyaltyPhone} ?`)) {
                        dbService.creditLoyaltyPoints(order.loyaltyPhone, order.totalPrice, order.table, activeWaiterId, order.id, (ok) => {
                            if (ok) {
                                playAlertSound();
                                order.loyaltyCredited = true;
                            }
                            dbService.updatePreOrderStatus(order.id, "completed");
                        });
                        return;
                    }
                }
                dbService.updatePreOrderStatus(order.id, "completed");
                const ai = (typeof AndroidInterface !== "undefined") ? AndroidInterface : (typeof window !== "undefined" ? window.AndroidInterface : null);
                if (ai && typeof ai.cancelAlert === "function") ai.cancelAlert(order.id);
            });
        }

        const btnCreditLoyalty = card.querySelector(".action-btn-credit-loyalty");
        if (btnCreditLoyalty) {
            btnCreditLoyalty.addEventListener("click", () => {
                const phone = btnCreditLoyalty.dataset.phone;
                const amount = parseFloat(btnCreditLoyalty.dataset.amount) || 0;
                btnCreditLoyalty.disabled = true;
                btnCreditLoyalty.textContent = "Validation...";

                dbService.creditLoyaltyPoints(phone, amount, order.table, activeWaiterId, order.id, (ok, added, newTotal) => {
                    if (ok) {
                        playAlertSound();
                        triggerHapticVibrate();
                        order.loyaltyCredited = true;
                        const container = document.getElementById(`loyaltyPointsBadge_${order.id}`);
                        if (container) {
                            container.innerHTML = `<span style="color:#2ecc71; font-weight:700; font-size:0.84rem;">✓ Points validés (+${added} pts)</span>`;
                        }
                        alert(`👑 ${added} points validés pour ${phone} !\nNouveau solde : ${newTotal} / 500 pts`);
                    } else {
                        alert("❌ Erreur lors du crédit des points fidélité.");
                        btnCreditLoyalty.disabled = false;
                        btnCreditLoyalty.textContent = "Réessayer";
                    }
                });
            });
        }

        const btnAssignLoyalty = card.querySelector(".action-btn-assign-loyalty");
        if (btnAssignLoyalty) {
            btnAssignLoyalty.addEventListener("click", () => {
                const phoneRaw = prompt(`Valider ${ptsToAdd} points pour cette commande (Table ${order.table} - ${order.totalPrice} MAD) :\n\nEntrez le numéro de téléphone du client :`);
                if (!phoneRaw) return;
                const cleanPh = window.normalizePhone ? window.normalizePhone(phoneRaw) : phoneRaw.replace(/\D/g, "");
                if (cleanPh.length < 8) {
                    alert("Numéro de téléphone invalide.");
                    return;
                }
                btnAssignLoyalty.disabled = true;
                btnAssignLoyalty.textContent = "Validation...";
                dbService.createOrGetLoyaltyMember(cleanPh, "Client Table " + order.table, "waiter_direct", (okGet, member) => {
                    dbService.creditLoyaltyPoints(cleanPh, order.totalPrice, order.table, activeWaiterId, order.id, (okCredit, added, newTotal) => {
                        if (okCredit) {
                            playAlertSound();
                            triggerHapticVibrate();
                            order.loyaltyPhone = cleanPh;
                            order.loyaltyCredited = true;
                            const container = document.getElementById(`loyaltyPointsBadge_${order.id}`);
                            if (container) {
                                container.innerHTML = `<span style="color:#2ecc71; font-weight:700; font-size:0.84rem;">✓ Points validés (+${added} pts)</span>`;
                            }
                            alert(`👑 +${added} points validés pour ${cleanPh} !\nNouveau solde : ${newTotal} / 500 pts`);
                        } else {
                            alert("❌ Erreur lors de la validation des points.");
                            btnAssignLoyalty.disabled = false;
                            btnAssignLoyalty.textContent = "Réessayer";
                        }
                    });
                });
            });
        }

        feed.appendChild(card);
    });

    if (feed.children.length === 0) {
        feed.innerHTML = '<div class="feed-empty-state">Aucune précommande en attente.</div>';
    }

    const statOrderEl = document.getElementById("statActiveOrders");
    const badgeTabEl = document.getElementById("badgeTabOrders");

    if (statOrderEl) {
        statOrderEl.textContent = myActiveOrdersCount;
        const parentCard = statOrderEl.closest(".stat-card");
        if (parentCard) {
            parentCard.classList.toggle("pulse-active", myActiveOrdersCount > 0);
        }
    }
    if (badgeTabEl) {
        badgeTabEl.textContent = myActiveOrdersCount;
        badgeTabEl.style.display = myActiveOrdersCount > 0 ? "flex" : "none";
    }

    if (newOrderDetected) {
        triggerHapticVibrate();
        playAlertSound();
    }

    isOrdersInitialLoad = false;
}

// ============================================================================
// PIPELINE 3 — HISTORIQUE DES PRÉCOMMANDES
// ============================================================================

function renderHistoryFeed() {
    const feed = document.getElementById("historyFeed");
    if (!feed) return;

    feed.innerHTML = "";

    // Trier toutes les précommandes du jour J par date de création décroissante
    const sortedOrders = [...activePreOrdersList].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const db = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return db - da;
    });

    if (sortedOrders.length === 0) {
        feed.innerHTML = '<div class="feed-empty-state">Aucune précommande aujourd\'hui.</div>';
        return;
    }

    sortedOrders.forEach(order => {
        let itemsHtml = "";
        order.items.forEach(it => {
            const catBadge = it.category ? ` <span style="font-size: 0.72rem; color: var(--gold); margin-left: 6px; font-weight: 500;">(${it.category})</span>` : "";
            itemsHtml += `
                <div class="order-item-row">
                    <div>
                        <span class="item-qty-lbl">${it.qty}x</span>
                        <span class="item-name-lbl">${it.name_lang}${catBadge}</span>
                    </div>
                    <span class="item-price-lbl">${it.price} MAD</span>
                </div>
            `;
        });

        // Styles de statut
        let statusText = "En attente";
        let statusStyle = "";

        if (order.status === "pending") {
            statusText = "En attente";
            statusStyle = "color: #f39c12; background: rgba(243, 156, 18, 0.12); border: 1px solid rgba(243, 156, 18, 0.25);";
        } else if (order.status === "accepted") {
            statusText = "Validée";
            statusStyle = "color: var(--sc-gold-light); background: rgba(201, 168, 76, 0.12); border: 1px solid rgba(201, 168, 76, 0.3);";
        } else if (order.status === "completed") {
            statusText = "Servie";
            statusStyle = "color: var(--success); background: rgba(46, 204, 113, 0.12); border: 1px solid rgba(46, 204, 113, 0.25);";
        } else if (order.status === "cancelled") {
            statusText = "Annulée";
            statusStyle = "color: var(--alert); background: rgba(231, 76, 60, 0.12); border: 1px solid rgba(231, 76, 60, 0.25);";
        }

        const card = document.createElement("div");
        card.className = "alert-card";
        card.style.borderColor = "rgba(255, 255, 255, 0.04)";
        card.style.background = "rgba(18, 26, 42, 0.4)";

        const waiterInfo = (order.assignedTo && globalWaiters) ? getWaiterName(order.assignedTo) : "";
        const waiterMarkup = waiterInfo ? `<div style="font-size: 0.72rem; color: var(--muted); margin-top: 6px;">Prise en charge par : ${waiterInfo}</div>` : "";

        card.innerHTML = `
            <div class="card-top">
                <div class="card-title-wrap">
                    <div class="table-circle" style="width:auto;padding:0 10px;border-radius:12px;font-size:0.8rem;font-weight:700;height:32px;">
                        ${getTableZoneName(order.table)} ${order.table}
                    </div>
                    <span class="request-badge" style="${statusStyle}">${statusText}</span>
                </div>
                <span class="time-elapsed" data-created="${order.createdAt}">${getElapsedTimeMarkup(order.createdAt)}</span>
            </div>
            <div class="order-items-list">
                ${itemsHtml}
                ${order.note ? `<div class="order-comments"><strong>Note :</strong> ${order.note}</div>` : ""}
                <div class="order-total-bar">
                    <span>Total</span>
                    <span class="order-total-price">${order.totalPrice} MAD</span>
                </div>
            </div>
            ${waiterMarkup}
        `;

        feed.appendChild(card);
    });
}

// ============================================================================

// ============================================================================
// TIMERS PÉRIODIQUES
// ============================================================================

setInterval(() => {
    document.querySelectorAll(".time-elapsed").forEach(el => {
        const createdStr = el.getAttribute("data-created");
        if (createdStr) el.textContent = getElapsedTimeMarkup(createdStr);
    });
}, 30000);

// ============================================================================
// NAVIGATION TABS
// ============================================================================

function initTabNavigation() {
    const tabs = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".tab-panel");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const targetId = tab.getAttribute("data-tab");
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            panels.forEach(p => p.classList.toggle("active", p.id === targetId));
        });
    });
}

// ============================================================================
// RÉSEAU & VISIBILITÉ — Reconnexion automatique
// ============================================================================

window.addEventListener("online", () => {
    console.log("🌐 Réseau rétabli.");
    setConnectionStatus("online");
    // Ne relancer les flux que si les listes sont vides (évite de re-consommer le quota si Firebase a maintenu le cache)
    if (!activeCallsList || activeCallsList.length === 0) {
        reconnectHub();
    }
});

window.addEventListener("offline", () => {
    console.warn("📴 Réseau perdu → arrêt des listeners.");
    stopRealtimeHub();
});

let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        hiddenAt = Date.now();
    } else {
        const hiddenDuration = hiddenAt ? Date.now() - hiddenAt : 0;
        // Réactivation immédiate de l'écran, du contexte audio et du keep-alive
        requestScreenWakeLock();
        if (waiterAudioCtx && waiterAudioCtx.state === "suspended") {
            waiterAudioCtx.resume().catch(() => {});
        }
        const ai = (typeof AndroidInterface !== "undefined")
            ? AndroidInterface
            : ((typeof window !== "undefined" && window.AndroidInterface) ? window.AndroidInterface : null);
        if (ai && typeof ai.keepAlive === "function") {
            ai.keepAlive();
        }

        // Optimisation anti-quota : Firebase gère déjà la reprise automatique du WebSocket.
        // On ne force une reconnexion que si la page est restée en veille plus de 30 minutes ET que le réseau est coupé
        if (hiddenDuration > 30 * 60 * 1000 && !navigator.onLine) {
            console.log(`🔄 Longue veille (${Math.round(hiddenDuration / 60000)} min) et hors-ligne → reconnexion.`);
            reconnectHub();
        }
        hiddenAt = null;
    }
});

window.addEventListener("beforeunload", () => {
    stopRealtimeHub();
});

// ============================================================================
// WATCHDOG DE SECOURS — Rappels sonores tant qu'un appel ou commande est en attente
// ============================================================================
let pendingAlertWatchdog = null;
function startPendingAlertWatchdog() {
    if (pendingAlertWatchdog) return;
    pendingAlertWatchdog = setInterval(() => {
        const now = Date.now();
        const maxAgeMs = 15 * 60 * 1000; // Ne relance que les alertes de moins de 15 minutes

        const hasPendingCalls = (activeCallsList || []).some(c => {
            if (c.status !== "pending") return false;
            const age = c.createdAt ? (now - parseSafeDate(c.createdAt).getTime()) : 0;
            return age >= 0 && age < maxAgeMs;
        });
        const hasPendingOrders = (activePreOrdersList || []).some(o => {
            if (o.status !== "pending") return false;
            const age = o.createdAt ? (now - parseSafeDate(o.createdAt).getTime()) : 0;
            return age >= 0 && age < maxAgeMs;
        });

        if (hasPendingCalls || hasPendingOrders) {
            console.log("⏰ Watchdog : Éléments récents toujours en attente → Relance sonore et réveil écran.");
            triggerHapticVibrate();
            playAlertSound();
            requestScreenWakeLock();

            const ai = (typeof AndroidInterface !== "undefined")
                ? AndroidInterface
                : ((typeof window !== "undefined" && window.AndroidInterface) ? window.AndroidInterface : null);
            if (ai && typeof ai.triggerActionAlert === "function") {
                const label = hasPendingOrders ? "Commande(s) récente(s) en attente !" : "Appel(s) en attente !";
                ai.triggerActionAlert("pending_reminder", "reminder", "⚠️ Attention : En attente", label);
            }
        }
    }, 20000); // Répète toutes les 20 secondes
}

// ============================================================================
// INITIALISATION
// ============================================================================


// ============================================================================
// MODULE FIDÉLITÉ DIRECTE (SERVEUR — SCÉNARIO B : CLIENT SANS QR)
// ============================================================================

function initDirectLoyaltyModule() {
    const modal = document.getElementById("directLoyaltyModal");
    const btnOpen = document.getElementById("btnOpenDirectLoyalty");
    const btnClose = document.getElementById("btnCloseDirectLoyalty");
    const modalSearchInput = document.getElementById("directLoyaltySearchInput");
    const modalSearchBtn = document.getElementById("directLoyaltySearchBtn");
    const modalContentArea = document.getElementById("directLoyaltyContentArea");

    const tabSearchInput = document.getElementById("tabLoyaltySearchInput");
    const tabSearchBtn = document.getElementById("tabLoyaltySearchBtn");
    const tabContentArea = document.getElementById("tabLoyaltyContentArea");

    // Quand le serveur clique sur le bouton en haut, on bascule directement sur l'onglet Fidélité !
    if (btnOpen) {
        btnOpen.addEventListener("click", () => {
            const loyaltyTabBtn = document.querySelector('.tab-btn[data-tab="tabLoyalty"]');
            if (loyaltyTabBtn) {
                loyaltyTabBtn.click();
                if (tabSearchInput) setTimeout(() => tabSearchInput.focus(), 150);
            } else if (modal) {
                modal.style.display = "flex";
                if (modalSearchInput) setTimeout(() => modalSearchInput.focus(), 150);
            }
        });
    }

    if (btnClose && modal) {
        btnClose.addEventListener("click", () => { modal.style.display = "none"; });
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    }

    function setupController(searchInput, searchBtn, contentArea, suffix) {
        if (!searchInput || !contentArea) return;

        const performSearch = () => {
            const query = (searchInput.value || "").trim();
            if (!query) return;

            contentArea.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);"><span class="mini-pulse"></span> Recherche du compte...</div>`;
            const cleanPhone = window.normalizePhone ? window.normalizePhone(query) : query.replace(/\D/g, "");

            if (cleanPhone.length >= 8) {
                dbService.getLoyaltyMember(cleanPhone, (member) => {
                    if (member) {
                        renderMember(member, contentArea, suffix);
                    } else {
                        renderCreate(cleanPhone, contentArea, suffix);
                    }
                });
            } else {
                dbService.onAllLoyaltyMembersChange((allMembers) => {
                    const match = (allMembers || []).find(m => m.phone.endsWith(query) || (m.firstName && m.firstName.toLowerCase().includes(query.toLowerCase())));
                    if (match) {
                        renderMember(match, contentArea, suffix);
                    } else {
                        renderCreate(query, contentArea, suffix);
                    }
                });
            }
        };

        if (searchBtn) searchBtn.addEventListener("click", performSearch);
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") performSearch();
        });
    }

    function renderMember(member, contentArea, suffix) {
        const pts = member.points || 0;
        const target = 500;
        const pct = Math.min(100, Math.round((pts / target) * 100));
        const canRedeem = pts >= target;

        contentArea.innerHTML = `
            <div class="waiter-member-card">
                <div class="member-card-header">
                    <div>
                        <div class="member-name">👑 ${member.firstName || "Client"}</div>
                        <div class="member-phone">${member.phone}</div>
                    </div>
                    <div class="member-score">
                        <span class="member-score-pts">${pts}</span>
                        <span class="member-score-sub">/ 500 pts</span>
                    </div>
                </div>

                <div class="member-progress-wrap">
                    <div class="member-progress-bar" style="width: ${pct}%;"></div>
                </div>

                <div class="member-status-lbl">
                    ${canRedeem 
                        ? `<span style="color:#2ecc71; font-weight:700;">🎉 CE CLIENT A DROIT À 1 CONSOMMATION GRATUITE !</span>` 
                        : `<span>Encore <strong>${target - pts} pts</strong> pour débloquer la boisson offerte</span>`
                    }
                </div>

                ${canRedeem ? `
                    <div style="margin-top:14px;">
                        <button type="button" class="btn-redeem-free-drink" id="btnRedeem_${suffix}">
                            🎁 OFFRIR LA CONSOMMATION (-500 pts)
                        </button>
                    </div>
                ` : ""}

                <div class="direct-credit-section">
                    <div class="direct-credit-title">⚡ Encaissement Direct (Valider des points)</div>
                    <div class="direct-credit-inputs">
                        <input type="number" id="creditAmount_${suffix}" class="waiter-num-input" placeholder="Montant addition (DH)" min="1" step="1" />
                        <input type="text" id="creditTable_${suffix}" class="waiter-num-input" placeholder="Table (optionnel)" style="max-width:120px;" />
                    </div>
                    <button type="button" class="btn-credit-now" id="btnCredit_${suffix}">
                        ✅ Valider les points (1 DH = 1 pt)
                    </button>
                </div>
            </div>
        `;

        if (canRedeem) {
            const btnRedeem = document.getElementById(`btnRedeem_${suffix}`);
            if (btnRedeem) {
                btnRedeem.addEventListener("click", () => {
                    if (confirm(`Confirmez-vous déduire 500 points pour offrir 1 consommation gratuite à ${member.firstName} (${member.phone}) ?`)) {
                        btnRedeem.disabled = true;
                        btnRedeem.textContent = "Déduction...";
                        dbService.redeemLoyaltyReward(member.phone, activeWaiterId, (ok, newTotal) => {
                            if (ok) {
                                playAlertSound();
                                triggerHapticVibrate();
                                alert(`🎉 Consommation offerte accordée avec succès !\nNouveau solde : ${newTotal} pts`);
                                member.points = newTotal;
                                renderMember(member, contentArea, suffix);
                            } else {
                                alert("❌ Solde insuffisant ou erreur.");
                                btnRedeem.disabled = false;
                                btnRedeem.textContent = "🎁 OFFRIR LA CONSOMMATION (-500 pts)";
                            }
                        });
                    }
                });
            }
        }

        const btnCreditNow = document.getElementById(`btnCredit_${suffix}`);
        const inputAmount = document.getElementById(`creditAmount_${suffix}`);
        const inputTable = document.getElementById(`creditTable_${suffix}`);

        if (btnCreditNow && inputAmount) {
            btnCreditNow.addEventListener("click", () => {
                const amount = parseFloat(inputAmount.value) || 0;
                if (amount <= 0) {
                    alert("Veuillez saisir un montant d'addition valide.");
                    return;
                }
                const tableNum = (inputTable ? inputTable.value : "").trim();
                btnCreditNow.disabled = true;
                btnCreditNow.textContent = "Validation en cours...";

                dbService.creditLoyaltyPoints(member.phone, amount, tableNum, activeWaiterId, null, (ok, added, newTotal) => {
                    if (ok) {
                        playAlertSound();
                        triggerHapticVibrate();
                        alert(`✅ Addition de ${amount} DH encaissée !\n\n+${added} points crédités à ${member.firstName || "Client"}.\nNouveau solde : ${newTotal} / 500 pts`);
                        member.points = newTotal;
                        renderMember(member, contentArea, suffix);
                    } else {
                        alert("❌ Erreur lors de l'attribution des points.");
                        btnCreditNow.disabled = false;
                        btnCreditNow.textContent = "✅ Valider les points (1 DH = 1 pt)";
                    }
                });
            });
        }
    }

    function renderCreate(phoneVal, contentArea, suffix) {
        contentArea.innerHTML = `
            <div class="waiter-member-card" style="border-color: rgba(201, 169, 110, 0.4);">
                <div style="text-align: center; margin-bottom: 16px;">
                    <span style="font-size: 2rem;">👤</span>
                    <h4 style="margin: 6px 0 2px 0; font-size: 1.1rem; color: var(--gold);">Nouveau Client</h4>
                    <p style="margin: 0; font-size: 0.8rem; color: var(--muted);">Ce numéro n'est pas encore inscrit au Club.</p>
                </div>

                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
                    <div>
                        <label style="font-size: 0.75rem; color: var(--muted); text-transform: uppercase;">Prénom du client</label>
                        <input type="text" id="newFirstName_${suffix}" class="waiter-search-input" style="width: 100%; margin-top: 4px;" placeholder="Ex: Karim" />
                    </div>
                    <div>
                        <label style="font-size: 0.75rem; color: var(--muted); text-transform: uppercase;">Numéro de téléphone</label>
                        <input type="tel" id="newPhone_${suffix}" class="waiter-search-input" style="width: 100%; margin-top: 4px;" value="${phoneVal}" placeholder="Ex: 0612345678" />
                    </div>
                </div>

                <button type="button" id="btnCreate_${suffix}" class="btn-credit-now" style="background: linear-gradient(135deg, #C9A96E 0%, #B8860B 100%); color: #000; font-weight: 700;">
                    🎁 Créer le compte (+50 pts offerts) & Continuer
                </button>
            </div>
        `;

        const btnCreate = document.getElementById(`btnCreate_${suffix}`);
        const inputName = document.getElementById(`newFirstName_${suffix}`);
        const inputPhone = document.getElementById(`newPhone_${suffix}`);

        if (btnCreate && inputPhone) {
            btnCreate.addEventListener("click", () => {
                const rawPh = inputPhone.value.trim();
                const cleanPh = window.normalizePhone ? window.normalizePhone(rawPh) : rawPh.replace(/\D/g, "");
                const name = (inputName ? inputName.value.trim() : "") || "Client";

                if (cleanPh.length < 8) {
                    alert("Numéro de téléphone invalide (minimum 8 chiffres requis).");
                    return;
                }

                btnCreate.disabled = true;
                btnCreate.textContent = "Création du compte...";

                dbService.createOrGetLoyaltyMember(cleanPh, name, "waiter_direct", (ok, member, isNew) => {
                    if (ok && member) {
                        playAlertSound();
                        triggerHapticVibrate();
                        alert(`👑 Compte créé pour ${member.firstName} !\n+50 points de bienvenue offerts (Solde: ${member.points} pts).`);
                        renderMember(member, contentArea, suffix);
                    } else {
                        alert("❌ Erreur lors de la création du compte.");
                        btnCreate.disabled = false;
                        btnCreate.textContent = "🎁 Créer le compte (+50 pts) & Continuer";
                    }
                });
            });
        }
    }

    setupController(modalSearchInput, modalSearchBtn, modalContentArea, "modal");
    setupController(tabSearchInput, tabSearchBtn, tabContentArea, "tab");
}

document.addEventListener("DOMContentLoaded", () => {
    initTabNavigation();
    initDirectLoyaltyModule();
    requestScreenWakeLock();
    startAndroidKeepAlive();
    startPendingAlertWatchdog();

    function startWaiterApp() {
        if (typeof dbService !== "undefined" && dbService.isCloud()) {
            firebase.auth().signInAnonymously()
                .then(() => {
                    console.log("🔒 Authentification anonyme réussie.");
                    setConnectionStatus("online");
                    startRealtimeHub();
                })
                .catch(e => {
                    console.error("❌ Auth échouée, démarrage en mode fallback:", e);
                    setConnectionStatus("online");
                    startRealtimeHub();
                });
        } else {
            setConnectionStatus("online");
            startRealtimeHub();
        }
    }

    if (typeof dbService !== "undefined") {
        startWaiterApp();
    } else {
        const checkInterval = setInterval(() => {
            if (typeof dbService !== "undefined") {
                clearInterval(checkInterval);
                startWaiterApp();
            }
        }, 50);
    }
});