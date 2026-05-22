/**
 * ============================================================================
 * GREY CORNER — FIREBASE CONFIGURATION & DUAL-MODE SERVICE LAYER
 * ============================================================================
 * COMPLETE FIXED VERSION
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

    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get("sim") === "true") {
        console.log("ℹ️ Simulation Mode forced");
        return false;
    }

    return firebaseConfig.apiKey &&
        firebaseConfig.projectId;
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
    {
        id: "karim",
        name: "Karim",
        email: "karim@greycorner.com",
        active: true
    },
    {
        id: "yassine",
        name: "Yassine",
        email: "yassine@greycorner.com",
        active: true
    }
];

const DEFAULT_TABLES = {};

for (let i = 1; i <= 24; i++) {

    DEFAULT_TABLES[i] = {
        tableNumber: i,
        assignedTo:
            i <= 8
                ? "karim"
                : i <= 16
                    ? "yassine"
                    : "",
        active: true
    };
}

// ============================================================================
// LOCAL STORAGE HELPERS
// ============================================================================

function getLocalCollection(name, defaultVal = []) {

    const val = localStorage.getItem(`sim_${name}`);

    if (!val) {

        localStorage.setItem(
            `sim_${name}`,
            JSON.stringify(defaultVal)
        );

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

    localStorage.setItem(
        `sim_${name}`,
        JSON.stringify(data)
    );

    if (simBroadcast) {

        simBroadcast.postMessage({
            type: "SYNC",
            collection: name,
            data: data
        });
    }

    if (typeof dbService !== "undefined") {

        dbService._simListeners.forEach(listener => {

            try {

                listener(name, data);

            } catch (e) {

                console.error(e);
            }
        });
    }
}

// ============================================================================
// INIT LOCAL STORAGE
// ============================================================================

if (!isFirebaseActive) {

    getLocalCollection("servers", DEFAULT_WAITERS);

    getLocalCollection("tables", DEFAULT_TABLES);

    getLocalCollection("calls", []);

    getLocalCollection("pre_orders", []);

    getLocalCollection("system_config", {
        frozen: false
    });
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

    // =========================================================================
    // MODE
    // =========================================================================

    isCloud() {
        return isFirebaseActive;
    },

    // =========================================================================
    // LISTENERS
    // =========================================================================

    _simListeners: [],

    registerSimListener(callback) {
        this._simListeners.push(callback);
    },

    initSimBroadcastListener() {

        if (!simBroadcast) return;

        simBroadcast.onmessage = (event) => {

            if (
                event.data &&
                event.data.type === "SYNC"
            ) {

                localStorage.setItem(
                    `sim_${event.data.collection}`,
                    JSON.stringify(event.data.data)
                );

                this._simListeners.forEach(listener => {

                    listener(
                        event.data.collection,
                        event.data.data
                    );
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

                    snapshot.forEach(doc => {

                        waiters.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    });

                    callback(waiters);
                }, err => {
                    console.error("❌ Servers stream error:", err);
                });

        } else {

            callback(
                getLocalCollection("servers")
            );

            this.registerSimListener((collection, data) => {

                if (collection === "servers") {
                    callback(data);
                }
            });

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

                    snapshot.forEach(doc => {

                        tables[doc.id] = {
                            tableNumber: parseInt(doc.id),
                            ...doc.data()
                        };
                    });

                    callback(tables);
                }, err => {
                    console.error("❌ Tables stream error:", err);
                });

        } else {

            callback(
                getLocalCollection("tables")
            );

            this.registerSimListener((collection, data) => {

                if (collection === "tables") {
                    callback(data);
                }
            });

            return () => { };
        }
    },

    assignTable(tableId, waiterId, callback) {

        const data = {
            tableNumber: parseInt(tableId),
            assignedTo: waiterId,
            active: true,
            lastUpdated: isFirebaseActive
                ? firebase.firestore.FieldValue.serverTimestamp()
                : new Date().toISOString()
        };

        if (isFirebaseActive) {

            db.collection("tables")
                .doc(String(tableId))
                .set(data, { merge: true })

                .then(() => {

                    if (callback) callback(true);

                })

                .catch(e => {

                    console.error(e);

                    if (callback) callback(false);
                });

        } else {

            const tables =
                getLocalCollection("tables");

            tables[tableId] = data;

            setLocalCollection("tables", tables);

            if (callback) callback(true);
        }
    },

    // =========================================================================
    // CALLS
    // =========================================================================

    sendCall(tableId, type, callback) {

        const execute = (waiterId) => {

            const data = {
                table: parseInt(tableId),
                assignedTo: waiterId || "",
                type: type,
                status: "pending",
                createdAt: isFirebaseActive
                    ? firebase.firestore.FieldValue.serverTimestamp()
                    : new Date().toISOString(),
                acceptedAt: null,
                completedAt: null
            };

            if (isFirebaseActive) {

                db.collection("waiter_calls")
                    .add(data)

                    .then(docRef => {
                        const zoneName = getTableZoneName(tableId);
                        const typeLabels = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition" };
                        const typeLabel = typeLabels[type] || "Appel";
                        const alertTitle = `🔔 Nouveau Appel : ${zoneName} ${tableId}`;
                        const alertBody = `Demande : ${typeLabel}`;
                        sendFcmToWaiters("WAITER_CALL", alertTitle, alertBody, tableId, docRef.id);

                        if (callback) {
                            callback(true, docRef.id);
                        }
                    })

                    .catch(e => {

                        console.error(e);

                        if (callback) callback(false);
                    });

            } else {

                const calls =
                    getLocalCollection("calls");

                const id =
                    "call_" +
                    Math.random()
                        .toString(36)
                        .substring(2, 9);

                calls.push({
                    id,
                    ...data
                });

                setLocalCollection("calls", calls);

                if (callback) callback(true, id);
            }
        };

        if (isFirebaseActive) {

            db.collection("tables")
                .doc(String(tableId))
                .get()

                .then(doc => {

                    const waiterId =
                        doc.exists
                            ? doc.data().assignedTo
                            : "";

                    execute(waiterId);
                })

                .catch(() => execute(""));

        } else {

            const tables =
                getLocalCollection("tables");

            execute(
                tables[tableId]
                    ? tables[tableId].assignedTo
                    : ""
            );
        }
    },

    onCallsChange(callback) {

        if (isFirebaseActive) {

            return db.collection("waiter_calls")
                .orderBy("createdAt", "desc")
                .onSnapshot(snapshot => {

                    const calls = [];

                    snapshot.forEach(doc => {

                        const data = doc.data();

                        calls.push({
                            id: doc.id,
                            ...data,
                            createdAt:
                                data.createdAt
                                    ? (typeof data.createdAt.toDate === "function"
                                        ? data.createdAt.toDate().toISOString()
                                        : data.createdAt)
                                    : new Date().toISOString()
                        });
                    });

                    callback(calls);
                }, err => {
                    console.error("❌ Calls stream error:", err);
                });

        } else {

            const trigger = () => {

                const calls =
                    getLocalCollection("calls");

                calls.sort(
                    (a, b) =>
                        new Date(b.createdAt) -
                        new Date(a.createdAt)
                );

                callback(calls);
            };

            trigger();

            this.registerSimListener(collection => {

                if (collection === "calls") {
                    trigger();
                }
            });

            return () => { };
        }
    },

    updateCallStatus(callId, status, waiterId, callback) {

        if (typeof waiterId === "function") {
            callback = waiterId;
            waiterId = null;
        }

        const updateData = {
            status: status,
            acceptedAt:
                status === "accepted"
                    ? isFirebaseActive
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : new Date().toISOString()
                    : null,

            completedAt:
                status === "completed"
                    ? isFirebaseActive
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : new Date().toISOString()
                    : null
        };

        if (waiterId) {
            updateData.assignedTo = waiterId;
        }

        if (isFirebaseActive) {

            db.collection("waiter_calls")
                .doc(callId)
                .update(updateData)

                .then(() => {

                    if (callback) callback(true);

                })

                .catch(e => {

                    console.error(e);

                    if (callback) callback(false);
                });

        } else {

            const calls =
                getLocalCollection("calls");

            const idx =
                calls.findIndex(c => c.id === callId);

            if (idx !== -1) {

                calls[idx] = {
                    ...calls[idx],
                    ...updateData
                };

                setLocalCollection("calls", calls);

                if (callback) callback(true);

            } else {

                if (callback) callback(false);
            }
        }
    },

    // =========================================================================
    // PRE-ORDERS
    // =========================================================================

    sendPreOrder(tableId, items, note, totalPrice, callback) {

        const execute = (waiterId) => {

            const data = {
                table: parseInt(tableId),
                assignedTo: waiterId || "",
                items: items,
                note: note || "",
                totalPrice: parseFloat(totalPrice),
                status: "pending",
                createdAt: isFirebaseActive
                    ? firebase.firestore.FieldValue.serverTimestamp()
                    : new Date().toISOString(),
                acceptedAt: null
            };

            if (isFirebaseActive) {

                db.collection("pre_orders")
                    .add(data)

                    .then(docRef => {
                        // Envoyer un push FCM unique aux serveurs depuis le client
                        const zoneName = getTableZoneName(tableId);
                        const alertTitle = `👨‍🍳 Nouvelle Précommande : ${zoneName} ${tableId}`;
                        const alertBody = `Total : ${totalPrice} MAD`;
                        sendFcmToWaiters("PRE_ORDER", alertTitle, alertBody, tableId, docRef.id);

                        if (callback) {
                            callback(true, docRef.id);
                        }
                    })

                    .catch(e => {

                        console.error(e);

                        if (callback) callback(false);
                    });

            } else {

                const orders =
                    getLocalCollection("pre_orders");

                const id =
                    "order_" +
                    Math.random()
                        .toString(36)
                        .substring(2, 9);

                orders.push({
                    id,
                    ...data
                });

                setLocalCollection("pre_orders", orders);

                if (callback) callback(true, id);
            }
        };

        if (isFirebaseActive) {

            db.collection("tables")
                .doc(String(tableId))
                .get()

                .then(doc => {

                    const waiterId =
                        doc.exists
                            ? doc.data().assignedTo
                            : "";

                    execute(waiterId);
                })

                .catch(() => execute(""));

        } else {

            const tables =
                getLocalCollection("tables");

            execute(
                tables[tableId]
                    ? tables[tableId].assignedTo
                    : ""
            );
        }
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
                            createdAt:
                                data.createdAt
                                    ? (typeof data.createdAt.toDate === "function"
                                        ? data.createdAt.toDate().toISOString()
                                        : data.createdAt)
                                    : new Date().toISOString()
                        });
                    });

                    callback(orders);
                }, err => {
                    console.error("❌ PreOrders stream error:", err);
                });

        } else {

            const trigger = () => {

                const orders =
                    getLocalCollection("pre_orders");

                orders.sort(
                    (a, b) =>
                        new Date(b.createdAt) -
                        new Date(a.createdAt)
                );

                callback(orders);
            };

            trigger();

            this.registerSimListener(collection => {

                if (collection === "pre_orders") {
                    trigger();
                }
            });

            return () => { };
        }
    },

    updatePreOrderStatus(orderId, status, waiterId, callback) {

        if (typeof waiterId === "function") {
            callback = waiterId;
            waiterId = null;
        }

        const updateData = {
            status: status,
            acceptedAt:
                status === "accepted"
                    ? isFirebaseActive
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : new Date().toISOString()
                    : null
        };

        if (waiterId) {
            updateData.assignedTo = waiterId;
        }

        if (isFirebaseActive) {

            db.collection("pre_orders")
                .doc(orderId)
                .update(updateData)

                .then(() => {

                    if (callback) callback(true);

                })

                .catch(e => {

                    console.error(e);

                    if (callback) callback(false);
                });

        } else {

            const orders =
                getLocalCollection("pre_orders");

            const idx =
                orders.findIndex(o => o.id === orderId);

            if (idx !== -1) {

                orders[idx] = {
                    ...orders[idx],
                    ...updateData
                };

                setLocalCollection("pre_orders", orders);

                if (callback) callback(true);

            } else {

                if (callback) callback(false);
            }
        }
    },

    // =========================================================================
    // FREEZE SYSTEM
    // =========================================================================

    onSystemFreezeChange(callback) {

        if (isFirebaseActive) {

            return db.collection("system")
                .doc("config")
                .onSnapshot(doc => {

                    const frozen =
                        doc.exists &&
                        doc.data() &&
                        doc.data().frozen === true;

                    callback(frozen);
                }, err => {
                    console.error("❌ SystemFreeze stream error:", err);
                });

        } else {

            const trigger = () => {

                const config =
                    getLocalCollection(
                        "system_config",
                        { frozen: false }
                    );

                callback(config.frozen === true);
            };

            trigger();

            this.registerSimListener(collection => {

                if (collection === "system_config") {
                    trigger();
                }
            });

            return () => { };
        }
    },

    setSystemFreeze(frozen, callback) {

        console.log("🧊 Freeze State:", frozen);

        if (isFirebaseActive) {

            db.collection("system")
                .doc("config")
                .set({
                    frozen: frozen,
                    updatedAt:
                        firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true })

                .then(() => {

                    console.log("✅ Freeze Updated");

                    if (callback) callback(true);

                })

                .catch(e => {

                    console.error(
                        "❌ Freeze Error:",
                        e
                    );

                    if (callback) callback(false, e.message || String(e));
                });

        } else {

            setLocalCollection(
                "system_config",
                {
                    frozen: frozen,
                    updatedAt:
                        new Date().toISOString()
                }
            );

            console.log("✅ Local Freeze Updated");

            if (callback) callback(true);
        }
    },

    // =========================================================================
    // CLEANUP
    // =========================================================================

    cleanupOldData(callback) {

        const cutoff =
            new Date(
                Date.now() -
                24 * 60 * 60 * 1000
            );

        if (isFirebaseActive) {

            db.collection("waiter_calls")
                .where("createdAt", "<", cutoff)
                .get()

                .then(snapshot => {

                    const batch = db.batch();

                    snapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });

                    return batch.commit();
                })

                .then(() => {

                    return db.collection("pre_orders")
                        .where("createdAt", "<", cutoff)
                        .get();
                })

                .then(snapshot => {

                    const batch = db.batch();

                    snapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });

                    return batch.commit();
                })

                .then(() => {

                    if (callback) callback(true);

                })

                .catch(e => {

                    console.error(e);

                    if (callback) callback(false);
                });

        } else {

            const calls =
                getLocalCollection("calls")
                    .filter(
                        c =>
                            new Date(c.createdAt) >= cutoff
                    );

            setLocalCollection("calls", calls);

            const orders =
                getLocalCollection("pre_orders")
                    .filter(
                        o =>
                            new Date(o.createdAt) >= cutoff
                    );

            setLocalCollection("pre_orders", orders);

            if (callback) callback(true);
        }
    }
};

// ============================================================================
// INIT SIMULATION LISTENER
// ============================================================================

if (!isFirebaseActive) {
    dbService.initSimBroadcastListener();
}

console.log(
    isFirebaseActive
        ? "🔥 CLOUD MODE"
        : "🧪 SIMULATION MODE"
);