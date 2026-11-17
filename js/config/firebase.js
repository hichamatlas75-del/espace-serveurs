/**
 * ============================================================================
 * GREY CORNER — CLOUDFLARE D1 ADAPTER & REAL-TIME SERVICE LAYER (ES Module)
 * ============================================================================
 * Architecture 100% Cloudflare :
 * - Base SQLite D1 (5 000 000 lectures / jour gratuites, zéro blocage de quota)
 * - Cloudflare Pages Functions (/api/*) à latence ultra-faible (<15ms au Maroc)
 * - Synchronisation réactive intelligente (2.5s loop, pause en arrière-plan)
 * - Relais push FCM natif Android via Worker Cloudflare autonome
 * ============================================================================
 */

export const firebaseConfig = {
    apiKey: "AIzaSyAoINLpUCCic9Xz9_PnM3al9Iu69q1FQpY",
    authDomain: "grey-corner-restaurant.firebaseapp.com",
    projectId: "grey-corner-restaurant",
    storageBucket: "grey-corner-restaurant.firebasestorage.app",
    messagingSenderId: "251703175568",
    appId: "1:251703175568:web:8d693adc297eb869d12b15",
    measurementId: "G-3HVHB0EELC"
};

export const isFirebaseActive = true;
export const db = null;

// whenAuthReady : Dans l'architecture Cloudflare D1, l'authentification est instantanée
export function whenAuthReady(fn) {
    if (typeof fn === "function") {
        try { fn(); } catch (e) { console.error("whenAuthReady error:", e); }
    }
}

// Détection de l'URL racine de l'API Cloudflare
function resolveApiBase() {
    if (typeof window !== "undefined" && window.location) {
        const host = window.location.hostname || "";
        if (host.includes("pages.dev") || host.includes("greycorner")) {
            return `${window.location.origin}/api`;
        }
        if (host === "localhost" || host === "127.0.0.1") {
            return `${window.location.origin}/api`;
        }
    }
    return "https://espace-serveurs-hub.pages.dev/api";
}

const API_BASE = resolveApiBase();
const FALLBACK_API_BASE = "https://espace-serveurs-hub.pages.dev/api";

// Helper universel pour requêter l'API Cloudflare avec repli automatique
async function apiFetch(endpoint, method = "GET", body = null) {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    let primaryUrl = `${API_BASE}${cleanEndpoint}`;

    const headers = {
        "Content-Type": "application/json"
    };

    const options = {
        method,
        headers
    };

    if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
        options.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    try {
        const res = await fetch(primaryUrl, options);
        if (res.ok) {
            return await res.json();
        }
        // Si l'URL relative /api renvoie 404/500, essayer le hub officiel Cloudflare
        if (API_BASE !== FALLBACK_API_BASE) {
            const fallbackUrl = `${FALLBACK_API_BASE}${cleanEndpoint}`;
            const resFallback = await fetch(fallbackUrl, options);
            if (resFallback.ok) return await resFallback.json();
        }
        return await res.json().catch(() => null);
    } catch (err) {
        // En cas d'échec réseau sur l'URL primaire, repli sur le hub
        if (API_BASE !== FALLBACK_API_BASE) {
            try {
                const fallbackUrl = `${FALLBACK_API_BASE}${cleanEndpoint}`;
                const resFallback = await fetch(fallbackUrl, options);
                if (resFallback.ok) return await resFallback.json();
            } catch (err2) {
                console.warn(`⚠️ Cloudflare D1 API [${cleanEndpoint}] fallback error:`, err2.message || err2);
            }
        }
        console.warn(`⚠️ Cloudflare D1 API [${cleanEndpoint}] error:`, err.message || err);
        return null;
    }
}

// ── TABLES PAR DÉFAUT & DONNÉES LOCALES ──────────────────────────────────────
const DEFAULT_WAITERS = [
    { id: "karim", name: "Karim", email: "karim@greycorner.com", active: true },
    { id: "yassine", name: "Yassine", email: "yassine@greycorner.com", active: true }
];

const DEFAULT_TABLES = {};
for (let i = 1; i <= 24; i++) {
    const num = i <= 12 ? 100 + i : (i <= 18 ? 200 + (i - 12) : 300 + (i - 18));
    const zone = num < 200 ? "salon" : (num < 300 ? "loge" : "terrasse");
    DEFAULT_TABLES[num] = {
        tableNumber: num,
        zone: zone,
        assignedTo: "",
        status: "libre",
        active: true
    };
}

export function getLocalCollection(name, defaultVal = []) {
    if (typeof localStorage === "undefined") return defaultVal;
    const val = localStorage.getItem(`sim_${name}`);
    if (!val) {
        try { localStorage.setItem(`sim_${name}`, JSON.stringify(defaultVal)); } catch(e) {}
        return defaultVal;
    }
    try {
        return JSON.parse(val);
    } catch (e) {
        return defaultVal;
    }
}

export function setLocalCollection(name, data) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(`sim_${name}`, JSON.stringify(data));
    } catch (e) {}
    if (typeof dbService !== "undefined" && dbService._simListeners) {
        dbService._simListeners.forEach(cb => {
            try { cb(name, data); } catch (err) { console.error(err); }
        });
    }
}

export function normalizePhone(rawPhone) {
    if (!rawPhone) return "";
    let clean = String(rawPhone).replace(/[^\d+]/g, "").trim();
    if (clean.startsWith("+2120")) clean = clean.substring(4);
    else if (clean.startsWith("+212")) clean = "0" + clean.substring(4);
    else if (clean.startsWith("00212")) clean = "0" + clean.substring(5);
    else if (clean.startsWith("212") && clean.length >= 11) clean = "0" + clean.substring(3);
    clean = clean.replace(/\D/g, "");
    if (clean.length === 9 && (clean.startsWith("6") || clean.startsWith("7") || clean.startsWith("5"))) {
        clean = "0" + clean;
    }
    return clean;
}

export function isSamePhone(p1, p2) {
    if (!p1 || !p2) return false;
    const c1 = normalizePhone(p1);
    const c2 = normalizePhone(p2);
    if (c1 === c2) return true;
    if (c1.length >= 9 && c2.length >= 9 && c1.slice(-9) === c2.slice(-9)) return true;
    return false;
}

export function getTableZoneName(tableNum) {
    const num = parseInt(tableNum, 10);
    if (isNaN(num)) return `Table ${tableNum}`;
    if (num >= 101 && num <= 115) return `Salon (Table ${num})`;
    if (num >= 201 && num <= 219) return `Loge (Table ${num})`;
    if (num >= 301 && num <= 323) return `Terrasse (Table ${num})`;
    return `Table ${num}`;
}

export const FIREBASE_VAPID_KEY = "BO5FSWfM-nUZt6OZV4uGCbTmEi_dErg_FCVW52oxYi8Y__v0dBreH3KTY1Eo4NjzhZ83g09dESoSlegDI3vBH1I";
export const WORKER_URL = "https://greycorner-fcm.hichamatlas75.workers.dev";
export const WORKER_SECRET = "greycorner_secure_2026";

// Déclenchement notification Push FCM vers les serveurs
export function sendFcmToWaiters(type, title, body, tableId, docId) {
    if (typeof fetch === "undefined") return;
    const payload = {
        type: type,
        title: title,
        body: body,
        table: String(tableId),
        tableId: String(tableId),
        docId: String(docId)
    };

    fetch(WORKER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${WORKER_SECRET}`
        },
        body: JSON.stringify(payload)
    }).catch(() => {
        fetch(`${API_BASE}/send-fcm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }).catch(() => {});
    });
}

// ── COEUR DE SYNCHRONISATION TEMPS RÉEL (Cloudflare D1) ──────────────────────
let _cachedCalls = getLocalCollection("calls", []);
let _cachedOrders = getLocalCollection("pre_orders", []);
let _cachedTables = getLocalCollection("tables", DEFAULT_TABLES);
let _cachedFrozen = false;
let _cachedLoyaltyConfig = getLocalCollection("loyalty_settings", { rewardThreshold: 500, welcomeBonus: 20, pointsPerDH: 1 });
let _cachedMembers = getLocalCollection("loyalty_members", []);

const _callsListeners = new Set();
const _ordersListeners = new Set();
const _tablesListeners = new Set();
const _freezeListeners = new Set();
const _loyaltyConfigListeners = new Set();
const _allMembersListeners = new Set();
const _memberListeners = new Map(); // phone -> Set of callbacks
const _singleCallListeners = new Map(); // callId -> Set of callbacks
const _singleOrderListeners = new Map(); // orderId -> Set of callbacks

let _isSyncing = false;
let _syncIntervalId = null;

async function syncNow() {
    if (_isSyncing) return;
    _isSyncing = true;
    try {
        const data = await apiFetch("/sync");
        if (data && data.success) {
            // 1. Appels
            if (Array.isArray(data.calls)) {
                _cachedCalls = data.calls;
                setLocalCollection("calls", _cachedCalls);
                _callsListeners.forEach(cb => { try { cb(_cachedCalls); } catch(e) {} });

                _singleCallListeners.forEach((callbacks, callId) => {
                    const found = _cachedCalls.find(c => String(c.id) === String(callId));
                    if (found) callbacks.forEach(cb => { try { cb(found); } catch(e) {} });
                });
            }

            // 2. Précommandes
            if (Array.isArray(data.orders)) {
                _cachedOrders = data.orders;
                setLocalCollection("pre_orders", _cachedOrders);
                _ordersListeners.forEach(cb => { try { cb(_cachedOrders); } catch(e) {} });

                _singleOrderListeners.forEach((callbacks, orderId) => {
                    const found = _cachedOrders.find(o => String(o.id) === String(orderId));
                    if (found) callbacks.forEach(cb => { try { cb(found); } catch(e) {} });
                });
            }

            // 3. Tables
            if (data.tables && typeof data.tables === "object") {
                _cachedTables = data.tables;
                setLocalCollection("tables", _cachedTables);
                _tablesListeners.forEach(cb => { try { cb(_cachedTables); } catch(e) {} });
            }

            // 4. Freeze
            if (typeof data.frozen === "boolean") {
                _cachedFrozen = data.frozen;
                setLocalCollection("system_config", { frozen: _cachedFrozen });
                _freezeListeners.forEach(cb => { try { cb(_cachedFrozen); } catch(e) {} });
            }

            // 5. Config Fidélité
            if (data.loyaltyConfig) {
                _cachedLoyaltyConfig = data.loyaltyConfig;
                setLocalCollection("loyalty_settings", _cachedLoyaltyConfig);
                _loyaltyConfigListeners.forEach(cb => { try { cb(_cachedLoyaltyConfig); } catch(e) {} });
            }
        }
    } catch (err) {
        console.warn("D1 Sync error:", err);
    } finally {
        _isSyncing = false;
    }
}

// Synchronisation des membres fidélité (pour page Admin)
async function syncMembersNow() {
    try {
        const data = await apiFetch("/loyalty/members");
        if (data && data.success && Array.isArray(data.members)) {
            _cachedMembers = data.members;
            setLocalCollection("loyalty_members", _cachedMembers);
            _allMembersListeners.forEach(cb => { try { cb(_cachedMembers); } catch(e) {} });

            _memberListeners.forEach((callbacks, phone) => {
                const suffix = phone.length >= 9 ? phone.slice(-9) : phone;
                const found = _cachedMembers.find(m => m.phone === phone || (m.phone && m.phone.endsWith(suffix)));
                if (found) callbacks.forEach(cb => { try { cb(found); } catch(e) {} });
            });
        }
    } catch(e) {}
}

let _syncTimeoutId = null;

function scheduleNextSync() {
    if (_syncTimeoutId) clearTimeout(_syncTimeoutId);
    if (typeof window === "undefined") return;

    const hasPending = (_cachedCalls || []).some(c => c.status === "pending") || (_cachedOrders || []).some(o => o.status === "pending");
    // Si un appel ou commande est en attente, rafraîchir à 1200ms pour couper immédiatement la sonnerie dès validation par un collègue
    const delay = hasPending ? 1200 : 2500;

    _syncTimeoutId = setTimeout(async () => {
        if (!document.hidden) {
            await syncNow();
            if (_allMembersListeners.size > 0) await syncMembersNow();
        }
        scheduleNextSync();
    }, delay);
}

function startSyncLoop() {
    if (typeof window === "undefined") return;
    syncNow();
    scheduleNextSync();

    // Réveil immédiat dès que l'utilisateur déverrouille son téléphone ou revient sur l'onglet
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            syncNow();
            syncMembersNow();
            scheduleNextSync();
        }
    });

    window.addEventListener("online", () => {
        syncNow();
        syncMembersNow();
        scheduleNextSync();
    });
}

// ── SERVICE GLOBAL : DBSERVICE ──────────────────────────────────────────────
export const dbService = {
    syncNow() { return syncNow(); },
    syncMembersNow() { return syncMembersNow(); },
    isCloud() { return true; },
    getWaiters(callback) { return this.onWaitersChange(callback); },
    getTables(callback) { return this.onTablesChange(callback); },
    _simListeners: [],
    registerSimListener(cb) { this._simListeners.push(cb); },
    initSimBroadcastListener() {},

    onWaitersChange(callback) {
        if (callback) callback(DEFAULT_WAITERS);
        return () => {};
    },

    onTablesChange(callback) {
        if (callback) {
            _tablesListeners.add(callback);
            callback(_cachedTables);
        }
        return () => _tablesListeners.delete(callback);
    },

    assignTable(tableId, waiterId, callback) {
        const numId = parseInt(tableId, 10);
        if (_cachedTables[numId]) {
            _cachedTables[numId].assignedTo = waiterId;
            setLocalCollection("tables", _cachedTables);
        }
        apiFetch(`/tables/${numId}`, "PATCH", { assignedTo: waiterId })
            .then(res => {
                syncNow();
                if (callback) callback(res ? res.success !== false : true);
            })
            .catch(() => {
                if (callback) callback(true);
            });
    },

    sendCall(tableId, type, extraData, callback) {
        if (typeof extraData === "function") {
            callback = extraData;
            extraData = null;
        }
        const numTable = parseInt(tableId, 10);
        const payload = {
            table: numTable,
            tableNum: numTable,
            type: type || "waiter",
            ...(extraData || {})
        };

        apiFetch("/calls", "POST", payload)
            .then(res => {
                const callId = res && res.id ? res.id : `call_${Date.now()}`;
                const zoneName = getTableZoneName(numTable);
                const typeLabels = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition", reward: "🎁 Consommation Gratuite (500 pts)" };
                const label = typeLabels[type] || "Appel";
                sendFcmToWaiters("CALL", `🔔 ${label} : ${zoneName}`, `Table ${numTable} demande de l'assistance`, numTable, callId);

                syncNow();
                if (callback) callback(true, callId);
            })
            .catch(err => {
                console.error("sendCall error:", err);
                if (callback) callback(false);
            });
    },

    onSingleCallChange(callId, callback) {
        if (!callId || !callback) return () => {};
        if (!_singleCallListeners.has(callId)) {
            _singleCallListeners.set(callId, new Set());
        }
        _singleCallListeners.get(callId).add(callback);

        const found = _cachedCalls.find(c => String(c.id) === String(callId));
        if (found) callback(found);

        return () => {
            const set = _singleCallListeners.get(callId);
            if (set) {
                set.delete(callback);
                if (set.size === 0) _singleCallListeners.delete(callId);
            }
        };
    },

    onCallsChange(callback) {
        if (callback) {
            _callsListeners.add(callback);
            callback(_cachedCalls);
        }
        return () => _callsListeners.delete(callback);
    },

    updateCallStatus(callId, status, waiterId, callback) {
        if (typeof waiterId === "function") {
            callback = waiterId;
            waiterId = null;
        }

        // Optimiste en mémoire
        const found = _cachedCalls.find(c => String(c.id) === String(callId));
        if (found) {
            found.status = status;
            if (waiterId) found.assignedTo = waiterId;
            setLocalCollection("calls", _cachedCalls);
            _callsListeners.forEach(cb => { try { cb(_cachedCalls); } catch(e) {} });
        }

        apiFetch(`/calls/${callId}`, "PATCH", { status, waiterId })
            .then(res => {
                syncNow();
                if (callback) callback(res ? res.success !== false : true);
            })
            .catch(() => {
                if (callback) callback(true);
            });
    },

    sendPreOrder(tableId, items, note, totalPrice, loyaltyInfo, callback) {
        if (typeof loyaltyInfo === "function") {
            callback = loyaltyInfo;
            loyaltyInfo = null;
        }
        const numTable = parseInt(tableId, 10);
        const payload = {
            table: numTable,
            tableNum: numTable,
            items: items || [],
            note: note || "",
            totalPrice: parseFloat(totalPrice) || 0,
            loyaltyPhone: loyaltyInfo && loyaltyInfo.phone ? loyaltyInfo.phone : "",
            loyaltyName: loyaltyInfo && loyaltyInfo.name ? loyaltyInfo.name : "",
            loyaltyPoints: loyaltyInfo && typeof loyaltyInfo.points === "number" ? loyaltyInfo.points : null
        };

        apiFetch("/orders", "POST", payload)
            .then(res => {
                const orderId = res && res.id ? res.id : `order_${Date.now()}`;
                const zoneName = getTableZoneName(numTable);
                let itemsSummary = "";
                if (Array.isArray(items) && items.length > 0) {
                    const preview = items.slice(0, 3).map(it => `${it.qty || 1}x ${it.name_lang || it.name || "Article"}`).join(", ");
                    const extra = items.length > 3 ? ` (+${items.length - 3})` : "";
                    itemsSummary = `${preview}${extra} • `;
                }
                sendFcmToWaiters("PRE_ORDER", `👨‍🍳 Nouvelle Précommande : ${zoneName}`, `${itemsSummary}Total : ${totalPrice} MAD`, numTable, orderId);

                syncNow();
                if (callback) callback(true, orderId);
            })
            .catch(err => {
                console.error("sendPreOrder error:", err);
                if (callback) callback(false);
            });
    },

    onSinglePreOrderChange(orderId, callback) {
        if (!orderId || !callback) return () => {};
        if (!_singleOrderListeners.has(orderId)) {
            _singleOrderListeners.set(orderId, new Set());
        }
        _singleOrderListeners.get(orderId).add(callback);

        const found = _cachedOrders.find(o => String(o.id) === String(orderId));
        if (found) callback(found);

        return () => {
            const set = _singleOrderListeners.get(orderId);
            if (set) {
                set.delete(callback);
                if (set.size === 0) _singleOrderListeners.delete(orderId);
            }
        };
    },

    onPreOrdersChange(callback) {
        if (callback) {
            _ordersListeners.add(callback);
            callback(_cachedOrders);
        }
        return () => _ordersListeners.delete(callback);
    },

    updatePreOrderStatus(orderId, status, waiterId, callback) {
        if (typeof waiterId === "function") {
            callback = waiterId;
            waiterId = null;
        }

        const found = _cachedOrders.find(o => String(o.id) === String(orderId));
        if (found) {
            found.status = status;
            if (waiterId) found.assignedTo = waiterId;
            setLocalCollection("pre_orders", _cachedOrders);
            _ordersListeners.forEach(cb => { try { cb(_cachedOrders); } catch(e) {} });
        }

        apiFetch(`/orders/${orderId}`, "PATCH", { status, waiterId })
            .then(res => {
                syncNow();
                if (callback) callback(res ? res.success !== false : true);
            })
            .catch(() => {
                if (callback) callback(true);
            });
    },

    onSystemFreezeChange(callback) {
        if (callback) {
            _freezeListeners.add(callback);
            callback(_cachedFrozen);
        }
        return () => _freezeListeners.delete(callback);
    },

    setSystemFreeze(frozen, callback) {
        _cachedFrozen = Boolean(frozen);
        setLocalCollection("system_config", { frozen: _cachedFrozen });
        _freezeListeners.forEach(cb => { try { cb(_cachedFrozen); } catch(e) {} });

        apiFetch("/system/freeze", "POST", { frozen: _cachedFrozen })
            .then(res => {
                syncNow();
                if (callback) callback(res ? res.success !== false : true);
            })
            .catch(err => {
                if (callback) callback(false, err.message || String(err));
            });
    },

    cleanupOldData(callback) {
        apiFetch("/system/cleanup", "POST", {})
            .then(res => {
                syncNow();
                if (callback) callback(res ? res.success !== false : true);
            })
            .catch(() => {
                if (callback) callback(true);
            });
    },

    getLoyaltyMember(rawPhone, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(null); return; }

        const checkLocal = () => {
            const found = _cachedMembers.find(m => isSamePhone(m.phone, phone));
            if (found) return found;
            if (typeof localStorage !== "undefined" && isSamePhone(localStorage.getItem("gc_loyalty_phone"), phone)) {
                return {
                    phone: phone,
                    firstName: localStorage.getItem("gc_loyalty_name") || "Client",
                    points: parseInt(localStorage.getItem("gc_loyalty_pts"), 10) || 20,
                    totalEarned: 20,
                    rewardsClaimed: 0,
                    source: "qr_menu"
                };
            }
            return null;
        };

        apiFetch(`/loyalty/members/${phone}`, "GET")
            .then(res => {
                if (res && res.success && res.member) {
                    const idx = _cachedMembers.findIndex(m => isSamePhone(m.phone, res.member.phone));
                    if (idx >= 0) _cachedMembers[idx] = res.member; else _cachedMembers.push(res.member);
                    setLocalCollection("loyalty_members", _cachedMembers);
                    if (callback) callback(res.member);
                } else {
                    if (callback) callback(checkLocal());
                }
            })
            .catch(() => {
                if (callback) callback(checkLocal());
            });
    },

    onLoyaltyMemberChange(rawPhone, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone || !callback) return () => {};

        if (!_memberListeners.has(phone)) {
            _memberListeners.set(phone, new Set());
        }
        _memberListeners.get(phone).add(callback);

        this.getLoyaltyMember(phone, (mbr) => {
            if (mbr) callback(mbr);
        });

        return () => {
            const set = _memberListeners.get(phone);
            if (set) {
                set.delete(callback);
                if (set.size === 0) _memberListeners.delete(phone);
            }
        };
    },

    createOrGetLoyaltyMember(rawPhone, firstName, source, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, null, false); return; }
        const cleanName = (firstName || "Client").trim();
        const src = source || "qr_menu";

        apiFetch("/loyalty/members", "POST", { phone, firstName: cleanName, source: src })
            .then(res => {
                if (res && res.success && res.member) {
                    const idx = _cachedMembers.findIndex(m => isSamePhone(m.phone, res.member.phone));
                    if (idx >= 0) _cachedMembers[idx] = res.member; else _cachedMembers.push(res.member);
                    setLocalCollection("loyalty_members", _cachedMembers);

                    if (typeof localStorage !== "undefined") {
                        try {
                            localStorage.setItem("gc_loyalty_phone", res.member.phone);
                            localStorage.setItem("gc_loyalty_name", res.member.firstName);
                            localStorage.setItem("gc_loyalty_pts", String(res.member.points || 20));
                        } catch(e) {}
                    }
                    if (callback) callback(true, res.member, res.isNew !== false);
                } else {
                    if (callback) callback(false, null, false);
                }
            })
            .catch(() => {
                if (callback) callback(false, null, false);
            });
    },

    creditLoyaltyPoints(rawPhone, amountDH, tableNumber, validatedBy, orderId, forceAdmin, callback) {
        if (typeof orderId === "function") {
            callback = orderId;
            orderId = null;
            forceAdmin = false;
        } else if (typeof forceAdmin === "function") {
            callback = forceAdmin;
            forceAdmin = false;
        } else if (typeof validatedBy === "function") {
            callback = validatedBy;
            validatedBy = "waiter";
            orderId = null;
            forceAdmin = false;
        } else if (typeof tableNumber === "function") {
            callback = tableNumber;
            tableNumber = "";
            validatedBy = "waiter";
            orderId = null;
            forceAdmin = false;
        }
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, "Numéro invalide"); return; }
        const amount = parseFloat(amountDH) || 0;

        apiFetch("/loyalty/credit", "POST", {
            phone,
            amountDH: amount,
            tableNumber: tableNumber ? String(tableNumber) : "",
            orderId: orderId || "",
            validatedBy: validatedBy || "waiter",
            forceAdmin: forceAdmin === true
        }).then(res => {
            if (res && res.success) {
                const newTotal = res.newTotal;
                const pointsAdded = res.pointsAdded;

                if (typeof localStorage !== "undefined" && localStorage.getItem("gc_loyalty_phone") === phone) {
                    try { localStorage.setItem("gc_loyalty_pts", String(newTotal)); } catch(e) {}
                }

                syncNow();
                syncMembersNow();
                if (callback) callback(true, pointsAdded, newTotal, { ...(res.member || {}), ...res });
            } else {
                const errMsg = res ? (res.error || res.message) : "Erreur de crédit";
                if (callback) callback(false, errMsg, null, res);
            }
        }).catch(err => {
            if (callback) callback(false, err.message || String(err));
        });
    },

    redeemLoyaltyReward(rawPhone, waiterName, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, "Numéro invalide"); return; }

        apiFetch("/loyalty/redeem", "POST", {
            phone,
            validatedBy: waiterName || "waiter"
        }).then(res => {
            if (res && res.success) {
                const newTotal = res.newTotal;
                if (typeof localStorage !== "undefined" && localStorage.getItem("gc_loyalty_phone") === phone) {
                    try { localStorage.setItem("gc_loyalty_pts", String(newTotal)); } catch(e) {}
                }
                syncNow();
                syncMembersNow();
                if (callback) callback(true, newTotal);
            } else {
                if (callback) callback(false, res ? res.error : "Solde insuffisant");
            }
        }).catch(err => {
            if (callback) callback(false, err.message || String(err));
        });
    },

    adjustLoyaltyPoints(rawPhone, delta, reason, adminName, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, "Numéro invalide"); return; }
        const pointsDelta = parseInt(delta, 10) || 0;

        apiFetch("/loyalty/adjust", "POST", {
            phone,
            delta: pointsDelta,
            reason: reason || "Ajustement administrateur",
            by: adminName || "admin"
        }).then(res => {
            if (res && res.success) {
                syncNow();
                syncMembersNow();
                if (callback) callback(true, res.newTotal);
            } else {
                if (callback) callback(false, res ? res.error : "Erreur ajustement");
            }
        }).catch(err => {
            if (callback) callback(false, err.message || String(err));
        });
    },

    onAllLoyaltyMembersChange(callback) {
        if (callback) {
            _allMembersListeners.add(callback);
            callback(_cachedMembers);
            syncMembersNow();
        }
        return () => _allMembersListeners.delete(callback);
    },

    getLoyaltyTransactions(rawPhone, callback) {
        const phone = normalizePhone(rawPhone);
        const q = phone ? `?phone=${phone}` : "";
        apiFetch(`/loyalty/transactions${q}`, "GET")
            .then(res => {
                if (callback) callback(res && res.transactions ? res.transactions : []);
            })
            .catch(() => {
                if (callback) callback([]);
            });
    },

    getLoyaltyAlerts(callback) {
        apiFetch("/loyalty/alerts", "GET")
            .then(res => {
                if (callback) callback(res && res.alerts ? res.alerts : []);
            })
            .catch(() => {
                if (callback) callback([]);
            });
    },

    verifyLoyaltyAlert(txId, callback) {
        apiFetch("/loyalty/alerts", "POST", { txId, action: "verify" })
            .then(res => {
                if (res && res.success) {
                    syncNow();
                    syncMembersNow();
                }
                if (callback) callback(res && res.success, res ? res.message : null);
            })
            .catch(err => {
                if (callback) callback(false, err.message || String(err));
            });
    },

    rejectLoyaltyAlert(txId, callback) {
        apiFetch("/loyalty/alerts", "POST", { txId, action: "reject" })
            .then(res => {
                if (res && res.success) {
                    syncNow();
                    syncMembersNow();
                }
                if (callback) callback(res && res.success, res ? res.message : null);
            })
            .catch(err => {
                if (callback) callback(false, err.message || String(err));
            });
    },

    rectifyLoyaltyAlert(txId, newPoints, callback) {
        apiFetch("/loyalty/alerts", "POST", { txId, action: "rectify", newPoints })
            .then(res => {
                if (res && res.success) {
                    syncNow();
                    syncMembersNow();
                }
                if (callback) callback(res && res.success, res ? res.message : null);
            })
            .catch(err => {
                if (callback) callback(false, err.message || String(err));
            });
    },

    onLoyaltySettingsChange(callback) {
        if (callback) {
            _loyaltyConfigListeners.add(callback);
            callback(_cachedLoyaltyConfig);
        }
        return () => _loyaltyConfigListeners.delete(callback);
    },

    setLoyaltySettings(settings, callback) {
        apiFetch("/loyalty/settings", "POST", settings)
            .then(res => {
                if (res && res.success) {
                    _cachedLoyaltyConfig = res.settings || settings;
                    setLocalCollection("loyalty_settings", _cachedLoyaltyConfig);
                    _loyaltyConfigListeners.forEach(cb => { try { cb(_cachedLoyaltyConfig); } catch(e) {} });
                    if (callback) callback(true);
                } else {
                    if (callback) callback(false);
                }
            })
            .catch(() => {
                if (callback) callback(false);
            });
    },

    claimLoyaltyRewardRequest(rawPhone, tableId, clientName, callback) {
        const phone = normalizePhone(rawPhone);
        this.sendCall(tableId, "reward", {
            loyaltyPhone: phone,
            loyaltyName: clientName || "",
            note: "🎁 Consommation Gratuite (500 pts)"
        }, callback);
    }
};

// Démarrage automatique de la synchronisation intelligente
startSyncLoop();

// Liaison globale à window pour compatibilité totale avec les scripts existants
if (typeof window !== "undefined") {
    window.isFirebaseActive = isFirebaseActive;
    window.db = db;
    window.whenAuthReady = whenAuthReady;
    window.dbService = dbService;
    window.getTableZoneName = getTableZoneName;
    window.normalizePhone = normalizePhone;
    window.sendFcmToWaiters = sendFcmToWaiters;
}
