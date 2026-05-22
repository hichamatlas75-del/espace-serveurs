/**
 * ============================================================================
 * GREY CORNER — ADMIN CONSOLE REAL-TIME LOGIC (UPDATED + FREEZE SYSTEM)
 * ============================================================================
 */

let globalWaiters = [];
let activeCallsList = [];

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
        const orderDateStr = newO.createdAt ? new Date(newO.createdAt).toDateString() : todayStr;
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

let activePreOrdersList = loadPreOrdersCache();

let alertTablesSet = new Set();

// ❄️ SYSTEM STATE
let systemFrozen = false;

// ============================================================================
function getTableZoneName(tableNum) {
    const num = parseInt(tableNum);
    if (num >= 101 && num <= 115) return "Salon";
    if (num >= 201 && num <= 223) return "Loge";
    if (num >= 301 && num <= 324) return "Terrasse";
    return "Table";
}

// ============================================================================
// 1. SYSTEM FREEZE LISTENER
// ============================================================================
function initSystemFreezeListener() {
    dbService.onSystemFreezeChange((frozen) => {
        systemFrozen = frozen;
        updateFreezeUI();
        triggerMatrixRepaint(); // Repaint tables to show/hide freeze style
    });
}

function updateFreezeUI() {
    const pill = document.getElementById("connectionPill");
    const label = document.getElementById("connectionLabel");
    const btn = document.getElementById("toggleFreezeBtn");
    
    const isCloud = dbService.isCloud();

    if (systemFrozen) {
        if (pill) {
            pill.classList.remove("connected");
            pill.classList.add("disconnected");
            pill.style.background = "";
            pill.style.boxShadow = "";
        }
        if (label) {
            label.textContent = isCloud ? "SYSTEM FROZEN ❄" : "SIMULATION FROZEN ❄";
            label.style.color = "";
        }
        if (btn) {
            btn.textContent = "Freeze ON ❄️";
            btn.classList.add("frozen-active");
        }
    } else {
        if (pill) {
            pill.classList.add("connected");
            pill.classList.remove("disconnected");
            if (!isCloud) {
                pill.style.background = "#00bcd4";
                pill.style.boxShadow = "0 0 8px #00bcd4";
            } else {
                pill.style.background = "";
                pill.style.boxShadow = "";
            }
        }
        if (label) {
            if (!isCloud) {
                label.textContent = "SIMULATION";
                label.style.color = "#00bcd4";
            } else {
                label.textContent = "LIVE";
                label.style.color = "";
            }
        }
        if (btn) {
            btn.textContent = "Freeze OFF";
            btn.classList.remove("frozen-active");
        }
    }
}

// ============================================================================
// 2. STREAMS
// ============================================================================
function initAdminStreams() {

    initSystemFreezeListener();

    // Initial render from local cache to avoid empty views on load
    activePreOrdersList = loadPreOrdersCache();
    if (activePreOrdersList.length > 0) {
        updateKpiMetrics();
        mergeAndRenderActivityFeed();
        renderAdminHistoryFeed();
        updateTableAlertStates();
        triggerMatrixRepaint();
    }

    dbService.getWaiters((waiters) => {
        globalWaiters = waiters;
        triggerMatrixRepaint();
    });

    dbService.onCallsChange((calls) => {

        if (systemFrozen) return;

        const todayStr = new Date().toDateString();
        const todayCalls = calls.filter(c => {
            const dateStr = c.createdAt ? new Date(c.createdAt).toDateString() : todayStr;
            return dateStr === todayStr;
        });

        activeCallsList = todayCalls;

        updateKpiMetrics();
        mergeAndRenderActivityFeed();
        updateTableAlertStates();
        triggerMatrixRepaint();
    });

    dbService.onPreOrdersChange((orders) => {

        if (systemFrozen) return;

        savePreOrdersCache(orders);
        activePreOrdersList = loadPreOrdersCache();

        updateKpiMetrics();
        mergeAndRenderActivityFeed();
        renderAdminHistoryFeed();
        updateTableAlertStates();
        triggerMatrixRepaint();
    });
}

// ============================================================================
// 3. TABLE MATRIX
// ============================================================================
function triggerMatrixRepaint() {

    const zones = [
        { gridId: "gridSalon", start: 101, end: 115 },
        { gridId: "gridLoge", start: 201, end: 223 },
        { gridId: "gridTerrasse", start: 301, end: 324 }
    ];

    zones.forEach(zone => {
        const grid = document.getElementById(zone.gridId);
        if (!grid) return;

        grid.innerHTML = "";

        for (let i = zone.start; i <= zone.end; i++) {

            const hasAlert = alertTablesSet.has(i);

            const activeCall = activeCallsList.find(c => c.table === i && c.status === "accepted");
            const activeOrder = activePreOrdersList.find(o => o.table === i && o.status === "accepted");

            const isBeingServed = activeCall || activeOrder;

            const card = document.createElement("div");

            // ❄️ VISUAL FREEZE STATE (pas blocage rendu)
            const freezeClass = systemFrozen ? "system-frozen-table" : "";

            card.className =
                `admin-table-card 
                ${freezeClass}
                ${hasAlert ? 'table-alert-pending' : ''} 
                ${isBeingServed ? 'table-active-serving' : ''}`;

            card.dataset.id = i;

            if (isBeingServed) {
                card.style.borderColor = "var(--gold)";
                card.style.background = "rgba(201, 168, 76, 0.08)";
            }

            card.innerHTML = `
                ${hasAlert ? '<span class="alert-dot"></span>' : ''}
                <div class="atc-number">${i}</div>
                <span class="atc-waiter-pill ${hasAlert || isBeingServed ? 'assigned' : 'unassigned'}">
                    ${hasAlert ? 'Attente...' : (isBeingServed ? 'En cours' : 'Libre')}
                </span>
            `;

            grid.appendChild(card);
        }
    });
}
// ============================================================================
// 4. ALERT STATE TRACKER
// ============================================================================
function updateTableAlertStates() {

    alertTablesSet.clear();

    activeCallsList.forEach(c => {
        if (c.status === "pending") {
            alertTablesSet.add(c.table);
        }
    });

    activePreOrdersList.forEach(o => {
        if (o.status === "pending") {
            alertTablesSet.add(o.table);
        }
    });
}

// ============================================================================
// 5. KPI METRICS
// ============================================================================
function updateKpiMetrics() {

    const activeTablesSet = new Set();

    activeCallsList.forEach(c => {
        if (c.status !== "completed") activeTablesSet.add(c.table);
    });

    activePreOrdersList.forEach(o => {
        if (o.status !== "completed" && o.status !== "cancelled") {
            activeTablesSet.add(o.table);
        }
    });

    const elTables = document.getElementById("metricActiveTables");
    if (elTables) elTables.textContent = `${activeTablesSet.size} / 24`;

    const pendingCalls = activeCallsList.filter(c => c.status === "pending").length;
    const elCalls = document.getElementById("metricPendingCalls");
    if (elCalls) elCalls.textContent = pendingCalls;

    const pendingOrders = activePreOrdersList.filter(
        o => o.status === "pending" || o.status === "accepted"
    ).length;

    const elOrders = document.getElementById("metricActiveOrders");
    if (elOrders) elOrders.textContent = pendingOrders;

    computeAverageResponseTime();
}

// ============================================================================
// 6. RESPONSE TIME
// ============================================================================
function computeAverageResponseTime() {
    let sum = 0;
    let count = 0;

    const items = [...activeCallsList, ...activePreOrdersList];

    items.forEach(item => {
        if (item.acceptedAt && item.createdAt) {
            const accepted = new Date(item.acceptedAt);
            const created = new Date(item.createdAt);
            if (!isNaN(accepted.getTime()) && !isNaN(created.getTime())) {
                const diff = accepted.getTime() - created.getTime();
                if (diff > 0 && diff < 3600000) {
                    sum += diff;
                    count++;
                }
            }
        }
    });

    const el = document.getElementById("metricAvgResponse");
    if (!el) return;

    if (count > 0) {
        el.textContent = ((sum / count) / 60000).toFixed(1) + " min";
    } else {
        el.textContent = "-- min";
    }
}

// ============================================================================
// 7. LIVE FEED
// ============================================================================
function mergeAndRenderActivityFeed() {
    const feed = document.getElementById("adminLiveActivityFeed");
    if (!feed) return;

    feed.innerHTML = "";

    const merged = [];

    activeCallsList.forEach(c => {
        merged.push({
            id: c.id,
            table: c.table,
            status: c.status,
            createdAt: c.createdAt,
            type: "call",
            callType: c.type
        });
    });

    activePreOrdersList.forEach(o => {
        merged.push({
            id: o.id,
            table: o.table,
            status: o.status,
            createdAt: o.createdAt,
            type: "order",
            totalPrice: o.totalPrice
        });
    });

    merged.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const db = b.createdAt ? new Date(b.createdAt) : new Date(0);
        const t1 = isNaN(da.getTime()) ? 0 : da.getTime();
        const t2 = isNaN(db.getTime()) ? 0 : db.getTime();
        return t2 - t1;
    });

    if (merged.length === 0) {
        feed.innerHTML = '<div class="feed-log-empty">Aucune activité</div>';
        return;
    }

    merged.slice(0, 40).forEach(evt => {
        const row = document.createElement("div");
        row.className = "feed-log-row";

        let text = "";
        let badge = "";

        if (evt.type === "call") {
            badge = evt.callType;
            if (evt.status === "pending") {
                text = `Table ${evt.table} demande ${evt.callType}`;
            } else if (evt.status === "accepted") {
                text = `Service en cours Table ${evt.table}`;
            } else {
                text = `Terminé Table ${evt.table}`;
            }
        } else {
            badge = "order";
            if (evt.status === "pending") {
                text = `Commande Table ${evt.table} (${evt.totalPrice} MAD)`;
            } else if (evt.status === "accepted") {
                text = `Service en cours Table ${evt.table} (Commande)`;
            } else {
                text = `Commande servie Table ${evt.table}`;
            }
        }

        const evtDate = evt.createdAt ? new Date(evt.createdAt) : new Date();
        const time = isNaN(evtDate.getTime()) ? "--:--:--" : evtDate.toLocaleTimeString("fr-FR");

        row.innerHTML = `
            <div class="flr-content">
                <span class="flr-text">${text}</span>
                <span class="flr-time">${time}</span>
            </div>
            <span class="flr-badge">${badge}</span>
        `;

        feed.appendChild(row);
    });
}

// ============================================================================
// 8. ADMIN TABS & HISTORY RENDER
// ============================================================================
function initAdminTabs() {
    const tabs = document.querySelectorAll(".admin-tab-btn");
    const panels = document.querySelectorAll(".admin-tab-panel");
    
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const targetId = tab.getAttribute("data-tab");
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            
            panels.forEach(p => {
                if (p.id === targetId) {
                    p.classList.add("active");
                    p.style.display = "block";
                } else {
                    p.classList.remove("active");
                    p.style.display = "none";
                }
            });
        });
    });
}

function renderAdminHistoryFeed() {
    const feed = document.getElementById("adminHistoryFeed");
    if (!feed) return;

    feed.innerHTML = "";

    // Trier toutes les précommandes du jour J par date de création décroissante
    const sortedOrders = [...activePreOrdersList].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const db = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return db - da;
    });

    if (sortedOrders.length === 0) {
        feed.innerHTML = '<div class="feed-log-empty">Aucune précommande aujourd\'hui</div>';
        return;
    }

    sortedOrders.forEach(order => {
        let itemsHtml = "";
        order.items.forEach(it => {
            itemsHtml += `
                <div class="admin-history-row">
                    <div>
                        <span style="color: var(--gold); font-weight: 600; margin-right: 6px;">${it.qty}x</span>
                        <span style="color: #FFFFFF;">${it.name_lang}</span>
                    </div>
                    <span style="color: var(--muted); font-size: 0.78rem;">${it.price} MAD</span>
                </div>
            `;
        });

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

        const itemDate = order.createdAt ? new Date(order.createdAt) : new Date();
        const timeStr = isNaN(itemDate.getTime()) ? "--:--:--" : itemDate.toLocaleTimeString("fr-FR");

        const row = document.createElement("div");
        row.className = "admin-history-item";

        row.innerHTML = `
            <div class="admin-history-item-top">
                <div>
                    <span class="admin-history-item-table">${getTableZoneName(order.table)} ${order.table}</span>
                    <span style="font-size: 0.72rem; color: var(--muted); margin-left: 8px;">${timeStr}</span>
                </div>
                <span class="admin-history-item-status" style="${statusStyle}">${statusText}</span>
            </div>
            <div class="admin-history-items-list">
                ${itemsHtml}
                ${order.note ? `<div style="font-size: 0.78rem; color: var(--muted); margin-top: 6px; font-style: italic; border-top: 1px solid rgba(255, 255, 255, 0.03); padding-top: 4px;">Note: ${order.note}</div>` : ""}
                <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255, 255, 255, 0.03); padding-top: 6px; margin-top: 4px; font-weight: 600; font-size: 0.8rem;">
                    <span style="color: var(--muted);">Total</span>
                    <span style="color: var(--gold);">${order.totalPrice} MAD</span>
                </div>
            </div>
        `;

        feed.appendChild(row);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    // Initialize tab navigation
    initAdminTabs();

    // 1. Bind the freeze toggle button FIRST to protect against any database stream startup crashes!
    const btn = document.getElementById("toggleFreezeBtn");
    if (btn) {
        btn.addEventListener("click", () => {
            console.log("⚡ Freeze button clicked");
            dbService.setSystemFreeze(!systemFrozen, (success, errorMsg) => {
                if (!success) {
                    alert("Erreur lors de la modification de l'état freeze :\n" + (errorMsg || "Erreur inconnue (Vérifiez votre connexion ou vos permissions Firebase)"));
                }
            });
        });
    }

    // Bind the database purge button
    const cleanupBtn = document.getElementById("dbCleanupBtn");
    if (cleanupBtn) {
        cleanupBtn.addEventListener("click", () => {
            if (confirm("Voulez-vous purger de la base de données toutes les données datant de plus de 24 heures ?")) {
                dbService.cleanupOldData((success) => {
                    if (success) {
                        alert("Purge effectuée avec succès !");
                    } else {
                        alert("Échec de la purge.");
                    }
                });
            }
        });
    }

    // 2. Now start streams safely
    try {
        initAdminStreams();
    } catch (err) {
        console.error("⚠️ Error starting streams:", err);
    }
});
