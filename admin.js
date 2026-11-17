/**
 * ============================================================================
 * GREY CORNER — ADMIN CONSOLE REAL-TIME LOGIC (UPDATED + FREEZE SYSTEM)
 * ============================================================================
 */

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let globalWaiters = [];
let activeCallsList = [];

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

let activePreOrdersList = loadPreOrdersCache();

let alertTablesSet = new Set();
let cachedLoyaltyAlerts = [];

// ❄️ SYSTEM STATE
let systemFrozen = false;

// ============================================================================
function getTableZoneName(tableNum) {
    const num = parseInt(tableNum);
    if (num >= 101 && num <= 115) return "Salle";
    if (num >= 201 && num <= 219) return "Loge";
    if (num >= 301 && num <= 323) return "Terrasse";
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

    // Nettoyage automatique des appels et commandes archivés (> 24h) une fois par jour
    try {
        const lastAutoClean = localStorage.getItem("gc_last_auto_cleanup");
        const now = Date.now();
        if (!lastAutoClean || (now - parseInt(lastAutoClean, 10)) > 12 * 60 * 60 * 1000) {
            localStorage.setItem("gc_last_auto_cleanup", String(now));
            setTimeout(() => {
                if (typeof dbService !== "undefined" && dbService.cleanupOldData) {
                    dbService.cleanupOldData((ok) => {
                        if (ok) console.log("🧹 Auto-cleanup Firestore (>24h) effectué.");
                    });
                }
            }, 6000);
        }
    } catch (e) {}

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
            const dateStr = c.createdAt ? parseSafeDate(c.createdAt).toDateString() : todayStr;
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

    cachedLoyaltyAlerts.forEach(a => {
        merged.push({
            id: "alert_" + a.id,
            table: a.tableNumber || "?",
            status: "alert_loyalty",
            createdAt: a.createdAt,
            type: "loyalty_alert",
            points: a.pointsDelta,
            waiter: a.validatedBy,
            phone: a.phone
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
        } else if (evt.type === "loyalty_alert") {
            badge = "⚠️ >100 PTS";
            text = `⚠️ Table ${evt.table} : +${evt.points} pts attribués par ${evt.waiter || "Serveur"} (Contrôle requis)`;
            row.style.borderColor = "rgba(231, 76, 60, 0.55)";
            row.style.background = "rgba(231, 76, 60, 0.08)";
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
// 8. ADMIN NAVIGATION & HISTORY RENDER
// ============================================================================
function initAdminNavigation() {
    const navBtns = document.querySelectorAll(".admin-nav-btn");
    const sections = document.querySelectorAll(".admin-section");

    navBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const secId = btn.getAttribute("data-section");
            navBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            sections.forEach(s => {
                if (s.id === secId) {
                    s.classList.add("active");
                    s.style.display = "block";
                } else {
                    s.classList.remove("active");
                    s.style.display = "none";
                }
            });

            if (secId === "sectionHistory") {
                renderAdminHistoryFeed();
            }
            if (secId === "sectionLoyalty") {
                if (typeof loadLoyaltyAlerts === "function") loadLoyaltyAlerts();
                if (typeof dbService !== "undefined" && dbService.syncMembersNow) dbService.syncMembersNow();
            }
        });
    });
}

function initAdminTabs() {
    initAdminNavigation();

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
    const feeds = [
        document.getElementById("adminHistoryFeed"),
        document.getElementById("adminFullHistoryFeed")
    ].filter(Boolean);

    if (feeds.length === 0) return;

    // Trier toutes les précommandes du jour J par date de création décroissante
    const sortedOrders = [...activePreOrdersList].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const db = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return db - da;
    });

    feeds.forEach(feed => {
        feed.innerHTML = "";

        if (sortedOrders.length === 0) {
            feed.innerHTML = '<div class="feed-log-empty">Aucune précommande aujourd\'hui</div>';
            return;
        }

        sortedOrders.forEach(order => {
            let itemsHtml = "";
            (order.items || []).forEach(it => {
                const catBadge = it.category ? ` <span style="font-size: 0.72rem; color: var(--gold); margin-left: 6px; font-weight: 500;">(${it.category})</span>` : "";
                itemsHtml += `
                    <div class="admin-history-row">
                        <div>
                            <span style="color: var(--gold); font-weight: 600; margin-right: 6px;">${it.qty || 1}x</span>
                            <span style="color: #FFFFFF;">${it.name_lang || it.name || "Article"}${catBadge}</span>
                        </div>
                        <span style="color: var(--muted); font-size: 0.78rem;">${it.price || 0} MAD</span>
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
            const ptsToAdd = Math.max(1, Math.round(order.totalPrice || 0));

            let loyaltyHtml = "";
            if (order.loyaltyPhone) {
                loyaltyHtml = `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(201,169,110,0.08); border:1px solid rgba(201,169,110,0.25); border-radius:6px; padding:6px 10px; margin-top:8px;">
                        <div style="font-size:0.78rem;">
                            <span style="color:var(--gold); font-weight:700;">👑 ${order.loyaltyName || "Client"}</span>
                            <span style="color:var(--muted); margin-left:4px;">(${order.loyaltyPhone})</span>
                        </div>
                        <div id="adminOrderLoyaltyBadge_${order.id}">
                            ${order.loyaltyCredited 
                                ? `<span style="color:#2ecc71; font-weight:700; font-size:0.8rem;">✓ Points validés (+${ptsToAdd} pts)</span>`
                                : `<button type="button" class="admin-btn-credit-order" data-order-id="${order.id}" data-phone="${order.loyaltyPhone}" data-amount="${order.totalPrice}" style="background:#27ae60; color:#fff; border:none; border-radius:6px; padding:5px 10px; font-size:0.75rem; font-weight:700; cursor:pointer;">✅ Valider Points (+${ptsToAdd} pts)</button>`
                            }
                        </div>
                    </div>
                `;
            } else {
                loyaltyHtml = `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px dashed rgba(255,255,255,0.1); border-radius:6px; padding:6px 10px; margin-top:8px;">
                        <span style="font-size:0.75rem; color:var(--muted);">Fidélité non renseignée</span>
                        <div id="adminOrderLoyaltyBadge_${order.id}">
                            ${order.loyaltyCredited
                                ? `<span style="color:#2ecc71; font-weight:700; font-size:0.8rem;">✓ Points validés (+${ptsToAdd} pts)</span>`
                                : `<button type="button" class="admin-btn-assign-order" data-order-id="${order.id}" data-amount="${order.totalPrice}" data-table="${order.table}" style="background:rgba(201,169,110,0.15); border:1px solid var(--gold); color:var(--gold); border-radius:6px; padding:5px 10px; font-size:0.75rem; font-weight:700; cursor:pointer;">➕ Valider points (+${ptsToAdd} pts)</button>`
                            }
                        </div>
                    </div>
                `;
            }

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
                    ${order.note ? `<div style="font-size: 0.78rem; color: var(--muted); margin-top: 6px; font-style: italic; border-top: 1px solid rgba(255, 255, 255, 0.03); padding-top: 4px;">Note: ${escapeHtml(order.note)}</div>` : ""}
                    <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255, 255, 255, 0.03); padding-top: 6px; margin-top: 4px; font-weight: 600; font-size: 0.8rem;">
                        <span style="color: var(--muted);">Total</span>
                        <span style="color: var(--gold);">${order.totalPrice} MAD</span>
                    </div>
                    ${loyaltyHtml}
                </div>
            `;

            // Action Valider Points (client existant)
            const btnCredit = row.querySelector(".admin-btn-credit-order");
            if (btnCredit) {
                btnCredit.addEventListener("click", () => {
                    const ph = btnCredit.dataset.phone;
                    const amt = parseFloat(btnCredit.dataset.amount) || 0;
                    btnCredit.disabled = true;
                    btnCredit.textContent = "Validation...";
                    dbService.creditLoyaltyPoints(ph, amt, order.table, "admin", order.id, false, (ok, added, newTot, resObj) => {
                        btnCredit.disabled = false;
                        btnCredit.textContent = "Valider Points";
                        if (ok) {
                            order.loyaltyCredited = true;
                            window.showGreyCornerNotice("✅ POINTS VALIDÉS", `+${added} points validés pour ${ph} !\nNouveau solde : ${newTot} / 500 pts`, "success");
                            renderAdminHistoryFeed();
                            if (dbService.syncMembersNow) dbService.syncMembersNow();
                            loadLoyaltyAlerts();
                        } else {
                            const msg = (resObj && (resObj.error || resObj.message)) || added || "❌ Erreur lors de la validation des points.";
                            window.showGreyCornerNotice("⛔ CRÉDIT REFUSÉ", msg, "error");
                        }
                    });
                });
            }

            // Action Assigner Points (client non renseigné)
            const btnAssign = row.querySelector(".admin-btn-assign-order");
            if (btnAssign) {
                btnAssign.addEventListener("click", () => {
                    const phoneRaw = prompt(`Valider ${ptsToAdd} points pour cette commande (Table ${order.table} - ${order.totalPrice} MAD) :\n\nEntrez le numéro de téléphone du client :`);
                    if (!phoneRaw) return;
                    const cleanPh = window.normalizePhone ? window.normalizePhone(phoneRaw) : phoneRaw.replace(/\D/g, "");
                    if (cleanPh.length < 8) {
                        window.showGreyCornerNotice("Numéro invalide", "Veuillez saisir un numéro de téléphone valide.", "warning");
                        return;
                    }
                    btnAssign.disabled = true;
                    btnAssign.textContent = "Validation...";
                    dbService.createOrGetLoyaltyMember(cleanPh, "Client Table " + order.table, "admin", (okGet, member) => {
                        const canonicalPh = member ? member.phone : cleanPh;
                        const canonicalName = member ? (member.firstName || "Client") : "Client";
                        dbService.creditLoyaltyPoints(canonicalPh, order.totalPrice, order.table, "admin", order.id, false, (okCredit, added, newTot, resObj) => {
                            btnAssign.disabled = false;
                            btnAssign.textContent = "Attribuer Points";
                            if (okCredit) {
                                order.loyaltyPhone = canonicalPh;
                                order.loyaltyName = canonicalName;
                                order.loyaltyCredited = true;
                                window.showGreyCornerNotice("👑 POINTS VALIDÉS", `+${added} points validés pour ${canonicalName} (${canonicalPh}) !\nNouveau solde : ${newTot} / 500 pts`, "success");
                                renderAdminHistoryFeed();
                                if (dbService.syncMembersNow) dbService.syncMembersNow();
                                loadLoyaltyAlerts();
                            } else {
                                const msg = (resObj && (resObj.error || resObj.message)) || added || "❌ Erreur lors de l'attribution des points.";
                                window.showGreyCornerNotice("⛔ CRÉDIT REFUSÉ", msg, "error");
                            }
                        });
                    });
                });
            }

            feed.appendChild(row);
        });
    });
}

function initAdminLoyaltyDashboard() {
    const tableBody = document.getElementById("adminLoyaltyTableBody");
    const searchInput = document.getElementById("adminLoyaltySearchInput");
    const btnSaveSettings = document.getElementById("btnSaveLoyaltySettings");

    const inputRewardThreshold = document.getElementById("settingRewardThreshold");
    const inputWelcomeBonus = document.getElementById("settingWelcomeBonus");
    const inputPointsPerDH = document.getElementById("settingPointsPerDH");

    const modalTx = document.getElementById("adminLoyaltyTxModal");
    const btnCloseTxModal = document.getElementById("btnCloseTxModal");
    const txListContainer = document.getElementById("adminTxListContainer");
    const txModalTitle = document.getElementById("adminTxModalTitle");

    // 0. Module Validation Rapide des Points (Admin)
    const quickPhone = document.getElementById("adminQuickPhone");
    const quickAmount = document.getElementById("adminQuickAmount");
    const quickTable = document.getElementById("adminQuickTable");
    const quickNote = document.getElementById("adminQuickNote");

    const btnCreditPts = document.getElementById("btnAdminCreditPoints");
    const btnRedeemPts = document.getElementById("btnAdminRedeemReward");
    const btnRedeemDrink = document.getElementById("btnAdminRedeemDrink");
    const btnRedeemJuice = document.getElementById("btnAdminRedeemJuice");
    const btnDeductPts = document.getElementById("btnAdminDeductPoints");
    const btnCreateMbr = document.getElementById("btnAdminCreateMember");

    if (btnCreditPts && quickPhone) {
        btnCreditPts.addEventListener("click", () => {
            const raw = (quickPhone.value || "").trim();
            const cleanPh = window.normalizePhone ? window.normalizePhone(raw) : raw.replace(/\D/g, "");
            if (cleanPh.length < 8) {
                alert("Veuillez saisir un numéro de téléphone valide.");
                quickPhone.focus();
                return;
            }
            const amount = parseFloat(quickAmount.value) || 0;
            if (amount <= 0) {
                alert("Veuillez saisir un montant d'addition valide en DH (ex: 120).");
                quickAmount.focus();
                return;
            }
            const tableNum = (quickTable.value || "").trim();
            btnCreditPts.disabled = true;
            btnCreditPts.textContent = "Validation en cours...";

            dbService.creditLoyaltyPoints(cleanPh, amount, tableNum, "admin", null, false, (ok, added, newTotal, resObj) => {
                btnCreditPts.disabled = false;
                btnCreditPts.textContent = "✅ Valider les Points (+1 DH = 1 pt)";
                if (ok) {
                    window.showGreyCornerNotice("✅ POINTS VALIDÉS", `Addition de ${amount} DH validée avec succès !\n\n+${added} points crédités à ${cleanPh}.\nNouveau solde : ${newTotal} / 500 pts.`, "success");
                    quickAmount.value = "";
                    quickNote.value = "";
                    if (dbService.syncMembersNow) dbService.syncMembersNow();
                    loadLoyaltyAlerts();
                } else {
                    const msg = (resObj && (resObj.error || resObj.message)) || added || "❌ Erreur lors de la validation des points.";
                    window.showGreyCornerNotice("⛔ CRÉDIT REFUSÉ", msg, "error");
                }
            });
        });
    }

    function handleAdminRedeem(rewardType, cost, label, btnEl) {
        if (!quickPhone) return;
        const raw = (quickPhone.value || "").trim();
        const cleanPh = window.normalizePhone ? window.normalizePhone(raw) : raw.replace(/\D/g, "");
        if (cleanPh.length < 8) {
            window.showGreyCornerNotice("Numéro invalide", "Veuillez saisir un numéro de téléphone valide.", "warning");
            quickPhone.focus();
            return;
        }
        if (confirm(`Confirmez-vous déduire ${cost} points pour offrir ${label} à ${cleanPh} ?`)) {
            const origText = btnEl ? btnEl.textContent : "";
            if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Déduction..."; }
            dbService.redeemLoyaltyReward(cleanPh, "admin", rewardType, (ok, newTotal) => {
                if (btnEl) { btnEl.disabled = false; btnEl.textContent = origText; }
                if (ok) {
                    window.showGreyCornerNotice("🎉 RÉCOMPENSE ACCORDÉE", `${label} accordée avec succès à ${cleanPh} !\nNouveau solde : ${newTotal} points.`, "success");
                    if (dbService.syncMembersNow) dbService.syncMembersNow();
                    loadLoyaltyAlerts();
                } else {
                    window.showGreyCornerNotice("❌ Solde insuffisant", `Solde insuffisant (minimum ${cost} points requis) ou compte introuvable.`, "error");
                }
            });
        }
    }

    if (btnRedeemDrink && quickPhone) {
        btnRedeemDrink.addEventListener("click", () => handleAdminRedeem("hot_drink", 500, "1 Boisson Chaude", btnRedeemDrink));
    }
    if (btnRedeemJuice && quickPhone) {
        btnRedeemJuice.addEventListener("click", () => handleAdminRedeem("juice", 1000, "1 Jus de Fruits Frais", btnRedeemJuice));
    }
    if (btnRedeemPts && quickPhone) {
        btnRedeemPts.addEventListener("click", () => handleAdminRedeem("hot_drink", 500, "1 Boisson Chaude", btnRedeemPts));
    }

    if (btnDeductPts && quickPhone) {
        btnDeductPts.addEventListener("click", () => {
            const raw = (quickPhone.value || "").trim();
            const cleanPh = window.normalizePhone ? window.normalizePhone(raw) : raw.replace(/\D/g, "");
            if (cleanPh.length < 8) {
                window.showGreyCornerNotice("Numéro invalide", "Veuillez saisir un numéro de téléphone valide.", "warning");
                quickPhone.focus();
                return;
            }
            const pts = parseInt(quickAmount.value, 10) || 0;
            if (pts <= 0) {
                window.showGreyCornerNotice("Nombre invalide", "Veuillez indiquer le nombre de points à déduire dans le champ Montant.", "warning");
                quickAmount.focus();
                return;
            }
            const note = (quickNote.value || "").trim() || "Déduction manuelle admin";
            if (confirm(`Déduire ${pts} points à ${cleanPh} ?`)) {
                btnDeductPts.disabled = true;
                dbService.adjustLoyaltyPoints(cleanPh, -pts, note, "admin", (ok, newTotal) => {
                    btnDeductPts.disabled = false;
                    if (ok) {
                        window.showGreyCornerNotice("✅ POINTS DÉDUITS", `-${pts} points déduits avec succès !\nNouveau solde : ${newTotal} points.`, "success");
                        quickAmount.value = "";
                        if (dbService.syncMembersNow) dbService.syncMembersNow();
                        loadLoyaltyAlerts();
                    } else {
                        window.showGreyCornerNotice("❌ Erreur", "Erreur lors de la déduction des points.", "error");
                    }
                });
            }
        });
    }

    if (btnCreateMbr && quickPhone) {
        btnCreateMbr.addEventListener("click", () => {
            const raw = (quickPhone.value || "").trim();
            const cleanPh = window.normalizePhone ? window.normalizePhone(raw) : raw.replace(/\D/g, "");
            if (cleanPh.length < 8) {
                window.showGreyCornerNotice("Numéro invalide", "Veuillez saisir un numéro de téléphone valide.", "warning");
                quickPhone.focus();
                return;
            }
            const name = prompt("Prénom du client (le numéro reste le repère unique) :", "") || "Client";
            btnCreateMbr.disabled = true;
            dbService.createOrGetLoyaltyMember(cleanPh, name, "admin", (ok, mbr, isNew) => {
                btnCreateMbr.disabled = false;
                if (ok && mbr) {
                    if (dbService.syncMembersNow) dbService.syncMembersNow();
                    loadLoyaltyAlerts();
                    if (isNew) {
                        window.showGreyCornerNotice("👑 Compte Créé", `Compte fidélité créé pour ${mbr.firstName} (${mbr.phone}) !\n+20 points de bienvenue offerts (Solde: ${mbr.points} pts).`, "success");
                    } else {
                        window.showGreyCornerNotice("ℹ️ Compte Existant Retrouvé", `Ce numéro (${mbr.phone}) appartient déjà à ${mbr.firstName} !\nSolde actuel conservé : ${mbr.points} / 500 pts.`, "info");
                    }
                } else {
                    window.showGreyCornerNotice("❌ Erreur", "Erreur lors de la création du compte.", "error");
                }
            });
        });
    }

    if (btnCloseTxModal && modalTx) {
        btnCloseTxModal.addEventListener("click", () => {
            modalTx.style.display = "none";
        });
        modalTx.addEventListener("click", (e) => {
            if (e.target === modalTx) modalTx.style.display = "none";
        });
    }

    // 1. Paramètres
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener("click", () => {
            const rewardThreshold = parseInt(inputRewardThreshold.value, 10) || 500;
            const welcomeBonus = parseInt(inputWelcomeBonus.value, 10) || 20;
            const pointsPerDH = parseFloat(inputPointsPerDH.value) || 1;

            btnSaveSettings.disabled = true;
            btnSaveSettings.textContent = "Enregistrement...";

            dbService.setLoyaltySettings({ rewardThreshold, welcomeBonus, pointsPerDH }, (ok) => {
                btnSaveSettings.disabled = false;
                btnSaveSettings.textContent = "Enregistrer";
                if (ok) {
                    alert("✅ Paramètres du Club Fidélité enregistrés avec succès !");
                } else {
                    alert("❌ Erreur lors de l'enregistrement des paramètres.");
                }
            });
        });
    }

    dbService.onLoyaltySettingsChange((cfg) => {
        if (!cfg) return;
        if (inputRewardThreshold && cfg.rewardThreshold) inputRewardThreshold.value = cfg.rewardThreshold;
        if (inputWelcomeBonus && typeof cfg.welcomeBonus === "number") inputWelcomeBonus.value = cfg.welcomeBonus;
        if (inputPointsPerDH && cfg.pointsPerDH) inputPointsPerDH.value = cfg.pointsPerDH;
    });

    // 2. Recherche
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            renderLoyaltyMembersTable();
        });
    }

    // ── GESTIONNAIRE DES ALERTES SERVEURS (> 100 PTS) ──
    const alertsSection = document.getElementById("adminLoyaltyAlertsSection");
    const alertsList = document.getElementById("adminLoyaltyAlertsList");
    const alertsBadgeCount = document.getElementById("alertsBadgeCount");
    const navAlertBadge = document.getElementById("navLoyaltyAlertBadge");

    function loadLoyaltyAlerts() {
        if (!dbService || !dbService.getLoyaltyAlerts) return;
        dbService.getLoyaltyAlerts((alerts) => {
            cachedLoyaltyAlerts = alerts || [];
            renderLoyaltyAlerts();
            renderLoyaltyMembersTable();
            if (typeof mergeAndRenderActivityFeed === "function") {
                mergeAndRenderActivityFeed();
            }
        });
    }

    function renderLoyaltyAlerts() {
        const count = cachedLoyaltyAlerts.length;

        // Badge dans la barre de navigation
        if (navAlertBadge) {
            if (count > 0) {
                navAlertBadge.style.display = "inline-flex";
                navAlertBadge.textContent = `⚠️ ${count}`;
            } else {
                navAlertBadge.style.display = "none";
            }
        }

        // Section dédiée dans l'onglet Club Fidélité
        if (alertsSection && alertsList) {
            if (count === 0) {
                alertsSection.style.display = "none";
                return;
            }

            alertsSection.style.display = "block";
            if (alertsBadgeCount) {
                alertsBadgeCount.textContent = `${count} transaction${count > 1 ? "s" : ""} à contrôler`;
            }

            alertsList.innerHTML = "";
            cachedLoyaltyAlerts.forEach(tx => {
                const card = document.createElement("div");
                card.className = "alert-tx-card";

                const txDate = tx.createdAt ? new Date(tx.createdAt) : new Date();
                const dateStr = isNaN(txDate.getTime()) ? "" : txDate.toLocaleString("fr-FR", {
                    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
                });

                const memberName = tx.memberName || "Client";
                const tableStr = tx.tableNumber ? `Table ${tx.tableNumber}` : "⚠️ Table non renseignée";

                const isPending = tx.note && tx.note.includes("[EN ATTENTE VALIDATION ADMIN");

                card.innerHTML = `
                    <div class="alert-tx-header">
                        <div class="alert-tx-pts">+${tx.pointsDelta} PTS</div>
                        <div class="alert-tx-table">${tableStr}</div>
                        <div class="alert-tx-date">${dateStr}</div>
                    </div>
                    <div class="alert-tx-details">
                        <span>👤 <strong>${memberName}</strong> (<code style="color:var(--gold);">${tx.phone}</code>)</span>
                        <span>🤵 Saisi par : <strong style="color:#e2c97e;">${tx.validatedBy || "Serveur"}</strong></span>
                        <span>💵 Montant addition : <strong>${tx.amountDH} DH</strong></span>
                        ${isPending ? '<span style="color:#f39c12; font-weight:700;">⏳ Points EN ATTENTE de validation admin pour crédit effectif</span>' : '<span style="color:#2ecc71; font-weight:700;">✓ Points validés</span>'}
                    </div>
                    <div class="alert-tx-actions" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                        <button type="button" class="btn-alert-verify" data-id="${tx.id}" style="background:#27ae60; color:#fff; font-weight:800; border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">
                            ✅ Valider & Créditer (+${tx.pointsDelta} pts)
                        </button>
                        <button type="button" class="btn-alert-reject" data-id="${tx.id}" style="background:#c0392b; color:#fff; font-weight:700; border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">
                            ❌ Rejeter
                        </button>
                        <button type="button" class="btn-alert-rectify" data-phone="${tx.phone}" data-pts="${tx.pointsDelta}" data-name="${memberName}" data-table="${tx.tableNumber || ''}" data-id="${tx.id}" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:8px 14px; border-radius:8px; cursor:pointer;">
                            ✏️ Rectifier
                        </button>
                    </div>
                `;

                // Action 1: Marquer comme vérifié par l'administrateur et créditer les points
                const btnVerify = card.querySelector(".btn-alert-verify");
                if (btnVerify) {
                    btnVerify.addEventListener("click", () => {
                        btnVerify.disabled = true;
                        btnVerify.textContent = "Validation...";
                        dbService.verifyLoyaltyAlert(tx.id, (ok) => {
                            if (ok) {
                                window.showGreyCornerNotice(
                                    "✅ POINTS CRÉDITÉS",
                                    `Les +${tx.pointsDelta} points ont été validés et crédités avec succès sur le compte de ${memberName} (${tx.phone}) !`,
                                    "success"
                                );
                                if (dbService.syncMembersNow) dbService.syncMembersNow();
                                loadLoyaltyAlerts();
                            } else {
                                window.showGreyCornerNotice("❌ Erreur", "Erreur lors de la validation des points.", "error");
                                btnVerify.disabled = false;
                                btnVerify.textContent = "✅ Valider & Créditer";
                            }
                        });
                    });
                }

                // Action 1bis: Rejeter la demande de points
                const btnReject = card.querySelector(".btn-alert-reject");
                if (btnReject) {
                    btnReject.addEventListener("click", () => {
                        if (confirm(`Confirmez-vous le rejet de cette demande de ${tx.pointsDelta} points pour ${memberName} (${tx.phone}) ?\nAucun point ne sera crédité.`)) {
                            btnReject.disabled = true;
                            dbService.rejectLoyaltyAlert(tx.id, (ok) => {
                                if (ok) {
                                    window.showGreyCornerNotice("Transaction Rejetée", `La demande de ${tx.pointsDelta} points a été rejetée. Aucun point n'a été crédité.`, "info");
                                    if (dbService.syncMembersNow) dbService.syncMembersNow();
                                    loadLoyaltyAlerts();
                                } else {
                                    window.showGreyCornerNotice("❌ Erreur", "Erreur lors du rejet.", "error");
                                    btnReject.disabled = false;
                                }
                            });
                        }
                    });
                }

                // Action 2: Rectifier le montant / les points en cas d'erreur de saisie du serveur
                const btnRectify = card.querySelector(".btn-alert-rectify");
                if (btnRectify) {
                    btnRectify.addEventListener("click", () => {
                        const currentPts = tx.pointsDelta;
                        const rectifyStr = prompt(
                            `⚠️ RECTIFICATION DE L'ADDITION (${tx.validatedBy} - ${tableStr}) :\n\n` +
                            `Demande initiale du serveur : +${currentPts} points (${tx.amountDH || currentPts} DH) pour ${memberName} (${tx.phone}).\n\n` +
                            `Entrez le MONTANT RÉEL de l'addition en DH (= points exacts à créditer au client) :\n` +
                            `(Exemple : si l'addition réelle était de 50 DH au lieu de 500 DH, entrez 50) :`,
                            String(currentPts)
                        );
                        if (rectifyStr === null) return;
                        const newPts = parseInt(rectifyStr, 10);
                        if (isNaN(newPts) || newPts < 0) {
                            window.showGreyCornerNotice("Montant invalide", "Veuillez saisir un montant d'addition valide en DH (nombre entier >= 0).", "warning");
                            return;
                        }

                        btnRectify.disabled = true;
                        btnRectify.textContent = "Rectification...";
                        dbService.rectifyLoyaltyAlert(tx.id, newPts, (ok, msg) => {
                            if (ok) {
                                window.showGreyCornerNotice(
                                    "✅ RECTIFICATION EFFECTUÉE",
                                    `L'addition a été rectifiée à ${newPts} DH.\n+${newPts} points ont été validés et crédités au client ${memberName} (${tx.phone}) !`,
                                    "success"
                                );
                                if (dbService.syncMembersNow) dbService.syncMembersNow();
                                loadLoyaltyAlerts();
                            } else {
                                window.showGreyCornerNotice("❌ Erreur", msg || "Erreur lors de la rectification des points.", "error");
                                btnRectify.disabled = false;
                                btnRectify.textContent = "✏️ Rectifier";
                            }
                        });
                    });
                }

                alertsList.appendChild(card);
            });
        }
    }

    // Charger les alertes immédiatement et écoute temps réel continue
    loadLoyaltyAlerts();
    setInterval(loadLoyaltyAlerts, 3000);

    // 3. Écoute temps réel des membres
    dbService.onAllLoyaltyMembersChange((members) => {
        cachedAdminLoyaltyMembers = members || [];
        updateLoyaltyKPIs(cachedAdminLoyaltyMembers);
        renderLoyaltyMembersTable();
        loadLoyaltyAlerts();
    });

    function updateLoyaltyKPIs(members) {
        const total = members.length;
        let qrCount = 0;
        let waiterCount = 0;
        let totalPts = 0;
        let totalRewards = 0;
        let bronzeCount = 0;
        let silverCount = 0;
        let goldCount = 0;
        let platineCount = 0;

        members.forEach(m => {
            if (m.source === "qr_menu") qrCount++;
            else if (m.source === "waiter_direct") waiterCount++;
            totalPts += (m.points || 0);
            totalRewards += (m.rewardsClaimed || 0);

            const pts = m.points || 0;
            if (pts >= 1000) platineCount++;
            else if (pts >= 500) goldCount++;
            else if (pts >= 200) silverCount++;
            else bronzeCount++;
        });

        const elTotal = document.getElementById("kpiLoyaltyTotalMembers");
        const elRatio = document.getElementById("kpiLoyaltySourceRatio");
        const elPts = document.getElementById("kpiLoyaltyTotalPoints");
        const elRewards = document.getElementById("kpiLoyaltyRewardsClaimed");
        const elVip = document.getElementById("kpiLoyaltyVipTiers");

        if (elTotal) elTotal.textContent = total;
        if (elRatio) elRatio.textContent = `QR: ${qrCount} • Serveur: ${waiterCount}`;
        if (elPts) elPts.textContent = totalPts.toLocaleString();
        if (elRewards) elRewards.textContent = totalRewards;
        if (elVip) elVip.textContent = `🥉 ${bronzeCount} • 🥈 ${silverCount} • 🥇 ${goldCount} • 💎 ${platineCount}`;
    }

    function renderLoyaltyMembersTable() {
        if (!tableBody) return;
        const q = (searchInput && searchInput.value ? searchInput.value : "").trim().toLowerCase();

        const filtered = cachedAdminLoyaltyMembers.filter(m => {
            if (!q) return true;
            const name = (m.firstName || "").toLowerCase();
            const phone = (m.phone || "").toLowerCase();
            return name.includes(q) || phone.includes(q);
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center; padding:30px; color:var(--muted);">
                        ${q ? "Aucun membre trouvé pour cette recherche." : "Aucun membre inscrit au Club Fidélité pour le moment."}
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = "";

        filtered.forEach(m => {
            const tr = document.createElement("tr");
            const pts = m.points || 0;
            const sourceClass = m.source === "qr_menu" ? "qr" : (m.source === "waiter_direct" ? "waiter" : "admin");
            const sourceLabel = m.source === "qr_menu" ? "Menu QR" : (m.source === "waiter_direct" ? "Serveur" : "Admin");

            // Vérifier si ce membre a une alerte active > 100 pts
            const hasAlert = cachedLoyaltyAlerts.filter(a => (window.isSamePhone ? window.isSamePhone(a.phone, m.phone) : a.phone === m.phone));
            const alertBadge = hasAlert.length > 0 
                ? `<span class="badge-row-alert" title="Alerte : saisie serveur > 100 pts (${hasAlert[0].tableNumber ? 'Table ' + hasAlert[0].tableNumber : 'Table ?'})">⚠️ Contrôle requis</span>` 
                : "";

            // Format WhatsApp Phone (+212)
            let waPhone = (m.phone || "").replace(/\D/g, "");
            if (waPhone.startsWith("0")) {
                waPhone = "212" + waPhone.substring(1);
            } else if (!waPhone.startsWith("212") && waPhone.length === 9) {
                waPhone = "212" + waPhone;
            }
            const waDefaultMsg = encodeURIComponent(`Bonjour ${m.firstName || "cher client"} ! ☕ Votre salon Grey Corner vous informe que vous disposez actuellement de ${pts} points sur votre carte fidélité.`);
            const waLink = `https://wa.me/${waPhone}?text=${waDefaultMsg}`;

            const earned = Math.max(0, parseInt(m.totalEarned, 10) || pts);
            const tier = (window.getVipTier ? window.getVipTier(pts) : null) || {
                id: "bronze", name: "Bronze", icon: "🥉", ratio: 1.0, bonusLabel: "+0%", badgeClass: "bronze"
            };

            tr.innerHTML = `
                <td><strong>${escapeHtml(m.firstName || "Client")}</strong> ${alertBadge}</td>
                <td><span class="badge-vip ${tier.id}">${tier.icon} ${tier.name}</span></td>
                <td><code style="color:var(--gold);">${escapeHtml(m.phone)}</code></td>
                <td>
                    <span style="font-weight:700; ${pts >= 1000 ? "color:#8b5cf6;" : (pts >= 500 ? "color:#2ecc71;" : "")}">${pts} pts</span>
                    <div style="width:70px; height:5px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:4px;">
                        <div style="height:100%; width:${Math.min(100, (pts/1000)*100)}%; background:${pts >= 1000 ? "#8b5cf6" : (pts >= 500 ? "#2ecc71" : "var(--gold)")}; border-radius:4px;"></div>
                    </div>
                </td>
                <td><strong>${earned} pts</strong></td>
                <td style="color:#2ecc71; font-weight:700;">${m.rewardsClaimed || 0} 🎁</td>
                <td><span class="badge-source ${sourceClass}">${sourceLabel}</span></td>
                <td>
                    <button type="button" class="table-btn-action btn-credit-pts" data-phone="${m.phone}" data-name="${m.firstName}" style="background:#27ae60; border-color:#27ae60; color:#fff; font-weight:700;" title="Créditer addition (+DH/pts)">➕ Pts</button>
                    <button type="button" class="table-btn-action btn-adjust-pts" data-phone="${m.phone}" data-name="${m.firstName}">➖ Déduire</button>
                    ${pts >= 1000 ? `<button type="button" class="table-btn-action table-btn-redeem-juice btn-redeem-juice-row" data-phone="${m.phone}" data-name="${m.firstName}">🍹 -1000</button>` : ""}
                    ${pts >= 500 ? `<button type="button" class="table-btn-action table-btn-redeem-drink btn-redeem-drink-row" data-phone="${m.phone}" data-name="${m.firstName}">☕ -500</button>` : ""}
                    <button type="button" class="table-btn-action btn-history-pts" data-phone="${m.phone}" data-name="${m.firstName}">📜 Tx</button>
                    <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="table-btn-action" style="background:#25D366; border-color:#25D366; color:#fff; text-decoration:none; font-weight:700; display:inline-flex; align-items:center; gap:3px;" title="Discuter sur WhatsApp">💬 WA</a>
                </td>
            `;

            // Action Valider / Créditer Points
            const btnCreditRow = tr.querySelector(".btn-credit-pts");
            if (btnCreditRow) {
                btnCreditRow.addEventListener("click", () => {
                    const amtStr = prompt(`Valider et créditer des points pour ${m.firstName} (${m.phone}) :\n\nEntrez le montant de l'addition en DH (ou points, 1 DH = 1 pt) :`);
                    if (amtStr === null) return;
                    const amt = parseFloat(amtStr);
                    if (isNaN(amt) || amt <= 0) {
                        window.showGreyCornerNotice("Montant invalide", "Veuillez saisir un montant d'addition valide en DH.", "warning");
                        return;
                    }
                    const table = prompt("Numéro de table (optionnel) :", "") || "";
                    dbService.creditLoyaltyPoints(m.phone, amt, table, "admin", null, false, (ok, added, newTotal, resObj) => {
                        if (ok) {
                            window.showGreyCornerNotice("✅ POINTS CRÉDITÉS", `+${added} points crédités à ${m.firstName} (${m.phone}) !\nNouveau solde : ${newTotal} / 500 pts.`, "success");
                            if (dbService.syncMembersNow) dbService.syncMembersNow();
                            loadLoyaltyAlerts();
                        } else {
                            const msg = (resObj && (resObj.error || resObj.message)) || added || "❌ Erreur lors du crédit des points.";
                            window.showGreyCornerNotice("⛔ CRÉDIT REFUSÉ", msg, "error");
                        }
                    });
                });
            }

            // Action Déduire Points
            const btnAdjust = tr.querySelector(".btn-adjust-pts");
            if (btnAdjust) {
                btnAdjust.addEventListener("click", () => {
                    const deltaStr = prompt(`Déduire des points pour ${m.firstName} (${m.phone}) :\n\nEntrez le nombre de points à déduire (ex: 50) :`);
                    if (deltaStr === null) return;
                    const delta = parseInt(deltaStr, 10);
                    if (isNaN(delta) || delta <= 0) {
                        window.showGreyCornerNotice("Nombre invalide", "Veuillez saisir un nombre entier de points valide supérieur à 0.", "warning");
                        return;
                    }
                    const reason = prompt("Motif de la déduction (ex: Correction addition, remboursement) :") || "Déduction administrateur";

                    dbService.adjustLoyaltyPoints(m.phone, -delta, reason, "admin", (ok, newTotal) => {
                        if (ok) {
                            window.showGreyCornerNotice("✅ POINTS DÉDUITS", `-${delta} points déduits avec succès !\nNouveau solde de ${m.firstName} : ${newTotal} points.`, "success");
                            if (dbService.syncMembersNow) dbService.syncMembersNow();
                            loadLoyaltyAlerts();
                        } else {
                            window.showGreyCornerNotice("❌ Erreur", "Erreur lors de la déduction des points.", "error");
                        }
                    });
                });
            }

            // Action Offrir Jus (-1000 pts)
            const btnRedeemJ = tr.querySelector(".btn-redeem-juice-row");
            if (btnRedeemJ) {
                btnRedeemJ.addEventListener("click", () => {
                    if (confirm(`Déduire 1 000 points pour accorder 1 Jus de Fruits Frais à ${m.firstName} (${m.phone}) ?`)) {
                        dbService.redeemLoyaltyReward(m.phone, "admin", "juice", (ok, newTotal) => {
                            if (ok) {
                                window.showGreyCornerNotice("🍹 JUS OFFERT", `1 Jus de Fruits Frais accordé avec succès !\nNouveau solde de ${m.firstName} : ${newTotal} points.`, "success");
                                if (dbService.syncMembersNow) dbService.syncMembersNow();
                                loadLoyaltyAlerts();
                            } else {
                                window.showGreyCornerNotice("❌ Solde insuffisant", "Solde insuffisant (minimum 1 000 points requis) ou compte introuvable.", "error");
                            }
                        });
                    }
                });
            }

            // Action Offrir Boisson Chaude (-500 pts)
            const btnRedeemD = tr.querySelector(".btn-redeem-drink-row");
            if (btnRedeemD) {
                btnRedeemD.addEventListener("click", () => {
                    if (confirm(`Déduire 500 points pour accorder 1 Boisson Chaude à ${m.firstName} (${m.phone}) ?`)) {
                        dbService.redeemLoyaltyReward(m.phone, "admin", "hot_drink", (ok, newTotal) => {
                            if (ok) {
                                window.showGreyCornerNotice("☕ BOISSON CHAUDE OFFERTE", `1 Boisson Chaude accordée avec succès !\nNouveau solde de ${m.firstName} : ${newTotal} points.`, "success");
                                if (dbService.syncMembersNow) dbService.syncMembersNow();
                                loadLoyaltyAlerts();
                            } else {
                                window.showGreyCornerNotice("❌ Solde insuffisant", "Solde insuffisant (minimum 500 points requis) ou compte introuvable.", "error");
                            }
                        });
                    }
                });
            }

            // Action Historique des Transactions
            const btnHist = tr.querySelector(".btn-history-pts");
            if (btnHist) {
                btnHist.addEventListener("click", () => {
                    if (txModalTitle) txModalTitle.textContent = `Transactions — ${m.firstName} (${m.phone})`;
                    if (modalTx) modalTx.style.display = "flex";
                    if (txListContainer) txListContainer.innerHTML = "Chargement...";

                    dbService.getLoyaltyTransactions(m.phone, (txs) => {
                        if (!txListContainer) return;
                        if (!txs || txs.length === 0) {
                            txListContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Aucune transaction enregistrée pour ce membre.</div>`;
                            return;
                        }

                        txListContainer.innerHTML = txs.map(tx => {
                            const isPos = tx.pointsDelta >= 0;
                            const isAlert = tx.pointsDelta > 100 && tx.validatedBy && !tx.validatedBy.includes("admin") && !tx.validatedBy.includes("VÉRIFIÉ");
                            const d = tx.createdAt ? new Date(tx.createdAt).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";
                            return `
                                <div class="tx-item-card" ${isAlert ? 'style="border:1px solid #e74c3c; background:rgba(231,76,60,0.1);"' : ""}>
                                    <div>
                                        <div style="font-weight:700; color:#ffffff;">
                                            ${tx.note || tx.type}
                                            ${isAlert ? '<span style="color:#ff7675; font-size:0.75rem; margin-left:6px; font-weight:700;">⚠️ ALERTE >100 PTS</span>' : ''}
                                        </div>
                                        <div style="font-size:0.75rem; color:var(--muted);">
                                            ${d} • Validé par : <strong>${tx.validatedBy || "Système"}</strong> ${tx.tableNumber ? `• Table ${tx.tableNumber}` : ""}
                                        </div>
                                    </div>
                                    <div class="${isPos ? "tx-delta-pos" : "tx-delta-neg"}">
                                        ${isPos ? "+" : ""}${tx.pointsDelta} pts
                                    </div>
                                </div>
                            `;
                        }).join("");
                    });
                });
            }

            tableBody.appendChild(tr);
        });
    }

    // ── Outils Export CSV & Campagne WhatsApp ──
    const btnExportCSV = document.getElementById("btnExportLoyaltyCSV");
    if (btnExportCSV) {
        btnExportCSV.addEventListener("click", () => {
            if (!cachedAdminLoyaltyMembers || cachedAdminLoyaltyMembers.length === 0) {
                alert("Aucun client dans la base de données.");
                return;
            }
            downloadMembersCSV(cachedAdminLoyaltyMembers, `clients_grey_corner_${new Date().toISOString().split("T")[0]}.csv`);
        });
    }

    const btnCopyAll = document.getElementById("btnCopyAllPhones");
    if (btnCopyAll) {
        btnCopyAll.addEventListener("click", () => {
            if (!cachedAdminLoyaltyMembers || cachedAdminLoyaltyMembers.length === 0) {
                alert("Aucun client dans la base de données.");
                return;
            }
            const phones = cachedAdminLoyaltyMembers.map(m => m.phone).filter(Boolean).join(", ");
            navigator.clipboard.writeText(phones).then(() => {
                alert(`📋 ${cachedAdminLoyaltyMembers.length} numéros de téléphone copiés dans le presse-papier !`);
            }).catch(() => {
                prompt("Voici la liste des numéros (Ctrl+C pour copier) :", phones);
            });
        });
    }

    // ── Modale Campagne WhatsApp ──
    const modalWa = document.getElementById("adminWhatsAppModal");
    const btnOpenWa = document.getElementById("btnOpenWhatsAppCampaignModal");
    const btnCloseWa = document.getElementById("btnCloseWaModal");
    const waTargetSelect = document.getElementById("waTargetSelect");
    const waTargetCountLabel = document.getElementById("waTargetCountLabel");
    const waMessageText = document.getElementById("waMessageText");
    const btnCopyWaPhones = document.getElementById("btnCopyWaPhones");
    const btnExportWaCSV = document.getElementById("btnExportWaCSV");

    function getFilteredWaMembers() {
        const mode = waTargetSelect ? waTargetSelect.value : "all";
        return (cachedAdminLoyaltyMembers || []).filter(m => {
            const pts = m.points || 0;
            const tier = typeof window.getVipTier === "function" ? window.getVipTier(pts) : { id: 'bronze' };
            if (mode === "vip_platine") return tier.id === "platine";
            if (mode === "vip_gold") return tier.id === "gold";
            if (mode === "vip_silver") return tier.id === "silver";
            if (mode === "vip_bronze") return tier.id === "bronze";
            if (mode === "reward_juice") return pts >= 1000;
            if (mode === "reward_drink") return pts >= 500;
            if (mode === "near_reward") return pts >= 400 && pts < 500;
            if (mode === "new") return pts <= 50;
            return true;
        });
    }

    function updateWaTargetCount() {
        const list = getFilteredWaMembers();
        if (waTargetCountLabel) {
            waTargetCountLabel.textContent = `🎯 ${list.length} client(s) ciblé(s) sur ${cachedAdminLoyaltyMembers.length} inscrits.`;
        }
    }

    if (btnOpenWa && modalWa) {
        btnOpenWa.addEventListener("click", () => {
            modalWa.style.display = "flex";
            if (!waMessageText.value) {
                waMessageText.value = "Bonjour {prenom} ! ☕ Toute l'équipe de Grey Corner a le plaisir de vous accueillir ce week-end avec des nouveautés exclusives. Votre solde fidélité est toujours actif !";
            }
            updateWaTargetCount();
        });
    }

    if (btnCloseWa && modalWa) {
        btnCloseWa.addEventListener("click", () => modalWa.style.display = "none");
        modalWa.addEventListener("click", (e) => {
            if (e.target === modalWa) modalWa.style.display = "none";
        });
    }

    if (waTargetSelect) {
        waTargetSelect.addEventListener("change", updateWaTargetCount);
    }

    if (btnCopyWaPhones) {
        btnCopyWaPhones.addEventListener("click", () => {
            const list = getFilteredWaMembers();
            if (list.length === 0) {
                alert("Aucun client correspondant à ce filtre.");
                return;
            }
            const phones = list.map(m => m.phone).filter(Boolean).join(", ");
            navigator.clipboard.writeText(phones).then(() => {
                alert(`📋 ${list.length} numéros copiés dans le presse-papier ! Prêts à être collés dans WhatsApp.`);
            }).catch(() => {
                prompt("Voici les numéros :", phones);
            });
        });
    }

    if (btnExportWaCSV) {
        btnExportWaCSV.addEventListener("click", () => {
            const list = getFilteredWaMembers();
            if (list.length === 0) {
                alert("Aucun client correspondant à ce filtre.");
                return;
            }
            downloadMembersCSV(list, `clients_cibles_whatsapp_${waTargetSelect.value}.csv`);
        });
    }

    function downloadMembersCSV(membersList, filename) {
        let csv = "Prenom,Telephone,Points,Total_Gagne,Conso_Offertes,Source,Date_Inscription\n";
        membersList.forEach(m => {
            const safeName = (m.firstName || "Client").replace(/"/g, '""');
            const safePhone = (m.phone || "").replace(/"/g, '""');
            const pts = m.points || 0;
            const earned = m.totalEarned || pts;
            const rewards = m.rewardsClaimed || 0;
            const src = m.source || "qr_menu";
            const date = (m.createdAt || "").split("T")[0] || "";
            csv += `"${safeName}","${safePhone}",${pts},${earned},${rewards},"${src}","${date}"\n`;
        });

        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

function startAdminApp() {
    initAdminTabs();
    initAdminLoyaltyDashboard();

    // 1. Bind the freeze toggle button
    const btn = document.getElementById("toggleFreezeBtn");
    if (btn) {
        btn.addEventListener("click", () => {
            console.log("⚡ Freeze button clicked");
            if (typeof dbService !== "undefined") {
                dbService.setSystemFreeze(!systemFrozen, (success, errorMsg) => {
                    if (!success) {
                        alert("Erreur lors de la modification de l'état freeze :\n" + (errorMsg || "Erreur inconnue (Vérifiez votre connexion ou vos permissions Firebase)"));
                    }
                });
            }
        });
    }

    // Bind the database purge button
    const cleanupBtn = document.getElementById("dbCleanupBtn");
    if (cleanupBtn) {
        cleanupBtn.addEventListener("click", () => {
            if (confirm("Voulez-vous purger de la base de données toutes les données datant de plus de 24 heures ?")) {
                if (typeof dbService !== "undefined") {
                    dbService.cleanupOldData((success) => {
                        if (success) {
                            alert("Purge effectuée avec succès !");
                        } else {
                            alert("Échec de la purge.");
                        }
                    });
                }
            }
        });
    }

    // 2. Start streams safely
    try {
        initAdminStreams();
    } catch (err) {
        console.error("⚠️ Error starting streams:", err);
    }
}

// ============================================================================
// 🔒 ADMIN AUTHENTICATION SECURITY LAYER (CODE: greycorner2024)
// ============================================================================
const ADMIN_AUTH_CODE = "greycorner2024";
const ADMIN_AUTH_STORAGE_KEY = "gc_admin_authenticated";

let adminAppInitialized = false;

function isAdminAuthenticated() {
    try {
        return sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === "true";
    } catch (e) {
        return false;
    }
}

function unlockAdminUI() {
    const overlay = document.getElementById("adminAuthOverlay");
    const container = document.getElementById("adminMainContainer");
    if (overlay) overlay.style.display = "none";
    if (container) container.style.display = "flex";
}

function lockAdminUI() {
    const overlay = document.getElementById("adminAuthOverlay");
    const container = document.getElementById("adminMainContainer");
    if (overlay) overlay.style.display = "flex";
    if (container) container.style.display = "none";

    const input = document.getElementById("adminAuthCodeInput");
    if (input) {
        input.value = "";
        setTimeout(() => input.focus(), 150);
    }
}

function launchAdminAppSafely() {
    if (adminAppInitialized) return;
    adminAppInitialized = true;

    if (typeof dbService !== "undefined") {
        startAdminApp();
    } else {
        const checkInterval = setInterval(() => {
            if (typeof dbService !== "undefined") {
                clearInterval(checkInterval);
                startAdminApp();
            }
        }, 50);
    }
}

function handleAdminAuth(event) {
    if (event) event.preventDefault();

    const input = document.getElementById("adminAuthCodeInput");
    const errorEl = document.getElementById("adminAuthError");
    const card = document.getElementById("adminAuthCard");
    const enteredCode = input ? input.value.trim() : "";

    if (enteredCode === ADMIN_AUTH_CODE) {
        try {
            sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, "true");
        } catch (e) {}

        if (errorEl) errorEl.style.display = "none";
        unlockAdminUI();
        launchAdminAppSafely();
    } else {
        if (errorEl) {
            errorEl.style.display = "block";
            errorEl.textContent = "❌ Code d'accès incorrect. Veuillez réessayer.";
        }
        if (card) {
            card.classList.remove("auth-shake");
            void card.offsetWidth; // Force reflow
            card.classList.add("auth-shake");
            setTimeout(() => card.classList.remove("auth-shake"), 500);
        }
        if (input) {
            input.value = "";
            input.focus();
        }
    }
}

function handleAdminLogout() {
    if (confirm("Voulez-vous verrouiller la console d'administration ?")) {
        try {
            sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
        } catch (e) {}
        location.reload();
    }
}

function initAdminSecurity() {
    // 1. Bouton Afficher / Masquer mot de passe
    const toggleBtn = document.getElementById("adminAuthToggleVisibility");
    const codeInput = document.getElementById("adminAuthCodeInput");
    if (toggleBtn && codeInput) {
        toggleBtn.addEventListener("click", () => {
            const isPassword = codeInput.type === "password";
            codeInput.type = isPassword ? "text" : "password";
            toggleBtn.textContent = isPassword ? "🔒" : "👁️";
        });
    }

    // 2. Bouton Déconnexion dans le Header
    const logoutBtn = document.getElementById("adminLogoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleAdminLogout);
    }

    // 3. Vérification de l'état d'authentification
    if (isAdminAuthenticated()) {
        unlockAdminUI();
        launchAdminAppSafely();
    } else {
        lockAdminUI();
    }
}

window.handleAdminAuth = handleAdminAuth;
window.handleAdminLogout = handleAdminLogout;

document.addEventListener("DOMContentLoaded", () => {
    initAdminSecurity();
});

