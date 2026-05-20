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

// ============================================================================
// FCM — Notifications Android HIGH PRIORITY via Cloudflare Worker
// ============================================================================
//
//  La clé privée Firebase est stockée côté serveur (Cloudflare Worker).
//  waiter.js envoie uniquement le payload + un secret partagé.
//  La clé n'est jamais exposée dans le JS client.
//
//  WORKER_URL  → URL du Worker après "wrangler deploy"
//  WORKER_SECRET → doit être IDENTIQUE au secret configuré dans le Worker
//                  via "wrangler secret put WORKER_SECRET"
// ============================================================================

const WORKER_URL    = "https://greycorner-fcm.hichamatlas75.workers.dev";
const WORKER_SECRET = "greycorner_secure_2026";

/**
 * Envoie un DATA MESSAGE FCM HIGH PRIORITY au topic "waiters"
 * via le Cloudflare Worker greycorner-fcm.
 *
 * Fonctionne même si l'app Android est tuée / arrière-plan / écran éteint.
 *
 * @param {string}        type   "WAITER_CALL" | "PRE_ORDER"
 * @param {string}        title  Titre de la notification
 * @param {string}        body   Corps de la notification
 * @param {string|number} table  Numéro de table
 * @param {string}        docId  ID du document Firestore
 */
async function sendFcmToWaiters(type, title, body, table, docId) {
    if (!WORKER_URL || WORKER_URL.includes("TON-SUBDOMAIN")) {
        console.warn("⚠️ FCM Worker : URL non configurée.");
        return;
    }
    try {
        const res = await fetch(WORKER_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                secret: WORKER_SECRET,
                type,
                title,
                body,
                table:  String(table || "?"),
                docId:  docId || ""
            })
        });

        const json = await res.json();
        if (json.success) {
            console.log("✅ FCM envoyé via Worker →", type, "table", table);
        } else {
            console.error("❌ FCM Worker échec :", json);
        }
    } catch (e) {
        // Erreur réseau → silencieux, le fallback poller Android prend le relais
        console.warn("⚠️ FCM Worker fetch error:", e);
    }
}

const activeWaiterId = myDeviceId;
const activeWaiterName = "Serveur";

// ============================================================================
// STATE — Listeners Firestore actifs
// ============================================================================

let unsubCalls = null;
let unsubOrders = null;

// Sets pour éviter de rejouer le son/vibration sur les listes déjà chargées
const knownCallIds = new Set();
const knownOrderIds = new Set();
let isCallsInitialLoad = true;
let isOrdersInitialLoad = true;

// Données actives pour les compteurs
let activeCallsList = [];
let activePreOrdersList = [];
let globalWaiters = [];

// Flag de reconnexion en cours (évite les doubles subscribe)
let isReconnecting = false;

// ============================================================================
// AUDIO & VIBRATION
// ============================================================================

const alertChime = new Audio("https://assets.mixkit.co/active_storage/sfx/911/911-200.wav");
alertChime.volume = 0.55;

function triggerHapticVibrate() {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
}

function playAlertSound() {
    alertChime.currentTime = 0;
    alertChime.play().catch(() => {
        console.warn("🔊 Autoplay bloqué par le navigateur.");
    });
}

// ============================================================================
// ANDROID NATIVE BRIDGE — Helpers sécurisés
// ============================================================================

/**
 * Envoie une notification native Android avec bouton d'action (Accepter).
 * Correspond aux actions ACTION_ACCEPT_CALL / ACTION_ACCEPT_ORDER
 * interceptées par WaiterForegroundService.BroadcastReceiver.
 */
function triggerAndroidAlert(id, type, title, message) {
    if (typeof AndroidInterface === "undefined") return;
    try {
        if (typeof AndroidInterface.triggerActionAlert === "function") {
            AndroidInterface.triggerActionAlert(id, type, title, message);
        } else if (typeof AndroidInterface.triggerNativeAlert === "function") {
            AndroidInterface.triggerNativeAlert(title, message);
        }
    } catch (e) {
        console.error("❌ Android bridge error:", e);
    }
}

/**
 * Heartbeat vers le service Android toutes les 20 min.
 * Déclenche onStartCommand → réacquiert le WakeLock (timeout 30 min)
 * avant qu'il n'expire, gardant le service vivant indéfiniment.
 */
function startAndroidKeepAlive() {
    const INTERVAL_MS = 20 * 60 * 1000; // 20 minutes < timeout WakeLock 30 min

    setInterval(() => {
        if (typeof AndroidInterface === "undefined") return;
        try {
            if (typeof AndroidInterface.keepAlive === "function") {
                AndroidInterface.keepAlive();
                console.log("💓 Keep-alive envoyé au service Android.");
            }
        } catch (e) {
            console.warn("⚠️ Keep-alive bridge error:", e);
        }
    }, INTERVAL_MS);
}

// ============================================================================
// HELPERS
// ============================================================================

function getTableZoneName(tableNum) {
    const num = parseInt(tableNum);
    if (num >= 101 && num <= 115) return "Salon";
    if (num >= 201 && num <= 223) return "Loge";
    if (num >= 301 && num <= 324) return "Terrasse";
    return "Table";
}

function getElapsedTimeMarkup(createdAtString) {
    const created = new Date(createdAtString);
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
    activePreOrdersList = [];
}

function startRealtimeHub() {
    isCallsInitialLoad = true;
    isOrdersInitialLoad = true;

    unsubCalls = dbService.onCallsChange((calls) => {
        activeCallsList = calls;
        processCallsFeed(calls);
        updateMyTablesStats();
    });

    unsubOrders = dbService.onPreOrdersChange((orders) => {
        activePreOrdersList = orders;
        processPreOrdersFeed(orders);
        updateMyTablesStats();
    });

    console.log("✅ Listeners Firestore démarrés.");
}

/**
 * Reconnexion propre : arrêt → reset état → redémarrage.
 * Appelée sur retour réseau ou visibilité retrouvée après absence prolongée.
 */
async function reconnectHub() {
    if (isReconnecting) return;
    isReconnecting = true;

    console.log("🔄 Reconnexion du hub temps réel...");
    stopRealtimeHub();
    resetState();

    // Petite pause pour laisser Firestore se stabiliser
    await new Promise(r => setTimeout(r, 1500));

    try {
        if (typeof dbService !== "undefined" && dbService.isCloud()) {
            // Re-authentification anonyme si la session a expiré
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
                if (!isCallsInitialLoad) {
                    newPendingDetected = true;
                    const zoneName    = getTableZoneName(call.table);
                    const typeLabels  = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition" };
                    const typeLabel   = typeLabels[call.type] || "Appel";
                    const alertTitle  = `🔔 Nouveau Appel : ${zoneName} ${call.table}`;
                    const alertBody   = `Demande : ${typeLabel}`;
                    triggerAndroidAlert(call.id, "call", alertTitle, alertBody);
                    sendFcmToWaiters("WAITER_CALL", alertTitle, alertBody, call.table, call.id);
                }
            }
        } else {
            knownCallIds.add(call.id);
            if (isAcceptedByMe) myActiveCallsCount++;
        }

        // Rendu carte
        const card = document.createElement("div");
        card.className = `alert-card ${call.status === "pending" ? "call-pending" : "call-accepted"} ${isAcceptedByOther ? "unassigned-card" : ""}`;
        card.dataset.id = call.id;

        const typeLabels = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition" };
        const badgeClasses = { waiter: "badge-waiter", water: "badge-water", bill: "badge-bill" };

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
            <div class="card-actions">
                ${call.status === "pending"
                ? `<button class="action-btn-accept accept-call-btn" data-id="${call.id}">S'y Rendre</button>`
                : (isAcceptedByMe
                    ? `<div class="accepted-status-badge"><span class="mini-pulse"></span> En cours...</div>
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
            });
        }
        if (btnComplete) {
            btnComplete.addEventListener("click", () => {
                dbService.updateCallStatus(call.id, "completed");
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
                if (!isOrdersInitialLoad) {
                    newOrderDetected = true;
                    const zoneName   = getTableZoneName(order.table);
                    const alertTitle = `👨‍🍳 Nouvelle Précommande : ${zoneName} ${order.table}`;
                    const alertBody  = `Total : ${order.totalPrice} MAD`;
                    triggerAndroidAlert(order.id, "order", alertTitle, alertBody);
                    sendFcmToWaiters("PRE_ORDER", alertTitle, alertBody, order.table, order.id);
                }
            }
        } else {
            knownOrderIds.add(order.id);
            if (isAcceptedByMe) myActiveOrdersCount++;
        }

        // Rendu carte
        const card = document.createElement("div");
        card.className = `alert-card ${order.status === "pending" ? "call-pending" : "call-accepted"} ${isAcceptedByOther ? "unassigned-card" : ""}`;
        card.dataset.id = order.id;

        let itemsHtml = "";
        order.items.forEach(it => {
            itemsHtml += `
                <div class="order-item-row">
                    <div>
                        <span class="item-qty-lbl">${it.qty}x</span>
                        <span class="item-name-lbl">${it.name_lang}</span>
                    </div>
                    <span class="item-price-lbl">${it.price} MAD</span>
                </div>
            `;
        });

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
            });
        }
        if (btnComplete) {
            btnComplete.addEventListener("click", () => {
                dbService.updatePreOrderStatus(order.id, "completed");
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
// TIMERS PÉRIODIQUES
// ============================================================================

// Mise à jour des timers "Il y a X min" toutes les 30 secondes
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

// Retour réseau → reconnexion Firestore + Android Bridge
window.addEventListener("online", () => {
    console.log("🌐 Réseau rétabli → reconnexion...");
    reconnectHub();
});

// Perte réseau → arrêt propre des listeners
window.addEventListener("offline", () => {
    console.warn("📴 Réseau perdu → arrêt des listeners.");
    stopRealtimeHub();
});

// Page redevient visible après un long arrière-plan
// (ex : retour d'une autre app, déverrouillage écran)
let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        hiddenAt = Date.now();
    } else {
        // Si la page était cachée plus de 3 min → reconnexion préventive
        const hiddenDuration = hiddenAt ? Date.now() - hiddenAt : 0;
        if (hiddenDuration > 3 * 60 * 1000) {
            console.log(`🔄 Page cachée ${Math.round(hiddenDuration / 1000)}s → reconnexion préventive.`);
            reconnectHub();
        }
        hiddenAt = null;
    }
});

// Cleanup propre avant rechargement WebView (géré par le service Android)
window.addEventListener("beforeunload", () => {
    stopRealtimeHub();
});

// ============================================================================
// INITIALISATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
    initTabNavigation();

    // Déverrouiller l'audio au premier tap (politique browser/WebView)
    document.addEventListener("click", () => {
        alertChime.play().then(() => {
            alertChime.pause();
            alertChime.currentTime = 0;
        }).catch(() => { });
    }, { once: true });

    // Démarrage du heartbeat keep-alive vers le service Android
    startAndroidKeepAlive();

    // Authentification + démarrage des listeners
    if (typeof dbService !== "undefined" && dbService.isCloud()) {
        firebase.auth().signInAnonymously()
            .then(() => {
                console.log("🔒 Authentification anonyme réussie.");
                startRealtimeHub();
            })
            .catch(e => {
                console.error("❌ Auth échouée, démarrage en mode fallback:", e);
                startRealtimeHub();
            });
    } else {
        startRealtimeHub();
    }
});
