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

function errorResponse(message, status = 400) {
    return jsonResponse({ error: message, success: false }, status);
}

// Normalisation des numéros de téléphone (marocain: 06... / 07...)
function normalizePhone(raw) {
    if (!raw) return "";
    let clean = String(raw).replace(/[\s\-\.\(\)]/g, "");
    if (clean.startsWith("+212")) clean = "0" + clean.slice(4);
    else if (clean.startsWith("212")) clean = "0" + clean.slice(3);
    else if (clean.startsWith("00212")) clean = "0" + clean.slice(5);
    return clean;
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
        points INTEGER DEFAULT 50,
        totalEarned INTEGER DEFAULT 50,
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
            .bind("loyalty_config", JSON.stringify({ rewardThreshold: 500, welcomeBonus: 50, pointsPerDH: 1 }), new Date().toISOString())
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
            let loyaltyConfig = { rewardThreshold: 500, welcomeBonus: 50, pointsPerDH: 1 };
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
                const loyaltyPhone = normalizePhone(body.loyaltyPhone || "");
                const loyaltyName = body.loyaltyName || "";
                const note = body.note || "";
                const createdAt = body.createdAt || new Date().toISOString();

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
                } else if (status === "completed") {
                    await db.prepare("UPDATE waiters_calls SET status = ?, completedAt = ? WHERE id = ?")
                        .bind(status, now, callId).run();
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
                const loyaltyPhone = normalizePhone(body.loyaltyPhone || "");
                const loyaltyName = body.loyaltyName || "";
                const loyaltyPoints = typeof body.loyaltyPoints === "number" ? body.loyaltyPoints : null;
                const createdAt = body.createdAt || new Date().toISOString();

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
                    } else if (body.status === "completed") {
                        await db.prepare("UPDATE pre_orders SET status = ?, completedAt = ? WHERE id = ?")
                            .bind(body.status, now, orderId).run();
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
                // GET /api/loyalty/members : Liste tous les membres (pour Admin)
                if (request.method === "GET" && segments.length === 2) {
                    const { results } = await db.prepare("SELECT * FROM loyalty_members ORDER BY points DESC").all();
                    return jsonResponse({ success: true, members: results || [] });
                }

                // GET /api/loyalty/members/:phone : Fiche individuelle
                if (request.method === "GET" && segments.length === 3) {
                    const phone = normalizePhone(segments[2]);
                    const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ?").bind(phone).first();
                    return jsonResponse({ success: true, member: member || null });
                }

                // POST /api/loyalty/members : Créer ou récupérer membre (+50 pts bienvenue)
                if (request.method === "POST") {
                    const body = await request.json();
                    const phone = normalizePhone(body.phone);
                    if (!phone || phone.length < 8) return errorResponse("Numéro de téléphone invalide.");

                    const existing = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ?").bind(phone).first();
                    if (existing) {
                        return jsonResponse({ success: true, member: existing, isNew: false });
                    }

                    const firstName = (body.firstName || body.name || "Client").trim();
                    const source = body.source || "qr_menu";
                    const welcomeBonus = 50;
                    const now = new Date().toISOString();

                    const newMember = {
                        phone,
                        firstName,
                        points: welcomeBonus,
                        totalEarned: welcomeBonus,
                        rewardsClaimed: 0,
                        source,
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
                        VALUES (?, ?, 'WELCOME', ?, 0, '', '', 'system', 'Cadeau de bienvenue (+50 pts)', ?)
                    `).bind(txId, phone, welcomeBonus, now);

                    await db.batch([insertMember, insertTx]);
                    return jsonResponse({ success: true, member: newMember, isNew: true });
                }
            }

            // B. Crédit de points (/api/loyalty/credit) — 1 DH = 1 pt
            if (sub === "credit" && request.method === "POST") {
                const body = await request.json();
                const phone = normalizePhone(body.phone);
                if (!phone || phone.length < 8) return errorResponse("Numéro de téléphone invalide.");

                const amountDH = parseFloat(body.amountDH || body.amount) || 0;
                const pointsToAdd = Math.max(1, Math.round(amountDH));
                const tableNumber = body.tableNumber ? String(body.tableNumber) : "";
                const orderId = body.orderId || "";
                const validatedBy = body.validatedBy || "waiter";
                const now = new Date().toISOString();

                // S'assurer que le membre existe
                let member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ?").bind(phone).first();
                if (!member) {
                    await db.prepare(`
                        INSERT INTO loyalty_members (phone, firstName, points, totalEarned, rewardsClaimed, source, createdAt, updatedAt)
                        VALUES (?, 'Client', ?, ?, 0, 'waiter_direct', ?, ?)
                    `).bind(phone, pointsToAdd, pointsToAdd, now, now).run();
                    member = { phone, firstName: "Client", points: pointsToAdd, totalEarned: pointsToAdd };
                } else {
                    await db.prepare(`
                        UPDATE loyalty_members
                        SET points = points + ?, totalEarned = totalEarned + ?, updatedAt = ?
                        WHERE phone = ?
                    `).bind(pointsToAdd, pointsToAdd, now, phone).run();
                    member.points += pointsToAdd;
                    member.totalEarned += pointsToAdd;
                }

                // Enregistrer la transaction
                const txId = generateId("tx");
                await db.prepare(`
                    INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                    VALUES (?, ?, 'EARN', ?, ?, ?, ?, ?, ?, ?)
                `).bind(txId, phone, pointsToAdd, amountDH, tableNumber, orderId, validatedBy, `Encaissement ${amountDH} DH (+${pointsToAdd} pts)`, now).run();

                // Si lié à une commande, marquer comme crédité
                if (orderId) {
                    await db.prepare("UPDATE pre_orders SET loyaltyCredited = 1 WHERE id = ?").bind(orderId).run();
                }

                return jsonResponse({
                    success: true,
                    pointsAdded: pointsToAdd,
                    newTotal: member.points,
                    member
                });
            }

            // C. Déblocage récompense (/api/loyalty/redeem) — Déduire 500 points
            if (sub === "redeem" && request.method === "POST") {
                const body = await request.json();
                const phone = normalizePhone(body.phone);
                const cost = 500;
                const member = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ?").bind(phone).first();

                if (!member || member.points < cost) {
                    return errorResponse("Solde insuffisant pour débloquer une consommation (500 pts requis).", 400);
                }

                const validatedBy = body.validatedBy || "waiter";
                const now = new Date().toISOString();

                await db.prepare(`
                    UPDATE loyalty_members
                    SET points = points - ?, rewardsClaimed = rewardsClaimed + 1, updatedAt = ?
                    WHERE phone = ?
                `).bind(cost, now, phone).run();

                const txId = generateId("tx");
                await db.prepare(`
                    INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                    VALUES (?, ?, 'REDEEM', ?, 0, '', '', ?, 'Consommation offerte accordée (-500 pts)', ?)
                `).bind(txId, phone, -cost, validatedBy, now).run();

                return jsonResponse({
                    success: true,
                    newTotal: member.points - cost,
                    member: { ...member, points: member.points - cost, rewardsClaimed: (member.rewardsClaimed || 0) + 1 }
                });
            }

            // D. Ajustement Admin (/api/loyalty/adjust)
            if (sub === "adjust" && request.method === "POST") {
                const body = await request.json();
                const phone = normalizePhone(body.phone);
                const delta = parseInt(body.delta, 10);
                if (isNaN(delta) || delta === 0) return errorResponse("Valeur d'ajustement invalide.");

                const reason = body.reason || "Ajustement administrateur";
                const by = body.by || "admin";
                const now = new Date().toISOString();

                await db.prepare(`
                    UPDATE loyalty_members
                    SET points = MAX(0, points + ?),
                        totalEarned = CASE WHEN ? > 0 THEN totalEarned + ? ELSE totalEarned END,
                        updatedAt = ?
                    WHERE phone = ?
                `).bind(delta, delta, delta, now, phone).run();

                const txId = generateId("tx");
                await db.prepare(`
                    INSERT INTO loyalty_transactions (id, phone, type, pointsDelta, amountDH, tableNumber, orderId, validatedBy, note, createdAt)
                    VALUES (?, ?, 'ADMIN_ADJUST', ?, 0, '', '', ?, ?, ?)
                `).bind(txId, phone, delta, by, reason, now).run();

                const updated = await db.prepare("SELECT * FROM loyalty_members WHERE phone = ?").bind(phone).first();
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
                    let settings = { rewardThreshold: 500, welcomeBonus: 50, pointsPerDH: 1 };
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
