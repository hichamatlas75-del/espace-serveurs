/**
 * ============================================================================
 * GREY CORNER — ADMIN CONSOLE REAL-TIME LOGIC (UPDATED + FREEZE SYSTEM)
 * ============================================================================
 */

let globalWaiters = [];
let activeCallsList = [];

function savePreOrdersCache(orders) {
    const today = new Date().toDateString();
    const cache = {
        date: today,
        orders: orders
    };
    localStorage.setItem("grey_preorders_cache", JSON.stringify(cache));
}

function loadPreOrdersCache() {
    try {
        const cached = localStorage.getItem("grey_preorders_cache");
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.date === new Date().toDateString()) {
                return parsed.orders;
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
        updateTableAlertStates();
        triggerMatrixRepaint();
    }

    dbService.getWaiters((waiters) => {
        globalWaiters = waiters;
        triggerMatrixRepaint();
    });

    dbService.onCallsChange((calls) => {

        if (systemFrozen) return;

        activeCallsList = calls;

        updateKpiMetrics();
        mergeAndRenderActivityFeed();
        updateTableAlertStates();
        triggerMatrixRepaint();
    });

    dbService.onPreOrdersChange((orders) => {

        if (systemFrozen) return;

        activePreOrdersList = orders;
        savePreOrdersCache(orders);

        updateKpiMetrics();
        mergeAndRenderActivityFeed();
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

            const diff =
                new Date(item.acceptedAt).getTime() -
                new Date(item.createdAt).getTime();

            if (diff > 0 && diff < 3600000) {
                sum += diff;
                count++;
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

    merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (merged.length === 0) {
        feed.innerHTML = '<div class="feed-log-empty">Aucune activité</div>';
        return;
    }

    merged.slice(0, 40).forEach(evt => {

        const row = document.createElement("div");
        row.className = "feed-log-row";

        let text = "";
        let badge = "";
        let badgeClass = "";

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
            } else {
                text = `Commande servie Table ${evt.table}`;
            }
        }

        const time = new Date(evt.createdAt).toLocaleTimeString("fr-FR");

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

document.addEventListener("DOMContentLoaded", () => {
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

    // 2. Now start streams safely
    try {
        initAdminStreams();
    } catch (err) {
        console.error("⚠️ Error starting streams:", err);
    }
});
