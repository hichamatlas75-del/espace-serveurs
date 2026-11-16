/**
 * ============================================================================
 * GREY CORNER — FIREBASE CONFIGURATION & DUAL-MODE SERVICE LAYER
 * ============================================================================
 * COMPLETE FIXED VERSION — ALIGNED WITH SITE URL & FORCED CLOUD MODE
 * + AUTH ANONYME avec whenAuthReady() pour sécuriser les writes
 * ============================================================================
 */

const firebaseConfig = {
    apiKey: "AIzaSyAoINLpUCCic9Xz9_PnM3al9Iu69q1FQpY",
    authDomain: "grey-corner-restaurant.firebaseapp.com",
    projectId: "grey-corner-restaurant",
    storageBucket: "grey-corner-restaurant.firebasestorage.app",
    messagingSenderId: "251703175568",
    appId: "1:251703175568:web:8d693adc297eb869d12b15",
    measurementId: "G-3HVHB0EELC"
};

// ============================================================================
// FIREBASE INIT
// ============================================================================

let isFirebaseActive = false;
let db = null;

function hasValidFirebaseKeys() {
    return true;
}

if (hasValidFirebaseKeys()) {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        db = firebase.firestore();

        db.enablePersistence()
            .catch(err => {
                console.warn("⚠️ Persistence disabled:", err.code);
            });

        isFirebaseActive = true;
        console.log("🔥 Firebase Connected");

    } catch (e) {
        console.error("❌ Firebase Init Error:", e);
        isFirebaseActive = false;
    }
} else {
    console.log("ℹ️ Simulation Mode Active");
}

// ============================================================================
// AUTH ANONYME — whenAuthReady() garantit que l'auth est résolue avant tout write
// ============================================================================

let _authReady = false;
let _authReadyQueue = [];

function whenAuthReady(fn) {
    if (_authReady) {
        fn();
    } else {
        _authReadyQueue.push(fn);
    }
}

if (isFirebaseActive) {
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            _authReady = true;
            console.log("🔓 Auth anonyme OK — UID:", user.uid);
            _authReadyQueue.forEach(fn => { try { fn(); } catch(e) { console.error(e); } });
            _authReadyQueue = [];
        }
    });

    firebase.auth().signInAnonymously()
        .catch(e => console.warn("⚠️ signInAnonymously échoué:", e));
} else {
    // Mode simulation : pas besoin d'auth
    _authReady = true;
}

// ============================================================================
// LOCAL SIMULATION
// ============================================================================

const SIM_CHANNEL = "grey_corner_restaurant_channel";

const simBroadcast =
    typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(SIM_CHANNEL)
        : null;

// ============================================================================
// DEFAULT DATA
// ============================================================================

const DEFAULT_WAITERS = [
    { id: "karim", name: "Karim", email: "karim@greycorner.com", active: true },
    { id: "yassine", name: "Yassine", email: "yassine@greycorner.com", active: true }
];

const DEFAULT_TABLES = {};
for (let i = 1; i <= 24; i++) {
    DEFAULT_TABLES[i] = {
        tableNumber: i,
        assignedTo: i <= 8 ? "karim" : i <= 16 ? "yassine" : "",
        active: true
    };
}

// ============================================================================
// LOCAL STORAGE HELPERS
// ============================================================================

function getLocalCollection(name, defaultVal = []) {
    const val = localStorage.getItem(`sim_${name}`);
    if (!val) {
        localStorage.setItem(`sim_${name}`, JSON.stringify(defaultVal));
        return defaultVal;
    }
    try {
        return JSON.parse(val);
    } catch (e) {
        console.error("❌ JSON Parse Error:", name);
        return defaultVal;
    }
}

function setLocalCollection(name, data) {
    localStorage.setItem(`sim_${name}`, JSON.stringify(data));
    if (simBroadcast) {
        simBroadcast.postMessage({ type: "SYNC", collection: name, data: data });
    }
    if (typeof dbService !== "undefined") {
        dbService._simListeners.forEach(listener => {
            try { listener(name, data); } catch (e) { console.error(e); }
        });
    }
}

// ============================================================================
// INIT LOCAL STORAGE
// ============================================================================


function normalizePhone(rawPhone) {
    if (!rawPhone) return "";
    let clean = String(rawPhone).replace(/[^\d+]/g, "").trim();
    if (clean.startsWith("+212")) {
        clean = "0" + clean.substring(4);
    } else if (clean.startsWith("212")) {
        clean = "0" + clean.substring(3);
    } else if (clean.startsWith("00212")) {
        clean = "0" + clean.substring(5);
    }
    clean = clean.replace(/\D/g, "");
    return clean;
}
window.normalizePhone = normalizePhone;
if (!isFirebaseActive) {
    getLocalCollection("servers", DEFAULT_WAITERS);
    getLocalCollection("tables", DEFAULT_TABLES);
    getLocalCollection("calls", []);
    getLocalCollection("pre_orders", []);
    getLocalCollection("loyalty_members", []);
    getLocalCollection("loyalty_transactions", []);
    getLocalCollection("loyalty_settings", { rewardThreshold: 500, welcomeBonus: 50, pointsPerDH: 1 });
    getLocalCollection("tables", DEFAULT_TABLES);
    getLocalCollection("calls", []);
    getLocalCollection("pre_orders", []);
    getLocalCollection("system_config", { frozen: false });
}

// ============================================================================
// FCM CONFIGURATION & HELPERS
// ============================================================================

const WORKER_URL    = "https://greycorner-fcm.hichamatlas75.workers.dev";
const WORKER_SECRET = "greycorner_secure_2026";

function getTableZoneName(tableNum) {
    const num = parseInt(tableNum);
    if (num >= 101 && num <= 115) return "Salon";
    if (num >= 201 && num <= 223) return "Loge";
    if (num >= 301 && num <= 324) return "Terrasse";
    return "Table";
}

async function sendFcmToWaiters(type, title, body, table, docId) {
    if (!WORKER_URL) {
        console.warn("⚠️ FCM Worker : URL non configurée.");
        return;
    }
    try {
        const res = await fetch(WORKER_URL, {
            method:  "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${WORKER_SECRET}`
            },
            body: JSON.stringify({
                type,
                title,
                body,
                table:  String(table || "?"),
                docId:  docId || ""
            })
        });

        const json = await res.json();
        if (json.success) {
            console.log("🚀 Push FCM expédié avec succès via le Worker →", type, "table", table);
        } else {
            console.error("❌ FCM Worker échec :", json);
        }
    } catch (e) {
        console.warn("⚠️ FCM Worker fetch error:", e);
    }
}

// ============================================================================
// DATABASE SERVICE
// ============================================================================

const dbService = {
    isCloud() { return isFirebaseActive; },
    _simListeners: [],
    registerSimListener(callback) { this._simListeners.push(callback); },
    initSimBroadcastListener() {
        if (!simBroadcast) return;
        simBroadcast.onmessage = (event) => {
            if (event.data && event.data.type === "SYNC") {
                localStorage.setItem(`sim_${event.data.collection}`, JSON.stringify(event.data.data));
                this._simListeners.forEach(listener => {
                    listener(event.data.collection, event.data.data);
                });
            }
        };
    },

    // =========================================================================
    // WAITERS
    // =========================================================================
    getWaiters(callback) {
        if (isFirebaseActive) {
            return db.collection("servers")
                .where("active", "==", true)
                .onSnapshot(snapshot => {
                    const waiters = [];
                    snapshot.forEach(doc => { waiters.push({ id: doc.id, ...doc.data() }); });
                    callback(waiters);
                }, err => { console.error("❌ Servers stream error:", err); });
        } else {
            callback(getLocalCollection("servers"));
            this.registerSimListener((collection, data) => { if (collection === "servers") callback(data); });
            return () => { };
        }
    },

    // =========================================================================
    // TABLES
    // =========================================================================
    getTables(callback) {
        if (isFirebaseActive) {
            return db.collection("tables")
                .onSnapshot(snapshot => {
                    const tables = {};
                    snapshot.forEach(doc => { tables[doc.id] = { tableNumber: parseInt(doc.id), ...doc.data() }; });
                    callback(tables);
                }, err => { console.error("❌ Tables stream error:", err); });
        } else {
            callback(getLocalCollection("tables"));
            this.registerSimListener((collection, data) => { if (collection === "tables") callback(data); });
            return () => { };
        }
    },

    assignTable(tableId, waiterId, callback) {
        const data = {
            tableNumber: parseInt(tableId),
            assignedTo: waiterId,
            active: true,
            lastUpdated: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };
        if (isFirebaseActive) {
            db.collection("tables").doc(String(tableId)).set(data, { merge: true })
                .then(() => { if (callback) callback(true); })
                .catch(e => { console.error(e); if (callback) callback(false); });
        } else {
            const tables = getLocalCollection("tables");
            tables[tableId] = data;
            setLocalCollection("tables", tables);
            if (callback) callback(true);
        }
    },

    // =========================================================================
    // CALLS (waiters_calls)
    // =========================================================================
    sendCall(tableId, type, extraData, callback) {
        if (typeof extraData === "function") {
            callback = extraData;
            extraData = null;
        }
        whenAuthReady(() => {
            const execute = (waiterId) => {
                const data = {
                    table: parseInt(tableId),
                    assignedTo: waiterId || "",
                    type: type,
                    status: "pending",
                    createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
                    acceptedAt: null,
                    completedAt: null,
                    ...(extraData || {})
                };
                if (isFirebaseActive) {
                    db.collection("waiters_calls").add(data)
                        .then(docRef => {
                            const zoneName = getTableZoneName(tableId);
                            const typeLabels = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition", reward: "🎁 Consommation Gratuite (500 pts)" };
                            const typeLabel = typeLabels[type] || "Appel";
                            const alertTitle = `🔔 Nouveau Appel : ${zoneName} ${tableId}`;
                            const alertBody = `Demande : ${typeLabel}`;
                            sendFcmToWaiters("WAITER_CALL", alertTitle, alertBody, tableId, docRef.id);
                            if (callback) callback(true, docRef.id);
                        })
                        .catch(e => { console.error(e); if (callback) callback(false); });
                } else {
                    const calls = getLocalCollection("calls");
                    const id = "call_" + Math.random().toString(36).substring(2, 9);
                    calls.push({ id, ...data });
                    setLocalCollection("calls", calls);
                    if (callback) callback(true, id);
                }
            };
            if (isFirebaseActive) {
                db.collection("tables").doc(String(tableId)).get()
                    .then(doc => { execute(doc.exists ? doc.data().assignedTo : ""); })
                    .catch(() => execute(""));
            } else {
                const tables = getLocalCollection("tables");
                execute(tables[tableId] ? tables[tableId].assignedTo : "");
            }
        });
    },

    onCallsChange(callback) {
        if (isFirebaseActive) {
            return db.collection("waiters_calls")
                .orderBy("createdAt", "desc")
                .onSnapshot(snapshot => {
                    const calls = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        calls.push({
                            id: doc.id,
                            ...data,
                            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : data.createdAt) : new Date().toISOString()
                        });
                    });
                    callback(calls);
                }, err => { console.error("❌ Calls stream error:", err); });
        } else {
            const trigger = () => {
                const calls = getLocalCollection("calls");
                calls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                callback(calls);
            };
            trigger();
            this.registerSimListener(collection => { if (collection === "calls") trigger(); });
            return () => { };
        }
    },

    updateCallStatus(callId, status, waiterId, callback) {
        if (typeof waiterId === "function") { callback = waiterId; waiterId = null; }
        const updateData = {
            status: status,
            acceptedAt: status === "accepted" ? (isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()) : null,
            completedAt: status === "completed" ? (isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()) : null
        };
        if (waiterId) updateData.assignedTo = waiterId;
        if (isFirebaseActive) {
            db.collection("waiters_calls").doc(callId).update(updateData)
                .then(() => { if (callback) callback(true); })
                .catch(e => { console.error(e); if (callback) callback(false); });
        } else {
            const calls = getLocalCollection("calls");
            const idx = calls.findIndex(c => c.id === callId);
            if (idx !== -1) {
                calls[idx] = { ...calls[idx], ...updateData };
                setLocalCollection("calls", calls);
                if (callback) callback(true);
            } else { if (callback) callback(false); }
        }
    },

    // =========================================================================
    // PRE-ORDERS
    // =========================================================================
    sendPreOrder(tableId, items, note, totalPrice, callback) {
        whenAuthReady(() => {
            const execute = (waiterId) => {
                const data = {
                    table: parseInt(tableId),
                    assignedTo: waiterId || "",
                    items: items,
                    note: note || "",
                    totalPrice: parseFloat(totalPrice),
                    status: "pending",
                    createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
                    acceptedAt: null
                };
                if (isFirebaseActive) {
                    db.collection("pre_orders").add(data)
                        .then(docRef => {
                            const zoneName = getTableZoneName(tableId);
                            const alertTitle = `👨‍🍳 Nouvelle Précommande : ${zoneName} ${tableId}`;
                            const alertBody = `Total : ${totalPrice} MAD`;
                            sendFcmToWaiters("PRE_ORDER", alertTitle, alertBody, tableId, docRef.id);
                            if (callback) callback(true, docRef.id);
                        })
                        .catch(e => { console.error(e); if (callback) callback(false); });
                } else {
                    const orders = getLocalCollection("pre_orders");
                    const id = "order_" + Math.random().toString(36).substring(2, 9);
                    orders.push({ id, ...data });
                    setLocalCollection("pre_orders", orders);
                    if (callback) callback(true, id);
                }
            };
            if (isFirebaseActive) {
                db.collection("tables").doc(String(tableId)).get()
                    .then(doc => { execute(doc.exists ? doc.data().assignedTo : ""); })
                    .catch(() => execute(""));
            } else {
                const tables = getLocalCollection("tables");
                execute(tables[tableId] ? tables[tableId].assignedTo : "");
            }
        });
    },

    onPreOrdersChange(callback) {
        if (isFirebaseActive) {
            return db.collection("pre_orders")
                .orderBy("createdAt", "desc")
                .onSnapshot(snapshot => {
                    const orders = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        orders.push({
                            id: doc.id,
                            ...data,
                            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : data.createdAt) : new Date().toISOString()
                        });
                    });
                    callback(orders);
                }, err => { console.error("❌ PreOrders stream error:", err); });
        } else {
            const trigger = () => {
                const orders = getLocalCollection("pre_orders");
                orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                callback(orders);
            };
            trigger();
            this.registerSimListener(collection => { if (collection === "pre_orders") trigger(); });
            return () => { };
        }
    },

    updatePreOrderStatus(orderId, status, waiterId, callback) {
        if (typeof waiterId === "function") { callback = waiterId; waiterId = null; }
        const updateData = {
            status: status,
            acceptedAt: status === "accepted" ? (isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()) : null
        };
        if (waiterId) updateData.assignedTo = waiterId;
        if (isFirebaseActive) {
            db.collection("pre_orders").doc(orderId).update(updateData)
                .then(() => { if (callback) callback(true); })
                .catch(e => { console.error(e); if (callback) callback(false); });
        } else {
            const orders = getLocalCollection("pre_orders");
            const idx = orders.findIndex(o => o.id === orderId);
            if (idx !== -1) {
                orders[idx] = { ...orders[idx], ...updateData };
                setLocalCollection("pre_orders", orders);
                if (callback) callback(true);
            } else { if (callback) callback(false); }
        }
    },

    // =========================================================================
    // FREEZE SYSTEM
    // =========================================================================
    onSystemFreezeChange(callback) {
        if (isFirebaseActive) {
            return db.collection("system").doc("config")
                .onSnapshot(doc => {
                    const frozen = doc.exists && doc.data() && doc.data().frozen === true;
                    callback(frozen);
                }, err => { console.error("❌ SystemFreeze stream error:", err); });
        } else {
            const trigger = () => {
                const config = getLocalCollection("system_config", { frozen: false });
                callback(config.frozen === true);
            };
            trigger();
            this.registerSimListener(collection => { if (collection === "system_config") trigger(); });
            return () => { };
        }
    },

    setSystemFreeze(frozen, callback) {
        if (isFirebaseActive) {
            db.collection("system").doc("config").set({
                frozen: frozen,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true })
                .then(() => { if (callback) callback(true); })
                .catch(e => { console.error("❌ Freeze Error:", e); if (callback) callback(false, e.message || String(e)); });
        } else {
            setLocalCollection("system_config", { frozen: frozen, updatedAt: new Date().toISOString() });
            if (callback) callback(true);
        }
    },

    // =========================================================================
    // CLEANUP
    // =========================================================================
    cleanupOldData(callback) {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (isFirebaseActive) {
            db.collection("waiters_calls").where("createdAt", "<", cutoff).get()
                .then(snapshot => {
                    const batch = db.batch();
                    snapshot.forEach(doc => { batch.delete(doc.ref); });
                    return batch.commit();
                })
                .then(() => { return db.collection("pre_orders").where("createdAt", "<", cutoff).get(); })
                .then(snapshot => {
                    const batch = db.batch();
                    snapshot.forEach(doc => { batch.delete(doc.ref); });
                    return batch.commit();
                })
                .then(() => { if (callback) callback(true); })
                .catch(e => { console.error(e); if (callback) callback(false); });
        } else {
            const calls = getLocalCollection("calls").filter(c => new Date(c.createdAt) >= cutoff);
            setLocalCollection("calls", calls);
            const orders = getLocalCollection("pre_orders").filter(o => new Date(o.createdAt) >= cutoff);
            setLocalCollection("pre_orders", orders);
            if (callback) callback(true);
        }
    },
    getLoyaltyMember(rawPhone, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(null); return; }

        const checkLocal = () => {
            const members = getLocalCollection("loyalty_members", []);
            const found = members.find(m => m.phone === phone);
            if (found) return { ...found };
            const storedPhone = typeof localStorage !== "undefined" ? localStorage.getItem("gc_loyalty_phone") : null;
            if (storedPhone === phone) {
                return {
                    phone: phone,
                    firstName: localStorage.getItem("gc_loyalty_name") || "Client",
                    points: parseInt(localStorage.getItem("gc_loyalty_pts")) || 50,
                    totalEarned: 50,
                    rewardsClaimed: 0,
                    source: "qr_menu"
                };
            }
            return null;
        };

        if (isFirebaseActive && db) {
            whenAuthReady(() => {
                db.collection("loyalty_members").doc(phone).get()
                    .then(doc => {
                        if (doc.exists) {
                            const data = { phone: doc.id, ...doc.data() };
                            const members = getLocalCollection("loyalty_members", []);
                            const idx = members.findIndex(m => m.phone === phone);
                            if (idx >= 0) members[idx] = data; else members.push(data);
                            setLocalCollection("loyalty_members", members);
                            if (callback) callback(data);
                        } else {
                            if (callback) callback(checkLocal());
                        }
                    })
                    .catch(err => {
                        console.warn("⚠️ getLoyaltyMember Firestore error (repli local):", err.message || err);
                        if (callback) callback(checkLocal());
                    });
            });
        } else {
            if (callback) callback(checkLocal());
        }
    },
    onLoyaltyMemberChange(rawPhone, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) return () => {};

        const checkLocal = () => {
            const members = getLocalCollection("loyalty_members", []);
            const found = members.find(m => m.phone === phone);
            if (found) { callback(found); return; }
            const storedPhone = typeof localStorage !== "undefined" ? localStorage.getItem("gc_loyalty_phone") : null;
            if (storedPhone === phone) {
                callback({
                    phone: phone,
                    firstName: localStorage.getItem("gc_loyalty_name") || "Client",
                    points: parseInt(localStorage.getItem("gc_loyalty_pts")) || 50,
                    totalEarned: 50,
                    rewardsClaimed: 0,
                    source: "qr_menu"
                });
            }
        };

        if (isFirebaseActive && db) {
            let unsub = () => {};
            whenAuthReady(() => {
                unsub = db.collection("loyalty_members").doc(phone)
                    .onSnapshot(doc => {
                        if (doc.exists) {
                            const data = { phone: doc.id, ...doc.data() };
                            callback(data);
                        } else {
                            checkLocal();
                        }
                    }, err => {
                        console.warn("⚠️ onLoyaltyMemberChange error (repli local):", err.message || err);
                        checkLocal();
                    });
            });
            checkLocal();
            return () => { try { unsub(); } catch(e) {} };
        } else {
            checkLocal();
            this.registerSimListener(col => { if (col === "loyalty_members") checkLocal(); });
            return () => {};
        }
    },
    createOrGetLoyaltyMember(rawPhone, firstName, source, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, null, false); return; }
        const cleanName = (firstName || "Client").trim();
        const src = source || "qr_menu"; // 'qr_menu' | 'waiter_direct' | 'admin'

        const welcomePts = 50;
        const newMember = {
            phone: phone,
            firstName: cleanName,
            points: welcomePts,
            totalEarned: welcomePts,
            rewardsClaimed: 0,
            source: src,
            createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
            updatedAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };

        const tx = {
            phone: phone,
            type: "WELCOME",
            pointsDelta: welcomePts,
            amountDH: 0,
            validatedBy: src === "waiter_direct" ? "waiter" : (src === "admin" ? "admin" : "system"),
            note: "Cadeau de bienvenue (+50 pts offerts)",
            createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };

        const saveLocalFallback = (existing) => {
            const members = getLocalCollection("loyalty_members", []);
            let target = existing;
            if (!target) {
                target = {
                    ...newMember,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                const idx = members.findIndex(m => m.phone === phone);
                if (idx >= 0) members[idx] = target; else members.push(target);
                setLocalCollection("loyalty_members", members);

                const txs = getLocalCollection("loyalty_transactions", []);
                txs.push({ id: "tx_" + Date.now(), ...tx });
                setLocalCollection("loyalty_transactions", txs);
            }
            try {
                localStorage.setItem("gc_loyalty_phone", target.phone);
                localStorage.setItem("gc_loyalty_name", target.firstName);
                localStorage.setItem("gc_loyalty_pts", String(target.points || welcomePts));
            } catch(e) {}
            if (callback) callback(true, target, !existing);
        };

        whenAuthReady(() => {
            this.getLoyaltyMember(phone, (existing) => {
                if (existing) {
                    saveLocalFallback(existing);
                    return;
                }

                if (isFirebaseActive && db) {
                    db.collection("loyalty_members").doc(phone).set(newMember)
                        .then(() => db.collection("loyalty_transactions").add(tx))
                        .then(() => {
                            console.log(`👑 Membre fidélité créé : ${cleanName} (${phone}) +50 pts`);
                            const saved = { ...newMember, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                            saveLocalFallback(saved);
                        })
                        .catch(err => {
                            console.warn("⚠️ Erreur Firestore (quota/réseau) lors de la création membre fidélité:", err.message || err);
                            saveLocalFallback(null);
                        });
                } else {
                    saveLocalFallback(null);
                }
            });
        });
    },
    creditLoyaltyPoints(rawPhone, amountDH, tableNumber, validatedBy, orderId, callback) {
        if (typeof orderId === "function") {
            callback = orderId;
            orderId = null;
        }
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, "Numéro invalide"); return; }
        const amount = parseFloat(amountDH) || 0;
        const pointsToAdd = Math.max(1, Math.round(amount)); // 1 DH = 1 pt

        const tx = {
            phone: phone,
            type: "EARN",
            pointsDelta: pointsToAdd,
            amountDH: amount,
            tableNumber: tableNumber ? String(tableNumber) : "",
            orderId: orderId || "",
            validatedBy: validatedBy || "waiter",
            note: `Encaissement ${amount} DH (+${pointsToAdd} pts)`,
            createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };

        const updateLocal = () => {
            const members = getLocalCollection("loyalty_members", []);
            let idx = members.findIndex(m => m.phone === phone);
            let newTotal = pointsToAdd;
            if (idx >= 0) {
                members[idx].points = (members[idx].points || 0) + pointsToAdd;
                members[idx].totalEarned = (members[idx].totalEarned || 0) + pointsToAdd;
                members[idx].updatedAt = new Date().toISOString();
                newTotal = members[idx].points;
            } else {
                newTotal = 50 + pointsToAdd;
                members.push({
                    phone: phone,
                    firstName: "Client",
                    points: newTotal,
                    totalEarned: newTotal,
                    rewardsClaimed: 0,
                    source: "waiter_direct",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
            setLocalCollection("loyalty_members", members);

            const txs = getLocalCollection("loyalty_transactions", []);
            txs.push({ id: "tx_" + Date.now(), ...tx });
            setLocalCollection("loyalty_transactions", txs);

            try {
                if (localStorage.getItem("gc_loyalty_phone") === phone) {
                    localStorage.setItem("gc_loyalty_pts", String(newTotal));
                }
            } catch(e) {}

            if (callback) callback(true, pointsToAdd, newTotal);
        };

        if (isFirebaseActive && db) {
            whenAuthReady(() => {
                const memberRef = db.collection("loyalty_members").doc(phone);
                memberRef.update({
                    points: firebase.firestore.FieldValue.increment(pointsToAdd),
                    totalEarned: firebase.firestore.FieldValue.increment(pointsToAdd),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                })
                .then(() => db.collection("loyalty_transactions").add(tx))
                .then(() => {
                    if (orderId) {
                        db.collection("pre_orders").doc(orderId).update({ loyaltyCredited: true }).catch(() => {});
                    }
                    return memberRef.get();
                })
                .then(doc => {
                    updateLocal();
                })
                .catch(err => {
                    console.warn("⚠️ creditLoyaltyPoints Firestore error (repli local):", err.message || err);
                    updateLocal();
                });
            });
        } else {
            updateLocal();
        }
    },
    redeemLoyaltyReward(rawPhone, waiterName, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, "Numéro invalide"); return; }
        const cost = 500;

        const tx = {
            phone: phone,
            type: "REDEEM",
            pointsDelta: -cost,
            amountDH: 0,
            validatedBy: waiterName || "waiter",
            note: "Consommation gratuite offerte (-500 pts)",
            createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };

        const updateLocal = () => {
            const members = getLocalCollection("loyalty_members", []);
            const idx = members.findIndex(m => m.phone === phone);
            let resPts = 0;
            if (idx >= 0) {
                if ((members[idx].points || 0) < cost) {
                    if (callback) callback(false, "Solde insuffisant (minimum 500 pts)");
                    return;
                }
                members[idx].points = Math.max(0, (members[idx].points || 0) - cost);
                members[idx].rewardsClaimed = (members[idx].rewardsClaimed || 0) + 1;
                members[idx].updatedAt = new Date().toISOString();
                resPts = members[idx].points;
                setLocalCollection("loyalty_members", members);
            }
            const txs = getLocalCollection("loyalty_transactions", []);
            txs.push({ id: "tx_" + Date.now(), ...tx });
            setLocalCollection("loyalty_transactions", txs);

            try {
                if (localStorage.getItem("gc_loyalty_phone") === phone) {
                    localStorage.setItem("gc_loyalty_pts", String(resPts));
                }
            } catch(e) {}

            if (callback) callback(true, resPts);
        };

        if (isFirebaseActive && db) {
            whenAuthReady(() => {
                const memberRef = db.collection("loyalty_members").doc(phone);
                memberRef.get().then(doc => {
                    if (!doc.exists) { updateLocal(); return; }
                    const currentPts = doc.data().points || 0;
                    if (currentPts < cost) {
                        if (callback) callback(false, "Solde insuffisant (minimum 500 pts)");
                        return;
                    }
                    memberRef.update({
                        points: firebase.firestore.FieldValue.increment(-cost),
                        rewardsClaimed: firebase.firestore.FieldValue.increment(1),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    })
                    .then(() => db.collection("loyalty_transactions").add(tx))
                    .then(() => {
                        updateLocal();
                    })
                    .catch(err => {
                        console.warn("⚠️ redeemLoyaltyReward error (repli local):", err.message || err);
                        updateLocal();
                    });
                }).catch(err => {
                    console.warn("⚠️ redeemLoyaltyReward get error (repli local):", err.message || err);
                    updateLocal();
                });
            });
        } else {
            updateLocal();
        }
    },
    adjustLoyaltyPoints(rawPhone, delta, reason, adminName, callback) {
        const phone = normalizePhone(rawPhone);
        if (!phone) { if (callback) callback(false, "Numéro invalide"); return; }
        const pointsDelta = parseInt(delta) || 0;

        const tx = {
            phone: phone,
            type: "ADMIN_ADJUST",
            pointsDelta: pointsDelta,
            amountDH: 0,
            validatedBy: adminName || "admin",
            note: reason || `Ajustement manuel (${pointsDelta >= 0 ? "+" : ""}${pointsDelta} pts)`,
            createdAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };

        const updateLocal = () => {
            const members = getLocalCollection("loyalty_members", []);
            const idx = members.findIndex(m => m.phone === phone);
            let resPts = 0;
            if (idx >= 0) {
                members[idx].points = Math.max(0, (members[idx].points || 0) + pointsDelta);
                if (pointsDelta > 0) {
                    members[idx].totalEarned = (members[idx].totalEarned || 0) + pointsDelta;
                }
                members[idx].updatedAt = new Date().toISOString();
                resPts = members[idx].points;
                setLocalCollection("loyalty_members", members);
            }
            const txs = getLocalCollection("loyalty_transactions", []);
            txs.push({ id: "tx_" + Date.now(), ...tx });
            setLocalCollection("loyalty_transactions", txs);
            if (callback) callback(true, resPts);
        };

        if (isFirebaseActive && db) {
            whenAuthReady(() => {
                const memberRef = db.collection("loyalty_members").doc(phone);
                const updates = {
                    points: firebase.firestore.FieldValue.increment(pointsDelta),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                if (pointsDelta > 0) {
                    updates.totalEarned = firebase.firestore.FieldValue.increment(pointsDelta);
                }
                memberRef.update(updates)
                    .then(() => db.collection("loyalty_transactions").add(tx))
                    .then(() => memberRef.get())
                    .then(doc => updateLocal())
                    .catch(err => {
                        console.warn("⚠️ adjustLoyaltyPoints error (repli local):", err.message || err);
                        updateLocal();
                    });
            });
        } else {
            updateLocal();
        }
    },
    onAllLoyaltyMembersChange(callback) {
        const triggerLocal = () => {
            const members = getLocalCollection("loyalty_members", []);
            callback(members);
        };

        if (isFirebaseActive && db) {
            let unsub = () => {};
            whenAuthReady(() => {
                unsub = db.collection("loyalty_members")
                    .onSnapshot(snapshot => {
                        const list = [];
                        snapshot.forEach(doc => {
                            list.push({ phone: doc.id, ...doc.data() });
                        });
                        setLocalCollection("loyalty_members", list);
                        callback(list);
                    }, err => {
                        console.warn("⚠️ onAllLoyaltyMembersChange error (repli local):", err.message || err);
                        triggerLocal();
                    });
            });
            triggerLocal();
            return () => { try { unsub(); } catch(e) {} };
        } else {
            triggerLocal();
            this.registerSimListener(col => { if (col === "loyalty_members") triggerLocal(); });
            return () => {};
        }
    },
    getLoyaltyTransactions(rawPhone, callback) {
        const phone = normalizePhone(rawPhone);
        const triggerLocal = () => {
            let txs = getLocalCollection("loyalty_transactions", []);
            if (phone) {
                txs = txs.filter(t => t.phone === phone);
            }
            txs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            if (callback) callback(txs);
        };

        if (isFirebaseActive && db) {
            whenAuthReady(() => {
                let q = db.collection("loyalty_transactions");
                if (phone) {
                    q = q.where("phone", "==", phone);
                }
                q.limit(100).get().then(snapshot => {
                    const list = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        list.push({
                            id: doc.id,
                            ...data,
                            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : data.createdAt) : new Date().toISOString()
                        });
                    });
                    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    if (callback) callback(list);
                }).catch(err => {
                    console.warn("⚠️ getLoyaltyTransactions error (repli local):", err.message || err);
                    triggerLocal();
                });
            });
        } else {
            triggerLocal();
        }
    },
    onLoyaltySettingsChange(callback) {
        const triggerLocal = () => {
            const cfg = getLocalCollection("loyalty_settings", { rewardThreshold: 500, welcomeBonus: 50, pointsPerDH: 1 });
            callback(cfg);
        };

        if (isFirebaseActive && db) {
            let unsub = () => {};
            whenAuthReady(() => {
                unsub = db.collection("system").doc("loyalty_config")
                    .onSnapshot(doc => {
                        const data = doc.exists ? doc.data() : { rewardThreshold: 500, welcomeBonus: 50, pointsPerDH: 1 };
                        setLocalCollection("loyalty_settings", data);
                        callback(data);
                    }, err => {
                        console.warn("⚠️ onLoyaltySettingsChange error (repli local):", err.message || err);
                        triggerLocal();
                    });
            });
            triggerLocal();
            return () => { try { unsub(); } catch(e) {} };
        } else {
            triggerLocal();
            this.registerSimListener(col => { if (col === "loyalty_settings") triggerLocal(); });
            return () => {};
        }
    },
    setLoyaltySettings(settings, callback) {
        const data = {
            rewardThreshold: parseInt(settings.rewardThreshold) || 500,
            welcomeBonus: parseInt(settings.welcomeBonus) || 50,
            pointsPerDH: parseFloat(settings.pointsPerDH) || 1,
            updatedAt: isFirebaseActive ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        };
        setLocalCollection("loyalty_settings", data);

        if (isFirebaseActive && db) {
            whenAuthReady(() => {
                db.collection("system").doc("loyalty_config").set(data, { merge: true })
                    .then(() => { if (callback) callback(true); })
                    .catch(err => {
                        console.warn("⚠️ setLoyaltySettings error:", err.message || err);
                        if (callback) callback(true);
                    });
            });
        } else {
            if (callback) callback(true);
        }
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

if (!isFirebaseActive) {
    dbService.initSimBroadcastListener();
}

console.log(isFirebaseActive ? "🔥 CLOUD MODE" : "🧪 SIMULATION MODE");

window.isFirebaseActive = isFirebaseActive;
window.db = db;
window.whenAuthReady = whenAuthReady;
window.dbService = dbService;
window.getTableZoneName = getTableZoneName;
window.normalizePhone = normalizePhone;
