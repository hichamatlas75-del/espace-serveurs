/**
 * ============================================================================
 * GREY CORNER — CLOUDFLARE D1 BACKEND API (CATCH-ALL ROUTE)
 * Base de données serverless relationnelle SQLite hébergée à l'Edge Cloudflare
 * Quota : 5 000 000 de lectures gratuites / jour (vs 50 000 sur Firebase)
 * ============================================================================
 */

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400"
};

const FCM_WORKER_URL = "https://greycorner-fcm.hichamatlas75.workers.dev";
const FCM_SECRET = "greycorner_secure_2026";

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json; charset=utf-8"
        }
    });
}

function errorResponse(message, status = 400, extra = {}) {
    return jsonResponse({ error: message, message, success: false, ...extra }, status);
}

// Normalisation des numéros de téléphone (marocain: 06... / 07...)
function normalizePhone(raw) {
    if (!raw) return "";
    let clean = String(raw).replace(/[^\d+]/g, "").trim();
    if (clean.startsWith("+2120")) clean = clean.substring(4);
    else if (clean.startsWith("+212")) clean = "0" + clean.substring(4);
    else if (clean.startsWith("002120")) clean = clean.substring(5);
    else if (clean.startsWith("00212")) clean = "0" + clean.substring(5);
    else if (clean.startsWith("2120") && clean.length >= 12) clean = clean.substring(3);
    else if (clean.startsWith("212") && clean.length >= 11) clean = "0" + clean.substring(3);
    clean = clean.replace(/\D/g, "");
    if (clean.length === 9 && (clean.startsWith("6") || clean.startsWith("7") || clean.startsWith("5"))) {
        clean = "0" + clean;
    }
    return clean;
}

// Calcul des Paliers VIP Grey Corner basés sur le cumul à vie (totalEarned)
// Règle d'or : Les paliers dépendent UNIQUEMENT de totalEarned, donc dépenser des points ne rétrograde JAMAIS le client !
function getVipTier(totalEarned) {
    const earned = Math.max(0, parseInt(totalEarned, 10) || 0);
    if (earned >= 1000) {
        return {
            id: "platine",
            name: "Platine VIP",
            icon: "💎",
            ratio: 1.5,
            bonusLabel: "+50% pts (x1.5)",
            badgeClass: "vip-platine",
            threshold: 1000,
            nextTier: null,
            ptsToNext: 0
        };
    }
    if (earned >= 500) {
        return {
            id: "gold",
            name: "Gold VIP",
            icon: "🥇",
            ratio: 1.25,
            bonusLabel: "+25% pts (x1.25)",
            badgeClass: "vip-gold",
            threshold: 500,
            nextTier: "Platine VIP",
            ptsToNext: 1000 - earned
        };
    }
    if (earned >= 200) {
        return {
            id: "silver",
            name: "Silver VIP",
            icon: "🥈",
            ratio: 1.1,
            bonusLabel: "+10% pts (x1.1)",
            badgeClass: "vip-silver",
            threshold: 200,
            nextTier: "Gold VIP",
            ptsToNext: 500 - earned
        };
    }
    return {
        id: "bronze",
        name: "Bronze",
        icon: "🥉",
        ratio: 1.0,
        bonusLabel: "Standard (x1.0)",
        badgeClass: "vip-bronze",
        threshold: 0,
        nextTier: "Silver VIP",
        ptsToNext: 200 - earned
    };
}

// Générateur d'identifiant unique
function generateId(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

// Déclencheur FCM asynchrone sans bloquer la requête
function dispatchFcmNotification(env, type, title, body, tableId, docId) {
    try {
        fetch(FCM_WORKER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${FCM_SECRET}`
            },
            body: JSON.stringify({
                type,
                title,
                body,
                table: String(tableId),
                tableId: String(tableId),
                docId: String(docId)
            })
        }).catch(e => console.warn("FCM Dispatch Warning:", e));
    } catch (e) {
        console.warn("FCM Dispatch Warning:", e);
    }
}

// Initialisation automatique et résiliente des tables D1
let isDbInitialized = false;

const DB_SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY,
        zone TEXT NOT NULL,
        assignedTo TEXT DEFAULT '',
        status TEXT DEFAULT 'libre',
        active INTEGER DEFAULT 1,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS waiters_calls (
        id TEXT PRIMARY KEY,
        tableNum INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assignedTo TEXT DEFAULT '',
        loyaltyPhone TEXT DEFAULT '',
        loyaltyName TEXT DEFAULT '',
        note TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        acceptedAt TEXT,
        completedAt TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_calls_status ON waiters_calls(status, createdAt)`,
    `CREATE TABLE IF NOT EXISTS pre_orders (
        id TEXT PRIMARY KEY,
        tableNum INTEGER NOT NULL,
        items TEXT NOT NULL,
        note TEXT DEFAULT '',
        totalPrice REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        assignedTo TEXT DEFAULT '',
        loyaltyPhone TEXT DEFAULT '',
        loyaltyName TEXT DEFAULT '',
        loyaltyPoints INTEGER DEFAULT NULL,
        loyaltyCredited INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        acceptedAt TEXT,
        completedAt TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON pre_orders(status, createdAt)`,
    `CREATE TABLE IF NOT EXISTS loyalty_members (
        phone TEXT PRIMARY KEY,
        firstName TEXT NOT NULL,
        points INTEGER DEFAULT 20,
        totalEarned INTEGER DEFAULT 20,
        rewardsClaimed INTEGER DEFAULT 0,
        source TEXT DEFAULT 'qr_menu',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        type TEXT NOT NULL,
        pointsDelta INTEGER NOT NULL,
        amountDH REAL DEFAULT 0,
        tableNumber TEXT DEFAULT '',
        orderId TEXT DEFAULT '',
        validatedBy TEXT DEFAULT 'waiter',
        note TEXT DEFAULT '',
        createdAt TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tx_phone ON loyalty_transactions(phone, createdAt)`,
    `CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )`
];

async function ensureDb(db) {
    if (isDbInitialized) return;
    try {
        for (const sql of DB_SCHEMA_STATEMENTS) {
            await db.prepare(sql).run();
        }

        // Peupler les 24 tables par défaut si la table est vide
        const countRes = await db.prepare("SELECT COUNT(*) as count FROM tables").first();
        if (!countRes || countRes.count === 0) {
            const defaultTables = [
                // Salon : 101 -> 112
                { id: 101, zone: "salon" }, { id: 102, zone: "salon" }, { id: 103, zone: "salon" },
                { id: 104, zone: "salon" }, { id: 105, zone: "salon" }, { id: 106, zone: "salon" },
                { id: 107, zone: "salon" }, { id: 108, zone: "salon" }, { id: 109, zone: "salon" },
                { id: 110, zone: "salon" }, { id: 111, zone: "salon" }, { id: 112, zone: "salon" },
                // Loge : 201 -> 206
                { id: 201, zone: "loge" }, { id: 202, zone: "loge" }, { id: 203, zone: "loge" },
                { id: 204, zone: "loge" }, { id: 205, zone: "loge" }, { id: 206, zone: "loge" },
                // Terrasse : 301 -> 306
                { id: 301, zone: "terrasse" }, { id: 302, zone: "terrasse" }, { id: 303, zone: "terrasse" },
                { id: 304, zone: "terrasse" }, { id: 305, zone: "terrasse" }, { id: 306, zone: "terrasse" }
            ];
            const inserts = defaultTables.map(t => 
                db.prepare("INSERT OR IGNORE INTO tables (id, zone, assignedTo, status, active) VALUES (?, ?, '', 'libre', 1)")
                  .bind(t.id, t.zone)
            );
            await db.batch(inserts);
        }

        // Configuration par défaut
        await db.prepare("INSERT OR IGNORE INTO system_config (key, value, updatedAt) VALUES (?, ?, ?)")
            .bind("loyalty_config", JSON.stringify({ rewardThreshold: 500, welcomeBonus: 20, pointsPerDH: 1 }), new Date().toISOString())
            .run();
        await db.prepare("INSERT OR IGNORE INTO system_config (key, value, updatedAt) VALUES (?, ?, ?)")
            .bind("system_frozen", "false", new Date().toISOString())
            .run();

        isDbInitialized = true;
    } catch (e) {
        console.error("D1 Auto-Init Error:", e);
    }
}

// ── ROUTEUR PRINCIPAL HTTP ───────────────────────────────────────────────────
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // Gérer les requêtes CORS préliminaires (OPTIONS)
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const db = env.DB;
    if (!db) {
        return errorResponse("Binding Cloudflare D1 'DB' manquant dans les réglages du projet Pages.", 500);
    }

    await ensureDb(db);

    // Chemin normalisé relatif à /api/
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const segments = path.split("/").filter(Boolean);

    try {
        // Racine /api
        if (!path) {
            return jsonResponse({
                success: true,
                service: "Grey Corner Cloudflare D1 API",
                version: "2.0.0",
                engine: "Cloudflare D1 + Pages Functions",
                quotaTier: "5,000,000 reads/day free"
            });
        }

        // ── 0. Initialisation explicite de la base ────────────────────────────
        if (path === "init-db") {
            isDbInitialized = false;
            const log = [];
            for (let i = 0; i < DB_SCHEMA_STATEMENTS.length; i++) {
                const sql = DB_SCHEMA_STATEMENTS[i];
                try {
                    await db.prepare(sql).run();
                    log.push({ step: i + 1, status: "OK" });
                } catch (e) {
                    log.push({ step: i + 1, status: "ERROR", error: e.message, sql: sql.substring(0, 50) });
                }
            }
            await ensureDb(db);
            return jsonResponse({ success: true, message: "Exécution du schéma D1 terminée.", log });
        }

        // ── 1. SYNCHRONISATION TEMPS RÉEL (Pour serveurs & admin) ────────────
        if (path === "sync" && request.method === "GET") {
            // Récupère les appels en cours ou récents (max 25)
            const callsStmt = db.prepare("SELECT * FROM waiters_calls ORDER BY createdAt DESC LIMIT 25");
            // Récupère les précommandes du jour ou récentes (max 35)
            const ordersStmt = db.prepare("SELECT * FROM pre_orders ORDER BY createdAt DESC LIMIT 35");
            // Récupère toutes les tables
            const tablesStmt = db.prepare("SELECT * FROM tables ORDER BY id ASC");
            // Récupère la config
            const configStmt = db.prepare("SELECT * FROM system_config");

            const [callsRes, ordersRes, tablesRes, configRes] = await db.batch([callsStmt, ordersStmt, tablesStmt, configStmt]);

            const tablesObj = {};
            (tablesRes.results || []).forEach(t => {
                tablesObj[t.id] = { tableNumber: t.id, zone: t.zone, assignedTo: t.assignedTo || "", status: t.status || "libre" };
            });

            const parsedOrders = (ordersRes.results || []).map(o => {
                let items = [];
                try { items = typeof o.items === "string" ? JSON.parse(o.items) : o.items; } catch(e) {}
                return { ...o, table: o.tableNum, items, loyaltyCredited: Boolean(o.loyaltyCredited) };
            });

            const parsedCalls = (callsRes.results || []).map(c => ({
                ...c,
                table: c.tableNum
            }));

            let frozen = false;
            let loyaltyConfig = { rewardThreshold: 500, welcomeBonus: 20, pointsPerDH: 1 };
            (configRes.results || []).forEach(c => {
                if (c.key === "system_frozen") frozen = (c.value === "true");
                if (c.key === "loyalty_config") {
                    try { loyaltyConfig = JSON.parse(c.value); } catch(e) {}
                }
            });

            return jsonResponse({
                success: true,
                calls: parsedCalls,
                orders: parsedOrders,
                tables: tablesObj,
                frozen,
                loyaltyConfig,
                serverTime: new Date().toISOString()
            });
        }

        // ── 2. APPELS CLIENTS (/api/calls) ──────────────────────────────────
        if (segments[0] === "calls") {
            // GET /api/calls
            if (request.method === "GET") {
                const { results } = await db.prepare("SELECT * FROM waiters_calls ORDER BY createdAt DESC LIMIT 30").all();
                const calls = (results || []).map(c => ({ ...c, table: c.tableNum }));
                return jsonResponse({ success: true, calls });
            }

            // POST /api/calls
            if (request.method === "POST" && segments.length === 1) {
                const body = await request.json();
                const tableNum = parseInt(body.table || body.tableNum, 10);
                if (!tableNum) return errorResponse("Numéro de table manquant.");

                // Récupérer le serveur assigné à cette table
                const tableRow = await db.prepare("SELECT assignedTo, zone FROM tables WHERE id = ?").bind(tableNum).first();
                const assignedTo = tableRow ? (tableRow.assignedTo || "") : "";
                const zoneName = tableRow ? tableRow.zone : "Salon";

                const id = body.id || generateId("call");
                const type = body.type || "waiter";
                let loyaltyPhone = normalizePhone(body.loyaltyPhone || "");
                let loyaltyName = body.loyaltyName || "";
                const note = body.note || "";
                const createdAt = body.createdAt || new Date().toISOString();

                // Le numéro de téléphone est le SEUL repère pour identifier le client
                if (loyaltyPhone) {
                    const suffix9 = loyaltyPhone.length >= 9 ? loyaltyPhone.slice(-9) : loyaltyPhone;
                    const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(loyaltyPhone, `%${suffix9}`).first();
                    if (member) {
                        loyaltyPhone = member.phone;
                        if (member.firstName) loyaltyName = member.firstName;
                    }
                }

                await db.prepare(`
                    INSERT INTO waiters_calls (id, tableNum, type, status, assignedTo, loyaltyPhone, loyaltyName, note, createdAt)
                    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
                `).bind(id, tableNum, type, assignedTo, loyaltyPhone, loyaltyName, note, createdAt).run();

                // Notification push native FCM
                const typeLabels = { waiter: "Appel Serveur", water: "Besoin d'Eau", bill: "L'Addition", reward: "🎁 Consommation Gratuite (500 pts)" };
                const label = typeLabels[type] || "Appel";
                dispatchFcmNotification(env, "CALL", `🔔 ${label} : Table ${tableNum} (${zoneName})`, `Assistance demandée`, tableNum, id);

                return jsonResponse({ success: true, id, call: { id, table: tableNum, type, status: "pending", createdAt } });
            }

            // PATCH /api/calls/:id (ou POST/PUT pour compatibilité)
            if ((request.method === "PATCH" || request.method === "POST" || request.method === "PUT") && segments.length === 2) {
                const callId = segments[1];
                const body = await request.json();
                const status = body.status;
                const waiterId = body.waiterId || "";
                const now = new Date().toISOString();

                if (status === "accepted") {
                    await db.prepare("UPDATE waiters_calls SET status = ?, assignedTo = ?, acceptedAt = ? WHERE id = ?")
                        .bind(status, waiterId, now, callId).run();
                    dispatchFcmNotification(env, "CANCEL_ALERT", "Appel pris en charge", "Pris en charge", 0, callId);
                } else if (status === "completed") {
                    await db.prepare("UPDATE waiters_calls SET status = ?, completedAt = ? WHERE id = ?")
                        .bind(status, now, callId).run();
                    dispatchFcmNotification(env, "CANCEL_ALERT", "Appel terminé", "Terminé", 0, callId);
                } else {
                    await db.prepare("UPDATE waiters_calls SET status = ? WHERE id = ?")
                        .bind(status, callId).run();
                }

                return jsonResponse({ success: true, id: callId, status });
            }
        }

        // ── 3. PRÉCOMMANDES (/api/orders) ───────────────────────────────────
        if (segments[0] === "orders") {
            // GET /api/orders
            if (request.method === "GET") {
                const { results } = await db.prepare("SELECT * FROM pre_orders ORDER BY createdAt DESC LIMIT 50").all();
                const orders = (results || []).map(o => {
                    let items = [];
                    try { items = typeof o.items === "string" ? JSON.parse(o.items) : o.items; } catch(e) {}
                    return { ...o, table: o.tableNum, items, loyaltyCredited: Boolean(o.loyaltyCredited) };
                });
                return jsonResponse({ success: true, orders });
            }

            // POST /api/orders
            if (request.method === "POST" && segments.length === 1) {
                const body = await request.json();
                const tableNum = parseInt(body.table || body.tableNum, 10);
                if (!tableNum) return errorResponse("Numéro de table manquant.");

                const tableRow = await db.prepare("SELECT assignedTo, zone FROM tables WHERE id = ?").bind(tableNum).first();
                const assignedTo = tableRow ? (tableRow.assignedTo || "") : "";
                const zoneName = tableRow ? tableRow.zone : "Salon";

                const id = body.id || generateId("order");
                const itemsStr = typeof body.items === "string" ? body.items : JSON.stringify(body.items || []);
                const note = body.note || "";
                const totalPrice = parseFloat(body.totalPrice) || 0;
                let loyaltyPhone = normalizePhone(body.loyaltyPhone || "");
                let loyaltyName = body.loyaltyName || "";
                let loyaltyPoints = typeof body.loyaltyPoints === "number" ? body.loyaltyPoints : null;
                const createdAt = body.createdAt || new Date().toISOString();

                // Le numéro de téléphone est le SEUL repère pour identifier le client : on rattache le compte officiel
                if (loyaltyPhone) {
                    const suffix9 = loyaltyPhone.length >= 9 ? loyaltyPhone.slice(-9) : loyaltyPhone;
                    const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(loyaltyPhone, `%${suffix9}`).first();
                    if (member) {
                        loyaltyPhone = member.phone;
                        loyaltyName = member.firstName || loyaltyName || "Client";
                        loyaltyPoints = member.points;
                    }
                }

                await db.prepare(`
                    INSERT INTO pre_orders (id, tableNum, items, note, totalPrice, status, assignedTo, loyaltyPhone, loyaltyName, loyaltyPoints, loyaltyCredited, createdAt)
                    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?)
                `).bind(id, tableNum, itemsStr, note, totalPrice, assignedTo, loyaltyPhone, loyaltyName, loyaltyPoints, createdAt).run();

                // Notification push native FCM
                let itemsSummary = "";
                try {
                    const parsed = JSON.parse(itemsStr);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        itemsSummary = parsed.slice(0, 3).map(it => `${it.qty || 1}x ${it.name_lang || it.name || "Article"}`).join(", ");
                        if (parsed.length > 3) itemsSummary += ` (+${parsed.length - 3})`;
                        itemsSummary += " • ";
                    }
                } catch(e) {}
                dispatchFcmNotification(env, "PRE_ORDER", `👨‍🍳 Nouvelle Précommande : Table ${tableNum} (${zoneName})`, `${itemsSummary}Total : ${totalPrice} MAD`, tableNum, id);

                return jsonResponse({ success: true, id, order: { id, table: tableNum, totalPrice, status: "pending", createdAt } });
            }

            // PATCH /api/orders/:id (ou POST/PUT pour compatibilité)
            if ((request.method === "PATCH" || request.method === "POST" || request.method === "PUT") && segments.length === 2) {
                const orderId = segments[1];
                const body = await request.json();
                const now = new Date().toISOString();

                if (body.loyaltyCredited !== undefined) {
                    await db.prepare("UPDATE pre_orders SET loyaltyCredited = ? WHERE id = ?")
                        .bind(body.loyaltyCredited ? 1 : 0, orderId).run();
                }

                if (body.status) {
                    if (body.status === "accepted") {
                        await db.prepare("UPDATE pre_orders SET status = ?, assignedTo = ?, acceptedAt = ? WHERE id = ?")
                            .bind(body.status, body.waiterId || "", now, orderId).run();
                        dispatchFcmNotification(env, "CANCEL_ALERT", "Commande validée", "Validée", 0, orderId);
                    } else if (body.status === "completed") {
                        await db.prepare("UPDATE pre_orders SET status = ?, completedAt = ? WHERE id = ?")
                            .bind(body.status, now, orderId).run();
                        dispatchFcmNotification(env, "CANCEL_ALERT", "Commande servie", "Servie", 0, orderId);
                    } else {
                        await db.prepare("UPDATE pre_orders SET status = ? WHERE id = ?")
                            .bind(body.status, orderId).run();
                    }
                }

                return jsonResponse({ success: true, id: orderId });
            }
        }

        // ── 4. GESTION DES TABLES (/api/tables) ──────────────────────────────
        if (segments[0] === "tables") {
            // GET /api/tables
            if (request.method === "GET") {
                const { results } = await db.prepare("SELECT * FROM tables ORDER BY id ASC").all();
                const tablesObj = {};
                (results || []).forEach(t => {
                    tablesObj[t.id] = { tableNumber: t.id, zone: t.zone, assignedTo: t.assignedTo || "", status: t.status || "libre" };
                });
                return jsonResponse({ success: true, tables: tablesObj });
            }

            // POST ou PATCH /api/tables/:id
            if ((request.method === "POST" || request.method === "PATCH") && segments.length === 2) {
                const tableId = parseInt(segments[1], 10);
                const body = await request.json();
                const assignedTo = body.assignedTo !== undefined ? body.assignedTo : "";
                const status = body.status !== undefined ? body.status : "libre";
                const now = new Date().toISOString();

                await db.prepare("UPDATE tables SET assignedTo = ?, status = ?, updatedAt = ? WHERE id = ?")
                    .bind(assignedTo, status, now, tableId).run();

                return jsonResponse({ success: true, tableId, assignedTo, status });
            }
        }

        // ── 5. CLUB FIDÉLITÉ (/api/loyalty/...) ──────────────────────────────
        if (segments[0] === "loyalty") {
            const sub = segments[1];

            // A. Membres (/api/loyalty/members)
            if (sub === "members") {
                // GET /api/loyalty/members : Liste tous les membres (pour Admin) OU fiche individuelle si ?phone=...
                if (request.method === "GET" && segments.length === 2) {
                    const qPhone = normalizePhone(url.searchParams.get("phone") || "");
                    if (qPhone) {
                        const suffix9 = qPhone.length >= 9 ? qPhone.slice(-9) : qPhone;
                        const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(qPhone, `%${suffix9}`).first();
                        if (member) member.vipTier = getVipTier(member.totalEarned);
                        return jsonResponse({ success: true, member: member || null });
                    }
                    const { results } = await db.prepare("SELECT * FROM loyalty_members ORDER BY points DESC").all();
                    const enriched = (results || []).map(m => ({ ...m, vipTier: getVipTier(m.totalEarned) }));
                    return jsonResponse({ success: true, members: enriched });
                }

                // GET /api/loyalty/members/:phone : Fiche individuelle
                if (request.method === "GET" && segments.length === 3) {
                    const phone = normalizePhone(segments[2]);
                    const suffix9 = phone.length >= 9 ? phone.slice(-9) : phone;
                    const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(phone, `%${suffix9}`).first();
                    if (!member) return jsonResponse({ success: true, member: null });

                    member.vipTier = getVipTier(member.totalEarned);

                    // Vérifier si le numéro a été crédité il y a moins de 2h
                    const canonicalPhone = member.phone;
                    const recentEarn = await db.prepare(`
                        SELECT * FROM loyalty_transactions
                        WHERE (phone = ? OR phone LIKE ?) AND type = 'EARN' AND validatedBy NOT LIKE '%REJETÉ%'
                        ORDER BY createdAt DESC
                        LIMIT 1
                    `).bind(canonicalPhone, `%${suffix9}`).first();

                    let lockInfo = null;
                    if (recentEarn && recentEarn.createdAt) {
                        const lastTime = new Date(recentEarn.createdAt).getTime();
                        const nowMs = Date.now();
                        const elapsedMs = nowMs - lastTime;
                        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
                        if (!isNaN(lastTime) && elapsedMs < TWO_HOURS_MS && elapsedMs >= 0) {
                            lockInfo = {
                                isLocked: true,
                                remainingMinutes: Math.max(1, Math.ceil((TWO_HOURS_MS - elapsedMs) / 60000)),
                                tableNumber: recentEarn.tableNumber || "",
                                validatedBy: recentEarn.validatedBy || "",
                                lastEarnAt: recentEarn.createdAt
                            };
                        }
                    }

                    return jsonResponse({ success: true, member, lockInfo });
                }

                // POST /api/loyalty/members : Créer ou récupérer membre (+20 pts bienvenue)
                // RÈGLE : LE NUMÉRO DE TÉLÉPHONE EST LE SEUL ET UNIQUE REPÈRE DU CLIENT
                // Même si le prénom rentré est différent ou comporte une faute, le compte lié au numéro prime
                if (request.method === "POST") {
                    const body = await request.json();
                    const phone = normalizePhone(body.phone);
                    if (!phone || phone.length < 8) return errorResponse("Numéro de téléphone invalide.");

                    const suffix9 = phone.length >= 9 ? phone.slice(-9) : phone;
                    const existing = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(phone, `%${suffix9}`).first();
                    if (existing) {
                        existing.vipTier = getVipTier(existing.totalEarned);
                        const canonicalPhone = existing.phone;
                        const recentEarn = await db.prepare(`
                            SELECT * FROM loyalty_transactions
                            WHERE (phone = ? OR phone LIKE ?) AND type = 'EARN' AND validatedBy NOT LIKE '%REJETÉ%'
                            ORDER BY createdAt DESC
                            LIMIT 1
                        `).bind(canonicalPhone, `%${suffix9}`).first();

                        let lockInfo = null;
                        if (recentEarn && recentEarn.createdAt) {
                            const lastTime = new Date(recentEarn.createdAt).getTime();
                            const nowMs = Date.now();
                            const elapsedMs = nowMs - lastTime;
                            const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
                            if (!isNaN(lastTime) && elapsedMs < TWO_HOURS_MS && elapsedMs >= 0) {
                                lockInfo = {
                                    isLocked: true,
                                    remainingMinutes: Math.max(1, Math.ceil((TWO_HOURS_MS - elapsedMs) / 60000)),
                                    tableNumber: recentEarn.tableNumber || "",
                                    validatedBy: recentEarn.validatedBy || "",
                                    lastEarnAt: recentEarn.createdAt
                                };
                            }
                        }

                        return jsonResponse({ success: true, member: existing, isNew: false, lockInfo });
                    }

                    const firstName = (body.firstName || body.name || "Client").trim();
                    const source = body.source || "qr_menu";
                    const welcomeBonus = 20;
                    const now = new Date().toISOString();

                    const newMember = {
                        phone,
                        firstName,
                        points: welcomeBonus,
                        totalEarned: welcomeBonus,
                        rewardsClaimed: 0,
                        source,
                        vipTier: getVipTier(welcomeBonus),
                        createdAt: now,
                        updatedAt: now
                    };

                    const txId = generateId("tx");
                    const insertMember = db.prepare(`
                        INSERT INTO loyalty_members (phone, firstName, points, totalEarned, rewardsClaimed, source, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                    `).bind(phone, firstName, welcomeBonus, welcomeBonus, source, now, now);

                    const insertTx = db.prepare(`
                        INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                        VALUES (?, ?, 'WELCOME', ?, 0, '', '', 'system', 'Cadeau de bienvenue (+20 pts)', ?)
                    `).bind(txId, phone, welcomeBonus, now);

                    await db.batch([insertMember, insertTx]);
                    return jsonResponse({ success: true, member: newMember, isNew: true });
                }
            }

            // B. Crédit de points (/api/loyalty/credit) — Calcul dynamique avec Paliers VIP
            if (sub === "credit" && request.method === "POST") {
                const body = await request.json();
                const phone = normalizePhone(body.phone);
                if (!phone || phone.length < 8) return errorResponse("Numéro de téléphone invalide.");

                const amountDH = parseFloat(body.amountDH || body.amount) || 0;
                if (amountDH <= 0) return errorResponse("Montant de l'addition invalide (doit être supérieur à 0 DH).");
                const tableNumber = body.tableNumber ? String(body.tableNumber).trim() : "";
                const orderId = body.orderId || "";
                const validatedBy = body.validatedBy || "waiter";
                const now = new Date().toISOString();

                // 🛑 1. RÈGLE ANTIFRAUDE INFRANCHISSABLE POUR LES SERVEURS ET CLIENTS (< 2h)
                // L'ADMINISTRATEUR A LES PLEINS POUVOIRS ET CRÉDITE/DÉDUIT LIBREMENT SANS AUCUNE RESTRICTION
                const suffix9 = phone.length >= 9 ? phone.slice(-9) : phone;
                const isAdmin = String(validatedBy).toLowerCase().includes("admin");
                if (!isAdmin) {
                    const lastEarn = await db.prepare(`
                        SELECT * FROM loyalty_transactions
                        WHERE (phone = ? OR phone LIKE ?) AND type = 'EARN' AND validatedBy NOT LIKE '%REJETÉ%'
                        ORDER BY createdAt DESC
                        LIMIT 1
                    `).bind(phone, `%${suffix9}`).first();

                    if (lastEarn && lastEarn.createdAt) {
                        const lastTime = new Date(lastEarn.createdAt).getTime();
                        const nowMs = Date.now();
                        const elapsedMs = nowMs - lastTime;
                        const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 120 minutes

                        if (!isNaN(lastTime) && elapsedMs < TWO_HOURS_MS && elapsedMs >= 0) {
                            const remainingMin = Math.max(1, Math.ceil((TWO_HOURS_MS - elapsedMs) / 60000));
                            const tableInfo = lastEarn.tableNumber ? ` (Table ${lastEarn.tableNumber})` : "";
                            const byInfo = lastEarn.validatedBy ? ` par ${lastEarn.validatedBy}` : "";

                            return jsonResponse({
                                success: false,
                                blocked2h: true,
                                remainingMinutes: remainingMin,
                                error: `⛔ BLOCAGE ANTIFRAUDE (Moins de 2h) :\nCe numéro a déjà été crédité il y a moins de 2 heures${tableInfo}${byInfo}.\nNouveau crédit autorisé dans ${remainingMin} minute(s).`,
                                message: `⛔ BLOCAGE ANTIFRAUDE (Moins de 2h) :\nCe numéro a déjà été crédité il y a moins de 2 heures${tableInfo}${byInfo}.\nNouveau crédit autorisé dans ${remainingMin} minute(s).`
                            }, 200);
                        }
                    }
                }

                // S'assurer que le membre existe par son numéro de téléphone unique
                let member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(phone, `%${suffix9}`).first();
                if (!member) {
                    await db.prepare(`
                        INSERT INTO loyalty_members (phone, firstName, points, totalEarned, rewardsClaimed, source, createdAt, updatedAt)
                        VALUES (?, 'Client', 0, 0, 0, 'waiter_direct', ?, ?)
                    `).bind(phone, now, now).run();
                    member = { phone, firstName: "Client", points: 0, totalEarned: 0, rewardsClaimed: 0 };
                }
                const canonicalPhone = member.phone;

                // 👑 PALIERS VIP : Déterminer le palier et appliquer le multiplicateur de points
                const vipTier = getVipTier(member.totalEarned);
                const pointsToAdd = Math.max(1, Math.round(amountDH * (vipTier.ratio || 1.0)));

                // 🚨 2. RÈGLE DE SÉCURITÉ DIRECTION : MONTANT > 100 DH OU POINTS > 100 PTS PAR UN SERVEUR
                // LE MONTANT PASSE TOUJOURS (encaissement validé), mais les points sont mis en attente de validation par l'administrateur !
                const isPendingAdmin = (amountDH > 100 || pointsToAdd > 100) && !isAdmin;

                if (isPendingAdmin) {
                    const noteText = `⏳ [EN ATTENTE VALIDATION ADMIN >100 PTS] Encaissement ${amountDH} DH (+${pointsToAdd} pts [${vipTier.name} x${vipTier.ratio}]) — Table ${tableNumber || 'Non renseignée'}`;
                    const txId = generateId("tx");
                    await db.prepare(`
                        INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                        VALUES (?, ?, 'EARN', ?, ?, ?, ?, ?, ?, ?)
                    `).bind(txId, canonicalPhone, pointsToAdd, amountDH, tableNumber, orderId, validatedBy, noteText, now).run();

                    // Si lié à une commande, marquer comme crédité pour clore la commande
                    if (orderId) {
                        await db.prepare(`
                            UPDATE pre_orders 
                            SET loyaltyCredited = 1,
                                loyaltyPhone = CASE WHEN loyaltyPhone IS NULL OR loyaltyPhone = '' THEN ? ELSE loyaltyPhone END,
                                loyaltyName = CASE WHEN loyaltyName IS NULL OR loyaltyName = '' THEN ? ELSE loyaltyName END
                            WHERE id = ?
                        `).bind(canonicalPhone, member.firstName || 'Client', orderId).run();
                    }

                    return jsonResponse({
                        success: true,
                        pendingAdminApproval: true,
                        pointsAdded: pointsToAdd,
                        vipTier,
                        newTotal: member.points,
                        member: { ...member, vipTier },
                        message: `✅ Encaissement de ${amountDH} DH validé pour la Table ${tableNumber || 'N/A'} !\n\n⚠️ Montant supérieur à 100 DH :\nLes ${pointsToAdd} points (${vipTier.name} x${vipTier.ratio}) sont en attente de validation par la direction et seront crédités sur le compte client après validation de l'administrateur.`
                    }, 200);
                }

                // Si <= 100 pts OU si c'est l'administrateur : CRÉDIT IMMÉDIAT
                await db.prepare(`
                    UPDATE loyalty_members
                    SET points = points + ?, totalEarned = totalEarned + ?, updatedAt = ?
                    WHERE phone = ?
                `).bind(pointsToAdd, pointsToAdd, now, canonicalPhone).run();
                member.points += pointsToAdd;
                member.totalEarned += pointsToAdd;

                // Note avec flag explicite pour contrôle admin si forçage admin
                let noteText = body.note ? String(body.note) : `Encaissement ${amountDH} DH (+${pointsToAdd} pts [${vipTier.name} x${vipTier.ratio}])`;
                if (body.forceAdmin) {
                    noteText = `⚠️ [FORÇAGE ADMIN <2H] ${noteText}`;
                }

                // Enregistrer la transaction
                const txId = generateId("tx");
                await db.prepare(`
                    INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                    VALUES (?, ?, 'EARN', ?, ?, ?, ?, ?, ?, ?)
                `).bind(txId, canonicalPhone, pointsToAdd, amountDH, tableNumber, orderId, validatedBy, noteText, now).run();

                // Si lié à une commande, marquer comme crédité
                if (orderId) {
                    await db.prepare(`
                        UPDATE pre_orders 
                        SET loyaltyCredited = 1,
                            loyaltyPhone = CASE WHEN loyaltyPhone IS NULL OR loyaltyPhone = '' THEN ? ELSE loyaltyPhone END,
                            loyaltyName = CASE WHEN loyaltyName IS NULL OR loyaltyName = '' THEN ? ELSE loyaltyName END
                        WHERE id = ?
                    `).bind(canonicalPhone, member.firstName || 'Client', orderId).run();
                }

                const updatedVipTier = getVipTier(member.totalEarned);

                return jsonResponse({
                    success: true,
                    pendingAdminApproval: false,
                    pointsAdded: pointsToAdd,
                    vipTier: updatedVipTier,
                    newTotal: member.points,
                    member: { ...member, vipTier: updatedVipTier },
                    message: `✅ +${pointsToAdd} points validés pour ${member.firstName || 'Client'} (${updatedVipTier.name}) !\nNouveau solde : ${member.points} pts.`
                }, 200);
            }

            // C. Déblocage récompense (/api/loyalty/redeem) — Palier 1 (500 pts Boisson Chaude) ou Palier 2 (1000 pts Jus Frais)
            if (sub === "redeem" && request.method === "POST") {
                const body = await request.json();
                const phone = normalizePhone(body.phone);
                const suffix9 = phone.length >= 9 ? phone.slice(-9) : phone;

                const rewardType = (body.rewardType || body.reward || "").toLowerCase();
                const isJuice = rewardType === "juice" || rewardType === "jus" || parseInt(body.points, 10) === 1000;
                const cost = isJuice ? 1000 : 500;
                const rewardTitle = isJuice ? "🍹 Jus de Fruits Frais au choix" : "☕ Boisson Chaude au choix";
                const rewardNote = `${rewardTitle} accordée (-${cost} pts)`;

                const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(phone, `%${suffix9}`).first();

                if (!member || member.points < cost) {
                    const currentPts = member ? member.points : 0;
                    return errorResponse(`Solde insuffisant pour débloquer ${rewardTitle} (${cost} pts requis, solde actuel: ${currentPts} pts).`, 400);
                }

                const canonicalPhone = member.phone;
                const validatedBy = body.validatedBy || "waiter";
                const now = new Date().toISOString();

                // ATTENTION : On déduit UNIQUEMENT des points disponibles (member.points),
                // totalEarned n'est PAS modifié afin de conserver à vie le palier VIP du client !
                await db.prepare(`
                    UPDATE loyalty_members
                    SET points = points - ?, rewardsClaimed = rewardsClaimed + 1, updatedAt = ?
                    WHERE phone = ?
                `).bind(cost, now, canonicalPhone).run();

                const txId = generateId("tx");
                await db.prepare(`
                    INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                    VALUES (?, ?, 'REDEEM', ?, 0, '', '', ?, ?, ?)
                `).bind(txId, canonicalPhone, -cost, validatedBy, rewardNote, now).run();

                const vipTier = getVipTier(member.totalEarned);

                return jsonResponse({
                    success: true,
                    cost,
                    rewardType: isJuice ? "juice" : "hot_drink",
                    rewardTitle,
                    newTotal: member.points - cost,
                    member: {
                        ...member,
                        points: member.points - cost,
                        rewardsClaimed: (member.rewardsClaimed || 0) + 1,
                        vipTier
                    }
                });
            }

            // D. Ajustement Admin (/api/loyalty/adjust)
            if (sub === "adjust" && request.method === "POST") {
                const body = await request.json();
                const phone = normalizePhone(body.phone);
                const suffix9 = phone.length >= 9 ? phone.slice(-9) : phone;
                const delta = parseInt(body.delta, 10);
                if (isNaN(delta) || delta === 0) return errorResponse("Valeur d'ajustement invalide.");

                const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(phone, `%${suffix9}`).first();
                const canonicalPhone = member ? member.phone : phone;

                const reason = body.reason || "Ajustement administrateur";
                const by = body.by || "admin";
                const now = new Date().toISOString();

                if (!member) {
                    await db.prepare(`
                        INSERT INTO loyalty_members (phone, firstName, points, totalEarned, rewardsClaimed, source, createdAt, updatedAt)
                        VALUES (?, 'Client', MAX(0, ?), CASE WHEN ? > 0 THEN ? ELSE 0 END, 0, 'admin_adjust', ?, ?)
                    `).bind(canonicalPhone, delta, delta, delta, now, now).run();
                } else {
                    await db.prepare(`
                        UPDATE loyalty_members
                        SET points = MAX(0, points + ?),
                            totalEarned = CASE WHEN ? > 0 THEN totalEarned + ? ELSE totalEarned END,
                            updatedAt = ?
                        WHERE phone = ?
                    `).bind(delta, delta, delta, now, canonicalPhone).run();
                }

                const txId = generateId("tx");
                await db.prepare(`
                    INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                    VALUES (?, ?, 'ADMIN_ADJUST', ?, 0, '', '', ?, ?, ?)
                `).bind(txId, canonicalPhone, delta, by, reason, now).run();

                const updated = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ?").bind(canonicalPhone).first();
                return jsonResponse({ success: true, newTotal: updated ? updated.points : 0, member: updated });
            }

            // E. Transactions (/api/loyalty/transactions)
            if (sub === "transactions" && request.method === "GET") {
                const phone = normalizePhone(url.searchParams.get("phone") || "");
                let results;
                if (phone) {
                    results = (await db.prepare("SELECT * FROM loyalty_transactions WHERE phone = ? ORDER BY createdAt DESC LIMIT 50").bind(phone).all()).results;
                } else {
                    results = (await db.prepare("SELECT * FROM loyalty_transactions ORDER BY createdAt DESC LIMIT 100").all()).results;
                }
                return jsonResponse({ success: true, transactions: results || [] });
            }

            // F. Réglages Fidélité (/api/loyalty/settings)
            if (sub === "settings") {
                if (request.method === "GET") {
                    const row = await db.prepare("SELECT value FROM system_config WHERE key = 'loyalty_config'").first();
                    let settings = { rewardThreshold: 500, welcomeBonus: 20, pointsPerDH: 1 };
                    if (row && row.value) {
                        try { settings = JSON.parse(row.value); } catch(e) {}
                    }
                    return jsonResponse({ success: true, settings });
                }
                if (request.method === "POST") {
                    const body = await request.json();
                    const now = new Date().toISOString();
                    await db.prepare("INSERT OR REPLACE INTO system_config (key, value, updatedAt) VALUES ('loyalty_config', ?, ?)")
                        .bind(JSON.stringify(body), now).run();
                    return jsonResponse({ success: true, settings: body });
                }
            }

            // G. Alertes & Contrôle Serveurs (/api/loyalty/alerts) — Transactions > 100 pts
            if (sub === "alerts") {
                if (request.method === "GET") {
                    const rows = (await db.prepare(`
                        SELECT t.*, m.firstName as memberName
                        FROM loyalty_transactions t
                        LEFT JOIN loyalty_members m ON (t.phone = m.phone OR m.phone LIKE '%' || SUBSTR(t.phone, -9))
                        WHERE t.pointsDelta > 100 
                          AND t.validatedBy NOT LIKE '%admin%'
                          AND t.validatedBy NOT LIKE '%VÉRIFIÉ%'
                          AND t.validatedBy NOT LIKE '%RECTIFIÉ%'
                          AND t.validatedBy NOT LIKE '%REJETÉ%'
                          AND t.type != 'REJECTED'
                        ORDER BY t.createdAt DESC
                        LIMIT 50
                    `).all()).results;
                    return jsonResponse({ success: true, alerts: rows || [] });
                }
                if (request.method === "POST") {
                    const body = await request.json();
                    const txId = body.txId;
                    const action = body.action || "verify";
                    if (!txId) return errorResponse("ID de transaction manquant.");

                    const tx = await db.prepare("SELECT * FROM loyalty_transactions WHERE id = ?").bind(txId).first();
                    if (!tx) return errorResponse("Transaction introuvable.");

                    if (tx.validatedBy && (tx.validatedBy.includes("VÉRIFIÉ") || tx.validatedBy.includes("RECTIFIÉ") || tx.validatedBy.includes("REJETÉ"))) {
                        return errorResponse("Cette transaction a déjà été traitée par la direction.");
                    }

                    const suffix9 = tx.phone.length >= 9 ? tx.phone.slice(-9) : tx.phone;
                    const now = new Date().toISOString();

                    if (action === "verify") {
                        const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(tx.phone, `%${suffix9}`).first();
                        if (!member) {
                            await db.prepare(`
                                INSERT INTO loyalty_members (phone, firstName, points, totalEarned, rewardsClaimed, source, createdAt, updatedAt)
                                VALUES (?, 'Client', ?, ?, 0, 'waiter_direct', ?, ?)
                            `).bind(tx.phone, tx.pointsDelta, tx.pointsDelta, now, now).run();
                        } else {
                            await db.prepare(`
                                UPDATE loyalty_members
                                SET points = points + ?, totalEarned = totalEarned + ?, updatedAt = ?
                                WHERE phone = ? OR phone LIKE ?
                            `).bind(tx.pointsDelta, tx.pointsDelta, now, tx.phone, `%${suffix9}`).run();
                        }
                        await db.prepare(`
                            UPDATE loyalty_transactions 
                            SET validatedBy = validatedBy || ' [VÉRIFIÉ & CRÉDITÉ ADMIN]',
                                note = REPLACE(COALESCE(note, ''), '[EN ATTENTE VALIDATION ADMIN >100 PTS]', '[VALIDÉ & CRÉDITÉ ADMIN]')
                            WHERE id = ?
                        `).bind(txId).run();
                        return jsonResponse({ success: true, message: `✅ Transaction validée : +${tx.pointsDelta} points crédités au client.` });
                    }

                    if (action === "rectify") {
                        const newPoints = Math.max(0, parseInt(body.newPoints, 10) || 0);
                        if (newPoints > 0) {
                            const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ? OR phone LIKE ? LIMIT 1").bind(tx.phone, `%${suffix9}`).first();
                            if (!member) {
                                await db.prepare(`
                                    INSERT INTO loyalty_members (phone, firstName, points, totalEarned, rewardsClaimed, source, createdAt, updatedAt)
                                    VALUES (?, 'Client', ?, ?, 0, 'waiter_direct', ?, ?)
                                `).bind(tx.phone, newPoints, newPoints, now, now).run();
                            } else {
                                await db.prepare(`
                                    UPDATE loyalty_members
                                    SET points = points + ?, totalEarned = totalEarned + ?, updatedAt = ?
                                    WHERE phone = ? OR phone LIKE ?
                                `).bind(newPoints, newPoints, now, tx.phone, `%${suffix9}`).run();
                            }
                        }
                        await db.prepare(`
                            UPDATE loyalty_transactions 
                            SET pointsDelta = ?,
                                amountDH = ?,
                                validatedBy = validatedBy || ' [RECTIFIÉ & CRÉDITÉ ADMIN]',
                                note = '[RECTIFIÉ & CRÉDITÉ ADMIN +' || ? || ' PTS] (Initialement demandé: ' || ? || ' pts) — ' || REPLACE(COALESCE(note, ''), '[EN ATTENTE VALIDATION ADMIN >100 PTS]', '[RECTIFIÉ]')
                            WHERE id = ?
                        `).bind(newPoints, newPoints, newPoints, tx.pointsDelta, txId).run();
                        return jsonResponse({ success: true, message: `✅ Transaction rectifiée : +${newPoints} points crédités au client.` });
                    }

                    if (action === "reject") {
                        await db.prepare(`
                            UPDATE loyalty_transactions 
                            SET type = 'REJECTED',
                                validatedBy = validatedBy || ' [REJETÉ ADMIN]',
                                note = REPLACE(COALESCE(note, ''), '[EN ATTENTE VALIDATION ADMIN >100 PTS]', '[REJETÉ ADMIN]')
                            WHERE id = ?
                        `).bind(txId).run();
                        return jsonResponse({ success: true, message: "Transaction rejetée sans attribution de points." });
                    }

                    return errorResponse("Action inconnue.");
                }
            }
        }

        // ── 6. SYSTÈME (Rush mode freeze & purge) ───────────────────────────
        if (segments[0] === "system") {
            const sub = segments[1];
            if (sub === "freeze") {
                if (request.method === "GET") {
                    const row = await db.prepare("SELECT value FROM system_config WHERE key = 'system_frozen'").first();
                    return jsonResponse({ success: true, frozen: row ? row.value === "true" : false });
                }
                if (request.method === "POST") {
                    const body = await request.json();
                    const frozenStr = body.frozen ? "true" : "false";
                    const now = new Date().toISOString();
                    await db.prepare("INSERT OR REPLACE INTO system_config (key, value, updatedAt) VALUES ('system_frozen', ?, ?)")
                        .bind(frozenStr, now).run();
                    return jsonResponse({ success: true, frozen: body.frozen === true });
                }
            }

            if (sub === "cleanup" && request.method === "POST") {
                const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
                await db.prepare("DELETE FROM waiters_calls WHERE createdAt < ? AND status IN ('completed', 'cancelled')").bind(cutoff).run();
                await db.prepare("DELETE FROM pre_orders WHERE createdAt < ? AND status IN ('completed', 'cancelled')").bind(cutoff).run();
                return jsonResponse({ success: true, message: "Purger des données de plus de 24h effectuée." });
            }
        }

        return errorResponse(`Route API introuvable : /api/${path}`, 404);
    } catch (err) {
        console.error("API Server Error:", err);
        return errorResponse(err.message || String(err), 500);
    }
}
